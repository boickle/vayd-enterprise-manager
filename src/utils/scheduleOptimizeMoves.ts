import { DateTime } from 'luxon';
import { clientPhoneLineFromDoctorDayPayload, patchAppointment } from '../api/appointments';
import type { DayData, WeekHousehold } from '../pages/MyWeek';
import { dayTotalDriveSeconds, doctorDayIsOff } from '../pages/MyWeek';
import { isFixedTimeTypeName } from './editVisitTimePreview';
import { appointmentNotesFromDoctorDayRow } from './myDayVisualPatientDetails';
import { computeDriveTimeWindowWarning } from './windowWarning';
import {
  effectiveWindowForScheduledStart,
  type AppointmentTypeWindowSource,
} from './appointmentArrivalWindow';
import {
  normalizeAppointmentTypeName,
  type AppointmentTypeCatalog,
} from './appointmentTypeSettings';
import { pointsPerDriveHour } from './pointsPerDriveHour';
import {
  aggregateRoomLoaderPreApptStatus,
  roomLoaderPreApptDisplayColor,
  roomLoaderPreApptDisplayLabel,
} from './roomLoaderPreApptDisplay';
import {
  findDayOutlierHouseholds,
  isRoutableOptimizeStop,
  buildOptimizeBaseline,
  type OptimizeBaseline,
} from './scheduleOptimize';
import { fetchSchedulerDriveContextForDate, fetchSchedulerDriveEtasForDayBundle } from './schedulerDriveEta';
import type { DayBundleIn } from './schedulerEtaMerge';
import { householdsInRoutingDisplayOrder } from './maps';

const MAX_SLOT_SEARCHES = 8;
const MAX_DAY_SEARCHES = 8;
const MIN_SAVE_SEC = 5 * 60;
const MIN_SAME_DAY_SHIFT_SEC = 10 * 60;
const ISOLATED_DRIVE_MIN = 40;
const CLOSER_BY_KM = 8;
const WORK_END_SLACK_MIN = 30;

export type OptimizeMoveScope = 'day' | 'week';

export type OptimizeMove = {
  id: string;
  scope: OptimizeMoveScope;
  client: string;
  clientId: number | null;
  clientPhone: string | null;
  petNames: string[];
  /** Unique appointment type names (doctor-day visual PDF). */
  appointmentType: string | null;
  /** Unique appt notes / description (doctor-day visual PDF). */
  appointmentDescription: string | null;
  /** Room-loader label: Not sent / Email sent / Client submitted form. */
  roomLoaderStatus: string;
  roomLoaderStatusColor: string;
  fromDate: string;
  toDate: string;
  fromTimeLabel: string;
  toTimeLabel: string;
  /** Type ±N arrival window, e.g. "(9:45 AM–11:45 AM)". */
  fromWindowLabel: string | null;
  toWindowLabel: string | null;
  appointmentIds: number[];
  originalStartIso: string;
  newStartIso: string;
  newEndIso: string;
  /** Routable-stop insertion index on the destination day (after the closest remaining visit). */
  insertionIndex: number;
  windowWarningsBefore: number;
  windowWarningsAfter: number;
  driveDeltaMin: number;
  ppdhBefore: number | null;
  ppdhAfter: number | null;
  reason: string;
};

type RelocateProposal = {
  fromDate: string;
  toDate: string;
  household: WeekHousehold;
  score: number;
  reason: string;
  scope: OptimizeMoveScope;
};

function numId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function householdAppointmentIds(h: WeekHousehold): number[] {
  const raw = h.sourceAppointmentIds?.length
    ? h.sourceAppointmentIds
    : h.primary.id != null
      ? [h.primary.id]
      : [];
  const ids: number[] = [];
  for (const id of raw) {
    const n = numId(id);
    if (n != null) ids.push(n);
  }
  return [...new Set(ids)];
}

function householdClientId(h: WeekHousehold): number | null {
  const fromPrimary = numId((h.primary as { clientId?: unknown }).clientId);
  if (fromPrimary != null) return fromPrimary;
  const c = h.primary.client;
  if (c && typeof c === 'object') {
    return numId((c as { id?: unknown }).id);
  }
  return null;
}

function householdClientPhone(h: WeekHousehold): string | null {
  const line = clientPhoneLineFromDoctorDayPayload(h.primary);
  if (!line) return null;
  return line.split('·')[0]?.trim() || null;
}

function householdPetNames(h: WeekHousehold): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of h.patients) {
    const name = p.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function uniqueTrimmed(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function householdTypeName(h: WeekHousehold): string {
  const at = h.primary.appointmentType as unknown;
  if (at && typeof at === 'object') {
    const row = at as { name?: string; prettyName?: string };
    const nested = String(row.prettyName || row.name || '').trim();
    if (nested) return nested;
  }
  if (typeof at === 'string' && at.trim()) return at.trim();
  const row = h.primary as Record<string, unknown>;
  for (const key of ['appointmentTypeName', 'serviceName'] as const) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return String(h.patients[0]?.type ?? '').trim();
}

function householdAppointmentTypeForWindow(
  h: WeekHousehold,
  catalog: AppointmentTypeCatalog | undefined
): AppointmentTypeWindowSource | undefined {
  const at = h.primary.appointmentType as unknown;
  if (at && typeof at === 'object' && !Array.isArray(at)) {
    const row = at as AppointmentTypeWindowSource & { id?: number };
    if (row.windowBeforeMinutes != null || row.windowAfterMinutes != null) return row;
    const id = Number(row.id);
    if (catalog && Number.isFinite(id) && id > 0) {
      const byId = catalog.byId.get(id);
      if (byId) return byId;
    }
  }
  const name = householdTypeName(h);
  if (catalog && name) {
    const found = catalog.byName.get(normalizeAppointmentTypeName(name));
    if (found) return found;
  }
  if (typeof at === 'string' && at.trim()) return { name: at.trim() };
  if (name) return { name };
  return undefined;
}

function existingHouseholdWindow(h: WeekHousehold): { startIso: string; endIso: string } | undefined {
  const ew = h.effectiveWindow ?? h.primary.effectiveWindow;
  if (ew?.startIso?.trim() && ew?.endIso?.trim()) {
    return { startIso: ew.startIso.trim(), endIso: ew.endIso.trim() };
  }
  const start = h.windowStartIso?.trim();
  const end = h.windowEndIso?.trim();
  if (start && end) return { startIso: start, endIso: end };
  return undefined;
}

function formatWindowParen(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  practiceTz: string
): string | null {
  if (!startIso || !endIso) return null;
  const a = formatTimeLabel(startIso, practiceTz);
  const b = formatTimeLabel(endIso, practiceTz);
  if (!a || !b) return null;
  return `(${a}–${b})`;
}

function householdAppointmentTypeLabel(h: WeekHousehold): string | null {
  const types = uniqueTrimmed([householdTypeName(h), ...h.patients.map((p) => p.type)]);
  return types.length ? types.join(' · ') : null;
}

function householdAppointmentDescription(h: WeekHousehold): string | null {
  const notes = uniqueTrimmed([
    appointmentNotesFromDoctorDayRow(h.primary),
    ...h.patients.map((p) => p.appointmentNotes || p.desc),
  ]);
  return notes.length ? notes.join(' · ') : null;
}

function householdRoomLoader(h: WeekHousehold): { label: string; color: string } {
  const ui = aggregateRoomLoaderPreApptStatus([
    h.primary.confirmStatusName,
    ...h.patients.map((p) => p.status),
  ]);
  return {
    label: roomLoaderPreApptDisplayLabel(ui),
    color: roomLoaderPreApptDisplayColor(ui),
  };
}

function householdServiceMinutes(h: WeekHousehold): number {
  const typed = h.primary.serviceMinutes;
  if (typeof typed === 'number' && Number.isFinite(typed) && typed > 0) {
    return Math.max(15, Math.round(typed));
  }
  const start = h.startIso ?? h.primary.appointmentStart ?? h.primary.startIso;
  const end = h.endIso ?? h.primary.appointmentEnd ?? h.primary.endIso;
  if (start && end) {
    const a = DateTime.fromISO(start);
    const b = DateTime.fromISO(end);
    if (a.isValid && b.isValid) {
      const mins = Math.round(b.diff(a, 'minutes').minutes);
      if (mins > 0) return Math.max(15, mins);
    }
  }
  return 45;
}

function originalStartIso(h: WeekHousehold): string | null {
  const raw = h.startIso ?? h.primary.appointmentStart ?? h.primary.startIso;
  return raw?.trim() || null;
}

export function isMovableOptimizeHousehold(h: WeekHousehold): boolean {
  if (!isRoutableOptimizeStop(h)) return false;
  if (h.primary.isComplete === true) return false;
  if (h.primary.isFixed === true || h.primary.fixedTime === true) return false;
  if (isFixedTimeTypeName(householdTypeName(h))) return false;
  return householdAppointmentIds(h).length > 0 && originalStartIso(h) != null;
}

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function centroid(stops: WeekHousehold[]): { lat: number; lon: number } | null {
  const pts = stops.filter(isRoutableOptimizeStop);
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, h) => s + h.lat, 0) / pts.length;
  const lon = pts.reduce((s, h) => s + h.lon, 0) / pts.length;
  return { lat, lon };
}

function householdKey(h: WeekHousehold, date: string): string {
  const ids = householdAppointmentIds(h).slice().sort((a, b) => a - b);
  return `${date}:${ids.join(',')}`;
}

function shortDay(dateIso: string): string {
  const dt = DateTime.fromISO(dateIso);
  return dt.isValid ? dt.toFormat('ccc M/d') : dateIso.slice(5);
}

function formatTimeLabel(iso: string, practiceTz: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(practiceTz);
  return dt.isValid ? dt.toFormat('h:mm a') : '';
}

function dayDataToBundle(day: DayData): DayBundleIn {
  return {
    date: day.date,
    timezone: day.timezone,
    households: day.households,
    timeline: day.timeline ?? [],
    startDepot: day.startDepot,
    endDepot: day.endDepot,
    startDepotTown: day.startDepotTown,
    startDepotTime: day.startDepotTime,
    endDepotTime: day.endDepotTime,
  };
}

function omitHouseholdFromDay(day: DayData, ids: number[]): DayData {
  const idSet = new Set(ids.map(String));
  const households = day.households.filter((h) => {
    const hid = householdAppointmentIds(h);
    if (hid.length === 0) {
      return h.primary.id == null || !idSet.has(String(h.primary.id));
    }
    return !hid.some((id) => idSet.has(String(id)));
  });
  return {
    ...day,
    households,
    timeline: households.map(() => ({ eta: null, etd: null })),
    driveSeconds: null,
    routingOrderIndices: null,
    backToDepotSec: null,
  };
}

function clockOnDate(dateIso: string, timeStr: string | null | undefined, tz: string): DateTime {
  const base = DateTime.fromISO(dateIso, { zone: tz }).startOf('day');
  const parts = String(timeStr ?? '08:00').trim().split(':');
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  return base.set({
    hour: Number.isFinite(hour) ? hour : 8,
    minute: Number.isFinite(minute) ? minute : 0,
    second: 0,
    millisecond: 0,
  });
}

function attachHouseholdToDay(
  h: WeekHousehold,
  destDay: DayData,
  practiceTz: string,
  typeCatalog?: AppointmentTypeCatalog
): { household: WeekHousehold; insertAt: number; insertionIndex: number } {
  const tz = destDay.timezone || practiceTz;
  const service = householdServiceMinutes(h);
  const destStops = destDay.households
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => isRoutableOptimizeStop(x));

  let insertAt = destDay.households.length;
  let insertionIndex = destStops.length;
  let start = clockOnDate(destDay.date, destDay.startDepotTime || '08:30', tz);
  if (destStops.length > 0) {
    let best = destStops[0]!;
    let bestD = haversineKm({ lat: h.lat, lon: h.lon }, { lat: best.x.lat, lon: best.x.lon });
    for (const row of destStops.slice(1)) {
      const d = haversineKm({ lat: h.lat, lon: h.lon }, { lat: row.x.lat, lon: row.x.lon });
      if (d < bestD) {
        bestD = d;
        best = row;
      }
    }
    const neighborEnd =
      destDay.timeline[best.i]?.etd ||
      best.x.endIso ||
      best.x.primary.appointmentEnd ||
      best.x.startIso;
    if (neighborEnd) {
      const n = DateTime.fromISO(neighborEnd);
      if (n.isValid) start = n;
    }
    insertAt = best.i + 1;
    insertionIndex = destStops.findIndex((row) => row.i === best.i) + 1;
  }

  const end = start.plus({ minutes: service });
  const startIso = start.toUTC().toISO();
  const endIso = end.toUTC().toISO();
  const typeForWindow = householdAppointmentTypeForWindow(h, typeCatalog);
  const ew = effectiveWindowForScheduledStart(startIso ?? '', typeForWindow, tz, {
    appointmentEndIso: endIso ?? undefined,
  });
  const windowStartIso = ew?.startIso ?? null;
  const windowEndIso = ew?.endIso ?? null;
  const effectiveWindow =
    windowStartIso && windowEndIso ? { startIso: windowStartIso, endIso: windowEndIso } : h.effectiveWindow;
  return {
    insertAt,
    insertionIndex,
    household: {
      ...h,
      key: `${h.key}:opt-${destDay.date}`,
      startIso,
      endIso,
      windowStartIso,
      windowEndIso,
      effectiveWindow,
      primary: {
        ...h.primary,
        appointmentStart: startIso ?? undefined,
        appointmentEnd: endIso ?? undefined,
        startIso: startIso ?? undefined,
        endIso: endIso ?? undefined,
        effectiveWindow,
      },
    },
  };
}

function dayWindowWarningCount(day: DayData): number {
  let n = 0;
  day.households.forEach((h, i) => {
    if (!isRoutableOptimizeStop(h)) return;
    const slot = day.timeline[i];
    const windowStartIso =
      (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowStartIso : null) ??
      h.windowStartIso ??
      h.effectiveWindow?.startIso ??
      h.primary.effectiveWindow?.startIso ??
      null;
    const windowEndIso =
      (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ??
      h.windowEndIso ??
      h.effectiveWindow?.endIso ??
      h.primary.effectiveWindow?.endIso ??
      null;
    if (
      computeDriveTimeWindowWarning({
        etaIso: slot?.eta ?? null,
        windowEndIso,
        windowStartIso,
        isClientFixedTime: isFixedTimeTypeName(householdTypeName(h)),
        scheduledStartIso: h.startIso ?? h.primary.appointmentStart,
      })
    ) {
      n += 1;
    }
  });
  return n;
}

function dayWithInsertedHousehold(day: DayData, h: WeekHousehold, insertAt: number): DayData {
  const households = [...day.households];
  const at = Math.max(0, Math.min(insertAt, households.length));
  households.splice(at, 0, h);
  return {
    ...day,
    households,
    timeline: households.map(() => ({ eta: null, etd: null })),
    driveSeconds: null,
    routingOrderIndices: null,
    backToDepotSec: null,
  };
}

function hasDriveEstimate(day: DayData): boolean {
  if (day.households.filter(isRoutableOptimizeStop).length === 0) return true;
  return Array.isArray(day.driveSeconds) && day.driveSeconds.length > 0;
}

function timesForMovedHousehold(
  day: DayData,
  ids: number[],
  serviceMin: number
): { startIso: string; endIso: string } | null {
  const idSet = new Set(ids.map(String));
  const i = day.households.findIndex((hh) =>
    householdAppointmentIds(hh).some((id) => idSet.has(String(id)))
  );
  if (i < 0) return null;
  const slot = day.timeline[i];
  const h = day.households[i];
  const startRaw = (slot?.eta ?? h?.startIso ?? '').trim();
  let endRaw = (slot?.etd ?? '').trim();
  if (startRaw && !endRaw) {
    const dt = DateTime.fromISO(startRaw);
    if (dt.isValid) endRaw = dt.plus({ minutes: serviceMin }).toUTC().toISO() ?? '';
  }
  const start = DateTime.fromISO(startRaw);
  const end = DateTime.fromISO(endRaw);
  if (!start.isValid || !end.isValid) return null;
  const startIso = start.toUTC().toISO();
  const endIso = end.toUTC().toISO();
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

function pastWorkEnd(endIso: string, destDay: DayData, practiceTz: string): boolean {
  const tz = destDay.timezone || practiceTz;
  const workEnd = clockOnDate(destDay.date, destDay.endDepotTime || '18:00', tz);
  const etd = DateTime.fromISO(endIso);
  if (!etd.isValid || !workEnd.isValid) return false;
  return etd > workEnd.plus({ minutes: WORK_END_SLACK_MIN });
}

async function etaDayDrive(day: DayData, doctorId: string): Promise<DayData> {
  const r = await fetchSchedulerDriveEtasForDayBundle(dayDataToBundle(day), doctorId);
  return r.dayData;
}

export function proposeRelocatePairs(
  dates: string[],
  dayByDate: Map<string, DayData | null>,
  baseline: OptimizeBaseline,
  limit = MAX_SLOT_SEARCHES
): RelocateProposal[] {
  const byDate = new Map(baseline.days.map((d) => [d.date, d]));
  const proposals: RelocateProposal[] = [];

  for (const fromDate of dates) {
    const fromDay = dayByDate.get(fromDate);
    const fromRow = byDate.get(fromDate);
    if (!fromDay || !fromRow || fromRow.error) continue;
    const movable = fromDay.households.filter(isMovableOptimizeHousehold);
    if (movable.length === 0) continue;

    const outlierKeys = new Set(
      findDayOutlierHouseholds(fromDay).map((o) => householdKey(o.household, fromDate))
    );
    const isolated = fromRow.stopCount <= 2 && fromRow.driveMin >= ISOLATED_DRIVE_MIN;
    const farthest =
      fromRow.lowPpdh || isolated
        ? movable.reduce<WeekHousehold | null>((best, h) => {
            const others = fromDay.households.filter(
              (x) => isRoutableOptimizeStop(x) && householdKey(x, fromDate) !== householdKey(h, fromDate)
            );
            const c = centroid(others);
            if (!c) return best ?? h;
            const d = haversineKm({ lat: h.lat, lon: h.lon }, c);
            if (!best) return h;
            const bestOthers = fromDay.households.filter(
              (x) =>
                isRoutableOptimizeStop(x) &&
                householdKey(x, fromDate) !== householdKey(best, fromDate)
            );
            const bc = centroid(bestOthers);
            const bd = bc ? haversineKm({ lat: best.lat, lon: best.lon }, bc) : 0;
            return d > bd ? h : best;
          }, null)
        : null;

    const sources = movable.filter((h) => {
      const k = householdKey(h, fromDate);
      if (outlierKeys.has(k)) return true;
      if (isolated) return true;
      if (farthest && householdKey(farthest, fromDate) === k) return true;
      return false;
    });

    for (const h of sources) {
      const peers = fromDay.households.filter(
        (x) => isRoutableOptimizeStop(x) && householdKey(x, fromDate) !== householdKey(h, fromDate)
      );
      const sourceC = centroid(peers);
      const dSource = sourceC
        ? haversineKm({ lat: h.lat, lon: h.lon }, sourceC)
        : Number.POSITIVE_INFINITY;

      for (const toDate of dates) {
        if (toDate === fromDate) continue;
        const toDay = dayByDate.get(toDate);
        const toRow = byDate.get(toDate);
        if (!toDay || !toRow || toRow.isOff || toRow.error) continue;
        if (doctorDayIsOff(toDay)) continue;
        const destStops = toDay.households.filter(isRoutableOptimizeStop);
        if (destStops.length === 0) continue;
        const destC = centroid(destStops);
        if (!destC) continue;
        const dDest = haversineKm({ lat: h.lat, lon: h.lon }, destC);
        const isolatedFit = !Number.isFinite(dSource);
        const closer = Number.isFinite(dSource) && dDest + CLOSER_BY_KM < dSource;
        if (!isolatedFit && !closer) continue;
        const score = Number.isFinite(dSource)
          ? dSource - dDest
          : fromRow.driveMin - dDest;
        const client = h.client?.trim() || 'This visit';
        const reason = Number.isFinite(dSource)
          ? `${client} is ${dDest.toFixed(0)} km from ${shortDay(toDate)} stops vs ${dSource.toFixed(0)} km from other ${shortDay(fromDate)} stops`
          : `${client} is a thin day (${fromRow.driveMin} min drive) and sits ${dDest.toFixed(0)} km from ${shortDay(toDate)} stops`;
        proposals.push({ fromDate, toDate, household: h, score, reason, scope: 'week' });
      }
    }
  }

  proposals.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: RelocateProposal[] = [];
  for (const p of proposals) {
    const k = `${householdKey(p.household, p.fromDate)}->${p.toDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

function clientStopsInRouteOrder(day: DayData): WeekHousehold[] {
  return householdsInRoutingDisplayOrder(day.households, day.routingOrderIndices).filter(
    isRoutableOptimizeStop
  );
}

function adjacentHouseholdKeys(h: WeekHousehold, day: DayData, date: string): Set<string> {
  const ordered = clientStopsInRouteOrder(day);
  const key = householdKey(h, date);
  const i = ordered.findIndex((x) => householdKey(x, date) === key);
  const keys = new Set<string>();
  if (i > 0) keys.add(householdKey(ordered[i - 1]!, date));
  if (i >= 0 && i < ordered.length - 1) keys.add(householdKey(ordered[i + 1]!, date));
  return keys;
}

function closestPeer(
  h: WeekHousehold,
  others: WeekHousehold[]
): { peer: WeekHousehold; km: number } | null {
  let best: WeekHousehold | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of others) {
    const d = haversineKm({ lat: h.lat, lon: h.lon }, { lat: o.lat, lon: o.lon });
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best ? { peer: best, km: bestD } : null;
}

export function proposeSameDayRelocates(
  dates: string[],
  dayByDate: Map<string, DayData | null>,
  baseline: OptimizeBaseline
): RelocateProposal[] {
  const byDate = new Map(baseline.days.map((d) => [d.date, d]));
  const proposals: RelocateProposal[] = [];

  for (const date of dates) {
    const day = dayByDate.get(date);
    const row = byDate.get(date);
    if (!day || !row || row.error || row.isOff) continue;
    if (doctorDayIsOff(day)) continue;
    const movable = day.households.filter(isMovableOptimizeHousehold);
    const routable = day.households.filter(isRoutableOptimizeStop);
    if (movable.length < 2 || routable.length < 3) continue;

    const candidates: RelocateProposal[] = [];
    for (const h of movable) {
      const others = routable.filter((x) => householdKey(x, date) !== householdKey(h, date));
      const near = closestPeer(h, others);
      if (!near) continue;
      if (adjacentHouseholdKeys(h, day, date).has(householdKey(near.peer, date))) continue;
      const neighbors = [...adjacentHouseholdKeys(h, day, date)]
        .map((k) => others.find((x) => householdKey(x, date) === k))
        .filter((x): x is WeekHousehold => x != null);
      const neighborC = centroid(neighbors.length ? neighbors : others);
      const dNow = neighborC
        ? haversineKm({ lat: h.lat, lon: h.lon }, neighborC)
        : Number.POSITIVE_INFINITY;
      if (Number.isFinite(dNow) && near.km >= dNow) continue;
      const client = h.client?.trim() || 'This visit';
      const peer = near.peer.client?.trim() || 'another stop';
      candidates.push({
        fromDate: date,
        toDate: date,
        household: h,
        score: Number.isFinite(dNow) ? dNow - near.km : 40 - near.km,
        reason: `${client} is ${near.km.toFixed(0)} km from ${peer} on ${shortDay(date)} — closer than the visits currently around this time`,
        scope: 'day',
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    proposals.push(...candidates.slice(0, 2));
  }

  proposals.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: RelocateProposal[] = [];
  for (const p of proposals) {
    const k = householdKey(p.household, p.fromDate);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= MAX_DAY_SEARCHES) break;
  }
  return out;
}

function toOptimizeMove(args: {
  household: WeekHousehold;
  ids: number[];
  fromDate: string;
  toDate: string;
  startIso: string;
  times: { startIso: string; endIso: string };
  driveDeltaMin: number;
  baseline: OptimizeBaseline;
  reason: string;
  scope: OptimizeMoveScope;
  practiceTz: string;
  typeCatalog?: AppointmentTypeCatalog;
  insertionIndex: number;
  windowWarningsBefore: number;
  windowWarningsAfter: number;
}): OptimizeMove {
  const totalAfter = args.baseline.totalDriveMin + args.driveDeltaMin;
  const roomLoader = householdRoomLoader(args.household);
  const typeForWindow = householdAppointmentTypeForWindow(args.household, args.typeCatalog);
  const fromWin =
    existingHouseholdWindow(args.household) ??
    effectiveWindowForScheduledStart(args.startIso, typeForWindow, args.practiceTz, {
      appointmentEndIso: args.household.endIso ?? args.household.primary.appointmentEnd,
    });
  const toWin = effectiveWindowForScheduledStart(
    args.times.startIso,
    typeForWindow,
    args.practiceTz,
    { appointmentEndIso: args.times.endIso }
  );
  return {
    id:
      args.scope === 'day'
        ? `${args.ids.join('-')}-${args.fromDate}-day`
        : `${args.ids.join('-')}-${args.fromDate}-${args.toDate}`,
    scope: args.scope,
    client: args.household.client?.trim() || 'Visit',
    clientId: householdClientId(args.household),
    clientPhone: householdClientPhone(args.household),
    petNames: householdPetNames(args.household),
    appointmentType: householdAppointmentTypeLabel(args.household),
    appointmentDescription: householdAppointmentDescription(args.household),
    roomLoaderStatus: roomLoader.label,
    roomLoaderStatusColor: roomLoader.color,
    fromDate: args.fromDate,
    toDate: args.toDate,
    fromTimeLabel: formatTimeLabel(args.startIso, args.practiceTz),
    toTimeLabel: formatTimeLabel(args.times.startIso, args.practiceTz),
    fromWindowLabel: formatWindowParen(fromWin?.startIso, fromWin?.endIso, args.practiceTz),
    toWindowLabel: formatWindowParen(toWin?.startIso, toWin?.endIso, args.practiceTz),
    appointmentIds: args.ids,
    originalStartIso: args.startIso,
    newStartIso: args.times.startIso,
    newEndIso: args.times.endIso,
    insertionIndex: args.insertionIndex,
    windowWarningsBefore: args.windowWarningsBefore,
    windowWarningsAfter: args.windowWarningsAfter,
    driveDeltaMin: args.driveDeltaMin,
    ppdhBefore: args.baseline.ppdh,
    ppdhAfter: pointsPerDriveHour(args.baseline.totalPoints, totalAfter),
    reason: args.reason,
  };
}

async function validateOneProposal(args: {
  proposal: RelocateProposal;
  doctorId: string;
  practiceTz: string;
  dayByDate: Map<string, DayData | null>;
  baseline: OptimizeBaseline;
  typeCatalog?: AppointmentTypeCatalog;
}): Promise<OptimizeMove | null> {
  const { proposal: p, doctorId, practiceTz, dayByDate, baseline, typeCatalog } = args;
  const fromDay = dayByDate.get(p.fromDate);
  const toDay = dayByDate.get(p.toDate);
  if (!fromDay || !toDay) return null;
  const ids = householdAppointmentIds(p.household);
  const startIso = originalStartIso(p.household);
  if (!startIso || ids.length === 0) return null;
  const serviceMin = householdServiceMinutes(p.household);

  let destEta: DayData;
  let sourceEta: DayData | null = null;
  let insertionIndex = 0;
  const destOld = dayTotalDriveSeconds(toDay);
  const sourceOld = dayTotalDriveSeconds(fromDay);
  const warningsBefore =
    p.scope === 'day'
      ? dayWindowWarningCount(fromDay)
      : dayWindowWarningCount(fromDay) + dayWindowWarningCount(toDay);

  try {
    if (p.scope === 'day') {
      const remaining = omitHouseholdFromDay(fromDay, ids);
      const attached = attachHouseholdToDay(p.household, remaining, practiceTz, typeCatalog);
      insertionIndex = attached.insertionIndex;
      const destWithMove = dayWithInsertedHousehold(remaining, attached.household, attached.insertAt);
      destEta = await etaDayDrive(destWithMove, doctorId);
    } else {
      const attached = attachHouseholdToDay(p.household, toDay, practiceTz, typeCatalog);
      insertionIndex = attached.insertionIndex;
      const destWithMove = dayWithInsertedHousehold(toDay, attached.household, attached.insertAt);
      const remaining = omitHouseholdFromDay(fromDay, ids);
      const [dest, source] = await Promise.all([
        etaDayDrive(destWithMove, doctorId),
        remaining.households.length === 0
          ? Promise.resolve(remaining)
          : etaDayDrive(remaining, doctorId),
      ]);
      destEta = dest;
      sourceEta = source;
    }
  } catch {
    return null;
  }

  if (!hasDriveEstimate(destEta)) return null;
  if (p.scope === 'week' && sourceEta && !hasDriveEstimate(sourceEta)) return null;

  const warningsAfter =
    p.scope === 'day'
      ? dayWindowWarningCount(destEta)
      : dayWindowWarningCount(destEta) + dayWindowWarningCount(sourceEta ?? fromDay);
  if (warningsAfter > warningsBefore) return null;

  const times = timesForMovedHousehold(destEta, ids, serviceMin);
  if (!times) return null;
  if (pastWorkEnd(times.endIso, toDay, practiceTz)) return null;
  if (p.scope === 'day') {
    const oldMs = DateTime.fromISO(startIso).toMillis();
    const newMs = DateTime.fromISO(times.startIso).toMillis();
    if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return null;
    if (Math.abs(newMs - oldMs) < MIN_SAME_DAY_SHIFT_SEC * 1000) return null;
  }

  const destNew = dayTotalDriveSeconds(destEta);
  const sourceNew = sourceEta ? dayTotalDriveSeconds(sourceEta) : 0;
  const deltaSec =
    p.scope === 'day' ? destNew - sourceOld : sourceNew + destNew - (sourceOld + destOld);
  if (!(deltaSec <= -MIN_SAVE_SEC)) return null;

  return toOptimizeMove({
    household: p.household,
    ids,
    fromDate: p.fromDate,
    toDate: p.toDate,
    startIso,
    times,
    driveDeltaMin: Math.round(deltaSec / 60),
    baseline,
    reason: p.reason,
    scope: p.scope,
    practiceTz,
    typeCatalog,
    insertionIndex,
    windowWarningsBefore: warningsBefore,
    windowWarningsAfter: warningsAfter,
  });
}

export async function validateOptimizeMoves(args: {
  doctorId: string;
  practiceTz: string;
  dates: string[];
  dayByDate: Map<string, DayData | null>;
  baseline: OptimizeBaseline;
  typeCatalog?: AppointmentTypeCatalog;
}): Promise<OptimizeMove[]> {
  const { doctorId, practiceTz, dates, dayByDate, baseline, typeCatalog } = args;
  const week1 = new Set(dates.slice(0, Math.min(7, dates.length)));
  const weekRaw = proposeRelocatePairs(dates, dayByDate, baseline, MAX_SLOT_SEARCHES * 4);
  const weekInFirst = weekRaw
    .filter((p) => week1.has(p.fromDate) && week1.has(p.toDate))
    .slice(0, MAX_SLOT_SEARCHES);
  const weekAcross = weekRaw
    .filter((p) => !(week1.has(p.fromDate) && week1.has(p.toDate)))
    .slice(0, MAX_SLOT_SEARCHES);
  const proposals = [
    ...proposeSameDayRelocates(dates, dayByDate, baseline),
    ...weekInFirst,
    ...weekAcross,
  ];
  const found = await Promise.all(
    proposals.map((proposal) =>
      validateOneProposal({ proposal, doctorId, practiceTz, dayByDate, baseline, typeCatalog })
    )
  );
  return found
    .filter((m): m is OptimizeMove => m != null)
    .sort((a, b) => a.driveDeltaMin - b.driveDeltaMin);
}

function findHouseholdByAppointmentIds(day: DayData, ids: number[]): WeekHousehold | null {
  const idSet = new Set(ids.map(String));
  return (
    day.households.find((h) => householdAppointmentIds(h).some((id) => idSet.has(String(id)))) ??
    null
  );
}

export type OptimizeResimulateResult = {
  live: OptimizeMove | null;
  unavailableReason: string | null;
  driveWorse: boolean;
  windowWorse: boolean;
};

export function formatOptimizeResimulateWarning(
  saved: Pick<OptimizeMove, 'driveDeltaMin' | 'windowWarningsBefore' | 'windowWarningsAfter'>,
  live: OptimizeMove
): string | null {
  const parts: string[] = [];
  if (live.driveDeltaMin > saved.driveDeltaMin + 1) {
    const now =
      live.driveDeltaMin < 0
        ? `saves ${Math.abs(live.driveDeltaMin)} min`
        : `adds ${Math.abs(live.driveDeltaMin)} min`;
    const was =
      saved.driveDeltaMin < 0
        ? `saved ${Math.abs(saved.driveDeltaMin)} min`
        : `added ${Math.abs(saved.driveDeltaMin)} min`;
    parts.push(`drive is now ${now} (was ${was})`);
  }
  const savedDelta =
    (saved.windowWarningsAfter ?? 0) - (saved.windowWarningsBefore ?? 0);
  const liveDelta = live.windowWarningsAfter - live.windowWarningsBefore;
  if (live.windowWarningsAfter > (saved.windowWarningsAfter ?? 0) || liveDelta > savedDelta) {
    parts.push(
      `window warnings would go from ${saved.windowWarningsAfter ?? 0} to ${live.windowWarningsAfter}`
    );
  }
  if (parts.length === 0) return null;
  return `This suggestion is worse than when it was simulated: ${parts.join('; ')}. Continue anyway?`;
}

/** Re-run the ETA simulation for a saved suggestion (same check as texted-offer tap vs send score). */
export async function revalidateOptimizeMove(args: {
  move: OptimizeMove;
  doctorId: string;
  practiceTz: string;
  typeCatalog?: AppointmentTypeCatalog;
}): Promise<OptimizeResimulateResult> {
  const { move, doctorId, practiceTz, typeCatalog } = args;
  const dates = [...new Set([move.fromDate, move.toDate].filter(Boolean))];
  const dayByDate = new Map<string, DayData | null>();
  const errors = new Map<string, string>();
  await Promise.all(
    dates.map(async (date) => {
      try {
        const r = await fetchSchedulerDriveContextForDate(date, doctorId);
        dayByDate.set(date, r?.dayData ?? null);
      } catch (e) {
        errors.set(date, (e as Error)?.message || 'Could not load this day');
        dayByDate.set(date, null);
      }
    })
  );
  const fromDay = dayByDate.get(move.fromDate);
  if (!fromDay) {
    return {
      live: null,
      unavailableReason: 'Could not reload this day to re-check the suggestion.',
      driveWorse: false,
      windowWorse: false,
    };
  }
  const household = findHouseholdByAppointmentIds(fromDay, move.appointmentIds);
  if (!household || !isMovableOptimizeHousehold(household)) {
    return {
      live: null,
      unavailableReason: 'This visit is no longer on that day, so the suggestion cannot be used.',
      driveWorse: false,
      windowWorse: false,
    };
  }
  const baseline = buildOptimizeBaseline(dates, dayByDate, typeCatalog ?? { byId: new Map(), byName: new Map() }, errors);
  const live = await validateOneProposal({
    proposal: {
      fromDate: move.fromDate,
      toDate: move.toDate,
      household,
      score: 0,
      reason: move.reason,
      scope: move.scope,
    },
    doctorId,
    practiceTz,
    dayByDate,
    baseline,
    typeCatalog,
  });
  if (!live) {
    return {
      live: null,
      unavailableReason:
        'This move no longer saves enough drive, or it would add window warnings. It was not applied.',
      driveWorse: true,
      windowWorse: true,
    };
  }
  const driveWorse = live.driveDeltaMin > move.driveDeltaMin + 1;
  const windowWorse =
    live.windowWarningsAfter > (move.windowWarningsAfter ?? 0) ||
    live.windowWarningsAfter - live.windowWarningsBefore >
      (move.windowWarningsAfter ?? 0) - (move.windowWarningsBefore ?? 0);
  return { live, unavailableReason: null, driveWorse, windowWorse };
}

export async function applyOptimizeMove(args: {
  move: Pick<OptimizeMove, 'appointmentIds' | 'newStartIso' | 'newEndIso'>;
  practiceId: number;
}): Promise<void> {
  const { move, practiceId } = args;
  for (const id of move.appointmentIds) {
    await patchAppointment(
      id,
      {
        appointmentStart: move.newStartIso,
        appointmentEnd: move.newEndIso,
        bookedViaRouting: true,
      },
      { practiceId }
    );
  }
}
