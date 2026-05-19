/**
 * Resolve ETA/ETD (arrive/leave) per appointment for the practice scheduler,
 * using the same doctor-day + /routing/eta flow as My Week.
 */
import { DateTime } from 'luxon';
import {
  fetchDoctorDay,
  clientDisplayName,
  isBlockEntry,
  blockDisplayLabel,
  miniZoneFromPayload,
  type DoctorDayAppt,
  type DoctorDayPatientPrimaryProvider,
  type DoctorDayResponse,
  type MiniZone,
} from '../api/appointments';
import { etaHouseholdArrivalWindowPayload, fetchEtas } from '../api/routing';
import type { DayData } from '../pages/MyWeek';
import { mergeEtaFetchIntoDayData, type DayBundleIn } from './schedulerEtaMerge';
import {
  SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
  type RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';

const str = (o: unknown, k: string) =>
  typeof (o as Record<string, unknown>)?.[k] === 'string' ? ((o as Record<string, unknown>)[k] as string) : undefined;
const num = (o: unknown, k: string) => {
  const v = (o as Record<string, unknown>)?.[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(+v)) return +v;
  return undefined;
};
const getStartISO = (a: DoctorDayAppt) =>
  str(a, 'appointmentStart') ?? str(a, 'scheduledStartIso') ?? str(a, 'startIso');
const getEndISO = (a: DoctorDayAppt) =>
  str(a, 'appointmentEnd') ?? str(a, 'scheduledEndIso') ?? str(a, 'endIso');

function keyFor(lat: number, lon: number, d = 6) {
  const m = Math.pow(10, d);
  return `${Math.round(lat * m) / m},${Math.round(lon * m) / m}`;
}

function keyVariantsForKeyString(s: string): string[] {
  const suffix = s.includes(':') ? s.slice(s.indexOf(':')) : '';
  const base = suffix ? s.slice(0, s.indexOf(':')) : s;
  const parts = base.split(',');
  if (parts.length !== 2) return [s];
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return [s];
  const k6 = keyFor(lat, lon, 6) + suffix;
  const k5 = keyFor(lat, lon, 5) + suffix;
  return [s, k6, k5].filter((x, i, arr) => arr.indexOf(x) === i);
}

function splitAddressForRoutingDoctorDay(addr?: string) {
  if (!addr) return {};
  const [line, rest = ''] = addr.split(',').map((s) => s.trim());
  const m = rest.match(/^([^,]+)\s+([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
  return m
    ? { address1: line, city: m[1], state: m[2].toUpperCase(), zip: m[3] }
    : { address1: addr };
}

/** Doctor-day row for routing preview — aligned with `MyWeek` virtual injection + `/routing/eta` candidateSlot. */
function buildDoctorDaySyntheticFromRoutingPreview(
  preview: RoutingCalendarPreviewPayloadV1
): DoctorDayAppt | null {
  const opt = preview.option;
  const startRaw = String(opt.suggestedStartIso ?? '').trim();
  if (!startRaw) return null;
  const start = DateTime.fromISO(startRaw, { zone: 'utc' });
  if (!start.isValid) return null;
  const mins = Math.max(1, Math.floor(preview.serviceMinutes) || 30);
  const end = start.plus({ minutes: mins });
  const meta = preview.newApptMeta ?? {};
  const parts = splitAddressForRoutingDoctorDay(typeof meta.address === 'string' ? meta.address : undefined);
  const clientName =
    preview.clientDisplayLabel?.trim() ||
    (typeof opt.clientName === 'string' ? opt.clientName : null) ||
    'New Appointment';

  const synthetic: DoctorDayAppt = {
    id: SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
    clientName,
    lat: Number.isFinite(meta.lat as number) ? meta.lat : undefined,
    lon: Number.isFinite(meta.lon as number) ? meta.lon : undefined,
    address1: (parts.address1 ?? (typeof meta.address === 'string' ? meta.address : '')) || '',
    city: parts.city ?? meta.city,
    state: parts.state ?? meta.state,
    zip: parts.zip ?? meta.zip,
    startIso: start.toISO()!,
    endIso: end.toISO()!,
  };
  const cz = miniZoneFromPayload((opt as { clientZone?: unknown }).clientZone);
  const ez = miniZoneFromPayload((opt as { effectiveZone?: unknown }).effectiveZone);
  if (cz) synthetic.clientZone = cz;
  if (ez) synthetic.effectiveZone = ez;
  const aw = (opt as { arrivalWindow?: { windowStartIso?: string; windowEndIso?: string } }).arrivalWindow;
  if (aw?.windowStartIso && aw?.windowEndIso) {
    synthetic.effectiveWindow = { startIso: aw.windowStartIso, endIso: aw.windowEndIso };
  }
  (synthetic as { isPreview?: boolean }).isPreview = true;
  const rawIns = opt.insertionIndex;
  const ins =
    typeof rawIns === 'number' && Number.isFinite(rawIns)
      ? Math.floor(rawIns)
      : rawIns != null
        ? Math.floor(Number(rawIns)) || 0
        : 0;
  const pd = (opt as { positionInDay?: unknown }).positionInDay;
  (synthetic as { positionInDay?: number }).positionInDay =
    typeof pd === 'number' && Number.isFinite(pd)
      ? Math.floor(pd)
      : pd != null
        ? Math.floor(Number(pd)) || ins + 1
        : ins + 1;
  return synthetic;
}

function injectDoctorDayAppointmentsRoutingPreview(
  appts: DoctorDayAppt[],
  preview: RoutingCalendarPreviewPayloadV1
): DoctorDayAppt[] {
  const syn = buildDoctorDaySyntheticFromRoutingPreview(preview);
  if (!syn) return appts;
  const rawIns = preview.option.insertionIndex;
  const ins =
    typeof rawIns === 'number' && Number.isFinite(rawIns)
      ? Math.floor(rawIns)
      : rawIns != null
        ? Math.floor(Number(rawIns)) || 0
        : 0;
  const insertionIndex = Math.max(0, Math.min(appts.length, ins));
  return [...appts.slice(0, insertionIndex), syn, ...appts.slice(insertionIndex)];
}

function normalizeAddressString(s?: string): string | null {
  if (!s) return null;
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[,\s]+$/g, '').trim() || null;
}
function addressKeyForAppt(a: DoctorDayAppt): string | null {
  const address1 = normalizeAddressString(str(a, 'address1'));
  const city = normalizeAddressString(str(a, 'city'));
  const state = normalizeAddressString(str(a, 'state'));
  const zip = normalizeAddressString(str(a, 'zip'));
  const structured = [address1, city, state, zip].filter(Boolean).join('|');
  if (structured) return `structured:${structured}`;
  const free =
    normalizeAddressString(str(a as any, 'address')) ||
    normalizeAddressString(str(a as any, 'addressStr')) ||
    normalizeAddressString(str(a as any, 'fullAddress'));
  return free ? `free:${free}` : null;
}

function householdGroupKey(
  a: DoctorDayAppt,
  lat: number,
  lon: number,
  addrKey: string | null,
  idPart: string,
  hasGeo: boolean
): string {
  const clientId = (a as any)?.clientPimsId ?? (a as any)?.clientId;
  const clientPart = clientId != null ? String(clientId) : (str(a, 'clientName') ?? '').trim();
  if (hasGeo) return `${lat}_${lon}_${clientPart}`;
  if (addrKey) return `addr:${addrKey}_${clientPart}`;
  return `noloc:${idPart}`;
}

type PatientBadge = { name: string; type?: string | null };
function makePatientBadge(a: DoctorDayAppt): PatientBadge {
  const name =
    str(a as any, 'patientName') ||
    str(a as any, 'petName') ||
    str(a as any, 'animalName') ||
    str(a as any, 'name') ||
    'Patient';
  const type = str(a, 'appointmentType') || str(a as any, 'appointmentTypeName') || str(a as any, 'serviceName') || null;
  return { name, type };
}

function formatAddress(a: DoctorDayAppt) {
  const address1 = str(a, 'address1');
  const city = str(a, 'city');
  const state = str(a, 'state');
  const zip = str(a, 'zip');
  const line = [address1, [city, state].filter(Boolean).join(', '), zip]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+,/g, ',');
  return (
    line ||
    str(a as any, 'address') ||
    str(a as any, 'addressStr') ||
    str(a as any, 'fullAddress') ||
    'Address not available'
  );
}

export type SchedulerDriveHousehold = {
  key: string;
  client: string;
  address: string;
  lat: number;
  lon: number;
  startIso: string | null;
  endIso: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
  isNoLocation?: boolean;
  isPersonalBlock?: boolean;
  isPreview?: boolean;
  patients: PatientBadge[];
  primary: DoctorDayAppt;
  effectiveWindow?: { startIso: string; endIso: string };
  firstApptIndex?: number;
  /** Every doctor-day appointment id merged into this household (for ETA mapping). */
  sourceAppointmentIds: (string | number)[];
};

function assignEtaKeysForSameAddress(households: SchedulerDriveHousehold[]): void {
  const byLoc = new Map<string, SchedulerDriveHousehold[]>();
  for (const h of households) {
    const hasGeo =
      Number.isFinite(h.lat) &&
      Number.isFinite(h.lon) &&
      Math.abs(h.lat) > 1e-6 &&
      Math.abs(h.lon) > 1e-6;
    const locKey = hasGeo ? `${h.lat}_${h.lon}` : h.key;
    if (!byLoc.has(locKey)) byLoc.set(locKey, []);
    byLoc.get(locKey)!.push(h);
  }
  for (const [, list] of byLoc) {
    if (list.length === 0) continue;
    const first = list[0];
    const hasGeo =
      Number.isFinite(first.lat) &&
      Number.isFinite(first.lon) &&
      Math.abs(first.lat) > 1e-6 &&
      Math.abs(first.lon) > 1e-6;
    const baseKey = hasGeo ? keyFor(first.lat, first.lon, 6) : first.key;
    list.forEach((h, i) => {
      h.key = i === 0 ? baseKey : `${baseKey}:${i + 1}`;
    });
  }
}

function buildHouseholdsWithSourceIds(appts: DoctorDayAppt[]): SchedulerDriveHousehold[] {
  const m = new Map<string, SchedulerDriveHousehold>();
  for (const [idx, a] of appts.entries()) {
    const rawLat = num(a, 'lat');
    const rawLon = num(a, 'lon');
    const backendNoLoc = Boolean((a as any)?.isNoLocation ?? (a as any)?.noLocation ?? (a as any)?.unroutable);
    const inRange =
      typeof rawLat === 'number' &&
      typeof rawLon === 'number' &&
      Math.abs(rawLat) <= 90 &&
      Math.abs(rawLon) <= 180;
    const nonZero =
      typeof rawLat === 'number' &&
      typeof rawLon === 'number' &&
      Math.abs(rawLat) > 1e-6 &&
      Math.abs(rawLon) > 1e-6;
    const hasGeo = !backendNoLoc && inRange && nonZero;
    const lat = hasGeo ? (rawLat as number) : 0;
    const lon = hasGeo ? (rawLon as number) : 0;
    const addrKey = hasGeo ? null : addressKeyForAppt(a);
    const idPart = (a as any)?.id != null ? String((a as any).id) : String(idx);
    const groupKey = householdGroupKey(a, lat, lon, addrKey, idPart, hasGeo);
    const isPersonalBlock = isBlockEntry({ ...a, key: groupKey });
    const isPreview = (a as any)?.isPreview === true;
    const patient = makePatientBadge(a);
    const effectiveWindow = (a as any)?.effectiveWindow;
    const windowStartIso = effectiveWindow?.startIso ?? null;
    const windowEndIso = effectiveWindow?.endIso ?? null;
    const apptId = (a as any)?.id;

    if (!m.has(groupKey)) {
      const initialKey = hasGeo ? keyFor(lat, lon, 6) : addrKey ? `addr:${addrKey}` : `noloc:${idPart}`;
      m.set(groupKey, {
        key: initialKey,
        client: isBlockEntry(a) ? blockDisplayLabel(a) : clientDisplayName(a),
        address: formatAddress(a),
        lat,
        lon,
        startIso: getStartISO(a) ?? null,
        endIso: getEndISO(a) ?? null,
        windowStartIso: windowStartIso ?? undefined,
        windowEndIso: windowEndIso ?? undefined,
        isNoLocation: !hasGeo,
        isPersonalBlock,
        isPreview,
        patients: isPersonalBlock ? [] : [patient],
        primary: a,
        effectiveWindow: (() => {
          const ew = (a as any)?.effectiveWindow;
          return ew?.startIso && ew?.endIso ? { startIso: ew.startIso, endIso: ew.endIso } : undefined;
        })(),
        firstApptIndex: idx,
        sourceAppointmentIds: apptId != null ? [apptId] : [],
      });
    } else {
      const h = m.get(groupKey)!;
      h.firstApptIndex = Math.min(h.firstApptIndex ?? idx, idx);
      const s = getStartISO(a);
      const e = getEndISO(a);
      const sDt = s ? DateTime.fromISO(s) : null;
      const eDt = e ? DateTime.fromISO(e) : null;
      if (sDt && (!h.startIso || sDt < DateTime.fromISO(h.startIso))) h.startIso = sDt.toISO();
      if (eDt && (!h.endIso || eDt > DateTime.fromISO(h.endIso))) h.endIso = eDt.toISO();
      if (!h.isPersonalBlock) {
        const exists = h.patients.some((p) => p.name === patient.name && p.type === patient.type);
        if (!exists) h.patients.push(patient);
      }
      if (isPreview) h.isPreview = true;
      if (apptId != null) h.sourceAppointmentIds.push(apptId);
    }
  }
  const list = Array.from(m.values()).sort((a, b) => {
    if (a.firstApptIndex != null && b.firstApptIndex != null) {
      return a.firstApptIndex - b.firstApptIndex;
    }
    return (
      (a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0) -
      (b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0)
    );
  });
  assignEtaKeysForSameAddress(list);
  return list;
}

export type DriveIsoPair = { startIso: string; endIso: string };

/** Optional routing calendar preview — doctor-day + `/routing/eta` match `MyWeek` virtual day. */
export type SchedulerDriveRoutingPreviewOptions = {
  routingPreview?: RoutingCalendarPreviewPayloadV1 | null;
  /** Practice-local YYYY-MM-DD for the preview column (must match `day.date` to apply). */
  previewPracticeDateKey?: string | null;
};

async function fetchEtaForOneDay(
  day: DayBundleIn,
  doctorId: string,
  routingOpts?: SchedulerDriveRoutingPreviewOptions | null
): Promise<DayData> {
  if (day.households.length === 0) {
    return {
      date: day.date,
      timezone: day.timezone,
      households: day.households as unknown as DayData['households'],
      timeline: [],
      startDepot: day.startDepot,
      endDepot: day.endDepot,
      startDepotTown: day.startDepotTown?.trim() || null,
      startDepotTime: day.startDepotTime,
      endDepotTime: day.endDepotTime,
    };
  }

  const hasVirtual =
    routingOpts?.routingPreview &&
    routingOpts.previewPracticeDateKey === day.date &&
    day.households.some((h: { isPreview?: boolean }) => h.isPreview);

  let householdsForPayload = day.households;
  let candidateExtras: Record<string, unknown> = {};

  if (hasVirtual && routingOpts?.routingPreview) {
    const rp = routingOpts.routingPreview;
    const opt = rp.option as Record<string, unknown>;
    const rawIns = opt.insertionIndex;
    const insertionIndex = Math.max(
      0,
      Math.min(
        day.households.length - 1,
        typeof rawIns === 'number' && Number.isFinite(rawIns)
          ? Math.floor(rawIns)
          : rawIns != null
            ? Math.floor(Number(rawIns)) || day.households.length - 1
            : day.households.length - 1
      )
    );
    const existing = day.households.filter((h: { isPreview?: boolean }) => !h.isPreview);
    const virtualH = day.households.find((h: { isPreview?: boolean }) => h.isPreview);
    const sortedExisting = [...existing].sort(
      (a: { firstApptIndex?: number }, b: { firstApptIndex?: number }) =>
        (a.firstApptIndex ?? 999) - (b.firstApptIndex ?? 999)
    );
    householdsForPayload =
      virtualH != null
        ? [...sortedExisting.slice(0, insertionIndex), virtualH, ...sortedExisting.slice(insertionIndex)]
        : sortedExisting;

    const lat = rp.newApptMeta?.lat;
    const lon = rp.newApptMeta?.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const pd = opt.positionInDay;
      const positionInDay =
        typeof pd === 'number' && Number.isFinite(pd)
          ? Math.floor(pd)
          : pd != null
            ? Math.floor(Number(pd)) || insertionIndex + 1
            : insertionIndex + 1;
      const aw = opt.arrivalWindow as { windowStartIso?: string; windowEndIso?: string } | undefined;
      const vr = opt.validationReturnSec;
      const overrunSeconds =
        typeof vr === 'number' && Number.isFinite(vr)
          ? vr
          : vr != null && Number.isFinite(Number(vr))
            ? Number(vr)
            : undefined;
      candidateExtras = {
        candidateSlot: {
          insertionIndex,
          positionInDay,
          suggestedStartIso: String(opt.suggestedStartIso ?? ''),
          lat,
          lon,
          serviceMinutes: Math.max(1, Math.floor(rp.serviceMinutes) || 30),
          ...(overrunSeconds !== undefined ? { overrunSeconds } : {}),
          ...(aw?.windowStartIso && aw?.windowEndIso
            ? {
                arrivalWindow: {
                  windowStartIso: aw.windowStartIso,
                  windowEndIso: aw.windowEndIso,
                },
              }
            : {}),
        },
      };
    }
  }

  const payload = {
    doctorId,
    date: day.date,
    households: householdsForPayload.map((h) => ({
      key: h.key,
      lat: h.lat,
      lon: h.lon,
      startIso: h.startIso,
      endIso: h.endIso,
      ...etaHouseholdArrivalWindowPayload({
        isBlock: !!h.isPersonalBlock,
        isNoLocation: !!h.isNoLocation,
        lat: h.lat,
        lon: h.lon,
        startIso: h.startIso,
        endIso: h.endIso,
        effectiveWindow: h.effectiveWindow ?? (h.primary as any)?.effectiveWindow,
      }),
    })),
    startDepot: day.startDepot ? { lat: day.startDepot.lat, lon: day.startDepot.lon } : undefined,
    endDepot: day.endDepot ? { lat: day.endDepot.lat, lon: day.endDepot.lon } : undefined,
    useTraffic: false,
    ...candidateExtras,
  };

  const result: any = await fetchEtas(payload as any);
  return mergeEtaFetchIntoDayData(day, result);
}

function isoMapFromDayData(dayData: DayData): Map<string, DriveIsoPair> {
  const out = new Map<string, DriveIsoPair>();
  dayData.households.forEach((h: any, i: number) => {
    const slot = dayData.timeline[i];
    let startIso = slot?.eta ?? slot?.etd ?? h.startIso;
    let endIso = slot?.etd ?? null;
    if (startIso && !endIso && h.startIso && h.endIso) {
      const dur = DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso), 'minutes').minutes;
      endIso = DateTime.fromISO(startIso).plus({ minutes: Math.max(1, Math.round(dur)) }).toISO()!;
    }
    if (!startIso || !endIso) return;
    const ids: (string | number)[] = h.sourceAppointmentIds ?? [];
    for (const id of ids) {
      out.set(String(id), { startIso, endIso });
    }
  });
  return out;
}

export type SchedulerDriveDayResult = {
  date: string;
  dayData: DayData;
  isoPairs: [string, DriveIsoPair][];
};

function scheduleOnlyDayData(dayIn: DayBundleIn): DayData {
  return {
    date: dayIn.date,
    timezone: dayIn.timezone,
    households: dayIn.households as unknown as DayData['households'],
    timeline: dayIn.households.map((h: any) => ({
      eta: h.startIso ?? undefined,
      etd: h.endIso ?? undefined,
    })),
    startDepot: dayIn.startDepot,
    endDepot: dayIn.endDepot,
    startDepotTown: dayIn.startDepotTown?.trim() || null,
    startDepotTime: dayIn.startDepotTime,
    endDepotTime: dayIn.endDepotTime,
  };
}

/** Schedule times only (no routing ETA) — same as the fallback path when `/routing/eta` fails. */
export function schedulerDriveScheduleOnlyFromBundle(dayIn: DayBundleIn): SchedulerDriveDayResult {
  const dayData = scheduleOnlyDayData(dayIn);
  const isoPairs: [string, DriveIsoPair][] = [];
  for (const [k, v] of isoMapFromDayData(dayData)) {
    isoPairs.push([k, v]);
  }
  return { date: dayIn.date, dayData, isoPairs };
}

/** Per-appointment membership from GET /appointments/doctor (not always present on /appointments/range). */
export type SchedulerDoctorDayMembership = {
  isMember: boolean;
  membershipName: string | null;
};

export type SchedulerDoctorDayAppointmentZones = {
  clientZone: MiniZone;
  effectiveZone: MiniZone;
};

function zonesMapFromDoctorDayAppointments(
  appts: DoctorDayAppt[]
): Map<string, SchedulerDoctorDayAppointmentZones> {
  const out = new Map<string, SchedulerDoctorDayAppointmentZones>();
  for (const a of appts) {
    if (isBlockEntry(a)) continue;
    const id = a.id != null ? String(a.id) : '';
    if (!id) continue;
    const clientZone = miniZoneFromPayload((a as { clientZone?: unknown }).clientZone);
    const effectiveZone = miniZoneFromPayload((a as { effectiveZone?: unknown }).effectiveZone);
    if (!clientZone && !effectiveZone) continue;
    out.set(String(id), { clientZone, effectiveZone });
  }
  return out;
}

export type SchedulerDoctorDayBundleFetch = {
  bundle: DayBundleIn | null;
  membershipByApptId: Map<string, SchedulerDoctorDayMembership>;
  zonesByApptId: Map<string, SchedulerDoctorDayAppointmentZones>;
  /** Chart PCP from GET /appointments/doctor (null = explicitly none). */
  patientPrimaryProviderByApptId: Map<string, DoctorDayPatientPrimaryProvider | null>;
};

function patientPrimaryProviderMapFromDoctorDayAppointments(
  appts: DoctorDayAppt[]
): Map<string, DoctorDayPatientPrimaryProvider | null> {
  const out = new Map<string, DoctorDayPatientPrimaryProvider | null>();
  for (const a of appts) {
    if (isBlockEntry(a)) continue;
    const sid = a.id != null ? String(a.id) : '';
    if (!sid) continue;
    out.set(sid, a.patientPrimaryProvider ?? null);
  }
  return out;
}

function membershipMapFromDoctorDayAppointments(
  appts: DoctorDayAppt[]
): Map<string, SchedulerDoctorDayMembership> {
  const out = new Map<string, SchedulerDoctorDayMembership>();
  for (const a of appts) {
    if (isBlockEntry(a)) continue;
    const id = a.id != null ? String(a.id) : '';
    if (!id) continue;
    const rawMn = a.membershipName;
    const membershipName =
      typeof rawMn === 'string' && rawMn.trim()
        ? rawMn.trim()
        : rawMn != null && String(rawMn).trim()
          ? String(rawMn).trim()
          : null;
    out.set(id, { isMember: Boolean(a.isMember), membershipName });
  }
  return out;
}

/** GET doctor-day + households (no `/routing/eta`) plus membership keyed by appointment id. */
export async function fetchSchedulerDoctorDayBundle(
  date: string,
  doctorId: string,
  routingPreviewOpts?: SchedulerDriveRoutingPreviewOptions | null
): Promise<SchedulerDoctorDayBundleFetch> {
  const empty = (): Map<string, SchedulerDoctorDayMembership> => new Map();
  const emptyZones = (): Map<string, SchedulerDoctorDayAppointmentZones> => new Map();
  const emptyPcp = (): Map<string, DoctorDayPatientPrimaryProvider | null> => new Map();
  try {
    const resp: DoctorDayResponse = await fetchDoctorDay(date, doctorId);
    let appts: DoctorDayAppt[] = resp?.appointments ?? [];
    const membershipByApptId = membershipMapFromDoctorDayAppointments(appts);
    const zonesByApptId = zonesMapFromDoctorDayAppointments(appts);
    const patientPrimaryProviderByApptId = patientPrimaryProviderMapFromDoctorDayAppointments(appts);

    if (
      routingPreviewOpts?.routingPreview &&
      routingPreviewOpts.previewPracticeDateKey &&
      routingPreviewOpts.previewPracticeDateKey === date
    ) {
      appts = injectDoctorDayAppointmentsRoutingPreview(appts, routingPreviewOpts.routingPreview);
    }

    const households = buildHouseholdsWithSourceIds(appts);
    if (households.length === 0) {
      return { bundle: null, membershipByApptId, zonesByApptId, patientPrimaryProviderByApptId };
    }

    const tz =
      typeof (resp as any)?.timezone === 'string' && (resp as any).timezone.trim()
        ? String((resp as any).timezone).trim()
        : 'America/New_York';

    const bundle: DayBundleIn = {
      date,
      timezone: tz,
      households,
      timeline: households.map(() => ({ eta: null, etd: null })),
      startDepot: resp?.startDepot ?? null,
      endDepot: resp?.endDepot ?? null,
      startDepotTown: str(resp, 'startDepotTown')?.trim() || null,
      startDepotTime: str(resp as any, 'startDepotTime') ?? null,
      endDepotTime: str(resp as any, 'endDepotTime') ?? null,
    };
    return { bundle, membershipByApptId, zonesByApptId, patientPrimaryProviderByApptId };
  } catch {
    return { bundle: null, membershipByApptId: empty(), zonesByApptId: emptyZones(), patientPrimaryProviderByApptId: emptyPcp() };
  }
}

/** Merge `/routing/eta` into a doctor-day bundle (drive + arrive/leave). */
export async function fetchSchedulerDriveEtasForDayBundle(
  dayIn: DayBundleIn,
  doctorId: string,
  routingPreviewOpts?: SchedulerDriveRoutingPreviewOptions | null
): Promise<SchedulerDriveDayResult> {
  let dayData: DayData;
  try {
    dayData = await fetchEtaForOneDay(dayIn, doctorId, routingPreviewOpts);
  } catch {
    dayData = scheduleOnlyDayData(dayIn);
  }
  const isoPairs: [string, DriveIsoPair][] = [];
  for (const [k, v] of isoMapFromDayData(dayData)) {
    isoPairs.push([k, v]);
  }
  return { date: dayIn.date, dayData, isoPairs };
}

/**
 * Load doctor-day + ETAs for a single calendar date (one column). Used when both requests run back-to-back.
 */
export async function fetchSchedulerDriveContextForDate(
  date: string,
  doctorId: string,
  routingPreviewOpts?: SchedulerDriveRoutingPreviewOptions | null
): Promise<SchedulerDriveDayResult | null> {
  const { bundle } = await fetchSchedulerDoctorDayBundle(date, doctorId, routingPreviewOpts);
  if (!bundle) return null;
  return fetchSchedulerDriveEtasForDayBundle(bundle, doctorId, routingPreviewOpts);
}

/**
 * Doctor-day + full ETA merge (drive seconds, windows, routing order) plus per-appointment arrive/leave map.
 */
export async function fetchSchedulerDriveContext(
  dates: string[],
  doctorId: string
): Promise<{ isoByApptId: Map<string, DriveIsoPair>; dayByDate: Map<string, DayData> }> {
  const isoByApptId = new Map<string, DriveIsoPair>();
  const dayByDate = new Map<string, DayData>();

  await Promise.all(
    dates.map(async (date) => {
      const r = await fetchSchedulerDriveContextForDate(date, doctorId);
      if (!r) return;
      dayByDate.set(r.date, r.dayData);
      for (const [k, v] of r.isoPairs) {
        isoByApptId.set(k, v);
      }
    })
  );

  return { isoByApptId, dayByDate };
}

/**
 * For each calendar date, load doctor day + ETAs and return arrive/leave ISO per appointment id
 * (same stop shares the same ETA/ETD).
 */
export async function fetchSchedulerDriveIsoByAppointmentId(
  dates: string[],
  doctorId: string
): Promise<Map<string, DriveIsoPair>> {
  const { isoByApptId } = await fetchSchedulerDriveContext(dates, doctorId);
  return isoByApptId;
}
