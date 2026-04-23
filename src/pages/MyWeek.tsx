// src/pages/MyWeek.tsx — Weekly calendar view: each day in a column, same APIs as My Day.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  fetchDoctorDay,
  clientDisplayName,
  isBlockEntry,
  blockDisplayLabel,
  isFlexBlockItem,
  type DoctorDayAppt,
  type DoctorDayResponse,
  type Depot,
  type MiniZone,
} from '../api/appointments';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { getZonePercentagesForProvider } from '../api/patients';
import { etaHouseholdArrivalWindowPayload, fetchEtas } from '../api/routing';
import { useAuth } from '../auth/useAuth';
import { buildGoogleMapsLinksForDay, type Stop } from '../utils/maps';
import { AlertTriangle, Heart } from 'lucide-react';
import { shouldShowEtaWindowWarning } from '../utils/windowWarning';
import {
  computeHoverPopoverPosition,
  rectFromElement,
  type HoverAnchorRect,
} from '../utils/hoverPopoverPosition';
import { colorForDrive } from '../utils/statsFormat';
import {
  practiceTimeZoneOrDefault,
  formatIsoInPracticeZone,
  formatIsoTimeShortInPracticeZone,
  dayWallClockStartIso,
  formatDepotWallClockOnDate,
  isoFromSecondsSincePracticeMidnight,
} from '../utils/practiceTimezone';
import './DoctorDay.css';

type ZonePatientStat = {
  zoneId: string | null;
  zoneName: string | null;
  count: number;
  percent: number;
};

const PPM = 1.1;
const DAY_END_HOUR = 19;
const DAY_END_MINUTE = 30;
/** End of grid in minutes from midnight (19:30). */
const END_MINUTES_FROM_MIDNIGHT = DAY_END_HOUR * 60 + DAY_END_MINUTE;
/** Default grid start when no data: 6:30 AM (390 min from midnight). */
const DEFAULT_GRID_START_MINUTES = 6 * 60 + 30;
const BUFFER_MINUTES_BEFORE_START = 30;

/** Parse "HH:mm" or "HH:mm:ss" to minutes from midnight. */
function timeStrToMinutesFromMidnight(s: string): number {
  const parts = s.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h)) return 0;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

/** Start / end of day (leave depot / return) — thicker than hour grid lines */
const DEPOT_LINE_PX = 5;
const DEPOT_LINE_OFFSET = Math.floor(DEPOT_LINE_PX / 2);
const DEPOT_LINE_COLOR = '#64748b';
/** Hour (:00) and half-hour (:30) — light guides */
const TICK_HOUR_BORDER = '1px solid #e2e8f0';
const TICK_HALF_BORDER = '1px dashed #eef2f6';
/** Sticky time column width (labels + gutter) */
const WEEK_TIME_COL_WIDTH_PX = 64;
/** Drive segment shading: diagonal stripes so drive vs whitespace is obvious */
const DRIVE_FILL = 'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';
/** Post-visit buffer: see-through / neutral (not blue); column background shows; outline vs hatched drive */
const BUFFER_FILL = 'rgba(255, 255, 255, 0.35)';
const BUFFER_BORDER = '1px dashed #d1d5db';

const str = (o: any, k: string) => (typeof o?.[k] === 'string' ? o[k] : undefined);
const num = (o: any, k: string) => {
  const v = o?.[k];
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

/** Key variants for matching ETA byIndex row key to household (avoids precision/rounding mismatches). Handles "lat,lon" and "lat,lon:2" style keys. */
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

/** Hover: drop trailing US ZIP so street + city + state stay on one line with client. */
function stripZipFromAddressLine(line: string): string {
  if (!line?.trim()) return line;
  return line.replace(/,\s*\d{5}(-\d{4})?\s*$/i, '').replace(/\s+\d{5}(-\d{4})?\s*$/i, '').trim();
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

type PatientBadge = {
  name: string;
  type?: string | null;
  desc?: string | null;
  /** confirmStatusName — pre-exam / check-in */
  status?: string | null;
  /** statusName — records status (PIMS) */
  recordStatus?: string | null;
  alerts?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
};
function makePatientBadge(a: any): PatientBadge {
  const name =
    str(a, 'patientName') || str(a, 'petName') || str(a, 'animalName') || str(a, 'name') || 'Patient';
  const type = str(a, 'appointmentType') || str(a, 'appointmentTypeName') || str(a, 'serviceName') || null;
  const desc = str(a, 'description') || str(a, 'visitReason') || null;
  const status = str(a, 'confirmStatusName') ?? null;
  const recordStatus = str(a, 'statusName') ?? null;
  const alerts = str(a, 'alerts') || null;
  const pat = a?.patient;
  const isMember = Boolean(a?.isMember ?? pat?.isMember);
  const rawMem = a?.membershipName ?? pat?.membershipName;
  const membershipName =
    typeof rawMem === 'string' && rawMem.trim()
      ? rawMem.trim()
      : rawMem != null && String(rawMem).trim()
        ? String(rawMem).trim()
        : null;
  return { name, type, desc, status, recordStatus, alerts, isMember, membershipName };
}

function statusPillStyle(text: string): CSSProperties {
  const s = text.toLowerCase();
  return {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
    background: s.includes('pre-appt email')
      ? '#fee2e2'
      : s.includes('pre-appt form') || s.includes('client submitted')
        ? '#dcfce7'
        : '#e5e7eb',
    color: s.includes('pre-appt email')
      ? '#b91c1c'
      : s.includes('pre-appt form') || s.includes('client submitted')
        ? '#166534'
        : '#334155',
  };
}

export type WeekHousehold = {
  key: string;
  client: string;
  address: string;
  lat: number;
  lon: number;
  startIso: string | null;
  endIso: string | null;
  /** Window of arrival from effectiveWindow (startIso/endIso) when present on the appointment */
  windowStartIso?: string | null;
  windowEndIso?: string | null;
  isNoLocation?: boolean;
  isPersonalBlock?: boolean;
  isPreview?: boolean;
  patients: PatientBadge[];
  primary: DoctorDayAppt;
  /** Backend effectiveWindow when available (from primary) */
  effectiveWindow?: { startIso: string; endIso: string };
  /** Min index in appts array (for visit-order sort when preview is present) */
  firstApptIndex?: number;
};

/** Same address: same lat/lon or keys like "lat,lon" and "lat,lon:2". */
function sameAddressWeek(a: WeekHousehold, b: WeekHousehold): boolean {
  if (Number.isFinite(a.lat) && Number.isFinite(b.lat) && Number.isFinite(a.lon) && Number.isFinite(b.lon)) {
    if (Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6) return true;
  }
  const base = (k: string) => (k.includes(':') ? k.slice(0, k.indexOf(':')) : k);
  return base(a.key) === base(b.key);
}

/** Household grouping key: same client at same location = one stop; different clients at same address = separate stops. */
function householdGroupKey(a: DoctorDayAppt, lat: number, lon: number, addrKey: string | null, idPart: string, hasGeo: boolean): string {
  const clientId = (a as any)?.clientPimsId ?? (a as any)?.clientId;
  const clientPart = clientId != null ? String(clientId) : (str(a, 'clientName') ?? '').trim();
  if (hasGeo) return `${lat}_${lon}_${clientPart}`;
  if (addrKey) return `addr:${addrKey}_${clientPart}`;
  return `noloc:${idPart}`;
}

/** Assign unique ETA keys: first at (lat,lon) gets "lat,lon", second "lat,lon:2", etc., so ETA API returns one entry per stop. */
function assignEtaKeysForSameAddress<T extends { key: string; lat: number; lon: number }>(households: T[]): void {
  const byLoc = new Map<string, T[]>();
  for (const h of households) {
    const hasGeo = Number.isFinite(h.lat) && Number.isFinite(h.lon) && Math.abs(h.lat) > 1e-6 && Math.abs(h.lon) > 1e-6;
    const locKey = hasGeo ? `${h.lat}_${h.lon}` : h.key;
    if (!byLoc.has(locKey)) byLoc.set(locKey, []);
    byLoc.get(locKey)!.push(h);
  }
  for (const [, list] of byLoc) {
    if (list.length === 0) continue;
    const first = list[0];
    const hasGeo = Number.isFinite(first.lat) && Number.isFinite(first.lon) && Math.abs(first.lat) > 1e-6 && Math.abs(first.lon) > 1e-6;
    const baseKey = hasGeo ? keyFor(first.lat, first.lon, 6) : first.key;
    list.forEach((h, i) => {
      (h as { key: string }).key = i === 0 ? baseKey : `${baseKey}:${i + 1}`;
    });
  }
}

function buildHouseholds(appts: DoctorDayAppt[]): WeekHousehold[] {
  const m = new Map<string, WeekHousehold>();
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
        effectiveWindow:
          a?.effectiveWindow?.startIso && a?.effectiveWindow?.endIso
            ? { startIso: a.effectiveWindow.startIso, endIso: a.effectiveWindow.endIso }
            : undefined,
        firstApptIndex: idx,
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

type DayData = {
  date: string;
  /** IANA practice timezone for wall times on this day (from doctor-day API). */
  timezone: string;
  households: WeekHousehold[];
  timeline: {
    eta?: string | null;
    etd?: string | null;
    windowStartIso?: string | null;
    windowEndIso?: string | null;
    /** From ETA byIndex: minutes at site after ETD before departing (0 = none). */
    bufferAfterMinutes?: number;
  }[];
  startDepot: Depot | null;
  endDepot: Depot | null;
  /** Time-of-day "HH:mm" or "HH:mm:ss" when doctor leaves depot */
  startDepotTime: string | null;
  /** Time-of-day "HH:mm" or "HH:mm:ss" when doctor returns to depot */
  endDepotTime: string | null;
  /** Drive durations in seconds: [toFirst, between..., back] from ETA API (byIndex when present). */
  driveSeconds?: number[] | null;
  /** Drive from depot to first routable stop (used only when first stop is not a block, to normalize ds[0]). */
  depotToFirstRoutableSec?: number | null;
  /** Back-to-depot drive seconds when not in driveSeconds array */
  backToDepotSec?: number | null;
  /** Back-to-depot arrival time from ETA API (authoritative for tooltip). */
  backToDepotIso?: string | null;
  /** Minutes after ETD before next appointment can start or drive starts. Use only for next-available/block end; ETD is appointment end. Default 5. */
  appointmentBufferMinutes?: number;
  /** When set, render in byIndex order: displayHouseholds[i] = households[routingOrderIndices[i]]. */
  routingOrderIndices?: number[] | null;
  /** Routing-v2 preview: depot return as seconds since local midnight (overrun-aware). */
  validationReturnSec?: number;
};

/** Sunday of the week containing the given date (YYYY-MM-DD). */
export function weekStartSunday(dateIso: string): string {
  const dt = DateTime.fromISO(dateIso);
  const weekday = dt.weekday; // 1=Mon .. 7=Sun
  const sunday = weekday === 7 ? dt : dt.minus({ days: weekday });
  return sunday.toISODate() ?? dateIso;
}

export type MyWeekVirtualAppt = {
  date: string; // YYYY-MM-DD
  /** 0-based insert-after index for visit order */
  insertionIndex?: number;
  /** 1-based visit order from routing API (positionInDay === insertionIndex + 1) */
  positionInDay?: number;
  suggestedStartIso: string;
  serviceMinutes: number;
  clientName?: string;
  lat?: number;
  lon?: number;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  arrivalWindow?: {
    windowStartSec?: number;
    windowEndSec?: number;
    windowStartIso?: string;
    windowEndIso?: string;
  };
  validationReturnSec?: number;
};

export type MyWeekProps = {
  readOnly?: boolean;
  initialWeekStart?: string; // YYYY-MM-DD (Sunday)
  initialDoctorId?: string;
  virtualAppt?: MyWeekVirtualAppt;
};

/** Seven dates Sun..Sat for the week containing the given date. */
function weekDates(weekStart: string): string[] {
  const start = DateTime.fromISO(weekStart);
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!);
}

// ----- Zone helpers (match My Month) -----
function zoneOf(a: DoctorDayAppt): MiniZone | null {
  return (a as any).effectiveZone ?? (a as any).clientZone ?? null;
}
function zoneKeyFrom(z: MiniZone | null): string {
  if (!z) return 'none|';
  return `${z.id}|${z.name ?? ''}`;
}

/** Points for one day (exclude personal blocks and "Note To Staff"). Per patient: 1 standard, 0.5 tech, 2 euthanasia. */
function dayPoints(households: WeekHousehold[]): number {
  return households.reduce((total, h) => {
    if (h.isPersonalBlock) return total;
    const type = (str(h.primary, 'appointmentType') || '').toLowerCase();
    if (type.includes('note to staff')) return total;
    const n = Math.max(1, h.patients?.length ?? 1);
    if (type === 'euthanasia') return total + 2 * n;
    if (type.includes('tech appointment')) return total + 0.5 * n;
    return total + 1 * n;
  }, 0);
}

/** Total driving time in seconds for the day (driveSeconds + backToDepot when separate). */
function dayTotalDriveSeconds(day: DayData): number {
  const ds = day.driveSeconds ?? [];
  const sum = ds.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const back = day.backToDepotSec ?? 0;
  // If driveSeconds already has N+1 elements (includes return), don't double-add back
  const n = day.households?.length ?? 0;
  const alreadyHasReturn = n > 0 && ds.length > n;
  return sum + (alreadyHasReturn ? 0 : back);
}

function householdMinutes(h: WeekHousehold): number {
  if (h.isPersonalBlock) return 0;
  const start = h.startIso ? DateTime.fromISO(h.startIso) : null;
  const end = h.endIso ? DateTime.fromISO(h.endIso) : null;
  if (!start?.isValid || !end?.isValid) return 0;
  return Math.max(1, Math.round(end.diff(start).as('minutes')));
}

/** Minutes from grid start to the given ISO time; clamp to [0, totalMinutes]. */
function minutesFromDayStart(
  gridStartMinutesFromMidnight: number,
  totalMinutes: number,
  iso: string,
  dateIso: string,
  practiceTz: string
): number {
  const base = DateTime.fromISO(
    dayWallClockStartIso(dateIso, gridStartMinutesFromMidnight, practiceTz)
  );
  const t = DateTime.fromISO(iso);
  const mins = t.diff(base, 'minutes').minutes;
  return Math.max(0, Math.min(totalMinutes, Math.round(mins)));
}

function isoFromMinutesFromGridStart(
  gridStartMinutesFromMidnight: number,
  totalMinutes: number,
  minFromGridStart: number,
  dateIso: string,
  practiceTz: string
): string {
  const base = DateTime.fromISO(
    dayWallClockStartIso(dateIso, gridStartMinutesFromMidnight, practiceTz)
  );
  const clamped = Math.max(0, Math.min(totalMinutes, minFromGridStart));
  return base.plus({ minutes: clamped }).toISO()!;
}

/** Convert startDepotTime/endDepotTime ("HH:mm" or "HH:mm:ss") to pixels from grid top. */
function depotTimeToPx(
  gridStartMinutesFromMidnight: number,
  totalMinutes: number,
  timeStr: string
): number {
  const minutesFromMidnight = timeStrToMinutesFromMidnight(timeStr);
  const minutesFromGridStart = minutesFromMidnight - gridStartMinutesFromMidnight;
  const clamped = Math.max(0, Math.min(totalMinutes, minutesFromGridStart));
  return clamped * PPM;
}

type WeekGridMetrics = { gridStartMinutesFromMidnight: number; totalMinutes: number };

/** Block tops/durations and Y-offsets so visits stack with drive gaps (matches appointment div layout). */
type MyWeekDayColumnLayout = {
  displayHouseholds: WeekHousehold[];
  displayTimeline: DayData['timeline'];
  topMinByIdx: number[];
  durMinByIdx: number[];
  driveOffsets: number[];
  ds: number[];
  N: number;
};

function computeMyWeekDayColumnLayout(
  dayData: DayData,
  weekGrid: WeekGridMetrics,
  dateIso: string,
  showByDriveTime: boolean,
  bufferMin: number
): MyWeekDayColumnLayout | null {
  const practiceTz = practiceTimeZoneOrDefault(dayData.timezone);
  const households = dayData.households ?? [];
  const tl = dayData.timeline ?? [];
  const order = dayData.routingOrderIndices;
  const N = households.length;
  if (N === 0) return null;
  const displayHouseholds =
    order && order.length === N ? order.map((i) => households[i]) : households;
  const displayTimeline = order && order.length === tl.length ? order.map((i) => tl[i]) : tl;
  const ds = dayData.driveSeconds ?? [];
  const bufferMinAfterStopK = (k: number) => {
    const v = displayTimeline[k]?.bufferAfterMinutes;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
    return Math.max(0, bufferMin);
  };

  const topMinByIdx: number[] = [];
  const durMinByIdx: number[] = [];
  const driveOffsets: number[] = [];

  for (let i = 0; i < N; i++) {
    const hi = displayHouseholds[i];
    const startIso = hi.startIso;
    const endIso = hi.endIso;
    if (!startIso || !endIso) {
      topMinByIdx.push(0);
      durMinByIdx.push(1);
      driveOffsets.push(0);
      continue;
    }
    const slot = displayTimeline[i];
    const useEta = showByDriveTime && (slot?.eta ?? slot?.etd);
    let anchorIso = useEta ? (slot?.eta ?? startIso) : startIso;
    if (i >= 1) {
      const prev = displayHouseholds[i - 1];
      const prevSlot = displayTimeline[i - 1];
      if (sameAddressWeek(prev, hi)) {
        const prevEtd = prevSlot?.etd ?? prev.endIso ?? null;
        if (prevEtd) {
          const minStartIso = DateTime.fromISO(prevEtd).plus({ minutes: bufferMin }).toISO();
          if (minStartIso) {
            const anchorDt = DateTime.fromISO(anchorIso);
            const minDt = DateTime.fromISO(minStartIso);
            if (anchorDt.isValid && minDt.isValid && anchorDt < minDt) {
              anchorIso = minStartIso;
            }
          }
        }
      }
    }
    const endIsoForHeight = useEta && slot?.etd ? slot.etd : endIso;
    const tMin = minutesFromDayStart(
      weekGrid.gridStartMinutesFromMidnight,
      weekGrid.totalMinutes,
      anchorIso,
      dateIso,
      practiceTz
    );
    const eMin = minutesFromDayStart(
      weekGrid.gridStartMinutesFromMidnight,
      weekGrid.totalMinutes,
      endIsoForHeight,
      dateIso,
      practiceTz
    );
    const dMin = Math.max(1, eMin - tMin);
    topMinByIdx.push(tMin);
    durMinByIdx.push(dMin);
    if (i === 0) {
      driveOffsets.push(0);
    } else {
      const prevEndShifted = topMinByIdx[i - 1] + driveOffsets[i - 1] + durMinByIdx[i - 1];
      const prevHi = displayHouseholds[i - 1];
      const prevSlot = displayTimeline[i - 1];
      const prevUseEta = showByDriveTime && (prevSlot?.eta ?? prevSlot?.etd);
      const prevEndIsoForClock =
        prevUseEta && prevSlot?.etd ? prevSlot.etd : prevHi.endIso ?? '';

      const dsLow = typeof ds[i - 1] === 'number' && Number.isFinite(ds[i - 1]) ? ds[i - 1] : 0;
      const dsHigh = typeof ds[i] === 'number' && Number.isFinite(ds[i]) ? ds[i] : 0;
      let driveSecJ = dsHigh;
      const prevBarrier = prevHi?.isPersonalBlock === true;
      const currBarrier = hi?.isPersonalBlock === true;

      if (prevEndIsoForClock) {
        const prevEndMinClock = minutesFromDayStart(
          weekGrid.gridStartMinutesFromMidnight,
          weekGrid.totalMinutes,
          prevEndIsoForClock,
          dateIso,
          practiceTz
        );
        const gapAvailMinClock = Math.max(0, tMin - prevEndMinClock - bufferMinAfterStopK(i - 1));

        if (prevBarrier && !currBarrier) {
          // dsHigh===0 && dsLow>0: [0] is depot→barrier only; [1]=0 — do not push next row with dsLow (keep ETA); gap is painted from clock in drive builder.
          if (dsHigh === 0 && dsLow > 0) {
            driveSecJ = 0;
          } else {
            let interSec = 0;
            if (dsLow > 0 && dsHigh > 0 && dsLow === dsHigh) interSec = dsLow;
            else if (dsLow > 0 && dsHigh > 0) interSec = dsHigh;
            else if (dsLow === 0 && dsHigh > 0) interSec = dsHigh;

            const interMin = interSec / 60;
            const fitsInGap = interSec > 0 && interMin <= gapAvailMinClock + 1e-6;

            if (dsLow > 0 && dsHigh > 0 && dsLow !== dsHigh) {
              driveSecJ = fitsInGap ? dsHigh : 0;
            } else if (interSec > 0) {
              // ds[i-1]===0, ds[i]>0: routed seconds are on this visit (block → first stop). Opening space
              // here paints hatched drive before that visit; stacking above the block mislabels as depot
              // and often collapses against startDepotTime when ETAs are flush with the block ETD.
              driveSecJ =
                fitsInGap || (dsLow === 0 && dsHigh > 0) ? interSec : 0;
            } else {
              driveSecJ = dsHigh;
            }
          }
        }
      }

      let off = Math.max(0, prevEndShifted + driveSecJ / 60 - tMin);
      const flexRow =
        hi?.isPersonalBlock === true &&
        (isFlexBlockItem(hi.primary) ||
          isFlexBlockItem({ blockLabel: hi.client, title: hi.client }));
      if (flexRow) off = 0;
      driveOffsets.push(off);
    }
  }
  return { displayHouseholds, displayTimeline, topMinByIdx, durMinByIdx, driveOffsets, ds, N };
}

/**
 * Paint drive bands in the same minute-space as appointment blocks (driveOffsets).
 * The old path used raw clock minutes + cumOffsetMin, which left white gaps and stretched return past backToDepotIso.
 */
function buildMyWeekDriveSegmentsFromLayout(
  layout: MyWeekDayColumnLayout,
  dayData: DayData,
  weekGrid: WeekGridMetrics,
  dateIso: string
): { top: number; height: number; title: string; kind: 'buffer' | 'drive' }[] {
  const practiceTz = practiceTimeZoneOrDefault(dayData.timezone);
  const segs: { top: number; height: number; title: string; kind: 'buffer' | 'drive' }[] = [];
  const { topMinByIdx, durMinByIdx, driveOffsets, ds, N, displayHouseholds, displayTimeline } = layout;
  const apptBufDefault = dayData.appointmentBufferMinutes ?? 5;
  const bufferMinAfterStop = (i: number) => {
    const v = displayTimeline[i]?.bufferAfterMinutes;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
    return Math.max(0, apptBufDefault);
  };
  const driveLabel = (routeMin: number, kind: string, gapMin?: number) => {
    if (kind === 'Drive from depot' || kind === 'Drive back to depot') {
      return `${kind}: ${routeMin} min`;
    }
    if (gapMin != null && gapMin < routeMin) {
      return `${kind}: ${routeMin} min route (${gapMin} min gap)`;
    }
    return `${kind}: ${routeMin} min drive`;
  };
  const toMin = (iso: string) =>
    minutesFromDayStart(
      weekGrid.gridStartMinutesFromMidnight,
      weekGrid.totalMinutes,
      iso,
      dateIso,
      practiceTz
    );
  const toPx = (min: number) => Math.max(0, Math.min(weekGrid.totalMinutes, min)) * PPM;

  /** Fixed blocks and flex blocks — drive cannot overlap these; placement hugs appointment or barricade edge. */
  const isDriveBarrier = (h: WeekHousehold | undefined) => h?.isPersonalBlock === true;

  const firstTopLayoutMin = topMinByIdx[0] + driveOffsets[0];
  const ds0 = typeof ds[0] === 'number' && Number.isFinite(ds[0]) ? ds[0] : 0;
  const ds1 = typeof ds[1] === 'number' && Number.isFinite(ds[1]) ? ds[1] : 0;
  /** First row is barrier (fixed/flex) and second is a real visit — outbound drive placement for gap 0→1 vs above row 0. */
  const barrierThenAppt =
    N >= 2 && isDriveBarrier(displayHouseholds[0]) && !isDriveBarrier(displayHouseholds[1]);

  /**
   * Barrier → appointment: if the outbound leg fits in the layout gap after the barrier (after buffer), paint it there
   * (hug rules in the loop). If it does not fit (e.g. appointment hugs the block, ETA flush with barrier end), move the
   * entire leg above the barrier so drive never sits between block and appointment. Duplicate ds[0]===ds[1] or ds[1]===0
   * with ds[0]>0 collapse to one inter-leg seconds value for this decision.
   * firstGapDriveSec: override for ds[i+1] when i===0; null = use ds[1] unless skipFirstInterRowDriveSegment.
   */
  let firstGapDriveSec: number | null = null;
  let skipFirstInterRowDriveSegment = false;
  let aboveFirstRowDriveSec = 0;

  if (barrierThenAppt) {
    const bottom0 = topMinByIdx[0] + driveOffsets[0] + durMinByIdx[0];
    const nextTop1 = topMinByIdx[1] + driveOffsets[1];
    const winStartAfterBlock = bottom0 + bufferMinAfterStop(0);
    const gapAvailMin = Math.max(0, nextTop1 - winStartAfterBlock);

    if (ds0 > 0 && ds1 > 0 && ds0 !== ds1) {
      const interMin = ds1 / 60;
      const fitsInGap = ds1 > 0 && interMin <= gapAvailMin + 1e-6;
      if (fitsInGap) {
        aboveFirstRowDriveSec = ds0;
        firstGapDriveSec = ds1;
      } else {
        aboveFirstRowDriveSec = ds0 + ds1;
        firstGapDriveSec = null;
        skipFirstInterRowDriveSegment = true;
      }
    } else if (ds1 === 0 && ds0 > 0) {
      // driveSeconds[0] = depot→block; [1]=0 means API omitted block→first visit — still show hatched band from ETA/ETD gap.
      aboveFirstRowDriveSec = ds0;
      const gapPaintSec = Math.max(0, Math.round(gapAvailMin * 60));
      firstGapDriveSec = gapPaintSec > 0 ? gapPaintSec : null;
      skipFirstInterRowDriveSegment = false;
    } else if (ds0 > 0 && ds1 > 0 && ds0 === ds1) {
      const interMin = ds0 / 60;
      const fitsInGap = interMin <= gapAvailMin + 1e-6;
      if (fitsInGap) {
        firstGapDriveSec = ds0;
        aboveFirstRowDriveSec = 0;
        skipFirstInterRowDriveSegment = false;
      } else {
        // Same seconds on [0] and [1] often means depot→block plus duplicated block→visit; paint depot above, visible gap for the hop.
        aboveFirstRowDriveSec = ds0;
        const gapPaintSec = Math.max(0, Math.round(gapAvailMin * 60));
        firstGapDriveSec = gapPaintSec > 0 ? gapPaintSec : null;
        skipFirstInterRowDriveSegment = false;
      }
    } else if (ds0 === 0 && ds1 > 0) {
      // Leg is attributed to the first visit (ds[1]); paint between block and that row, not as depot above.
      const interSec = ds1;
      const interMin = interSec / 60;
      const fitsInGap = interMin <= gapAvailMin + 1e-6;
      if (fitsInGap || gapAvailMin > 1e-6) {
        firstGapDriveSec = interSec;
        aboveFirstRowDriveSec = 0;
        skipFirstInterRowDriveSegment = false;
      } else {
        firstGapDriveSec = null;
        aboveFirstRowDriveSec = interSec;
        skipFirstInterRowDriveSegment = true;
      }
    } else {
      firstGapDriveSec = null;
      aboveFirstRowDriveSec = 0;
    }
  } else if (N > 0 && ds0 > 0) {
    aboveFirstRowDriveSec = ds0;
  }

  if (N > 0 && aboveFirstRowDriveSec > 0) {
    const toFirstSec = aboveFirstRowDriveSec;
    if (toFirstSec > 0) {
      const segHMin = toFirstSec / 60;
      let segTopMin = firstTopLayoutMin - segHMin;
      const sdt = dayData.startDepotTime?.trim();
      if (sdt) {
        const depotMinFromGrid =
          timeStrToMinutesFromMidnight(sdt) - weekGrid.gridStartMinutesFromMidnight;
        const clampedDepot = Math.max(0, Math.min(weekGrid.totalMinutes, depotMinFromGrid));
        segTopMin = Math.max(segTopMin, clampedDepot);
      }
      const heightMin = Math.max(0, firstTopLayoutMin - segTopMin);
      if (heightMin * PPM >= 2) {
        segs.push({
          top: toPx(segTopMin),
          height: Math.max(4, heightMin * PPM),
          title: driveLabel(Math.round(toFirstSec / 60), 'Drive from depot'),
          kind: 'drive',
        });
      }
    }
  }

  for (let i = 0; i < N - 1; i++) {
    const bottomMin = topMinByIdx[i] + driveOffsets[i] + durMinByIdx[i];
    const nextTopMin = topMinByIdx[i + 1] + driveOffsets[i + 1];
    const gapMin = nextTopMin - bottomMin;
    const gapPx = gapMin * PPM;
    if (gapPx <= 1) continue;
    const bufMin = bufferMinAfterStop(i);
    const bufPx = Math.min(gapPx, bufMin * PPM);
    const afterBufPx = gapPx - bufPx;
    const driveSecLeg =
      i === 0 && skipFirstInterRowDriveSegment
        ? 0
        : i === 0 && firstGapDriveSec != null && firstGapDriveSec > 0
          ? firstGapDriveSec
          : ds[i + 1];
    const yBuf = toPx(bottomMin);
    if (bufPx > 1) {
      const bm = Math.max(1, Math.round(bufPx / PPM));
      segs.push({
        top: yBuf,
        height: Math.max(4, bufPx),
        title: `Buffer after visit: ${bm} min`,
        kind: 'buffer',
      });
    }
    if (afterBufPx <= 1) continue;

    const prevBarrier = isDriveBarrier(displayHouseholds[i]);
    const nextBarrier = isDriveBarrier(displayHouseholds[i + 1]);
    const explicitZeroLeg =
      typeof driveSecLeg === 'number' && Number.isFinite(driveSecLeg) && driveSecLeg === 0;
    if (prevBarrier && nextBarrier && explicitZeroLeg) {
      continue;
    }

    const gapAvailMin = Math.max(0, afterBufPx / PPM);
    const routeMinFromLeg =
      typeof driveSecLeg === 'number' && Number.isFinite(driveSecLeg) && driveSecLeg > 0
        ? Math.max(1, Math.round(driveSecLeg / 60))
        : 0;
    // Hatched band = route time when API gives it; remainder of the ETA clock gap is idle (not drive).
    const paintDriveMin =
      routeMinFromLeg > 0 ? Math.min(gapAvailMin, routeMinFromLeg) : gapAvailMin;
    const driveH = paintDriveMin * PPM;
    if (driveH <= 1) continue;

    const winStartMin = bottomMin + bufMin;
    const dMin = paintDriveMin;
    const dm = Math.max(1, Math.round(dMin));

    let driveTopPx: number;

    const placeHugNext = () => {
      const startMin = nextTopMin - dMin;
      return startMin >= winStartMin - 1e-6;
    };
    const placeHugPrev = () => {
      const endMin = winStartMin + dMin;
      return endMin <= nextTopMin + 1e-6;
    };

    if (prevBarrier && !nextBarrier) {
      // Block above, appointment below: prefer hugging appointment (below), else hug far edge of block (above in gap).
      if (placeHugNext()) driveTopPx = toPx(nextTopMin) - driveH;
      else if (placeHugPrev()) driveTopPx = toPx(winStartMin);
      else driveTopPx = toPx(nextTopMin) - driveH;
    } else if (!prevBarrier && nextBarrier) {
      // Appointment above, block below: prefer hugging appointment (above in gap), else hug block top.
      if (placeHugPrev()) driveTopPx = toPx(winStartMin);
      else if (placeHugNext()) driveTopPx = toPx(nextTopMin) - driveH;
      else driveTopPx = toPx(winStartMin);
    } else if (prevBarrier && nextBarrier) {
      // Block above, block below: same as block→appointment — prefer hugging lower block top, else upper block bottom.
      if (placeHugNext()) driveTopPx = toPx(nextTopMin) - driveH;
      else if (placeHugPrev()) driveTopPx = toPx(winStartMin);
      else driveTopPx = toPx(nextTopMin) - driveH;
    } else {
      // Appointment → appointment: hug the upper visit (after buffer) so the leg sits next to the earlier stop (e.g. Amber→Allie).
      if (placeHugPrev()) driveTopPx = toPx(winStartMin);
      else if (placeHugNext()) driveTopPx = toPx(nextTopMin) - driveH;
      else driveTopPx = toPx(winStartMin);
    }

    const duplicateFullLegInGap =
      i === 0 &&
      ds0 > 0 &&
      ds1 > 0 &&
      ds0 === ds1 &&
      firstGapDriveSec != null &&
      firstGapDriveSec > 0 &&
      Math.abs(firstGapDriveSec - ds0) <= 2;
    const gapRound = Math.max(1, Math.round(gapAvailMin));
    const driveBeforeVisitName =
      i === 0 && prevBarrier && !nextBarrier && ds0 === 0 && ds1 > 0
        ? (displayHouseholds[1]?.client || '').trim() || 'visit'
        : '';
    const legTitle = duplicateFullLegInGap
      ? driveLabel(dm, 'Drive from depot')
      : driveBeforeVisitName && routeMinFromLeg > 0 && gapRound > routeMinFromLeg + 1e-6
        ? `Drive before ${driveBeforeVisitName}: ${routeMinFromLeg} min route (${gapRound} min gap)`
        : driveBeforeVisitName && routeMinFromLeg > 0
          ? `Drive before ${driveBeforeVisitName}: ${routeMinFromLeg} min`
        : driveBeforeVisitName
          ? `Drive before ${driveBeforeVisitName}: ${dm} min`
          : routeMinFromLeg > 0 && gapRound > routeMinFromLeg + 1e-6
            ? `Drive to next stop: ${routeMinFromLeg} min · ${gapRound} min until next stop`
            : routeMinFromLeg > 0
              ? `Drive to next stop: ${routeMinFromLeg} min`
              : `Drive to next stop: ${dm} min`;
    segs.push({
      top: driveTopPx,
      height: Math.max(4, driveH),
      title: legTitle,
      kind: 'drive',
    });
  }

  /** Last stop that is not a personal/fixed/flex block — drive home applies after this visit, not after trailing BLOCK rows. */
  let lastAddressIdx = -1;
  for (let i = N - 1; i >= 0; i--) {
    if (!displayHouseholds[i]?.isPersonalBlock) {
      lastAddressIdx = i;
      break;
    }
  }

  let backSec = 0;
  if (lastAddressIdx >= 0 && lastAddressIdx < N - 1 && typeof dayData.backToDepotSec === 'number' && dayData.backToDepotSec > 0) {
    // Route ends with personal blocks after the last address visit; ds[N] would be block→depot, not visit→depot.
    backSec = dayData.backToDepotSec;
  } else if (typeof ds[N] === 'number' && ds[N] > 0) {
    backSec = ds[N];
  } else if (typeof dayData.backToDepotSec === 'number') {
    backSec = dayData.backToDepotSec;
  }

  if (N > 0 && lastAddressIdx >= 0) {
    const lastBottomMin =
      topMinByIdx[lastAddressIdx] + driveOffsets[lastAddressIdx] + durMinByIdx[lastAddressIdx];
    const lastH = displayHouseholds[lastAddressIdx];
    const lastIsNoAddressBlock = (lastH as any)?.isNoLocation === true;

    const vrIsoForBack =
      typeof dayData.validationReturnSec === 'number' && Number.isFinite(dayData.validationReturnSec)
        ? isoFromSecondsSincePracticeMidnight(dateIso, dayData.validationReturnSec, practiceTz)
        : null;
    const returnWeekClockIso =
      dayData.backToDepotIso && DateTime.fromISO(dayData.backToDepotIso).isValid
        ? dayData.backToDepotIso
        : vrIsoForBack && DateTime.fromISO(vrIsoForBack).isValid
          ? vrIsoForBack
          : null;

    // backToDepot* is for return after the last address visit; trailing flex/fixed blocks are not a drive-home leg.
    if (!lastIsNoAddressBlock && (backSec > 0 || returnWeekClockIso)) {
      const kTrailEarly = lastAddressIdx + 1;
      const trailHEarly = kTrailEarly < N ? displayHouseholds[kTrailEarly] : null;
      const firstTrailIsFlexEarly =
        kTrailEarly < N &&
        isDriveBarrier(trailHEarly ?? undefined) &&
        (isFlexBlockItem(trailHEarly?.primary) ||
          isFlexBlockItem({ blockLabel: trailHEarly?.client, title: trailHEarly?.client }));
      const flexEtaEarly =
        firstTrailIsFlexEarly && displayTimeline[kTrailEarly]?.eta
          ? displayTimeline[kTrailEarly]!.eta!
          : null;
      const hopToTrailSec =
        Array.isArray(ds) &&
        ds.length > lastAddressIdx + 1 &&
        typeof ds[lastAddressIdx + 1] === 'number'
          ? ds[lastAddressIdx + 1]
          : null;
      const skipReturnDupToFlex =
        (firstTrailIsFlexEarly &&
          flexEtaEarly != null &&
          returnWeekClockIso != null &&
          DateTime.fromISO(flexEtaEarly).isValid &&
          DateTime.fromISO(returnWeekClockIso).isValid &&
          Math.abs(
            DateTime.fromISO(returnWeekClockIso).diff(DateTime.fromISO(flexEtaEarly), 'seconds').seconds
          ) <= 180) ||
        (firstTrailIsFlexEarly &&
          typeof dayData.backToDepotSec === 'number' &&
          Number.isFinite(dayData.backToDepotSec) &&
          hopToTrailSec != null &&
          Math.abs(hopToTrailSec - dayData.backToDepotSec) <= 2);

      const rawLast = displayTimeline[lastAddressIdx]?.bufferAfterMinutes;
      const bufMinLast =
        typeof rawLast === 'number' && Number.isFinite(rawLast)
          ? Math.max(0, rawLast)
          : Math.max(0, apptBufDefault);
      const driveDurationPx = (backSec / 60) * PPM;
      const yAfterVisit = toPx(lastBottomMin);
      const bufPx = Math.max(0, bufMinLast * PPM);

      if (skipReturnDupToFlex) {
        // Same leg as visit→flex in the inter-stop loop; API often sets backToDepotIso to flex arrival (My Day parity).
      } else if (returnWeekClockIso && DateTime.fromISO(returnWeekClockIso).isValid) {
        const arrivalMin = toMin(returnWeekClockIso);
        const yArrival = toPx(arrivalMin);
        const winStartMin = lastBottomMin + bufMinLast;
        const yBufEnd = yAfterVisit + Math.min(bufPx, Math.max(0, yArrival - yAfterVisit));
        const bufPaintPx = yBufEnd - yAfterVisit;
        if (bufPaintPx > 1) {
          const bm = Math.max(1, Math.round(bufPaintPx / PPM));
          segs.push({
            top: yAfterVisit,
            height: Math.max(4, bufPaintPx),
            title: `Buffer after visit: ${bm} min`,
            kind: 'buffer',
          });
        }

        const dMin =
          backSec > 0 ? backSec / 60 : Math.max(1, Math.round(arrivalMin - winStartMin));
        const maxAvailMin = Math.max(0, arrivalMin - winStartMin);
        const dMinCap = Math.min(dMin, maxAvailMin);

        const kTrail = lastAddressIdx + 1;
        const hasTrailingBlock =
          kTrail < N && isDriveBarrier(displayHouseholds[kTrail]);
        const trailH = displayHouseholds[kTrail];
        const firstTrailIsFlex =
          hasTrailingBlock &&
          (isFlexBlockItem(trailH?.primary) ||
            isFlexBlockItem({ blockLabel: trailH?.client, title: trailH?.client }));
        const blockTopMin = hasTrailingBlock ? topMinByIdx[kTrail] + driveOffsets[kTrail] : null;
        const blockBottomMin =
          hasTrailingBlock && blockTopMin != null ? blockTopMin + durMinByIdx[kTrail] : null;

        let driveStartMin: number;
        let driveEndMin: number;

        if (
          hasTrailingBlock &&
          blockTopMin != null &&
          blockBottomMin != null &&
          !firstTrailIsFlex
        ) {
          const preBlockGapMin = Math.max(0, blockTopMin - winStartMin);
          if (dMin <= preBlockGapMin + 1e-6) {
            driveStartMin = winStartMin;
            driveEndMin = winStartMin + dMin;
          } else {
            driveStartMin = arrivalMin - dMinCap;
            driveEndMin = arrivalMin;
            if (driveStartMin < blockBottomMin && driveEndMin > blockTopMin) {
              driveStartMin = Math.max(winStartMin, blockBottomMin);
              driveEndMin = Math.min(arrivalMin, driveStartMin + dMinCap);
            }
          }
        } else if (
          hasTrailingBlock &&
          blockTopMin != null &&
          blockBottomMin != null &&
          firstTrailIsFlex
        ) {
          // Do not stack return drive on the flex card: use free time before flex, else the gap after flex (flex is soft in time).
          const preFlexGapMin = Math.max(0, blockTopMin - winStartMin);
          const PRE_FLEX_GAP_SLACK_MIN = 3;
          if (dMin <= preFlexGapMin + PRE_FLEX_GAP_SLACK_MIN) {
            driveStartMin = winStartMin;
            driveEndMin = winStartMin + dMin;
          } else {
            driveStartMin = blockBottomMin;
            let ceilingMin = weekGrid.totalMinutes;
            const k2 = kTrail + 1;
            if (k2 < N) {
              ceilingMin = topMinByIdx[k2] + driveOffsets[k2];
            }
            const availAfter = Math.max(0, ceilingMin - driveStartMin);
            const paintedMin = Math.min(dMin, availAfter);
            driveEndMin = driveStartMin + paintedMin;
            if (paintedMin < 1e-6) {
              driveStartMin = Math.max(winStartMin, arrivalMin - dMinCap);
              driveEndMin = arrivalMin;
            }
          }
        } else {
          driveStartMin = Math.max(winStartMin, arrivalMin - dMinCap);
          driveEndMin = arrivalMin;
        }

        if (driveEndMin <= driveStartMin + 1e-6) {
          driveStartMin = Math.max(winStartMin, arrivalMin - dMinCap);
          driveEndMin = arrivalMin;
        }

        let driveTopPx = toPx(driveStartMin);
        let drivePx = Math.max(0, driveEndMin - driveStartMin) * PPM;
        let arrivalIso: string;
        if (
          firstTrailIsFlex &&
          blockBottomMin != null &&
          kTrail + 1 < N &&
          driveStartMin >= blockBottomMin - 1e-6
        ) {
          const k2 = kTrail + 1;
          const flexBottomPx = toPx(blockBottomMin);
          const nextTopPx = toPx(topMinByIdx[k2] + driveOffsets[k2]);
          driveTopPx = flexBottomPx;
          const gridEndPx = weekGrid.totalMinutes * PPM;
          let driveEndPx = nextTopPx;
          const vrIso =
            typeof dayData.validationReturnSec === 'number' &&
            Number.isFinite(dayData.validationReturnSec)
              ? isoFromSecondsSincePracticeMidnight(dateIso, dayData.validationReturnSec, practiceTz)
              : null;
          if (vrIso && DateTime.fromISO(vrIso).isValid) {
            driveEndPx = Math.max(driveEndPx, toPx(toMin(vrIso)));
          }
          if (returnWeekClockIso && DateTime.fromISO(returnWeekClockIso).isValid) {
            driveEndPx = Math.max(driveEndPx, toPx(toMin(returnWeekClockIso)));
          }
          driveEndPx = Math.min(gridEndPx, driveEndPx);
          drivePx = Math.max(0, driveEndPx - flexBottomPx);
          const ne = displayTimeline[k2]?.eta;
          arrivalIso =
            (vrIso && DateTime.fromISO(vrIso).isValid ? vrIso : null) ??
            (returnWeekClockIso && DateTime.fromISO(returnWeekClockIso).isValid
              ? returnWeekClockIso
              : null) ??
            (ne && DateTime.fromISO(ne).isValid
              ? ne
              : isoFromMinutesFromGridStart(
                  weekGrid.gridStartMinutesFromMidnight,
                  weekGrid.totalMinutes,
                  driveEndPx / PPM,
                  dateIso,
                  practiceTz
                ));
        } else {
          arrivalIso = isoFromMinutesFromGridStart(
            weekGrid.gridStartMinutesFromMidnight,
            weekGrid.totalMinutes,
            driveEndMin,
            dateIso,
            practiceTz
          );
        }

        if (drivePx > 1) {
          const routeDm = Math.max(1, Math.round(dMin));
          const titleBase = `Drive back to depot: ${routeDm} min`;
          segs.push({
            top: driveTopPx,
            height: Math.max(4, drivePx),
            title: `${titleBase} — Arrival: ${formatIsoInPracticeZone(arrivalIso, practiceTz)}`,
            kind: 'drive',
          });
        }
      } else {
        const bufUsePx = bufMinLast * PPM;
        let yPx = yAfterVisit;
        if (bufUsePx > 1) {
          const bm = Math.max(1, Math.round(bufUsePx / PPM));
          segs.push({
            top: yPx,
            height: Math.max(4, bufUsePx),
            title: `Buffer after visit: ${bm} min`,
            kind: 'buffer',
          });
          yPx += bufUsePx;
        }
        if (driveDurationPx > 1) {
          const dm = Math.max(1, Math.round(driveDurationPx / PPM));
          segs.push({
            top: yPx,
            height: Math.max(4, driveDurationPx),
            title: driveLabel(dm, 'Drive back to depot'),
            kind: 'drive',
          });
        }
      }
    } else if (!lastIsNoAddressBlock && dayData.endDepotTime) {
      const endDepotPx = depotTimeToPx(
        weekGrid.gridStartMinutesFromMidnight,
        weekGrid.totalMinutes,
        dayData.endDepotTime
      );
      const driveStartPx = toPx(lastBottomMin);
      const segH = Math.max(4, endDepotPx - driveStartPx);
      if (segH > 2) {
        const gridBaseIso = dayWallClockStartIso(
          dateIso,
          weekGrid.gridStartMinutesFromMidnight,
          practiceTz
        );
        const fallbackArrivalIso = DateTime.fromISO(gridBaseIso)
          .plus({ minutes: lastBottomMin + segH / PPM })
          .toISO()!;
        const rawLast = displayTimeline[lastAddressIdx]?.bufferAfterMinutes;
        const bufMinLast =
          typeof rawLast === 'number' && Number.isFinite(rawLast)
            ? Math.max(0, rawLast)
            : Math.max(0, apptBufDefault);
        const bufPx = Math.min(segH, bufMinLast * PPM);
        const drivePx = segH - bufPx;
        let yPx = driveStartPx;
        if (bufPx > 1) {
          const bm = Math.max(1, Math.round(bufPx / PPM));
          segs.push({
            top: yPx,
            height: Math.max(4, bufPx),
            title: `Buffer after visit: ${bm} min`,
            kind: 'buffer',
          });
          yPx += bufPx;
        }
        if (drivePx > 1) {
          segs.push({
            top: yPx,
            height: Math.max(4, drivePx),
            title:
              driveLabel(Math.round(drivePx / PPM), 'Drive back to depot') +
              ` — Arrival: ${formatIsoInPracticeZone(dayData.backToDepotIso ?? fallbackArrivalIso, practiceTz)}`,
            kind: 'drive',
          });
        }
      }
    }
  }

  return segs;
}

export const MYWEEK_STORAGE_KEY = 'myweek-state';

function getMyWeekStoredState(): {
  weekStart?: string;
  selectedDoctorId?: string;
  showByDriveTime?: boolean;
  zoneFillOpen?: boolean;
} | null {
  try {
    const raw = sessionStorage.getItem(MYWEEK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      weekStart: typeof parsed.weekStart === 'string' ? parsed.weekStart : undefined,
      selectedDoctorId: typeof parsed.selectedDoctorId === 'string' ? parsed.selectedDoctorId : undefined,
      showByDriveTime: typeof parsed.showByDriveTime === 'boolean' ? parsed.showByDriveTime : undefined,
      zoneFillOpen: typeof parsed.zoneFillOpen === 'boolean' ? parsed.zoneFillOpen : undefined,
    };
  } catch {
    return null;
  }
}

export default function MyWeek(props: MyWeekProps = {}) {
  const { readOnly, initialWeekStart, initialDoctorId, virtualAppt } = props;
  const { userEmail, doctorId: userDoctorId } = useAuth() as { userEmail?: string; doctorId?: string | null };
  const stored = readOnly ? null : getMyWeekStoredState();
  const [weekStart, setWeekStart] = useState<string>(() => {
    if (initialWeekStart) return initialWeekStart;
    if (stored?.weekStart) return stored.weekStart;
    const today = DateTime.local().toISODate() ?? '';
    return weekStartSunday(today);
  });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(() => {
    if (initialDoctorId) return initialDoctorId;
    if (stored?.selectedDoctorId) return stored.selectedDoctorId;
    return '';
  });
  const [showByDriveTime, setShowByDriveTime] = useState<boolean>(stored?.showByDriveTime ?? true);
  const [dayDataList, setDayDataList] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [etaLoading, setEtaLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [patientZoneMix, setPatientZoneMix] = useState<ZonePatientStat[] | null>(null);
  const [patientZoneMixLoading, setPatientZoneMixLoading] = useState(false);
  const [patientZoneMixErr, setPatientZoneMixErr] = useState<string | null>(null);
  const [zoneFillOpen, setZoneFillOpen] = useState(stored?.zoneFillOpen ?? true);
  const [zoneHoverKey, setZoneHoverKey] = useState<string | null>(null);
  const [zoneHoverPos, setZoneHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverCard, setHoverCard] = useState<{
    dayDate: string;
    key: string;
    x: number;
    y: number;
    client: string;
    clientAlert?: string | null;
    address: string;
    startIso: string;
    endIso: string;
    durMin: number;
    etaIso?: string | null;
    etdIso?: string | null;
    windowStartIso?: string | null;
    windowEndIso?: string | null;
    isFixedTime: boolean;
    isPersonalBlock?: boolean;
    isNoLocation?: boolean;
    patients: PatientBadge[];
    windowWarning?: boolean;
    /** Last stop of the day: scheduled end depot (wall clock), same as grid line */
    endDepotTimeFormatted?: string | null;
    /** IANA zone for displaying times on this card */
    practiceTimeZone: string;
    /** Viewport rect of the hovered appointment block — drives popover placement */
    anchor?: HoverAnchorRect;
  } | null>(null);
  /** Delay clearing hover so the cursor can move onto the portal to scroll long cards. */
  const hoverCardDismissTimerRef = useRef<number | null>(null);
  const weekGridScrollRef = useRef<HTMLDivElement | null>(null);
  const hoverBlockElementRef = useRef<HTMLElement | null>(null);
  const [driveHoverCard, setDriveHoverCard] = useState<{
    dayDate: string;
    segmentKey: string;
    x: number;
    y: number;
    title: string;
  } | null>(null);

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const didInitDoctor = useRef(false);

  useEffect(() => {
    let on = true;
    if (!userEmail) return;
    (async () => {
      setProvidersLoading(true);
      try {
        const raw = await fetchPrimaryProviders();
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as any)?.data)
            ? (raw as any).data
            : Array.isArray((raw as any)?.items)
              ? (raw as any).items
              : [];
        if (on) setProviders(list as Provider[]);
      } finally {
        if (on) setProvidersLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [userEmail]);

  useEffect(() => {
    if (didInitDoctor.current || !providers.length || initialDoctorId) return;
    // Prefer restored doctor from sessionStorage when standalone (so Schedule Loader → back keeps state)
    if (!readOnly) {
      const stored = getMyWeekStoredState();
      if (
        stored?.selectedDoctorId &&
        providers.some(
          (p: any) =>
            String(p?.id) === stored.selectedDoctorId ||
            String(p?.pimsId ?? '') === stored.selectedDoctorId
        )
      ) {
        didInitDoctor.current = true;
        return;
      }
    }
    const idToSet =
      userDoctorId != null && String(userDoctorId).trim() !== ''
        ? (() => {
            const match = providers.find(
              (p: any) =>
                String(p?.id) === String(userDoctorId) || String(p?.pimsId ?? '') === String(userDoctorId)
            );
            return match != null ? String(match.id) : null;
          })()
        : null;
    if (idToSet != null) {
      setSelectedDoctorId(idToSet);
      didInitDoctor.current = true;
      return;
    }
    if (!userEmail) return;
    const me = providers.find((p: any) => (p?.email || '').toLowerCase() === userEmail.toLowerCase());
    if (me?.id != null) {
      setSelectedDoctorId(String(me.id));
      didInitDoctor.current = true;
    }
  }, [providers, userEmail, userDoctorId, initialDoctorId, readOnly]);

  // Persist My Week state so returning from Schedule Loader (or tab switch) restores where you left off
  useEffect(() => {
    if (readOnly) return;
    sessionStorage.setItem(
      MYWEEK_STORAGE_KEY,
      JSON.stringify({
        weekStart,
        selectedDoctorId,
        showByDriveTime,
        zoneFillOpen,
      })
    );
  }, [readOnly, weekStart, selectedDoctorId, showByDriveTime, zoneFillOpen]);

  useEffect(() => {
    return () => {
      if (hoverCardDismissTimerRef.current) {
        clearTimeout(hoverCardDismissTimerRef.current);
        hoverCardDismissTimerRef.current = null;
      }
    };
  }, []);

  /** Keep popover anchor in sync when the week grid scrolls or the window resizes. */
  useEffect(() => {
    if (!hoverCard) return;

    const refreshAnchor = () => {
      const next = rectFromElement(hoverBlockElementRef.current);
      setHoverCard((prev) => {
        if (!prev) return null;
        if (!next) return prev;
        return { ...prev, anchor: next };
      });
    };

    const scrollEl = weekGridScrollRef.current;
    scrollEl?.addEventListener('scroll', refreshAnchor, { passive: true });
    window.addEventListener('resize', refreshAnchor);
    return () => {
      scrollEl?.removeEventListener('scroll', refreshAnchor);
      window.removeEventListener('resize', refreshAnchor);
    };
  }, [hoverCard?.dayDate, hoverCard?.key]);

  // Fetch patient zone mix for selected provider (for zone bars)
  useEffect(() => {
    if (!selectedDoctorId?.trim()) {
      setPatientZoneMix(null);
      return;
    }
    let on = true;
    setPatientZoneMixLoading(true);
    setPatientZoneMixErr(null);
    getZonePercentagesForProvider(selectedDoctorId, { includeUnzoned: true, activeOnly: true })
      .then((res: any) => {
        const data = res?.data ?? res;
        const list = Array.isArray(data) ? data : [];
        if (on) setPatientZoneMix(list as ZonePatientStat[]);
      })
      .catch((e: any) => {
        if (on) {
          setPatientZoneMixErr(e?.message ?? 'Failed to load zone mix');
          setPatientZoneMix(null);
        }
      })
      .finally(() => {
        if (on) setPatientZoneMixLoading(false);
      });
    return () => {
      on = false;
    };
  }, [selectedDoctorId]);

  // Load 7 days (inject virtualAppt on the matching day when provided)
  useEffect(() => {
    let on = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const responses = await Promise.all(
          dates.map((date) => fetchDoctorDay(date, selectedDoctorId || undefined))
        );
        if (!on) return;
        const list: DayData[] = dates.map((date, i) => {
          const resp: DoctorDayResponse = responses[i];
          // Day API returns appointments in route order (visit order). Do not re-sort by time.
          let appts: DoctorDayAppt[] = resp?.appointments ?? [];
          if (virtualAppt && virtualAppt.date === date) {
            const start = DateTime.fromISO(virtualAppt.suggestedStartIso);
            const end = start.plus({ minutes: Math.max(1, Math.floor(virtualAppt.serviceMinutes || 0)) });
            const insertionIndex = Math.max(0, Math.min(appts.length, virtualAppt.insertionIndex ?? 0));
            const synthetic: DoctorDayAppt = {
              id: `virtual-${date}-${start.toMillis()}`,
              clientName: virtualAppt.clientName ?? 'New Appointment',
              startIso: start.toISO()!,
              endIso: end.toISO()!,
              lat: virtualAppt.lat,
              lon: virtualAppt.lon,
              address1: virtualAppt.address1,
              city: virtualAppt.city,
              state: virtualAppt.state,
              zip: virtualAppt.zip,
              effectiveWindow: virtualAppt.arrivalWindow?.windowStartIso && virtualAppt.arrivalWindow?.windowEndIso
                ? {
                    startIso: virtualAppt.arrivalWindow.windowStartIso,
                    endIso: virtualAppt.arrivalWindow.windowEndIso,
                  }
                : undefined,
            } as DoctorDayAppt;
            (synthetic as any).isPreview = true;
            (synthetic as any).positionInDay = virtualAppt.positionInDay ?? insertionIndex + 1;
            appts = [...appts.slice(0, insertionIndex), synthetic, ...appts.slice(insertionIndex)];
          }
          const households = buildHouseholds(appts);
          return {
            date,
            timezone: resp.timezone,
            households,
            timeline: households.map(() => ({ eta: null, etd: null })),
            startDepot: resp?.startDepot ?? null,
            endDepot: resp?.endDepot ?? null,
            startDepotTime: str(resp as any, 'startDepotTime') ?? null,
            endDepotTime: str(resp as any, 'endDepotTime') ?? null,
          };
        });
        setDayDataList(list);
      } catch (e: any) {
        if (on) setErr(e?.message ?? 'Failed to load week');
        setDayDataList([]);
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [dates.join(','), selectedDoctorId, virtualAppt?.date, virtualAppt?.suggestedStartIso, virtualAppt?.serviceMinutes, virtualAppt?.insertionIndex]);

  // When showByDriveTime is true, fetch ETAs for each day that has households
  useEffect(() => {
    if (!showByDriveTime || dayDataList.length === 0) return;
    const needsEta = dayDataList.some(
      (d) => d.households.length > 0 && d.timeline.every((t) => !t.eta && !t.etd)
    );
    if (!needsEta) return;

    let on = true;
    setEtaLoading(true);
    const list = dayDataList;
    (async () => {
      try {
        const updated = await Promise.all(
          list.map(async (day) => {
            if (day.households.length === 0)
              return day;
            // Visit order for ETA: when this day has the selected routing candidate (virtualAppt), put
            // existing households first and the candidate at insertionIndex so the backend gets correct order.
            const hasVirtual = virtualAppt && virtualAppt.date === day.date;
            const insertionIndex = Math.max(
              0,
              Math.min(day.households.length - 1, virtualAppt?.insertionIndex ?? day.households.length - 1)
            );
            let householdsInVisitOrder: typeof day.households;
            if (hasVirtual) {
              const existing = day.households.filter((h) => !h.isPreview);
              const virtualH = day.households.find((h) => h.isPreview);
              const sortedExisting = [...existing].sort(
                (a, b) => (a.firstApptIndex ?? 999) - (b.firstApptIndex ?? 999)
              );
              householdsInVisitOrder =
                virtualH != null
                  ? [
                      ...sortedExisting.slice(0, insertionIndex),
                      virtualH,
                      ...sortedExisting.slice(insertionIndex),
                    ]
                  : sortedExisting;
            } else {
              householdsInVisitOrder = day.households;
            }
            const payload = {
              doctorId: selectedDoctorId || '',
              date: day.date,
              households: householdsInVisitOrder.map((h) => ({
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
                  effectiveWindow: h.effectiveWindow ?? h.primary?.effectiveWindow,
                }),
              })),
              startDepot: day.startDepot ? { lat: day.startDepot.lat, lon: day.startDepot.lon } : undefined,
              endDepot: day.endDepot ? { lat: day.endDepot.lat, lon: day.endDepot.lon } : undefined,
              useTraffic: false,
              ...(hasVirtual &&
              virtualAppt &&
              Number.isFinite(virtualAppt.lat) &&
              Number.isFinite(virtualAppt.lon)
                ? {
                    candidateSlot: {
                      insertionIndex,
                      positionInDay: virtualAppt.positionInDay ?? insertionIndex + 1,
                      suggestedStartIso: virtualAppt.suggestedStartIso,
                      lat: virtualAppt.lat,
                      lon: virtualAppt.lon,
                      serviceMinutes: virtualAppt.serviceMinutes,
                      overrunSeconds: (virtualAppt as any).overrunSeconds,
                      arrivalWindow:
                        virtualAppt.arrivalWindow?.windowStartIso && virtualAppt.arrivalWindow?.windowEndIso
                          ? {
                              windowStartIso: virtualAppt.arrivalWindow.windowStartIso,
                              windowEndIso: virtualAppt.arrivalWindow.windowEndIso,
                            }
                          : undefined,
                    },
                  }
                : {}),
            } as any;
            const result: any = await fetchEtas(payload);
            const valid = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);
            // Build key -> { eta, etd } from byIndex so we match by key (households and byIndex can be in different orders)
            const keyToSlot: Record<
              string,
              {
                eta: string | null;
                etd: string | null;
                windowStartIso?: string | null;
                windowEndIso?: string | null;
                bufferAfterMinutes?: number;
              }
            > = {};
            const blockLabelFromByIndex: Record<string, string> = {};
            if (Array.isArray(result?.byIndex)) {
              for (const row of result.byIndex as {
                key?: string;
                etaIso?: string;
                etdIso?: string;
                windowStartIso?: string;
                windowEndIso?: string;
                blockLabel?: string;
                bufferAfterMinutes?: number;
              }[]) {
                const k = row?.key;
                if (k == null) continue;
                const eta = valid(row?.etaIso) ? row.etaIso! : null;
                const etd = valid(row?.etdIso) ? row.etdIso! : null;
                const windowStartIso = valid(row?.windowStartIso) ? row.windowStartIso! : null;
                const windowEndIso = valid(row?.windowEndIso) ? row.windowEndIso! : null;
                const bufferAfterMinutes =
                  typeof row.bufferAfterMinutes === 'number' && Number.isFinite(row.bufferAfterMinutes)
                    ? row.bufferAfterMinutes
                    : undefined;
                keyToSlot[k] = {
                  eta,
                  etd,
                  windowStartIso: windowStartIso ?? undefined,
                  windowEndIso: windowEndIso ?? undefined,
                  ...(bufferAfterMinutes !== undefined ? { bufferAfterMinutes } : {}),
                };
                const bl = row?.blockLabel;
                if (bl != null && String(bl).trim() !== '') {
                  for (const variant of keyVariantsForKeyString(k)) {
                    blockLabelFromByIndex[variant] = String(bl).trim();
                  }
                }
              }
            }
            let tl = day.households.map((h, i) => {
              const slot = h.key ? keyToSlot[h.key] : undefined;
              let eta = slot?.eta ?? null;
              let etd = slot?.etd ?? null;
              if (!eta && h?.startIso) eta = h.startIso;
              if (!etd && eta && h?.endIso) {
                const dur = h.startIso && h.endIso
                  ? DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
                  : 60;
                etd = DateTime.fromISO(eta!).plus({ minutes: dur }).toISO();
              }
              return {
                eta: eta ?? undefined,
                etd: etd ?? undefined,
                windowStartIso: slot?.windowStartIso ?? undefined,
                windowEndIso: slot?.windowEndIso ?? undefined,
                ...(typeof slot?.bufferAfterMinutes === 'number'
                  ? { bufferAfterMinutes: slot.bufferAfterMinutes }
                  : {}),
              };
            });
            let driveSeconds: number[] | null = Array.isArray(result?.driveSeconds) ? result.driveSeconds : null;
            let depotToFirstRoutableSec: number | null = null;
            if (Array.isArray(result?.byIndex)) {
              const firstRoutableRow = result.byIndex.find(
                (r: any) => (r?.driveFromPrevSec ?? r?.driveFromPrevMinutes ?? 0) > 0 && r?.key != null && !String(r.key).startsWith('noloc:')
              );
              const row = firstRoutableRow ?? result.byIndex[0];
              if (row != null) {
                const sec = (row as any).driveFromPrevSec;
                const min = (row as any).driveFromPrevMinutes;
                depotToFirstRoutableSec =
                  typeof sec === 'number' ? sec : typeof min === 'number' ? min * 60 : null;
              }
            }
            const firstH = day.households[0];
            const firstIsBlock = (firstH as any)?.isPersonalBlock === true || firstH?.isNoLocation === true;
            // When first stop is a personal block, trust driveSeconds[0]: 0 means no drive from depot to block.
            // Do not overwrite with byIndex[0].driveFromPrevSec, which can be the drive *after* the block in some APIs.
            // Only fill ds[0] from byIndex[0] when the API didn't send a value (null/undefined), not when it sent 0.
            if (firstIsBlock && Array.isArray(result?.byIndex) && result.byIndex.length > 0 && driveSeconds && driveSeconds.length > 0) {
              const by0 = result.byIndex[0] as { driveFromPrevSec?: number; driveFromPrevMinutes?: number };
              const depotToBlockSec = typeof by0.driveFromPrevSec === 'number' ? by0.driveFromPrevSec : typeof by0.driveFromPrevMinutes === 'number' ? by0.driveFromPrevMinutes * 60 : 0;
              const apiSentFirst = driveSeconds[0] != null;
              if (depotToBlockSec > 0 && !apiSentFirst) {
                driveSeconds = [depotToBlockSec, ...driveSeconds.slice(1)];
              }
            }
            // Use only driveSeconds from API/byIndex for painting. Do not overwrite with depotToFirstRoutableSec.
            const backToDepotSec =
              typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null;
            const backToDepotIso = result?.backToDepotIso ?? null;
            const appointmentBufferMinutes =
              typeof result?.appointmentBufferMinutes === 'number' ? result.appointmentBufferMinutes : 5;
            // Display in positionInDay order from ETA byIndex; keyToPositionInDay uses all key variants so lookup works across precision differences
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
              const chronologicalOrder = Array.from({ length: N }, (_, i) => i).sort((a, b) => {
                const anchorA = tl[a]?.eta ?? tl[a]?.etd ?? day.households[a]?.startIso ?? '';
                const anchorB = tl[b]?.eta ?? tl[b]?.etd ?? day.households[b]?.startIso ?? '';
                return anchorA.localeCompare(anchorB);
              });
              routingOrderIndices = chronologicalOrder;
            }

            // Flex/blocks can get an ETA before the prior visit's ETD (routing vs window desync); align to route order.
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
                    ? Math.round(
                        DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso), 'minutes').minutes
                      )
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

            const mergedHouseholds = day.households.map((h) => {
              if (!h.isPersonalBlock || !h.primary) return h;
              const fromPrimary = String((h.primary as any).blockLabel ?? '').trim();
              let fromEta: string | undefined;
              for (const v of keyVariantsForKeyString(h.key)) {
                const x = blockLabelFromByIndex[v];
                if (x) {
                  fromEta = x;
                  break;
                }
              }
              const primary = {
                ...h.primary,
                blockLabel: fromPrimary || fromEta || (h.primary as any).blockLabel,
              };
              const client = blockDisplayLabel(primary);
              if ((h.primary as any).blockLabel === primary.blockLabel && h.client === client) return h;
              return { ...h, primary, client };
            });
            return {
              ...day,
              households: mergedHouseholds,
              timeline: tl,
              driveSeconds: driveSeconds ?? undefined,
              depotToFirstRoutableSec: depotToFirstRoutableSec ?? undefined,
              backToDepotSec: backToDepotSec ?? undefined,
              backToDepotIso: backToDepotIso ?? undefined,
              appointmentBufferMinutes,
              routingOrderIndices,
            };
          })
        );
        if (on) setDayDataList(updated);
      } catch {
        // non-fatal: keep dayDataList with empty timelines
      } finally {
        if (on) setEtaLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [showByDriveTime, dayDataList, selectedDoctorId, virtualAppt]);

  /** Earliest start in the week minus 30 min (honor earliest day start); grid end stays 19:30. */
  const weekGrid = useMemo(() => {
    let earliestMinutesFromMidnight: number | null = null;
    for (const day of dayDataList) {
      const dayTz = practiceTimeZoneOrDefault(day.timezone);
      const candidates: number[] = [];
      if (day.startDepotTime) {
        candidates.push(timeStrToMinutesFromMidnight(day.startDepotTime));
      }
      const first = day.households?.[0];
      if (first?.startIso) {
        const dt = DateTime.fromISO(first.startIso).setZone(dayTz);
        if (dt.isValid) {
          candidates.push(dt.hour * 60 + dt.minute);
        }
      }
      const firstSlot = day.timeline?.[0];
      const eta = firstSlot?.eta ?? firstSlot?.etd;
      if (eta) {
        const dt = DateTime.fromISO(eta).setZone(dayTz);
        if (dt.isValid) {
          candidates.push(dt.hour * 60 + dt.minute);
        }
      }
      if (candidates.length > 0) {
        const dayEarliest = Math.min(...candidates);
        if (
          earliestMinutesFromMidnight === null ||
          dayEarliest < earliestMinutesFromMidnight
        ) {
          earliestMinutesFromMidnight = dayEarliest;
        }
      }
    }
    const gridStartMinutesFromMidnight =
      earliestMinutesFromMidnight === null
        ? DEFAULT_GRID_START_MINUTES
        : Math.max(0, earliestMinutesFromMidnight - BUFFER_MINUTES_BEFORE_START);
    const totalMinutes = Math.max(
      60,
      END_MINUTES_FROM_MIDNIGHT - gridStartMinutesFromMidnight
    );
    return { gridStartMinutesFromMidnight, totalMinutes };
  }, [dayDataList]);

  const hours = useMemo(() => {
    const labelTz = practiceTimeZoneOrDefault(dayDataList[0]?.timezone);
    const out: { top: number; label: string }[] = [];
    const startH = Math.floor(weekGrid.gridStartMinutesFromMidnight / 60);
    for (let h = startH; h <= DAY_END_HOUR; h++) {
      const minAtHour = h * 60;
      const minutesFromGridStart = minAtHour - weekGrid.gridStartMinutesFromMidnight;
      if (minutesFromGridStart >= 0 && minutesFromGridStart <= weekGrid.totalMinutes) {
        out.push({
          top: minutesFromGridStart * PPM,
          label: DateTime.fromObject({ hour: h, minute: 0 }, { zone: labelTz }).toFormat('h a'),
        });
      }
    }
    return out;
  }, [weekGrid.gridStartMinutesFromMidnight, weekGrid.totalMinutes, dayDataList]);

  /** Hour and half-hour tick positions (lighter than depot start/end lines) */
  const timeTicks = useMemo(() => {
    const out: { top: number; isHour: boolean }[] = [];
    for (let min = 0; min <= weekGrid.totalMinutes; min += 30) {
      out.push({
        top: min * PPM,
        isHour: (weekGrid.gridStartMinutesFromMidnight + min) % 60 === 0,
      });
    }
    return out;
  }, [weekGrid.totalMinutes, weekGrid.gridStartMinutesFromMidnight]);

  // Week zone stats: actual minutes + appointment counts per zone; ratio vs expected (patient %)
  // Only include zones the doctor is assigned to (non-zero patient %)
  // Label shows number of patients needed to meet target (not percentage)
  const weekZoneBars = useMemo(() => {
    const assignedZones = (patientZoneMix ?? []).filter((z) => (z.percent ?? 0) >= 2);
    const byZoneMinutes = new Map<string, number>();
    const byZoneCount = new Map<string, number>();
    const byZoneClients = new Map<string, string[]>();
    let totalMinutes = 0;
    let totalAppointments = 0;
    for (const day of dayDataList) {
      for (const h of day.households ?? []) {
        if (h.isPersonalBlock) continue;
        const z = zoneOf(h.primary);
        const key = zoneKeyFrom(z);
        byZoneCount.set(key, (byZoneCount.get(key) ?? 0) + 1);
        totalAppointments += 1;
        const list = byZoneClients.get(key) ?? [];
        list.push(h.client || 'Unknown');
        byZoneClients.set(key, list);
        const mins = householdMinutes(h);
        if (mins <= 0) continue;
        byZoneMinutes.set(key, (byZoneMinutes.get(key) ?? 0) + mins);
        totalMinutes += mins;
      }
    }
    if (!assignedZones.length) return [];
    type ZoneStatus = 'green' | 'yellow' | 'red';
    const zoneStatus = (ratio: number): ZoneStatus =>
      ratio >= 0.9 && ratio <= 1.1
        ? 'green'
        : (ratio >= 0.8 && ratio < 0.9) || (ratio > 1.1 && ratio <= 1.2)
          ? 'yellow'
          : 'red';

    if (totalMinutes <= 0 && totalAppointments <= 0) {
      return assignedZones.map((z) => {
        const key = `${z.zoneId ?? 'none'}|${z.zoneName ?? ''}`;
        const actualCount = byZoneCount.get(key) ?? 0;
        const expectedCount = totalAppointments * (z.percent / 100);
        const needCount = Math.round(expectedCount - actualCount);
        const clients = byZoneClients.get(key) ?? [];
        return {
          zoneId: z.zoneId,
          zoneName: z.zoneName ?? 'No Zone',
          percent: z.percent,
          doctorPatientCount: z.count ?? 0,
          actualMinutes: 0,
          expectedMinutes: 0,
          ratio: 0,
          status: 'red' as ZoneStatus,
          actualCount: 0,
          expectedCount,
          needCount,
          clients,
        };
      });
    }
    return assignedZones.map((z) => {
      const key = `${z.zoneId ?? 'none'}|${z.zoneName ?? ''}`;
      const actualMinutes = byZoneMinutes.get(key) ?? 0;
      const expectedMinutes = totalMinutes * (z.percent / 100);
      const ratio = expectedMinutes > 0 ? actualMinutes / expectedMinutes : 0;
      const actualCount = byZoneCount.get(key) ?? 0;
      const expectedCount = totalAppointments * (z.percent / 100);
      const needCount = Math.round(expectedCount - actualCount);
      const clients = byZoneClients.get(key) ?? [];
      return {
        zoneId: z.zoneId,
        zoneName: z.zoneName ?? 'No Zone',
        percent: z.percent,
        doctorPatientCount: z.count ?? 0,
        actualMinutes,
        expectedMinutes,
        ratio,
        status: zoneStatus(ratio),
        actualCount,
        expectedCount,
        needCount,
        clients,
      };
    });
  }, [dayDataList, patientZoneMix]);

  const goToPrevWeek = () => {
    const prev = DateTime.fromISO(weekStart).minus({ weeks: 1 }).toISODate();
    if (prev) setWeekStart(prev);
  };
  const goToNextWeek = () => {
    const next = DateTime.fromISO(weekStart).plus({ weeks: 1 }).toISODate();
    if (next) setWeekStart(next);
  };
  const weekRangeLabel = useMemo(() => {
    const start = DateTime.fromISO(weekStart);
    const end = start.plus({ days: 6 });
    return `${start.toFormat('MMM d')} – ${end.toFormat('MMM d, yyyy')}`;
  }, [weekStart]);

  return (
    <div className="card" style={{ paddingBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>My Week</h2>
      <p className="muted">
        Week view: each day in a column. Toggle to show blocks by drive time (arrive/leave) or by appointment start/end.
        When using actual time, striped areas are driving; plain gaps are whitespace.
      </p>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {!readOnly && (
          <>
            <button
              type="button"
              className="btn"
              onClick={goToPrevWeek}
              title="Previous week"
              aria-label="Previous week"
            >
              ←
            </button>
            <button
              type="button"
              className="btn"
              onClick={goToNextWeek}
              title="Next week"
              aria-label="Next week"
            >
              →
            </button>
          </>
        )}
        {readOnly && (
          <span style={{ fontWeight: 600 }}>{weekRangeLabel}</span>
        )}
        {!readOnly && (
          <>
            <label className="muted" htmlFor="mw-date">
              Go to week
            </label>
            <input
              id="mw-date"
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(weekStartSunday(e.target.value))}
              onBlur={(e) => {
                const v = e.target.value;
                if (v) {
                  const dt = DateTime.fromISO(v);
                  if (dt.isValid) setWeekStart(weekStartSunday(v));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = (e.target as HTMLInputElement).value;
                  if (v) {
                    const dt = DateTime.fromISO(v);
                    if (dt.isValid) setWeekStart(weekStartSunday(v));
                  }
                }
              }}
              disabled={readOnly}
            />
          </>
        )}
        <label className="muted" htmlFor="mw-doc">
          Provider
        </label>
        <select
          id="mw-doc"
          value={selectedDoctorId}
          onChange={(e) => setSelectedDoctorId(e.target.value)}
          disabled={providersLoading || readOnly}
        >
          <option value="">— My Team's Schedule —</option>
          {providersLoading && <option disabled>Loading…</option>}
          {providers.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>

        <span className="muted" style={{ marginLeft: 8 }}>Show blocks by:</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="mw-drive-toggle"
              checked={showByDriveTime}
              onChange={() => setShowByDriveTime(true)}
            />
            Actual time (arrive/leave)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="mw-drive-toggle"
              checked={!showByDriveTime}
              onChange={() => setShowByDriveTime(false)}
            />
            Appointment time (start/end)
          </label>
        </div>
      </div>

      {(loading || (showByDriveTime && etaLoading)) && (
        <div className="dd-loading">
          <div className="dd-spinner" aria-hidden />
          <span>{loading ? 'Loading week…' : 'Loading drive times…'}</span>
        </div>
      )}
      {err && <p className="error">{err}</p>}

      {/* Week range label above zones */}
      {selectedDoctorId && (
        <div style={{ marginTop: 16, marginBottom: 4, fontWeight: 600, fontSize: 15 }}>
          {weekRangeLabel}
        </div>
      )}

      {/* Week zone fill: bars per zone (actual vs expected by patient %) — collapsible */}
      {selectedDoctorId && (
        <div
          className="card"
          style={{
            marginTop: 0,
            padding: 12,
            marginBottom: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setZoneFillOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              margin: 0,
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
            }}
            aria-expanded={zoneFillOpen}
          >
            <span
              style={{
                display: 'inline-block',
                transform: zoneFillOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              ▶
            </span>
            <h3 style={{ margin: 0, flex: 1 }}>
              Week zone fill <span className="muted">— vs patient % by zone (distribution by total patients)</span>
            </h3>
          </button>
          {zoneFillOpen && (
            <div style={{ marginTop: 8 }}>
          {patientZoneMixLoading && (
            <div className="dd-loading" style={{ marginBottom: 8 }}>
              <div className="dd-spinner" aria-hidden />
              <span className="muted">Loading zone mix…</span>
            </div>
          )}
          {patientZoneMixErr && (
            <div className="danger" style={{ marginBottom: 8 }}>{patientZoneMixErr}</div>
          )}
          {!patientZoneMixLoading && !patientZoneMixErr && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {weekZoneBars.length === 0 ? (
                <span className="muted">No zone data for this provider.</span>
              ) : (
                weekZoneBars.map((b) => {
                  const barKey = `${b.zoneId ?? 'none'}|${b.zoneName}`;
                  const countLabel =
                    (b.actualCount ?? 0) === 0
                      ? `No appt booked · ${b.needCount} under target`
                      : b.needCount > 0
                        ? `${b.needCount} under target`
                        : b.needCount < 0
                          ? `${Math.abs(b.needCount)} over`
                          : 'On target';
                  // Bar scale 0–120%; 100% target at 83.33%
                  const fillPct = Math.min(100, (b.ratio * 100) / 1.2);
                  const targetPct = 100 / 1.2; // ~83.33%
                  return (
                    <div
                      key={barKey}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
                      onMouseEnter={(e) => {
                        setZoneHoverKey(barKey);
                        setZoneHoverPos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => {
                        if (zoneHoverKey === barKey) setZoneHoverPos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseLeave={() => {
                        setZoneHoverKey(null);
                        setZoneHoverPos(null);
                      }}
                    >
                      <div style={{ minWidth: 100, fontWeight: 600, fontSize: 13 }}>
                        {b.zoneName}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 120,
                          maxWidth: 280,
                          height: 22,
                          background:
                            b.status === 'red' && (b.actualCount ?? 0) === 0
                              ? 'repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, #b91c1c 4px, #b91c1c 8px)'
                              : '#e5e7eb',
                          borderRadius: 4,
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: `${fillPct}%`,
                            background:
                              b.status === 'green'
                                ? '#22c55e'
                                : b.status === 'yellow'
                                  ? '#eab308'
                                  : '#ef4444',
                            borderRadius: 4,
                          }}
                        />
                        {/* 100% target marker */}
                        <div
                          style={{
                            position: 'absolute',
                            left: `${targetPct}%`,
                            top: 0,
                            bottom: 0,
                            width: 2,
                            background: '#0f172a',
                            marginLeft: -1,
                          }}
                          title="100% (target)"
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color:
                            b.status === 'green'
                              ? '#166534'
                              : b.status === 'yellow'
                                ? '#854d0e'
                                : '#b91c1c',
                          minWidth: 36,
                        }}
                      >
                        {countLabel}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
          {!patientZoneMixLoading && weekZoneBars.length > 0 && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              Numbers = patients needed to meet zone target. Zone targets use distribution by total patients. Green: within ±10% of target. Yellow: 10–20% off. Red: outside ±20%. Bar length = actual fill vs expected by patient %.
            </p>
          )}
            </div>
          )}
        </div>
      )}

      {/* Zone hover: client distribution tooltip */}
      {zoneHoverKey && zoneHoverPos &&
        createPortal(
          (() => {
            const bar = weekZoneBars.find((b) => `${b.zoneId ?? 'none'}|${b.zoneName}` === zoneHoverKey);
            if (!bar) return null;
            const clients = bar.clients ?? [];
            const totalBooked = weekZoneBars.reduce((s, b) => s + (b.actualCount ?? 0), 0);
            const zonePct =
              totalBooked > 0
                ? ((bar.actualCount ?? 0) / totalBooked * 100).toFixed(1)
                : '0';
            const left = zoneHoverPos.x + 14;
            let top = zoneHoverPos.y - 8;
            if (top + 200 > window.innerHeight - 12) top = window.innerHeight - 212;
            if (top < 12) top = 12;
            return (
              <div
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  maxWidth: 320,
                  maxHeight: 280,
                  overflow: 'auto',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  fontSize: 13,
                  lineHeight: 1.4,
                  pointerEvents: 'none',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {bar.zoneName} — {clients.length} booked
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  {zonePct}% of week&apos;s appointments
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Doctor&apos;s panel (by total patients): {Number(bar.percent).toFixed(1)}% of patients ({bar.doctorPatientCount ?? 0} total in this zone)
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  Client distribution (booked this week)
                </div>
                {clients.length === 0 ? (
                  <div className="muted">No appointments in this zone this week.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {clients.map((name, i) => (
                      <li key={`${i}-${name}`} style={{ marginBottom: 4 }}>
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })(),
          document.body
        )}

      <div
        ref={weekGridScrollRef}
        style={{
          marginTop: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          overflow: 'auto',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', width: '100%', minWidth: 0 }}>
          {/* Time column — header height matches day column (day name + date + points/buttons) so labels align with grid lines */}
          <div
            style={{
              width: WEEK_TIME_COL_WIDTH_PX,
              flexShrink: 0,
              position: 'sticky',
              left: 0,
              background: '#f9fafb',
              zIndex: 2,
            }}
          >
            <div style={{ minHeight: 28 }} aria-hidden />
            <div style={{ height: 48, marginBottom: 4 }} aria-hidden />
            <div style={{ position: 'relative', height: weekGrid.totalMinutes * PPM }}>
              {/* Time labels aligned with hour lines: center of label on the line */}
              {hours.map((h, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: h.top,
                    left: 6,
                    right: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#475569',
                    lineHeight: 1,
                    transform: 'translateY(-50%)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {h.label}
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {dates.map((dateIso, colIndex) => {
            const dayData = dayDataList[colIndex];
            const practiceTzCol = practiceTimeZoneOrDefault(
              dayData?.timezone ?? dayDataList.find((d) => d?.timezone)?.timezone
            );
            const dt = DateTime.fromISO(dateIso, { zone: practiceTzCol });
            const isToday = dateIso === DateTime.local().toISODate();
            const hasApptsOrBlocks = (dayData?.households?.length ?? 0) > 0;
            return (
              <div
                key={dateIso}
                style={{
                  flex: hasApptsOrBlocks ? '2 1 0' : '1 1 0',
                  minWidth: 72,
                  borderLeft: '1px solid #e5e7eb',
                  background: isToday ? '#fefce8' : undefined,
                }}
              >
                <div
                  style={{
                    minHeight: 28,
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  <span>{dt.toFormat('ccc')}</span>
                  <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{dt.toFormat('M/d')}</span>
                </div>
                {/* Points and total driving time at top of each day; fixed height so all day columns align (no column sits higher) */}
                <div
                  style={{
                    fontSize: 10,
                    color: '#475569',
                    textAlign: 'center',
                    marginBottom: 4,
                    lineHeight: 1.3,
                    minHeight: 24,
                    height: 48,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {dayData ? (
                    (() => {
                      const pts = dayPoints(dayData.households);
                      const driveSec = dayTotalDriveSeconds(dayData);
                      const driveMin = Math.round(driveSec / 60);
                      const driveColor = colorForDrive(driveMin);
                      const hasAppts = (dayData.households?.length ?? 0) > 0;
                      const mapsLinks = hasAppts && dayData.households
                        ? (() => {
                            const stops: Stop[] = dayData.households
                              .filter((h) => !h.isNoLocation && Number.isFinite(h.lat) && Number.isFinite(h.lon))
                              .map((h) => ({
                                lat: h.lat,
                                lon: h.lon,
                                label: h.client,
                                address: h.address,
                              }));
                            return buildGoogleMapsLinksForDay(stops, {
                              start: dayData.startDepot
                                ? { lat: dayData.startDepot.lat, lon: dayData.startDepot.lon }
                                : undefined,
                              end: dayData.endDepot
                                ? { lat: dayData.endDepot.lat, lon: dayData.endDepot.lon }
                                : undefined,
                            });
                          })()
                        : [];
                      const scheduleLoaderHref = selectedDoctorId && hasAppts
                        ? `/schedule-loader?targetDate=${dateIso}&doctorId=${encodeURIComponent(selectedDoctorId)}`
                        : null;
                      return (
                        <>
                          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 8px' }}>
                            {pts > 0 && <span><strong>Points:</strong> {pts}</span>}
                            {showByDriveTime && driveMin > 0 && (
                              <span style={driveColor ? { color: driveColor } : undefined}>
                                <strong>Drive:</strong> {driveMin} min
                              </span>
                            )}
                          </div>
                          {hasAppts && (
                            <div style={{ display: 'flex', flexDirection: 'row', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                              {scheduleLoaderHref && (
                                <a
                                  href={scheduleLoaderHref}
                                  className="btn"
                                  style={{ fontSize: 10, padding: '4px 8px', whiteSpace: 'nowrap' }}
                                  title={`Open Schedule Loader for ${dateIso}`}
                                >
                                  Schedule Loader
                                </a>
                              )}
                              {mapsLinks.length > 0 && (
                                <a
                                  href={mapsLinks[0]}
                                  className="btn"
                                  style={{ fontSize: 10, padding: '4px 8px', whiteSpace: 'nowrap' }}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={mapsLinks.length > 1 ? `Open segment 1 of ${mapsLinks.length} in Google Maps` : 'Open this day in Google Maps'}
                                >
                                  Maps
                                </a>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <div>&nbsp;</div>
                      <div>&nbsp;</div>
                    </>
                  )}
                </div>
                <div style={{ position: 'relative', height: weekGrid.totalMinutes * PPM, padding: '0 4px' }}>
                  {/* Thick horizontal lines at this day's startDepotTime and endDepotTime */}
                  {dayData?.startDepotTime && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: depotTimeToPx(weekGrid.gridStartMinutesFromMidnight, weekGrid.totalMinutes, dayData.startDepotTime) - DEPOT_LINE_OFFSET,
                        height: 0,
                        borderTop: `${DEPOT_LINE_PX}px solid ${DEPOT_LINE_COLOR}`,
                        pointerEvents: 'none',
                        zIndex: 1,
                      }}
                      aria-hidden
                    />
                  )}
                  {dayData?.endDepotTime && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: depotTimeToPx(weekGrid.gridStartMinutesFromMidnight, weekGrid.totalMinutes, dayData.endDepotTime) - DEPOT_LINE_OFFSET,
                        height: 0,
                        borderTop: `${DEPOT_LINE_PX}px solid ${DEPOT_LINE_COLOR}`,
                        pointerEvents: 'none',
                        zIndex: 1,
                      }}
                      aria-hidden
                    />
                  )}
                  {/* Hour and half-hour lines (full width across column) */}
                  {timeTicks.map((tick, i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: tick.top,
                        height: 0,
                        borderTop: tick.isHour ? TICK_HOUR_BORDER : TICK_HALF_BORDER,
                        pointerEvents: 'none',
                        zIndex: 0,
                      }}
                      aria-hidden
                    />
                  ))}
                  {/* Drive + appointments share one layout so hatched drive bands align with blocks */}
                  {(() => {
                    if (!dayData?.households?.length) return null;
                    const bufferMin = dayData.appointmentBufferMinutes ?? 5;
                    const layout = computeMyWeekDayColumnLayout(
                      dayData,
                      weekGrid,
                      dateIso,
                      showByDriveTime,
                      bufferMin
                    );
                    if (!layout) return null;
                    const dayDataForDrive =
                      virtualAppt?.date === dateIso &&
                      typeof virtualAppt.validationReturnSec === 'number' &&
                      Number.isFinite(virtualAppt.validationReturnSec)
                        ? { ...dayData, validationReturnSec: virtualAppt.validationReturnSec }
                        : dayData;
                    const driveSegs = showByDriveTime
                      ? buildMyWeekDriveSegmentsFromLayout(layout, dayDataForDrive, weekGrid, dateIso)
                      : [];
                    const { displayHouseholds, displayTimeline, topMinByIdx, durMinByIdx, driveOffsets } =
                      layout;
                    return (
                      <>
                        {driveSegs.map((seg, i) => (
                          <div
                            key={`drive-${i}`}
                            onMouseEnter={(ev) => {
                              setDriveHoverCard({
                                dayDate: dateIso,
                                segmentKey: `${dateIso}-drive-${i}`,
                                x: ev.clientX,
                                y: ev.clientY,
                                title: seg.title,
                              });
                            }}
                            onMouseMove={(ev) => {
                              setDriveHoverCard((prev) =>
                                prev && prev.segmentKey === `${dateIso}-drive-${i}`
                                  ? { ...prev, x: ev.clientX, y: ev.clientY }
                                  : prev
                              );
                            }}
                            onMouseLeave={() => {
                              setDriveHoverCard((prev) =>
                                prev?.segmentKey === `${dateIso}-drive-${i}` ? null : prev
                              );
                            }}
                            style={{
                              position: 'absolute',
                              left: 4,
                              right: 4,
                              top: seg.top,
                              height: seg.height,
                              background: seg.kind === 'buffer' ? BUFFER_FILL : DRIVE_FILL,
                              border: seg.kind === 'buffer' ? BUFFER_BORDER : undefined,
                              boxSizing: 'border-box',
                              borderRadius: 4,
                              zIndex: 0,
                              cursor: 'default',
                            }}
                          />
                        ))}
                        {displayHouseholds.map((h, idx) => {
                          const startIso = h.startIso;
                          const endIso = h.endIso;
                          if (!startIso || !endIso) return null;
                          const slot = displayTimeline[idx];
                          const topMin = topMinByIdx[idx] ?? 0;
                          const durMin = durMinByIdx[idx] ?? 1;
                          const driveOffsetMin = driveOffsets[idx] ?? 0;
                          const top = topMin * PPM + driveOffsetMin * PPM;
                          const height = Math.max(14, durMin * PPM);

                          const flexBlock = h.isPersonalBlock && isFlexBlockItem(h.primary);
                          const isFixedTime =
                            (h.isPersonalBlock && !flexBlock) ||
                            (str(h.primary, 'appointmentType') || '').toLowerCase() === 'fixed time' ||
                            (h.patients[0]?.type || '').toLowerCase() === 'fixed time';

                          const etaIso = slot?.eta ?? null;
                          const etdIso = slot?.etd ?? null;
                          const windowEndForWarn =
                            (slot?.windowStartIso != null && slot?.windowEndIso != null
                              ? slot.windowEndIso
                              : null) ??
                            h.windowEndIso ??
                            h.effectiveWindow?.endIso ??
                            null;
                          const windowWarning =
                            showByDriveTime &&
                            !h.isPersonalBlock &&
                            !isFixedTime &&
                            shouldShowEtaWindowWarning(etaIso, windowEndForWarn);
                          const isLastStopOfDay = idx === displayHouseholds.length - 1;
                          const endDepotTimeFormatted = isLastStopOfDay
                            ? formatDepotWallClockOnDate(dayData.endDepotTime, dateIso, dayData.timezone)
                            : null;
                          return (
                            <div
                              key={h.key}
                              onPointerEnter={(ev) => {
                                if (hoverCardDismissTimerRef.current) {
                                  clearTimeout(hoverCardDismissTimerRef.current);
                                  hoverCardDismissTimerRef.current = null;
                                }
                                const el = ev.currentTarget;
                                hoverBlockElementRef.current = el;
                                const anchor = rectFromElement(el);
                                setHoverCard({
                                  dayDate: dateIso,
                                  key: h.key,
                                  x: ev.clientX,
                                  y: ev.clientY,
                                  ...(anchor ? { anchor } : {}),
                                  client: h.client,
                                  clientAlert: str(h.primary, 'clientAlert') ?? null,
                                  address: h.address,
                                  startIso,
                                  endIso,
                                  durMin,
                                  etaIso: showByDriveTime ? etaIso : null,
                                  etdIso: showByDriveTime ? etdIso : null,
                                  windowStartIso: (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowStartIso : null) ?? h.windowStartIso ?? null,
                                  windowEndIso: (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ?? h.windowEndIso ?? null,
                                  isFixedTime,
                                  isPersonalBlock: h.isPersonalBlock,
                                  isNoLocation: h.isNoLocation,
                                  patients: h.patients,
                                  windowWarning,
                                  practiceTimeZone: dayData.timezone,
                                  ...(endDepotTimeFormatted ? { endDepotTimeFormatted } : {}),
                                });
                              }}
                              onPointerMove={(ev) => {
                                const t = ev.currentTarget;
                                if (t) hoverBlockElementRef.current = t;
                                setHoverCard((prev) => {
                                  if (!prev || prev.key !== h.key || prev.dayDate !== dateIso) return prev;
                                  const nextAnchor = rectFromElement(t);
                                  return {
                                    ...prev,
                                    x: ev.clientX,
                                    y: ev.clientY,
                                    ...(nextAnchor ? { anchor: nextAnchor } : {}),
                                  };
                                });
                              }}
                              onPointerLeave={() => {
                                hoverCardDismissTimerRef.current = window.setTimeout(() => {
                                  setHoverCard((prev) =>
                                    prev?.key === h.key && prev?.dayDate === dateIso ? null : prev
                                  );
                                  hoverBlockElementRef.current = null;
                                  hoverCardDismissTimerRef.current = null;
                                }, 280);
                              }}
                              style={{
                                position: 'absolute',
                                left: 4,
                                right: 4,
                                top,
                                height,
                                zIndex: 1,
                                background: flexBlock
                                  ? '#fef9c3'
                                  : h.isPersonalBlock
                                    ? '#e5e7eb'
                                    : h.isPreview
                                      ? '#ede9fe'
                                      : h.isNoLocation
                                        ? '#fee2e2'
                                        : '#e0f2fe',
                                border: `1px solid ${flexBlock ? '#ca8a04' : h.isPersonalBlock ? '#9ca3af' : h.isPreview ? '#a855f7' : h.isNoLocation ? '#ef4444' : '#38bdf8'}`,
                                borderRadius: 6,
                                fontSize: 11,
                                overflow: 'hidden',
                                padding: 4,
                                cursor: 'default',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    minWidth: 0,
                                    flex: 1,
                                  }}
                                >
                                  {h.isPersonalBlock ? blockDisplayLabel(h.primary) : h.client}
                                </span>
                                {windowWarning && (
                                  <span
                                    title="Window Warning"
                                    aria-label="Window Warning"
                                    role="img"
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      flexShrink: 0,
                                      color: '#b45309',
                                      background: '#fef3c7',
                                      padding: 2,
                                      borderRadius: 4,
                                      border: '1px solid #f59e0b',
                                      lineHeight: 0,
                                    }}
                                  >
                                    <AlertTriangle size={14} strokeWidth={2.25} aria-hidden />
                                  </span>
                                )}
                              </div>
                              {!h.isPersonalBlock && (
                              <div
                                style={{
                                  color: '#6b7280',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                    display: 'flex',
                                    flexWrap: 'nowrap',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 0,
                                    minWidth: 0,
                                }}
                              >
                                {h.patients.map((p, pi) => (
                                  <span key={pi} style={{ display: 'inline' }}>
                                    {pi > 0 ? ', ' : ''}
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: 'bottom' }}>
                                      {p.isMember && (
                                        <span
                                          style={{ flexShrink: 0, display: 'inline-flex', lineHeight: 0 }}
                                          title={p.membershipName?.trim() || 'Member'}
                                          aria-hidden
                                        >
                                          <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
                                        </span>
                                      )}
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                    </span>
                                  </span>
                                ))}
                              </div>
                              )}
                              {isFixedTime && !h.isPersonalBlock && (
                                <span style={{ fontSize: 10, color: '#b91c1c', fontWeight: 600 }}>Fixed</span>
                              )}
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hover card: full appointment details */}
      {hoverCard &&
        createPortal(
          (() => {
            const CARD_MAX_W = 420;
            const CARD_MIN_W = 300;
            const PADDING = 12;
            const OFFSET = 14;
            const vwW = window.innerWidth;
            const vwH = window.innerHeight;
            const pos = computeHoverPopoverPosition({
              anchor: hoverCard.anchor,
              x: hoverCard.x,
              y: hoverCard.y,
              vwW,
              vwH,
              cardMaxW: CARD_MAX_W,
              cardMinW: CARD_MIN_W,
              padding: PADDING,
              offset: OFFSET,
              preferSide: 'left',
            });
            const { left, top, maxCardH, width: popoverW } = pos;
            const practiceTzHover = practiceTimeZoneOrDefault(hoverCard.practiceTimeZone);
            const addrNoZip = stripZipFromAddressLine(hoverCard.address);
            return (
              <div
                role="tooltip"
                onMouseEnter={() => {
                  if (hoverCardDismissTimerRef.current) {
                    clearTimeout(hoverCardDismissTimerRef.current);
                    hoverCardDismissTimerRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  hoverBlockElementRef.current = null;
                  setHoverCard(null);
                }}
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  width: popoverW,
                  maxWidth: CARD_MAX_W,
                  minWidth: Math.min(300, popoverW),
                  maxHeight: maxCardH,
                  overflow: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: 10,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
                  fontSize: 13,
                  lineHeight: 1.35,
                  pointerEvents: 'auto',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#14532d' }}>{hoverCard.client}</span>
                  <span style={{ color: '#64748b' }}>·</span>
                  <span style={{ color: '#64748b', flex: '1 1 12rem', minWidth: 0 }}>{addrNoZip}</span>
                  {hoverCard.windowWarning && (
                    <span
                      role="status"
                      aria-label="Window Warning"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: '#b45309',
                        fontWeight: 600,
                        fontSize: 12,
                        background: '#fef3c7',
                        padding: '2px 6px',
                        borderRadius: 6,
                        border: '1px solid #f59e0b',
                      }}
                    >
                      <AlertTriangle size={14} strokeWidth={2.25} aria-hidden />
                      Window Warning
                    </span>
                  )}
                </div>
                {hoverCard.clientAlert && (
                  <div style={{ marginBottom: 4, color: '#dc2626', fontSize: 12, lineHeight: 1.35 }}>
                    Alert: {hoverCard.clientAlert}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', marginBottom: 4, fontSize: 13, color: '#334155' }}>
                  <span>
                    <b>Scheduled:</b>{' '}
                    {formatIsoTimeShortInPracticeZone(hoverCard.startIso, practiceTzHover)}
                  </span>
                  <span>
                    <b>Duration:</b> {hoverCard.durMin} min
                  </span>
                  {hoverCard.endDepotTimeFormatted && (
                    <span style={{ color: '#475569' }}>
                      <b>End of depot:</b> {hoverCard.endDepotTimeFormatted}
                    </span>
                  )}
                  {hoverCard.isFixedTime && !hoverCard.isPersonalBlock && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>FIXED TIME</span>
                  )}
                  {hoverCard.isPersonalBlock && (
                    <span style={{ color: '#6b7280', fontWeight: 600 }}>{hoverCard.client || 'Block'}</span>
                  )}
                  {hoverCard.isNoLocation && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>No location</span>
                  )}
                </div>
                {(() => {
                  const showArrive = !!(hoverCard.etaIso || hoverCard.etdIso);
                  const showWindow =
                    !!(hoverCard.windowStartIso || hoverCard.windowEndIso) &&
                    !(hoverCard.isPersonalBlock && hoverCard.isFixedTime);
                  if (!showArrive && !showWindow) return null;
                  return (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 10,
                        alignItems: 'baseline',
                        marginBottom: 4,
                        fontSize: 13,
                        color: '#334155',
                      }}
                    >
                      {showArrive && (
                        <span>
                          <b>Arrive/Leave:</b>{' '}
                          {hoverCard.etaIso
                            ? formatIsoTimeShortInPracticeZone(hoverCard.etaIso, practiceTzHover)
                            : '—'}
                          {' – '}
                          {hoverCard.etdIso
                            ? formatIsoTimeShortInPracticeZone(hoverCard.etdIso, practiceTzHover)
                            : '—'}
                        </span>
                      )}
                      {showWindow && (
                        <span>
                          <b>Window of arrival:</b>{' '}
                          {hoverCard.isFixedTime ? (
                            <>
                              {formatIsoTimeShortInPracticeZone(hoverCard.startIso, practiceTzHover)}
                              {' – '}
                              {formatIsoTimeShortInPracticeZone(hoverCard.endIso, practiceTzHover)}
                            </>
                          ) : (
                            <>
                              {hoverCard.windowStartIso
                                ? formatIsoTimeShortInPracticeZone(hoverCard.windowStartIso, practiceTzHover)
                                : '—'}
                              {' – '}
                              {hoverCard.windowEndIso
                                ? formatIsoTimeShortInPracticeZone(hoverCard.windowEndIso, practiceTzHover)
                                : '—'}
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {hoverCard.patients?.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: '#14532d' }}>Patients</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {hoverCard.patients.map((p, i) => (
                        <li key={i} style={{ marginBottom: 6 }}>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {p.isMember && (
                                <Heart size={14} fill="#dc2626" color="#dc2626" strokeWidth={1.5} aria-hidden />
                              )}
                              <span>{p.name}</span>
                            </span>
                            {p.isMember && p.membershipName?.trim() ? (
                              <span style={{ color: '#991b1b', fontWeight: 600, fontSize: 13 }}>
                                {p.membershipName.trim()}
                              </span>
                            ) : null}
                            {p?.alerts ? (
                              <>
                                {' '}
                                — <strong>Alert</strong>:{' '}
                                <span style={{ color: '#dc2626' }}>{p.alerts}</span>
                              </>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                            {p.type ? (
                              <>
                                <b>{p.type}</b>
                                {p.desc ? ` — ${p.desc}` : ''}
                              </>
                            ) : (
                              p.desc || '—'
                            )}
                          </div>
                          {(p.status || p.recordStatus) && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: 6,
                                marginTop: 4,
                              }}
                            >
                              {p.status ? (
                                <span style={statusPillStyle(p.status)} title="Status">
                                  {p.status}
                                </span>
                              ) : null}
                              {p.recordStatus ? (
                                <span style={statusPillStyle(p.recordStatus)} title="Records status">
                                  {p.recordStatus}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })(),
          document.body
        )}

      {/* Hover card: drive segment (same style as appointment hover) */}
      {driveHoverCard &&
        createPortal(
          (() => {
            const PADDING = 12;
            const OFFSET = 14;
            const CARD_W = 260;
            const vwW = window.innerWidth;
            const vwH = window.innerHeight;
            // Keep drive tooltip to the right of the cursor; slide left only to stay in view (do not flip to the left of the pointer).
            let left = driveHoverCard.x + OFFSET;
            if (left + CARD_W > vwW - PADDING) left = vwW - PADDING - CARD_W;
            if (left < PADDING) left = PADDING;
            let top = driveHoverCard.y - 12;
            if (top + 80 > vwH - PADDING) top = vwH - PADDING - 80;
            if (top < PADDING) top = PADDING;
            return (
              <div
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  minWidth: 200,
                  maxWidth: 280,
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: 14,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
                  fontSize: 14,
                  lineHeight: 1.4,
                  pointerEvents: 'none',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4, color: '#475569' }}>
                  Driving
                </div>
                <div style={{ fontSize: 13 }}>{driveHoverCard.title}</div>
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
}
