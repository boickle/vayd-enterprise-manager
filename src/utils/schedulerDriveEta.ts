/**
 * Resolve ETA/ETD (arrive/leave) per appointment for the practice scheduler,
 * using the same doctor-day + /routing/eta flow as My Week.
 */
import { DateTime } from 'luxon';
import {
  fetchDoctorDay,
  clientDisplayName,
  isAppointmentCancelledOnPracticeCalendar,
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
import { makeMyDayVisualPatientBadge, type MyDayVisualPatientBadge } from './myDayVisualPatientDetails';
import { mergeEtaFetchIntoDayData, type DayBundleIn } from './schedulerEtaMerge';
import type { AppointmentType } from '../api/appointmentSettings';
import {
  arrivalWindowFromScheduledStart,
  effectiveWindowForScheduledStart,
} from './appointmentArrivalWindow';
import {
  applyEditTimePreviewToDoctorDayAppts,
  type EditVisitTimePreview,
} from './editVisitTimePreview';
import {
  SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
  type RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';
import {
  buildEtaCandidateSlot,
  orderHouseholdsWithCandidateAtInsertion,
  resolveRoutingEtaInsertionIndex,
  type RoutingEtaCandidateSlotSource,
} from './routingEtaCandidateSlot';
import {
  buildRoutingRescheduleContextForSlotSearch,
  readRoutingRescheduleIntent,
  rescheduleScopeTargets,
  type RoutingRescheduleIntentV1,
} from './routingRescheduleIntent';
import { householdGroupKey } from './doctorDayHouseholdGroup';

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
  preview: RoutingCalendarPreviewPayloadV1,
  previewAppointmentType?: AppointmentType | null,
  practiceTz = 'utc',
  /** Co-visit add-pet anchor's doctor-day row — its backend-resolved geo + stop wins over client home. */
  coVisitAnchorRow?: DoctorDayAppt | null
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
  const useAlt = Boolean(preview.routingUsesAlternateAddress && meta.address?.trim());
  const previewPatients = preview.previewPatients ?? [];
  const primaryPatient =
    previewPatients.find((p) => String(p.name ?? '').trim()) ?? previewPatients[0] ?? null;

  // The anchor visit is already geocoded for its (possibly alternate) stop, so inherit its
  // coordinates/address instead of the client-home coords the draft carries. This keeps the
  // co-visit pet on the same routed stop rather than routing to the client's home.
  const anchorLat = coVisitAnchorRow != null ? num(coVisitAnchorRow, 'lat') : undefined;
  const anchorLon = coVisitAnchorRow != null ? num(coVisitAnchorRow, 'lon') : undefined;
  const anchorHasGeo =
    typeof anchorLat === 'number' &&
    typeof anchorLon === 'number' &&
    Math.abs(anchorLat) > 1e-6 &&
    Math.abs(anchorLon) > 1e-6;

  const synthetic: DoctorDayAppt = {
    id: SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
    clientName,
    ...(meta.clientPimsId?.trim() ? { clientPimsId: meta.clientPimsId.trim() } : {}),
    lat: anchorHasGeo ? anchorLat : Number.isFinite(meta.lat as number) ? meta.lat : undefined,
    lon: anchorHasGeo ? anchorLon : Number.isFinite(meta.lon as number) ? meta.lon : undefined,
    address1:
      (coVisitAnchorRow ? str(coVisitAnchorRow, 'address1') : undefined) ??
      (parts.address1 ?? (typeof meta.address === 'string' ? meta.address : '')) ??
      '',
    city: (coVisitAnchorRow ? str(coVisitAnchorRow, 'city') : undefined) ?? parts.city ?? meta.city,
    state: (coVisitAnchorRow ? str(coVisitAnchorRow, 'state') : undefined) ?? parts.state ?? meta.state,
    zip: (coVisitAnchorRow ? str(coVisitAnchorRow, 'zip') : undefined) ?? parts.zip ?? meta.zip,
    startIso: start.toISO()!,
    endIso: end.toISO()!,
    ...(primaryPatient
      ? {
          patientName: String(primaryPatient.name ?? '').trim() || undefined,
          patientPimsId:
            primaryPatient.id != null ? String(primaryPatient.id) : undefined,
        }
      : {}),
  };
  if (meta.clientId?.trim()) {
    (synthetic as DoctorDayAppt & { clientId?: string }).clientId = meta.clientId.trim();
  }
  const anchorAlt = coVisitAnchorRow?.isAlternateStop
    ? (coVisitAnchorRow.alternateAddressText?.trim() ||
        (coVisitAnchorRow.alternateAddress as { addressText?: string } | null)?.addressText?.trim() ||
        '')
    : '';
  const altText = anchorAlt || (useAlt ? meta.address!.trim() : '');
  if (altText) {
    synthetic.isAlternateStop = true;
    synthetic.alternateAddressText = altText;
    synthetic.alternateAddress = { addressText: altText };
  }
  const cz = miniZoneFromPayload((opt as { clientZone?: unknown }).clientZone);
  const ez = miniZoneFromPayload((opt as { effectiveZone?: unknown }).effectiveZone);
  if (cz) synthetic.clientZone = cz;
  if (ez) synthetic.effectiveZone = ez;
  const aw = (opt as { arrivalWindow?: { windowStartIso?: string; windowEndIso?: string } }).arrivalWindow;
  if (aw?.windowStartIso && aw?.windowEndIso) {
    synthetic.effectiveWindow = { startIso: aw.windowStartIso, endIso: aw.windowEndIso };
  } else {
    const ew = effectiveWindowForScheduledStart(
      start.toISO()!,
      previewAppointmentType ?? undefined,
      practiceTz,
      { appointmentEndIso: end.toISO()! }
    );
    if (ew) synthetic.effectiveWindow = ew;
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

/** Extra doctor-day rows so multi-pet co-visit previews show every pet on the household stop. */
function buildDoctorDayCoVisitCompanionAppts(
  preview: RoutingCalendarPreviewPayloadV1,
  primary: DoctorDayAppt
): DoctorDayAppt[] {
  const patients = preview.previewPatients ?? [];
  if (patients.length <= 1) return [];
  const primaryName = (primary.patientName ?? '').trim().toLowerCase();
  const primaryId = primary.patientPimsId != null ? String(primary.patientPimsId) : '';
  const out: DoctorDayAppt[] = [];
  let offset = 1;
  for (const p of patients) {
    const name = String(p.name ?? '').trim();
    if (!name) continue;
    const idStr = p.id != null ? String(p.id) : '';
    if (
      (primaryId && idStr && idStr === primaryId) ||
      (primaryName && name.toLowerCase() === primaryName)
    ) {
      continue;
    }
    out.push({
      ...primary,
      id: SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID - offset,
      patientName: name,
      patientPimsId: idStr || undefined,
    });
    offset += 1;
  }
  return out;
}

function injectDoctorDayAppointmentsRoutingPreview(
  appts: DoctorDayAppt[],
  preview: RoutingCalendarPreviewPayloadV1,
  previewAppointmentType?: AppointmentType | null,
  practiceTz = 'utc',
  /** Resolved before align-omit — the anchor is often removed from `appts` for the combined preview. */
  coVisitAnchorRow?: DoctorDayAppt | null
): DoctorDayAppt[] {
  const anchorId = Number(preview.manualBookDraft?.coVisitAnchorAppointmentId);
  const anchorFromList =
    Number.isFinite(anchorId) && anchorId > 0
      ? appts.find((a) => Number(a.id) === anchorId) ?? null
      : null;
  const syn = buildDoctorDaySyntheticFromRoutingPreview(
    preview,
    previewAppointmentType,
    practiceTz,
    coVisitAnchorRow ?? anchorFromList
  );
  if (!syn) return appts;
  const companions = buildDoctorDayCoVisitCompanionAppts(preview, syn);
  const inject = [syn, ...companions];
  const rawIns = preview.option.insertionIndex;
  const ins =
    typeof rawIns === 'number' && Number.isFinite(rawIns)
      ? Math.floor(rawIns)
      : rawIns != null
        ? Math.floor(Number(rawIns)) || 0
        : 0;
  const insertionIndex = Math.max(0, Math.min(appts.length, ins));
  return [...appts.slice(0, insertionIndex), ...inject, ...appts.slice(insertionIndex)];
}

/** Hide co-visit siblings that will be time-aligned when confirming the manual-book preview. */
export function omitManualBookCoVisitAlignFromDoctorDayAppts(
  appts: DoctorDayAppt[],
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined
): DoctorDayAppt[] {
  if (!preview || preview.previewSource !== 'manual-book') return appts;
  const ids = preview.manualBookDraft?.coVisitAlignAppointmentIds ?? [];
  const omit = new Set(
    ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
  );
  if (omit.size === 0) return appts;
  return appts.filter((a) => {
    if ((a as { isPreview?: boolean }).isPreview) return true;
    const id = a.id;
    return typeof id !== 'number' || !omit.has(id);
  });
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

type PatientBadge = MyDayVisualPatientBadge;
function makePatientBadge(a: DoctorDayAppt): PatientBadge {
  return makeMyDayVisualPatientBadge(a);
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

function serviceMinutesFromIsoPair(
  startIso: string | null | undefined,
  endIso: string | null | undefined
): number | undefined {
  if (!startIso?.trim() || !endIso?.trim()) return undefined;
  const start = DateTime.fromISO(startIso);
  const end = DateTime.fromISO(endIso);
  if (!start.isValid || !end.isValid) return undefined;
  const mins = Math.round(end.diff(start, 'minutes').minutes);
  if (!Number.isFinite(mins) || mins <= 0) return undefined;
  return Math.max(1, mins);
}

function etaHouseholdSchedulingFields(h: SchedulerDriveHousehold): {
  startIso: string | null | undefined;
  endIso: string | null | undefined;
  appointmentStart?: string;
  appointmentEnd?: string;
  serviceMinutes?: number;
} {
  const primary = h.primary;
  const appointmentStart = primary.appointmentStart ?? h.startIso ?? undefined;
  const appointmentEnd = primary.appointmentEnd ?? h.endIso ?? undefined;
  const serviceMinutes =
    primary.serviceMinutes ??
    serviceMinutesFromIsoPair(appointmentStart ?? null, appointmentEnd ?? null);
  return {
    startIso: h.startIso,
    endIso: h.endIso,
    ...(appointmentStart ? { appointmentStart } : {}),
    ...(appointmentEnd ? { appointmentEnd } : {}),
    ...(serviceMinutes != null ? { serviceMinutes } : {}),
  };
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

/** Overlap or back-to-back scheduled times — same visit clump (multi-pet); otherwise separate stops. */
function scheduledIntervalsClumped(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function appointmentScheduledIntervalMs(
  a: DoctorDayAppt
): { start: number; end: number } | null {
  const s = getStartISO(a);
  const e = getEndISO(a);
  if (!s || !e) return null;
  const start = DateTime.fromISO(s).toMillis();
  const end = DateTime.fromISO(e).toMillis();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/**
 * Same client + location can host multiple same-day visits. Only merge when scheduled times
 * overlap or touch (multi-pet one stop); morning + afternoon stay separate households.
 */
function splitApptsByScheduledTimeClumps(
  bucket: { appt: DoctorDayAppt; index: number }[]
): { appt: DoctorDayAppt; index: number }[][] {
  if (bucket.length <= 1) return bucket.length === 1 ? [bucket] : [];
  const intervals = bucket.map(({ appt }) => appointmentScheduledIntervalMs(appt));
  const n = bucket.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = intervals[i];
      const b = intervals[j];
      // Missing times: keep separate unless both missing (still same stop / multi-pet unknown).
      if (!a || !b) {
        if (!a && !b) {
          adj[i].push(j);
          adj[j].push(i);
        }
        continue;
      }
      if (scheduledIntervalsClumped(a.start, a.end, b.start, b.end)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const visited = new Array(n).fill(false);
  const clumps: { appt: DoctorDayAppt; index: number }[][] = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const stack = [i];
    visited[i] = true;
    const clump: { appt: DoctorDayAppt; index: number }[] = [];
    while (stack.length) {
      const u = stack.pop()!;
      clump.push(bucket[u]!);
      for (const v of adj[u]!) {
        if (!visited[v]) {
          visited[v] = true;
          stack.push(v);
        }
      }
    }
    clump.sort((x, y) => x.index - y.index);
    clumps.push(clump);
  }
  return clumps;
}

function householdFromApptClump(
  clump: { appt: DoctorDayAppt; index: number }[],
  lat: number,
  lon: number,
  hasGeo: boolean,
  addrKey: string | null,
  idPart: string
): SchedulerDriveHousehold {
  const first = clump[0]!;
  const a0 = first.appt;
  const groupKey = householdGroupKey(a0, lat, lon, addrKey, idPart, hasGeo);
  const isPersonalBlock = isBlockEntry({ ...a0, key: groupKey });
  const initialKey = hasGeo ? keyFor(lat, lon, 6) : addrKey ? `addr:${addrKey}` : `noloc:${idPart}`;

  let startIso: string | null = null;
  let endIso: string | null = null;
  let isPreview = false;
  const patients: PatientBadge[] = [];
  const sourceAppointmentIds: (string | number)[] = [];
  let primary = a0;
  let firstApptIndex = first.index;
  let windowStartIso: string | undefined;
  let windowEndIso: string | undefined;
  let effectiveWindow: { startIso: string; endIso: string } | undefined;

  for (const { appt: a, index: idx } of clump) {
    firstApptIndex = Math.min(firstApptIndex, idx);
    const s = getStartISO(a);
    const e = getEndISO(a);
    const sDt = s ? DateTime.fromISO(s) : null;
    const eDt = e ? DateTime.fromISO(e) : null;
    if (sDt?.isValid && (!startIso || sDt < DateTime.fromISO(startIso))) startIso = sDt.toISO();
    if (eDt?.isValid && (!endIso || eDt > DateTime.fromISO(endIso))) endIso = eDt.toISO();
    if ((a as { isPreview?: boolean }).isPreview === true) {
      isPreview = true;
      primary = a;
    }
    if (!isPersonalBlock) {
      const patient = makePatientBadge(a);
      const exists = patients.some((p) => p.name === patient.name && p.type === patient.type);
      if (!exists) patients.push(patient);
    }
    const apptId = (a as { id?: string | number }).id;
    if (apptId != null) sourceAppointmentIds.push(apptId);
    const ew = (a as { effectiveWindow?: { startIso?: string; endIso?: string } }).effectiveWindow;
    if (ew?.startIso && ew?.endIso) {
      if (!effectiveWindow) {
        effectiveWindow = { startIso: ew.startIso, endIso: ew.endIso };
        windowStartIso = ew.startIso;
        windowEndIso = ew.endIso;
      } else {
        const w0 = DateTime.fromISO(effectiveWindow.startIso);
        const w1 = DateTime.fromISO(effectiveWindow.endIso);
        const n0 = DateTime.fromISO(ew.startIso);
        const n1 = DateTime.fromISO(ew.endIso);
        if (n0.isValid && (!w0.isValid || n0 < w0)) effectiveWindow.startIso = ew.startIso;
        if (n1.isValid && (!w1.isValid || n1 > w1)) effectiveWindow.endIso = ew.endIso;
        windowStartIso = effectiveWindow.startIso;
        windowEndIso = effectiveWindow.endIso;
      }
    }
  }

  return {
    key: initialKey,
    client: isBlockEntry(a0) ? blockDisplayLabel(a0) : clientDisplayName(a0),
    address: formatAddress(a0),
    lat,
    lon,
    startIso,
    endIso,
    windowStartIso,
    windowEndIso,
    isNoLocation: !hasGeo,
    isPersonalBlock,
    isPreview,
    patients: isPersonalBlock ? [] : patients,
    primary,
    effectiveWindow,
    firstApptIndex,
    sourceAppointmentIds,
  };
}

function buildHouseholdsWithSourceIds(appts: DoctorDayAppt[]): SchedulerDriveHousehold[] {
  type BucketItem = { appt: DoctorDayAppt; index: number };
  type LocMeta = {
    lat: number;
    lon: number;
    hasGeo: boolean;
    addrKey: string | null;
    idPart: string;
    items: BucketItem[];
  };
  const buckets = new Map<string, LocMeta>();

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
    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = { lat, lon, hasGeo, addrKey, idPart, items: [] };
      buckets.set(groupKey, bucket);
    }
    bucket.items.push({ appt: a, index: idx });
  }

  const list: SchedulerDriveHousehold[] = [];
  for (const meta of buckets.values()) {
    const clumps = splitApptsByScheduledTimeClumps(meta.items);
    for (const clump of clumps) {
      const idPart =
        (clump[0]!.appt as { id?: string | number }).id != null
          ? String((clump[0]!.appt as { id?: string | number }).id)
          : meta.idPart;
      list.push(
        householdFromApptClump(clump, meta.lat, meta.lon, meta.hasGeo, meta.addrKey, idPart)
      );
    }
  }

  list.sort((a, b) => {
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
  /** Appointment type for routing preview — used for ±N arrival windows on synthetic rows. */
  previewAppointmentType?: AppointmentType | null;
  /** Move an existing visit to proposed times for drive-time preview (edit visit flow). */
  editTimePreview?: EditVisitTimePreview | null;
  /** Draft type when `editTimePreview.kind` is `type`. */
  editPreviewDraftType?: AppointmentType | null;
  /** Active reschedule row — omits moved visits from doctor-day + passes `rescheduleContext` to `/routing/eta`. */
  rescheduleIntent?: RoutingRescheduleIntentV1 | null;
};

/** Drop visits being rescheduled from doctor-day simulation (server `loadDoctorDay` parity).
 * Explore Alternatives keeps the originals (new stop is additive). */
export function omitRescheduleTargetsFromDoctorDayAppts(
  appts: DoctorDayAppt[],
  intent: RoutingRescheduleIntentV1 | null | undefined
): DoctorDayAppt[] {
  if (!intent || intent.exploreAlternatives) return appts;
  const omit = new Set(rescheduleScopeTargets(intent).appointmentIds);
  if (omit.size === 0) return appts;
  return appts.filter((a) => {
    if ((a as { isPreview?: boolean }).isPreview) return true;
    const id = a.id;
    return typeof id !== 'number' || !omit.has(id);
  });
}

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
    const insertionIndex = resolveRoutingEtaInsertionIndex(opt.insertionIndex, day.households.length);
    householdsForPayload = orderHouseholdsWithCandidateAtInsertion(day.households, insertionIndex);

    const optArrivalWindow = opt.arrivalWindow as RoutingEtaCandidateSlotSource['arrivalWindow'];
    const fallbackArrivalWindow =
      optArrivalWindow?.windowStartIso && optArrivalWindow?.windowEndIso
        ? optArrivalWindow
        : arrivalWindowFromScheduledStart(
            String(opt.suggestedStartIso ?? ''),
            routingOpts?.previewAppointmentType ?? undefined,
            day.timezone || 'utc',
            {
              appointmentEndIso: DateTime.fromISO(String(opt.suggestedStartIso ?? ''), { zone: 'utc' })
                .plus({ minutes: Math.max(1, Math.floor(rp.serviceMinutes) || 30) })
                .toISO() ?? undefined,
            }
          );
    const previewHousehold = day.households.find(
      (h: { isPreview?: boolean }) => h.isPreview === true
    );
    const candidateLat =
      previewHousehold && Number.isFinite(previewHousehold.lat) && Math.abs(previewHousehold.lat) > 1e-6
        ? previewHousehold.lat
        : rp.newApptMeta?.lat;
    const candidateLon =
      previewHousehold && Number.isFinite(previewHousehold.lon) && Math.abs(previewHousehold.lon) > 1e-6
        ? previewHousehold.lon
        : rp.newApptMeta?.lon;
    const candidateSlot = buildEtaCandidateSlot(
      {
        insertionIndex: opt.insertionIndex as RoutingEtaCandidateSlotSource['insertionIndex'],
        positionInDay: opt.positionInDay as RoutingEtaCandidateSlotSource['positionInDay'],
        suggestedStartIso: opt.suggestedStartIso as string | undefined,
        lat: candidateLat,
        lon: candidateLon,
        serviceMinutes: rp.serviceMinutes,
        overrunSeconds: opt.overrunSeconds as RoutingEtaCandidateSlotSource['overrunSeconds'],
        validationLastEtdSec: opt.validationLastEtdSec as RoutingEtaCandidateSlotSource['validationLastEtdSec'],
        validationReturnSec: opt.validationReturnSec as RoutingEtaCandidateSlotSource['validationReturnSec'],
        arrivalWindow: fallbackArrivalWindow,
      },
      { householdCount: day.households.length, defaultServiceMinutes: rp.serviceMinutes }
    );
    if (candidateSlot) {
      candidateExtras = { candidateSlot };
    }
  }

  const rescheduleIntent = routingOpts?.rescheduleIntent ?? readRoutingRescheduleIntent();
  const rescheduleContext =
    rescheduleIntent != null
      ? buildRoutingRescheduleContextForSlotSearch(rescheduleIntent, day.date, day.date)
      : undefined;

  const payload = {
    doctorId,
    date: day.date,
    households: householdsForPayload.map((h) => ({
      key: h.key,
      lat: h.lat,
      lon: h.lon,
      ...etaHouseholdSchedulingFields(h),
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
    ...(rescheduleContext ? { rescheduleContext } : {}),
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

export type SchedulerDoctorDayEffectiveWindow = {
  startIso: string;
  endIso: string;
};

function isCompleteMapFromDoctorDayAppointments(
  appts: DoctorDayAppt[]
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const a of appts) {
    if (isBlockEntry(a)) continue;
    const id = a.id != null ? String(a.id) : '';
    if (!id) continue;
    out.set(id, a.isComplete === true);
  }
  return out;
}

function effectiveWindowMapFromDoctorDayAppointments(
  appts: DoctorDayAppt[]
): Map<string, SchedulerDoctorDayEffectiveWindow> {
  const out = new Map<string, SchedulerDoctorDayEffectiveWindow>();
  for (const a of appts) {
    if (isBlockEntry(a)) continue;
    const id = a.id != null ? String(a.id) : '';
    if (!id) continue;
    const ew = (a as { effectiveWindow?: { startIso?: string; endIso?: string } }).effectiveWindow;
    const startIso = ew?.startIso?.trim();
    const endIso = ew?.endIso?.trim();
    if (!startIso || !endIso) continue;
    out.set(id, { startIso, endIso });
  }
  return out;
}

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
  effectiveWindowByApptId: Map<string, SchedulerDoctorDayEffectiveWindow>;
  /** Chart PCP from GET /appointments/doctor (null = explicitly none). */
  patientPrimaryProviderByApptId: Map<string, DoctorDayPatientPrimaryProvider | null>;
  /** PIMS/eVet complete flag from GET /appointments/doctor. */
  isCompleteByApptId: Map<string, boolean>;
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

/**
 * Remove a cancelled visit from cached drive-day layout immediately (before doctor-day refetch).
 * Drops the household when it was the only appointment there; otherwise strips the id from `sourceAppointmentIds`.
 */
export function dropAppointmentFromDriveDayData(dayData: DayData, apptId: string | number): DayData {
  const idStr = String(apptId);
  const households = dayData.households ?? [];
  const timeline = dayData.timeline ?? [];
  const newHouseholds: DayData['households'] = [];
  const newTimeline: DayData['timeline'] = [];

  for (let i = 0; i < households.length; i++) {
    const h = households[i];
    const ids = h.sourceAppointmentIds ?? [];
    if (!ids.some((id: string | number) => String(id) === idStr)) {
      newHouseholds.push(h);
      newTimeline.push(timeline[i] ?? {});
      continue;
    }
    if (ids.length <= 1) continue;
    newHouseholds.push({
      ...h,
      sourceAppointmentIds: ids.filter((id: string | number) => String(id) !== idStr),
    });
    newTimeline.push(timeline[i] ?? {});
  }

  if (newHouseholds.length === households.length) return dayData;

  const n = newHouseholds.length;
  let driveSeconds = dayData.driveSeconds;
  if (Array.isArray(driveSeconds) && driveSeconds.length > 0) {
    driveSeconds = driveSeconds.slice(0, Math.max(0, n > 0 ? n + 1 : 0));
  }

  return {
    ...dayData,
    households: newHouseholds,
    timeline: newTimeline,
    driveSeconds,
    routingOrderIndices: null,
  };
}

/** GET doctor-day + households (no `/routing/eta`) plus membership keyed by appointment id. */
export async function fetchSchedulerDoctorDayBundle(
  date: string,
  doctorId: string,
  routingPreviewOpts?: SchedulerDriveRoutingPreviewOptions | null
): Promise<SchedulerDoctorDayBundleFetch> {
  const empty = (): Map<string, SchedulerDoctorDayMembership> => new Map();
  const emptyZones = (): Map<string, SchedulerDoctorDayAppointmentZones> => new Map();
  const emptyEffectiveWindow = (): Map<string, SchedulerDoctorDayEffectiveWindow> => new Map();
  const emptyPcp = (): Map<string, DoctorDayPatientPrimaryProvider | null> => new Map();
  const emptyIsComplete = (): Map<string, boolean> => new Map();
  try {
    const resp: DoctorDayResponse = await fetchDoctorDay(date, doctorId);
    let appts: DoctorDayAppt[] = resp?.appointments ?? [];
    const membershipByApptId = membershipMapFromDoctorDayAppointments(appts);
    const zonesByApptId = zonesMapFromDoctorDayAppointments(appts);
    const patientPrimaryProviderByApptId = patientPrimaryProviderMapFromDoctorDayAppointments(appts);
    const isCompleteByApptId = isCompleteMapFromDoctorDayAppointments(appts);

    if (
      routingPreviewOpts?.editTimePreview &&
      routingPreviewOpts.editTimePreview.practiceDateKey === date
    ) {
      appts = applyEditTimePreviewToDoctorDayAppts(appts, routingPreviewOpts.editTimePreview, {
        draftType: routingPreviewOpts.editPreviewDraftType ?? undefined,
        practiceTz: resp.timezone,
      });
    }

    if (
      routingPreviewOpts?.routingPreview &&
      routingPreviewOpts.previewPracticeDateKey &&
      routingPreviewOpts.previewPracticeDateKey === date
    ) {
      const ri = routingPreviewOpts.rescheduleIntent ?? readRoutingRescheduleIntent();
      // Capture before align-omit — Update-all hides the anchor, which still owns the ALT geo.
      const anchorId = Number(
        routingPreviewOpts.routingPreview.manualBookDraft?.coVisitAnchorAppointmentId
      );
      const coVisitAnchorRow =
        Number.isFinite(anchorId) && anchorId > 0
          ? appts.find((a) => Number(a.id) === anchorId) ?? null
          : null;
      appts = omitRescheduleTargetsFromDoctorDayAppts(appts, ri);
      appts = omitManualBookCoVisitAlignFromDoctorDayAppts(
        appts,
        routingPreviewOpts.routingPreview
      );
      appts = injectDoctorDayAppointmentsRoutingPreview(
        appts,
        routingPreviewOpts.routingPreview,
        routingPreviewOpts.previewAppointmentType,
        resp.timezone,
        coVisitAnchorRow
      );
    } else if (routingPreviewOpts?.rescheduleIntent) {
      appts = omitRescheduleTargetsFromDoctorDayAppts(appts, routingPreviewOpts.rescheduleIntent);
    }

    appts = appts.filter(
      (a) => !isAppointmentCancelledOnPracticeCalendar(a as Record<string, unknown>)
    );

    // After preview/reschedule transforms so promised windows match the times we will drive/ETA.
    const effectiveWindowByApptId = effectiveWindowMapFromDoctorDayAppointments(appts);

    const households = buildHouseholdsWithSourceIds(appts);

    const tz =
      typeof (resp as any)?.timezone === 'string' && (resp as any).timezone.trim()
        ? String((resp as any).timezone).trim()
        : 'America/New_York';

    // Keep bundle even with zero visits so day-off days (null depot times) still reach the scheduler.
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
    return {
      bundle,
      membershipByApptId,
      zonesByApptId,
      effectiveWindowByApptId,
      patientPrimaryProviderByApptId,
      isCompleteByApptId,
    };
  } catch {
    return {
      bundle: null,
      membershipByApptId: empty(),
      zonesByApptId: emptyZones(),
      effectiveWindowByApptId: emptyEffectiveWindow(),
      patientPrimaryProviderByApptId: emptyPcp(),
      isCompleteByApptId: emptyIsComplete(),
    };
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
