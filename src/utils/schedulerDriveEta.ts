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
  type DoctorDayAppt,
  type DoctorDayResponse,
} from '../api/appointments';
import { etaHouseholdArrivalWindowPayload, fetchEtas } from '../api/routing';

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

type DayBundle = {
  date: string;
  households: SchedulerDriveHousehold[];
  timeline: { eta?: string | null; etd?: string | null }[];
  startDepot: { lat: number; lon: number } | null;
  endDepot: { lat: number; lon: number } | null;
};

async function fetchEtaForOneDay(day: DayBundle, doctorId: string): Promise<DayBundle> {
  if (day.households.length === 0) return day;

  const payload = {
    doctorId,
    date: day.date,
    households: day.households.map((h) => ({
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
  };

  const result: any = await fetchEtas(payload as any);
  const valid = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);

  const keyToSlot: Record<
    string,
    { eta: string | null; etd: string | null; bufferAfterMinutes?: number }
  > = {};
  if (Array.isArray(result?.byIndex)) {
    for (const row of result.byIndex as {
      key?: string;
      etaIso?: string;
      etdIso?: string;
      bufferAfterMinutes?: number;
    }[]) {
      const k = row?.key;
      if (k == null) continue;
      const eta = valid(row?.etaIso) ? row.etaIso! : null;
      const etd = valid(row?.etdIso) ? row.etdIso! : null;
      const bufferAfterMinutes =
        typeof row.bufferAfterMinutes === 'number' && Number.isFinite(row.bufferAfterMinutes)
          ? row.bufferAfterMinutes
          : undefined;
      keyToSlot[k] = {
        eta,
        etd,
        ...(bufferAfterMinutes !== undefined ? { bufferAfterMinutes } : {}),
      };
    }
  }

  let tl = day.households.map((h) => {
    const slot = h.key ? keyToSlot[h.key] : undefined;
    let eta = slot?.eta ?? null;
    let etd = slot?.etd ?? null;
    if (!eta && h?.startIso) eta = h.startIso;
    if (!etd && eta && h?.endIso) {
      const dur = h.startIso && h.endIso
        ? DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
        : 60;
      etd = DateTime.fromISO(eta).plus({ minutes: dur }).toISO()!;
    }
    return { eta: eta ?? undefined, etd: etd ?? undefined };
  });

  const N = day.households.length;
  let routingOrderIndices: number[];
  if (Array.isArray(result?.byIndex) && result.byIndex.length === N) {
    const keyToPositionInDay: Record<string, number> = {};
    result.byIndex.forEach((row: { key?: string; positionInDay?: number }, i: number) => {
      const pos = typeof row.positionInDay === 'number' ? row.positionInDay : i + 1;
      if (row.key != null) {
        for (const variant of keyVariantsForKeyString(row.key)) {
          keyToPositionInDay[variant] = pos;
        }
      }
    });
    const getPositionInDay = (householdIndex: number): number => {
      const h = day.households[householdIndex];
      const pos = keyToPositionInDay[h.key];
      if (pos != null) return pos;
      if (Number.isFinite(h.lat) && Number.isFinite(h.lon)) {
        const k5 = keyFor(h.lat as number, h.lon as number, 5);
        if (keyToPositionInDay[k5] != null) return keyToPositionInDay[k5];
      }
      return 999;
    };
    routingOrderIndices = Array.from({ length: N }, (_, i) => i).sort(
      (a, b) => getPositionInDay(a) - getPositionInDay(b)
    );
  } else {
    routingOrderIndices = Array.from({ length: N }, (_, i) => i).sort((a, b) => {
      const anchorA = tl[a]?.eta ?? tl[a]?.etd ?? day.households[a]?.startIso ?? '';
      const anchorB = tl[b]?.eta ?? tl[b]?.etd ?? day.households[b]?.startIso ?? '';
      return anchorA.localeCompare(anchorB);
    });
  }

  for (let p = 1; p < routingOrderIndices.length; p++) {
    const currIdx = routingOrderIndices[p];
    const prevIdx = routingOrderIndices[p - 1];
    const h = day.households[currIdx];
    if (!h?.isPersonalBlock) continue;
    const curSlot = tl[currIdx];
    const prevSlot = tl[prevIdx];
    if (!curSlot?.eta || !prevSlot?.etd) continue;
    const etaDt = DateTime.fromISO(curSlot.eta);
    const prevEtdDt = DateTime.fromISO(prevSlot.etd);
    if (!etaDt.isValid || !prevEtdDt.isValid || etaDt >= prevEtdDt) continue;
    const durMin = Math.max(
      1,
      curSlot.etd
        ? Math.round(DateTime.fromISO(curSlot.etd).diff(etaDt, 'minutes').minutes)
        : h.startIso && h.endIso
          ? Math.round(DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso), 'minutes').minutes)
          : 60
    );
    const newEta = prevEtdDt;
    const newEtd = newEta.plus({ minutes: durMin });
    tl[currIdx] = {
      ...curSlot,
      eta: newEta.toISO()!,
      etd: newEtd.toISO()!,
    };
  }

  return { ...day, timeline: tl };
}

/**
 * For each calendar date, load doctor day + ETAs and return arrive/leave ISO per appointment id
 * (same stop shares the same ETA/ETD).
 */
export async function fetchSchedulerDriveIsoByAppointmentId(
  dates: string[],
  doctorId: string
): Promise<Map<string, DriveIsoPair>> {
  const out = new Map<string, DriveIsoPair>();

  await Promise.all(
    dates.map(async (date) => {
      try {
        const resp: DoctorDayResponse = await fetchDoctorDay(date, doctorId);
        const appts: DoctorDayAppt[] = resp?.appointments ?? [];
        const households = buildHouseholdsWithSourceIds(appts);
        if (households.length === 0) return;

        let day: DayBundle = {
          date,
          households,
          timeline: households.map(() => ({ eta: null, etd: null })),
          startDepot: resp?.startDepot ?? null,
          endDepot: resp?.endDepot ?? null,
        };

        const needsEta = households.length > 0 && day.timeline.every((t) => !t.eta && !t.etd);
        if (needsEta) {
          try {
            day = await fetchEtaForOneDay(day, doctorId);
          } catch {
            /* fall through: use scheduled window */
          }
        }

        day.households.forEach((h, i) => {
          const slot = day.timeline[i];
          let startIso = slot?.eta ?? slot?.etd ?? h.startIso;
          let endIso = slot?.etd ?? null;
          if (startIso && !endIso && h.startIso && h.endIso) {
            const dur = DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso), 'minutes').minutes;
            endIso = DateTime.fromISO(startIso).plus({ minutes: Math.max(1, Math.round(dur)) }).toISO()!;
          }
          if (!startIso || !endIso) return;
          for (const id of h.sourceAppointmentIds) {
            out.set(String(id), { startIso, endIso });
          }
        });
      } catch {
        /* skip day */
      }
    })
  );

  return out;
}
