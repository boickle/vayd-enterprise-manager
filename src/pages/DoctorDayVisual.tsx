// src/pages/DoctorDayVisual.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import type { DoctorDayProps } from './DoctorDay';
import {
  fetchDoctorDay,
  clientDisplayName,
  isBlockEntry,
  blockDisplayLabel,
  isFlexBlockItem,
  type DoctorDayAppt,
  type DoctorDayResponse,
  type Depot,
} from '../api/appointments';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { etaHouseholdArrivalWindowPayload, fetchEtas } from '../api/routing';
import { useAuth } from '../auth/useAuth';
import { buildGoogleMapsLinksForDay, type Stop } from '../utils/maps';
import { Heart } from 'lucide-react';
import { shouldShowEtaWindowWarning } from '../utils/windowWarning';
import {
  computeHoverPopoverPosition,
  rectFromElement,
  type HoverAnchorRect,
} from '../utils/hoverPopoverPosition';
import { reverseGeocode } from '../api/geo';
import {
  formatHM,
  colorForWhitespace,
  colorForHDRatio,
  colorForDrive,
} from '../utils/statsFormat';
import './DoctorDay.css';

// ===== Vertical scale: match My Week column density =====
const PPM = 1.1;
const DAY_END_HOUR = 19;
const DAY_END_MINUTE = 30;
const END_MINUTES_FROM_MIDNIGHT = DAY_END_HOUR * 60 + DAY_END_MINUTE;
const DEFAULT_GRID_START_MINUTES = 6 * 60 + 30;
const BUFFER_MINUTES_BEFORE_START = 30;
/** Start / end of day — thicker than hour grid lines (matches My Week) */
const DEPOT_LINE_PX = 5;
const DEPOT_LINE_OFFSET = Math.floor(DEPOT_LINE_PX / 2);
const DEPOT_LINE_COLOR = '#64748b';
/** Hour (:00) and half-hour (:30) — light guides */
const TICK_HOUR_BORDER = '1px solid #e2e8f0';
const TICK_HALF_BORDER = '1px dashed #eef2f6';
/** Right margin reserved for hour labels (wider so labels stay legible) */
const TIMELINE_LABEL_GUTTER_PX = 60;
const DRIVE_FILL =
  'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';
/** Post-visit buffer: see-through white tint; column background shows (same as My Week) */
const BUFFER_FILL = 'rgba(255, 255, 255, 0.35)';
const BUFFER_BORDER = '1px dashed #d1d5db';

/** Parse "HH:mm" or "HH:mm:ss" to minutes from midnight. */
function timeStrToMinutesFromMidnight(s: string): number {
  const parts = s.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h)) return 0;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

function dayBaseIso(gridStartMinutesFromMidnight: number, dateIso: string): string {
  const hh = Math.floor(gridStartMinutesFromMidnight / 60);
  const mm = gridStartMinutesFromMidnight % 60;
  return DateTime.fromISO(dateIso)
    .set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
    .toISO()!;
}

function minutesFromDayStart(
  gridStartMinutesFromMidnight: number,
  totalMinutes: number,
  iso: string,
  dateIso: string
): number {
  const base = DateTime.fromISO(dayBaseIso(gridStartMinutesFromMidnight, dateIso));
  const t = DateTime.fromISO(iso);
  const mins = t.diff(base, 'minutes').minutes;
  return Math.max(0, Math.min(totalMinutes, Math.round(mins)));
}

/** Wall-clock ISO at `minFromGridStart` minutes after the day grid start (inverse of minutesFromDayStart). */
function isoFromMinutesFromGridStart(
  gridStartMinutesFromMidnight: number,
  totalMinutes: number,
  minFromGridStart: number,
  dateIso: string
): string {
  const base = DateTime.fromISO(dayBaseIso(gridStartMinutesFromMidnight, dateIso));
  const clamped = Math.max(0, Math.min(totalMinutes, minFromGridStart));
  return base.plus({ minutes: clamped }).toISO()!;
}

/** Routing-v2 `validationReturnSec`: seconds after local midnight on `dateIso`. */
function isoFromSecSinceLocalMidnight(dateIso: string, secFromMidnight: number): string | null {
  if (!Number.isFinite(secFromMidnight) || secFromMidnight < 0) return null;
  const d = DateTime.fromISO(dateIso);
  if (!d.isValid) return null;
  return d.startOf('day').plus({ seconds: Math.round(secFromMidnight) }).toISO()!;
}

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

/** Minutes from day-grid start for a depot clock time (same clamp as depotTimeToPx). */
function depotMinutesFromGridStart(
  timeStr: string | null | undefined,
  gridStartMinutesFromMidnight: number,
  totalMinutes: number
): number | null {
  const s = timeStr?.trim();
  if (!s) return null;
  const fromMidnight = timeStrToMinutesFromMidnight(s);
  const fromGrid = fromMidnight - gridStartMinutesFromMidnight;
  if (!Number.isFinite(fromGrid)) return null;
  return Math.max(0, Math.min(totalMinutes, fromGrid));
}

/* ----------------- narrow helpers ----------------- */
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

type EtaByIndexRow = {
  key?: string;
  etaIso?: string;
  etdIso?: string;
  driveFromPrevMinutes?: number;
  driveFromPrevSec?: number;
  bufferAfterMinutes?: number;
  earlyClamped?: boolean;
  blockLabel?: string;
  positionInDay?: number;
  windowStartIso?: string;
  windowEndIso?: string;
};

/** byIndex / parallel keys[] may not match households[] index order; match by routing key. */
function byIndexRowForHousehold(h: { key: string }, byIndex: EtaByIndexRow[]): EtaByIndexRow | undefined {
  const hSet = new Set(keyVariantsForKeyString(h.key));
  for (const row of byIndex) {
    if (row?.key == null) continue;
    for (const rv of keyVariantsForKeyString(row.key)) {
      if (hSet.has(rv)) return row;
    }
  }
  return undefined;
}

function parallelKeysIndexForHousehold(h: { key: string }, keysArr: string[]): number {
  const hSet = new Set(keyVariantsForKeyString(h.key));
  for (let j = 0; j < keysArr.length; j++) {
    const k = keysArr[j];
    if (k == null) continue;
    for (const kv of keyVariantsForKeyString(k)) {
      if (hSet.has(kv)) return j;
    }
  }
  return -1;
}

/**
 * API driveSeconds[k] is leg along keys[k-1]→keys[k] (k≥1), plus [0] depot→keys[0] and [N] last→depot.
 * When display order (positionInDay) differs from keys[] order, map hops to display-consecutive pairs.
 */
function alignDriveSecondsToDisplayOrder(
  driveSeconds: number[] | null,
  keysArr: string[] | null,
  households: { key: string }[],
  routingOrderIndices: number[] | null
): number[] | null {
  if (!driveSeconds || !keysArr || !routingOrderIndices || households.length === 0) return null;
  const N = households.length;
  if (keysArr.length !== N || driveSeconds.length !== N + 1) return null;

  const hiToKeyIdx = new Map<number, number>();
  for (let hi = 0; hi < N; hi++) {
    const j = parallelKeysIndexForHousehold(households[hi], keysArr);
    if (j < 0) return null;
    hiToKeyIdx.set(hi, j);
  }

  const out: number[] = new Array(N + 1).fill(0);
  out[0] = driveSeconds[0] ?? 0;
  for (let d = 0; d < N - 1; d++) {
    const hiA = routingOrderIndices[d];
    const hiB = routingOrderIndices[d + 1];
    const ia = hiToKeyIdx.get(hiA)!;
    const ib = hiToKeyIdx.get(hiB)!;
    let sum = 0;
    if (ib > ia) {
      for (let k = ia + 1; k <= ib; k++) sum += driveSeconds[k] ?? 0;
    } else if (ib < ia) {
      for (let k = ib + 1; k <= ia; k++) sum += driveSeconds[k] ?? 0;
    }
    out[d + 1] = sum;
  }
  out[N] = driveSeconds[N] ?? 0;
  return out;
}

/** Merge ETA byIndex blockLabel onto primary when the appointment payload omits it. */
function blockLabelMetaForDisplay(
  h: { key: string; primary?: DoctorDayAppt | null | undefined },
  etaByKey: Record<string, string>
): { blockLabel?: string; title?: string } {
  const p = h.primary as any;
  const fromP = String(p?.blockLabel ?? '').trim();
  if (fromP) return { blockLabel: p.blockLabel, title: p?.title };
  for (const v of keyVariantsForKeyString(h.key)) {
    const x = etaByKey[v];
    if (x) return { blockLabel: x, title: p?.title };
  }
  return { blockLabel: p?.blockLabel, title: p?.title };
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

function stripZipFromAddressLine(line: string): string {
  if (!line?.trim()) return line;
  return line.replace(/,\s*\d{5}(-\d{4})?\s*$/i, '').replace(/\s+\d{5}(-\d{4})?\s*$/i, '').trim();
}

/* ---- address-based fallback grouping for no-geo ---- */
function normalizeAddressString(s?: string): string | null {
  if (!s) return null;
  return (
    s
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[,\s]+$/g, '')
      .trim() || null
  );
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

/** Same client at same location = one stop; different clients at same address = separate stops. */
function householdGroupKey(a: DoctorDayAppt, lat: number, lon: number, addrKey: string | null, idPart: string, hasGeo: boolean): string {
  const clientId = (a as any)?.clientPimsId ?? (a as any)?.clientId;
  const clientPart = clientId != null ? String(clientId) : (str(a, 'clientName') ?? '').trim();
  if (hasGeo) return `${lat}_${lon}_${clientPart}`;
  if (addrKey) return `addr:${addrKey}_${clientPart}`;
  return `noloc:${idPart}`;
}

/** Assign unique ETA keys: first at (lat,lon) gets "lat,lon", second "lat,lon:2", etc. */
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

/* ----------------- patient extraction ----------------- */
type PatientBadge = {
  name: string;
  pimsId?: string | null;
  /** confirmStatusName — pre-exam / check-in */
  status?: string | null;
  /** statusName — records status (PIMS) */
  recordStatus?: string | null;
  type?: string | null;
  desc?: string | null;
  startIso?: string | null;
  endIso?: string | null;
  alerts?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
};
function makePatientBadge(a: any): PatientBadge {
  const name =
    str(a, 'patientName') ||
    str(a, 'petName') ||
    str(a, 'animalName') ||
    str(a, 'name') ||
    'Patient';
  const type =
    str(a, 'appointmentType') || str(a, 'appointmentTypeName') || str(a, 'serviceName') || null;
  const desc = str(a, 'description') || str(a, 'visitReason') || null;
  const status = str(a, 'confirmStatusName') ?? null;
  const recordStatus = str(a, 'statusName') ?? null;
  const pat = a?.patient;
  const isMember = Boolean(a?.isMember ?? pat?.isMember);
  const rawMem = a?.membershipName ?? pat?.membershipName;
  const membershipName =
    typeof rawMem === 'string' && rawMem.trim()
      ? rawMem.trim()
      : rawMem != null && String(rawMem).trim()
        ? String(rawMem).trim()
        : null;
  return {
    name,
    type,
    desc,
    status,
    recordStatus,
    pimsId: str(a, 'patientPimsId') ?? null,
    startIso: getStartISO(a) ?? null,
    endIso: getEndISO(a) ?? null,
    alerts: str(a, 'alerts') ?? null,
    isMember,
    membershipName,
  };
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

/* ----------------- data types ----------------- */
type Household = {
  key: string;
  client: string;
  clientAlert?: string;
  address: string;
  lat: number;
  lon: number;
  startIso?: string | null;
  endIso?: string | null;
  isNoLocation?: boolean;
  isPreview?: boolean;
  isPersonalBlock?: boolean;
  patients: PatientBadge[];
  primary: DoctorDayAppt; // Store primary appointment for checking appointment type
  /** Min index in appts array (for visit-order sort when preview is present) */
  firstApptIndex?: number;
};

/* ----------------- schedule bounds (for work start) ----------------- */
function pickScheduleBounds(
  resp: DoctorDayResponse,
  sortedAppts: DoctorDayAppt[]
): { start: string | null; end: string | null } {
  const start =
    str(resp as any, 'startDepotTime') ??
    str(resp as any, 'workdayStartIso') ??
    str(resp as any, 'shiftStartIso') ??
    (resp as any)?.schedule?.startIso ??
    (resp as any)?.schedule?.start ??
    null;

  const end =
    str(resp as any, 'endDepotTime') ??
    str(resp as any, 'workdayEndIso') ??
    str(resp as any, 'shiftEndIso') ??
    (resp as any)?.schedule?.endIso ??
    (resp as any)?.schedule?.end ??
    null;

  if (start && end) return { start, end };

  // Fallback: min start / max end from the set
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const a of sortedAppts) {
    const s = getStartISO(a);
    const e = getEndISO(a);
    if (s && (!earliest || DateTime.fromISO(s) < DateTime.fromISO(earliest))) earliest = s;
    if (e && (!latest || DateTime.fromISO(e) > DateTime.fromISO(latest))) latest = e;
  }
  return { start: earliest, end: latest };
}

/* ----------------- visual window helpers (8:30–10:30 + day-start clamp) ----------------- */
function eightThirtyIsoFor(date: string): string {
  return DateTime.fromISO(date).set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toISO()!;
}
function tenThirtyIsoFor(date: string): string {
  return DateTime.fromISO(date).set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toISO()!;
}
/** Return doctor's visual work start for the date (schedStartIso if valid time/ISO; else 08:30) */
function workStartIsoFor(date: string, schedStartIso?: string | null): string {
  if (schedStartIso && /^\d{2}:\d{2}(:\d{2})?$/.test(schedStartIso)) {
    const [hh, mm] = schedStartIso.split(':');
    return DateTime.fromISO(date)
      .set({
        hour: Math.min(23, Number(hh) || 0),
        minute: Math.min(59, Number(mm) || 0),
        second: 0,
        millisecond: 0,
      })
      .toISO()!;
  }
  if (schedStartIso && DateTime.fromISO(schedStartIso).isValid) return schedStartIso;
  return eightThirtyIsoFor(date);
}
/** Visual rule: given an appointment start, return [winStartIso, winEndIso] */
function adjustedWindowForStart(
  date: string,
  startIso: string,
  schedStartIso?: string | null
): { winStartIso: string; winEndIso: string } {
  const start = DateTime.fromISO(startIso);
  const workStart = DateTime.fromISO(workStartIsoFor(date, schedStartIso));
  const eightThirty = DateTime.fromISO(eightThirtyIsoFor(date));
  const tenThirty = DateTime.fromISO(tenThirtyIsoFor(date));

  const symmetricEarly = start.minus({ hours: 1 });
  if (symmetricEarly < eightThirty && start <= tenThirty) {
    const ws = workStart > eightThirty ? workStart : eightThirty;
    const we = ws.plus({ hours: 2 });
    return { winStartIso: ws.toISO()!, winEndIso: we.toISO()! };
  }
  const ws = DateTime.max(workStart, start.minus({ hours: 1 }));
  const we = start.plus({ hours: 1 });
  return { winStartIso: ws.toISO()!, winEndIso: we.toISO()! };
}

/* ----------------- ETA timeline type (aligned to households) ----------------- */
type DisplaySlot = {
  eta?: string | null;
  etd?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
  /** From ETA byIndex: minutes at site after ETD before departing (0 = none). */
  bufferAfterMinutes?: number;
};

export default function DoctorDayVisual({
  readOnly,
  initialDate,
  initialDoctorId,
  virtualAppt,
}: DoctorDayProps) {
  const { userEmail, doctorId: userDoctorId } = useAuth() as { userEmail?: string; doctorId?: string | null };

  // base state
  const [date, setDate] = useState<string>(() => initialDate || DateTime.local().toISODate() || '');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersErr, setProvidersErr] = useState<string | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(initialDoctorId || '');
  const didInitDoctor = useRef(false);

  const [startDepot, setStartDepot] = useState<Depot | null>(null);
  const [endDepot, setEndDepot] = useState<Depot | null>(null);
  const [appts, setAppts] = useState<DoctorDayAppt[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // server ETA/depot/drive
  const [timeline, setTimeline] = useState<DisplaySlot[]>([]);
  const [driveSecondsArr, setDriveSecondsArr] = useState<number[] | null>(null);
  /** Parallel to ETA keys[] from last fetch; used to align driveSeconds with positionInDay display order. */
  const [etaRouteKeys, setEtaRouteKeys] = useState<string[] | null>(null);
  /** Drive from depot to first stop (sec). From byIndex[0].driveFromPrevMinutes/driveFromPrevSec when backend provides it. */
  const [depotToFirstSec, setDepotToFirstSec] = useState<number | null>(null);
  const [backToDepotSec, setBackToDepotSec] = useState<number | null>(null);
  const [backToDepotIso, setBackToDepotIso] = useState<string | null>(null);
  const [appointmentBufferMinutes, setAppointmentBufferMinutes] = useState<number>(5);
  const [etaErr, setEtaErr] = useState<string | null>(null);
  /** When set, render in positionInDay order. From ETA response. */
  const [routingOrderIndices, setRoutingOrderIndices] = useState<number[] | null>(null);
  /** ETA byIndex rows (route order); used so displayTimeline aligns with positionInDay-ordered households. */
  const [byIndexRows, setByIndexRows] = useState<
    Array<{
      etaIso?: string;
      etdIso?: string;
      windowStartIso?: string;
      windowEndIso?: string;
      bufferAfterMinutes?: number;
    }>
  >([]);

  // schedule bounds for visual work start
  const [schedStartIso, setSchedStartIso] = useState<string | null>(null);
  const [schedEndIso, setSchedEndIso] = useState<string | null>(null);
  const [startDepotTimeStr, setStartDepotTimeStr] = useState<string | null>(null);
  const [endDepotTimeStr, setEndDepotTimeStr] = useState<string | null>(null);

  // pretty depot addresses
  const [startDepotAddr, setStartDepotAddr] = useState<string | null>(null);
  const [endDepotAddr, setEndDepotAddr] = useState<string | null>(null);

  // Toggle: position blocks by drive time (ETA/ETD) or by appointment start/end
  const [showByDriveTime, setShowByDriveTime] = useState<boolean>(true);

  // hover card (global, mouse-anchored)
  const [hoverCard, setHoverCard] = useState<{
    key: string;
    x: number;
    y: number;
    client: string;
    clientAlert?: string;
    isFixedTime?: boolean;
    isPersonalBlock?: boolean;
    isNoLocation?: boolean;
    address: string;
    durMin: number;
    etaIso?: string | null;
    etdIso?: string | null;
    sIso: string;
    eIso: string;
    patients: PatientBadge[];
    /** Backend effectiveWindow when available; used for Window display */
    effectiveWindow?: { startIso: string; endIso: string };
    /** Window from ETA byIndex row when present; preferred over effectiveWindow */
    windowFromByIndex?: { winStartIso: string; winEndIso: string };
    /** Same window as native `title` on the block (avoids recomputation drift for Flex Block / blocks). */
    resolvedWinStartIso: string;
    resolvedWinEndIso: string;
    anchor?: HoverAnchorRect;
  } | null>(null);
  const hoverCardDismissTimerRef = useRef<number | null>(null);

  const [driveHoverCard, setDriveHoverCard] = useState<{
    segmentKey: string;
    x: number;
    y: number;
    title: string;
  } | null>(null);

  /** blockLabel from last ETA byIndex (keys include lat/lon variants) */
  const [etaBlockLabelByKey, setEtaBlockLabelByKey] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      if (hoverCardDismissTimerRef.current) {
        clearTimeout(hoverCardDismissTimerRef.current);
        hoverCardDismissTimerRef.current = null;
      }
    };
  }, []);

  /* ------------ load providers ------------ */
  useEffect(() => {
    let on = true;
    if (!userEmail) return;
    (async () => {
      setProvidersLoading(true);
      setProvidersErr(null);
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
      } catch (e: any) {
        if (on) setProvidersErr(e?.message ?? 'Failed to load providers');
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
    const me = providers.find(
      (p: any) => (p?.email || '').toLowerCase() === userEmail.toLowerCase()
    );
    if (me?.id != null) {
      setSelectedDoctorId(String(me.id));
      didInitDoctor.current = true;
    }
  }, [providers, userEmail, userDoctorId, initialDoctorId]);

  /* ---------- Depot reverse geocode ---------- */
  useEffect(() => {
    let on = true;
    (async () => {
      setStartDepotAddr(null);
      setEndDepotAddr(null);
      try {
        if (startDepot) {
          const addr = await reverseGeocode(startDepot.lat, startDepot.lon);
          if (on) setStartDepotAddr(addr);
        }
        if (endDepot) {
          const addr = await reverseGeocode(endDepot.lat, endDepot.lon);
          if (on) setEndDepotAddr(addr);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      on = false;
    };
  }, [startDepot, endDepot]);

  /* ------------ load day (with optional preview injection) ------------ */
  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const resp: DoctorDayResponse = await fetchDoctorDay(date, selectedDoctorId || undefined);
        if (!on) return;

        // Day API returns appointments in route order (visit order). Do not re-sort by startIso.
        const inVisitOrder = [...(resp.appointments ?? [])];

        // inject preview if provided — keep visit order (insert at insertionIndex)
        const final = (() => {
          if (!virtualAppt || virtualAppt.date !== date) return inVisitOrder;
          const start = DateTime.fromISO(virtualAppt.suggestedStartIso);
          const end = start.plus({ minutes: Math.max(0, virtualAppt.serviceMinutes || 0) });
          const mid = inVisitOrder[Math.floor(inVisitOrder.length / 2)];
          const prev = {
            id: `virtual-${start.toMillis()}`,
            clientName: virtualAppt.clientName || 'New Appointment',
            lat: virtualAppt.lat ?? (mid as any)?.lat,
            lon: virtualAppt.lon ?? (mid as any)?.lon,
            address1: virtualAppt.address1 ?? '',
            city: virtualAppt.city ?? '',
            state: virtualAppt.state ?? '',
            zip: virtualAppt.zip ?? '',
            appointmentStart: start.toISO(),
            appointmentEnd: end.toISO(),
            isPreview: true as any,
            positionInDay: virtualAppt.positionInDay ?? virtualAppt.insertionIndex + 1,
            // Use arrivalWindow from backend if available
            effectiveWindow: virtualAppt.arrivalWindow?.windowStartIso && virtualAppt.arrivalWindow?.windowEndIso
              ? {
                  startIso: virtualAppt.arrivalWindow.windowStartIso,
                  endIso: virtualAppt.arrivalWindow.windowEndIso,
                }
              : undefined,
          } as any as DoctorDayAppt;
          const idx = Math.max(0, Math.min(inVisitOrder.length, virtualAppt.insertionIndex));
          return [...inVisitOrder.slice(0, idx), prev, ...inVisitOrder.slice(idx)];
        })();

        setAppts(final);
        setStartDepot(resp.startDepot ?? null);
        setEndDepot(resp.endDepot ?? null);

        const sdt = str(resp as any, 'startDepotTime');
        const edt = str(resp as any, 'endDepotTime');
        setStartDepotTimeStr(sdt?.trim() ? sdt : null);
        setEndDepotTimeStr(edt?.trim() ? edt : null);

        // schedule bounds for day-start/day-end visuals
        const { start: schedStart, end: schedEnd } = pickScheduleBounds(resp, final);
        setSchedStartIso(schedStart);
        setSchedEndIso(schedEnd);
      } catch (e: any) {
        if (on) setErr(e?.message ?? 'Failed to load day');
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [date, selectedDoctorId, virtualAppt]);

  /* ------------ group into households + patients (keep personal blocks); same client same address = one stop, different clients same address = separate stops ------------ */
  const households = useMemo<Household[]>(() => {
    const m = new Map<string, Household>();
    for (const [idx, a] of appts.entries()) {
      const rawLat = num(a, 'lat');
      const rawLon = num(a, 'lon');

      const backendNoLoc = Boolean(
        (a as any)?.isNoLocation ?? (a as any)?.noLocation ?? (a as any)?.unroutable
      );

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

      const patient = makePatientBadge(a);
      const apptIsPreview = (a as any)?.isPreview === true;

      if (!m.has(groupKey)) {
        const initialKey = hasGeo ? keyFor(lat, lon, 6) : addrKey ? `addr:${addrKey}` : `noloc:${idPart}`;
        m.set(groupKey, {
          key: initialKey,
          client: isBlockEntry(a) ? blockDisplayLabel(a) : clientDisplayName(a),
          clientAlert: (a as any)?.clientAlert ?? null,
          address: formatAddress(a),
          lat,
          lon,
          startIso: getStartISO(a) ?? null,
          endIso: getEndISO(a) ?? null,
          isNoLocation: !hasGeo,
          isPreview: apptIsPreview,
          isPersonalBlock,
          patients: isPersonalBlock ? [] : [patient],
          primary: a,
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

        if (apptIsPreview) h.isPreview = true;

        if (!h.isPersonalBlock) {
          const exists = h.patients.some(
            (p) =>
              (patient.pimsId && p.pimsId === patient.pimsId) ||
              (!patient.pimsId && p.name === patient.name && p.startIso === patient.startIso)
          );
          if (!exists) h.patients.push(patient);
        }
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
  }, [appts]);

  /* =========================================================================
     ROUTING: Make server ETA/ETD authoritative (no local overrides)
     ========================================================================= */
  useEffect(() => {
    let on = true;

    (async () => {
      setEtaErr(null);
      setTimeline(households.map(() => ({ eta: null, etd: null })));
      setDriveSecondsArr(null);
      setEtaRouteKeys(null);
      setDepotToFirstSec(null);
      setBackToDepotSec(null);
      setBackToDepotIso(null);
      setRoutingOrderIndices(null);
      setByIndexRows([]);

      if (households.length === 0) return;

      // Visit order for ETA: when we have a selected routing candidate (virtualAppt), put existing
      // households first (by firstApptIndex) and the candidate at insertionIndex so the backend
      // gets the correct order (e.g. [existing1..4, candidate] for POST-LAST).
      const hasVirtual = virtualAppt && virtualAppt.date === date;
      const insertionIndex = Math.max(0, Math.min(households.length - 1, virtualAppt?.insertionIndex ?? households.length - 1));
      const keyToHouseholdIndex = new Map(households.map((h, i) => [h.key, i]));

      let ordered: { h: Household; viewIdx: number }[];
      if (hasVirtual) {
        const existing = households.filter((h) => !h.isPreview);
        const virtualH = households.find((h) => h.isPreview);
        const sortedExisting = [...existing].sort(
          (a, b) => (a.firstApptIndex ?? 999) - (b.firstApptIndex ?? 999)
        );
        const inVisitOrder =
          virtualH != null
            ? [
                ...sortedExisting.slice(0, insertionIndex),
                virtualH,
                ...sortedExisting.slice(insertionIndex),
              ]
            : sortedExisting;
        ordered = inVisitOrder.map((h) => ({
          h,
          viewIdx: keyToHouseholdIndex.get(h.key) ?? 0,
        }));
      } else {
        ordered = households.map((h, viewIdx) => ({ h, viewIdx }));
      }

      // Pick doctorId from the first appt with provider info; fallback to selection
      const inferredDoctorId =
        (appts[0] as any)?.primaryProviderPimsId ??
        (appts[0] as any)?.providerPimsId ??
        (appts[0] as any)?.doctorId ??
        selectedDoctorId ??
        '';

      // Build payload: include ALL rows in visit order; always include lat/lon (0 for non-routable)
      const householdsPayload = ordered.map(({ h }) => {
        const isBlock = isBlockEntry({ ...h.primary, key: h.key });

        const lat = Number.isFinite(h.lat) ? (h.lat as number) : 0;
        const lon = Number.isFinite(h.lon) ? (h.lon as number) : 0;

        return {
          key: h.key,
          lat,
          lon,
          startIso: h.startIso ?? null,
          endIso: h.endIso ?? null,
          ...etaHouseholdArrivalWindowPayload({
            isBlock,
            isNoLocation: !!h.isNoLocation,
            lat,
            lon,
            startIso: h.startIso,
            endIso: h.endIso,
            effectiveWindow: h.primary?.effectiveWindow,
          }),
        } as any;
      });

      const payload = {
        doctorId: inferredDoctorId,
        date,
        households: householdsPayload,
        startDepot: startDepot ? { lat: startDepot.lat, lon: startDepot.lon } : undefined,
        endDepot: endDepot ? { lat: endDepot.lat, lon: endDepot.lon } : undefined,
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
                arrivalWindow: virtualAppt.arrivalWindow?.windowStartIso && virtualAppt.arrivalWindow?.windowEndIso
                  ? {
                      windowStartIso: virtualAppt.arrivalWindow.windowStartIso,
                      windowEndIso: virtualAppt.arrivalWindow.windowEndIso,
                    }
                  : undefined,
              },
            }
          : {}),
      } as any;

      try {
        const result: any = await fetchEtas(payload);
        if (!on) return;

        const tl: DisplaySlot[] = households.map(() => ({ eta: null, etd: null }));
        const serverETA: boolean[] = households.map(() => false);
        const serverETD: boolean[] = households.map(() => false);
        const validIso = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);

        // 1) Match each byIndex row to its household by key (API array order can differ from positionInDay / households order).
        const byIndex: Array<{
          key?: string;
          etaIso?: string;
          etdIso?: string;
          driveFromPrevMinutes?: number;
          driveFromPrevSec?: number;
          bufferAfterMinutes?: number;
          earlyClamped?: boolean;
        }> = Array.isArray(result?.byIndex) ? result.byIndex : [];
        const keysArr: string[] = Array.isArray(result?.keys) ? result.keys : [];

        for (let i = 0; i < ordered.length; i++) {
          const { h, viewIdx } = ordered[i];
          const row = byIndexRowForHousehold(h, byIndex) || {};
          let eta = row.etaIso;
          let etd = row.etdIso;
          const flexLike =
            h.isPersonalBlock === true &&
            (isFlexBlockItem(h.primary) ||
              isFlexBlockItem({
                blockLabel: (row as { blockLabel?: string }).blockLabel,
                title: h.client,
              }) ||
              isFlexBlockItem({ blockLabel: h.client, title: h.client }));
          // Fixed blocks: if server ETA is far before the scheduled window, snap to schedule. Flex must keep routing ETA (e.g. ~10:00 vs scheduled 11:00).
          if (!flexLike && h.isPersonalBlock === true && h.startIso && validIso(eta)) {
            const rowEta = DateTime.fromISO(eta!);
            const blockStart = DateTime.fromISO(h.startIso);
            if (rowEta.isValid && blockStart.isValid && rowEta < blockStart.minus({ minutes: 30 })) {
              eta = h.startIso;
              etd = h.endIso ?? etd;
            }
          }
          if (validIso(eta)) {
            tl[viewIdx].eta = eta!;
            serverETA[viewIdx] = true;
          }
          if (validIso(etd)) {
            tl[viewIdx].etd = etd!;
            serverETD[viewIdx] = true;
          }
          if (typeof row.bufferAfterMinutes === 'number' && Number.isFinite(row.bufferAfterMinutes)) {
            tl[viewIdx].bufferAfterMinutes = row.bufferAfterMinutes;
          }
        }

        // 2) Fallback parallel etaIso[] / etdIso[] / keys[] (same index), not ordered[] index.
        const etaIsoArr: string[] = Array.isArray(result?.etaIso) ? result.etaIso : [];
        const etdIsoArr: string[] = Array.isArray(result?.etdIso) ? result.etdIso : [];
        for (let i = 0; i < ordered.length; i++) {
          const { h, viewIdx } = ordered[i];
          const ki = parallelKeysIndexForHousehold(h, keysArr);
          if (ki < 0) continue;
          if (!tl[viewIdx].eta && validIso(etaIsoArr[ki])) {
            tl[viewIdx].eta = etaIsoArr[ki];
            serverETA[viewIdx] = true;
          }
          if (!tl[viewIdx].etd && validIso(etdIsoArr[ki])) {
            tl[viewIdx].etd = etdIsoArr[ki];
            serverETD[viewIdx] = true;
          }
        }

        // 3) Key maps for routables
        const etaByKey: Record<string, string> = result?.etaByKey || {};
        const etaByLL6: Record<string, string> = result?.etaByLL6 || {};
        const etaByLL5: Record<string, string> = result?.etaByLL5 || {};

        for (let i = 0; i < ordered.length; i++) {
          const { h, viewIdx } = ordered[i];
          if (!tl[viewIdx].eta) {
            if (!h.isNoLocation && Number.isFinite(h.lat) && Number.isFinite(h.lon)) {
              const k6 = `${h.lat.toFixed(6)},${h.lon.toFixed(6)}`;
              const k5 = `${h.lat.toFixed(5)},${h.lon.toFixed(5)}`;
              const v =
                etaByKey[h.key] ??
                etaByKey[k6] ??
                etaByKey[k5] ??
                etaByLL6[k6] ??
                etaByLL5[k5] ??
                null;
              if (validIso(v)) {
                tl[viewIdx].eta = v!;
                serverETA[viewIdx] = true;
              }
            }
          }
        }

        // 4) Local fallbacks (window start or block start)
        const durationMins = (h: Household) =>
          h.startIso && h.endIso
            ? Math.max(
                1,
                Math.round(
                  DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
                )
              )
            : 60;

        for (let i = 0; i < ordered.length; i++) {
          const { h, viewIdx } = ordered[i];

          // ETA fallback: prefer backend effectiveWindow when available
          if (!tl[viewIdx].eta && h.startIso) {
            if (h.isPersonalBlock) {
              tl[viewIdx].eta = h.startIso;
            } else {
              const winStartIso =
                h.primary?.effectiveWindow?.startIso ??
                adjustedWindowForStart(date, h.startIso, schedStartIso).winStartIso;
              tl[viewIdx].eta = winStartIso;
            }
          }

          // ETD fallback = ETA + duration
          if (!tl[viewIdx].etd && tl[viewIdx].eta) {
            tl[viewIdx].etd = DateTime.fromISO(tl[viewIdx].eta!)
              .plus({ minutes: durationMins(h) })
              .toISO();
          }
        }

        // 5) Monotonic pass — only shift rows whose ETA & ETD are BOTH fallbacks
        for (let i = 1; i < households.length; i++) {
          if (serverETA[i] || serverETD[i]) continue;
          const prev = tl[i - 1];
          const curr = tl[i];
          if (!prev?.etd || !curr?.eta) continue;
          const prevETD = DateTime.fromISO(prev.etd);
          const currETA = DateTime.fromISO(curr.eta);
          if (currETA < prevETD) {
            const mins = durationMins(households[i]);
            const shiftedETA = prev.etd!;
            const shiftedETD = DateTime.fromISO(shiftedETA).plus({ minutes: mins }).toISO();
            curr.eta = shiftedETA;
            curr.etd = shiftedETD;
          }
        }

        // 5b) Route order for timeline snaps (same as My Week): positionInDay when byIndex is complete, else chronological by ETA.
        const routeOrder: number[] = (() => {
          if (Array.isArray(result?.byIndex) && result.byIndex.length === households.length) {
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
              const hh = households[householdIndex];
              const pos = keyToPositionInDay[hh.key];
              if (pos != null) return pos;
              if (Number.isFinite(hh.lat) && Number.isFinite(hh.lon)) {
                const k5 = keyFor(hh.lat as number, hh.lon as number, 5);
                if (keyToPositionInDay[k5] != null) return keyToPositionInDay[k5];
              }
              return 999;
            };
            return Array.from({ length: households.length }, (_, i) => i).sort(
              (a, b) => getPositionInDay(a) - getPositionInDay(b)
            );
          }
          return Array.from({ length: households.length }, (_, i) => i).sort((a, b) => {
            const anchorA = tl[a]?.eta ?? tl[a]?.etd ?? households[a]?.startIso ?? '';
            const anchorB = tl[b]?.eta ?? tl[b]?.etd ?? households[b]?.startIso ?? '';
            return anchorA.localeCompare(anchorB);
          });
        })();

        // Personal blocks including flex: if ETA precedes previous stop's ETD in route order, snap after prev ETD (My Week parity).
        for (let p = 1; p < routeOrder.length; p++) {
          const currIdx = routeOrder[p];
          const prevIdx = routeOrder[p - 1];
          const h = households[currIdx];
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
              : durationMins(h)
          );
          const newEta = prevEtdDt;
          const newEtd = newEta.plus({ minutes: durMin });
          tl[currIdx].eta = newEta.toISO()!;
          tl[currIdx].etd = newEtd.toISO()!;
        }

        const labelMap: Record<string, string> = {};
        if (Array.isArray(result?.byIndex)) {
          for (const row of result.byIndex as { key?: string; blockLabel?: string }[]) {
            if (row?.key && row.blockLabel != null && String(row.blockLabel).trim() !== '') {
              for (const v of keyVariantsForKeyString(row.key)) {
                labelMap[v] = String(row.blockLabel).trim();
              }
            }
          }
        }
        setEtaBlockLabelByKey(labelMap);

        // 6) store drive/depot/buffer fields. First segment = drive from depot; use normalized result.driveSeconds[0] (same logic as My Week / routing.ts).
        const driveArr = Array.isArray(result?.driveSeconds) ? result.driveSeconds : null;
        setDriveSecondsArr(driveArr);
        const fromApiFirst =
          driveArr && driveArr.length > 0 && typeof driveArr[0] === 'number' ? driveArr[0] : null;
        const firstH = ordered[0]?.h;
        const firstRow = firstH
          ? (byIndexRowForHousehold(firstH, byIndex) as
              | { driveFromPrevMinutes?: number; driveFromPrevSec?: number }
              | undefined)
          : (byIndex[0] as { driveFromPrevMinutes?: number; driveFromPrevSec?: number } | undefined);
        const toFirstSec =
          fromApiFirst != null
            ? fromApiFirst
            : typeof firstRow?.driveFromPrevSec === 'number'
              ? firstRow.driveFromPrevSec
              : typeof firstRow?.driveFromPrevMinutes === 'number'
                ? firstRow.driveFromPrevMinutes * 60
                : null;
        setDepotToFirstSec(toFirstSec != null && toFirstSec > 0 ? toFirstSec : null);
        setBackToDepotSec(
          typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null
        );
        setBackToDepotIso(result?.backToDepotIso ?? null);
        setAppointmentBufferMinutes(
          typeof result?.appointmentBufferMinutes === 'number' ? result.appointmentBufferMinutes : 5
        );

        // Render in positionInDay order from ETA byIndex (routeOrder computed above for flex snap).
        if (Array.isArray(result?.byIndex) && result.byIndex.length === households.length) {
          setRoutingOrderIndices(routeOrder);
          setByIndexRows(
            routeOrder.map((houseIdx) => {
              const h = households[houseIdx];
              const r = byIndexRowForHousehold(h, byIndex) || {};
              const slot = tl[houseIdx];
              return {
                etaIso: slot?.eta ?? r.etaIso,
                etdIso: slot?.etd ?? r.etdIso,
                windowStartIso: r.windowStartIso ?? undefined,
                windowEndIso: r.windowEndIso ?? undefined,
                ...(typeof r.bufferAfterMinutes === 'number' && Number.isFinite(r.bufferAfterMinutes)
                  ? { bufferAfterMinutes: r.bufferAfterMinutes }
                  : {}),
              };
            })
          );
        } else {
          setRoutingOrderIndices(null);
          setByIndexRows([]);
        }

        setEtaRouteKeys(
          keysArr.length === households.length ? keysArr : null
        );

        if (on) setTimeline(tl);
      } catch (e: any) {
        if (on) {
          setEtaErr(e?.message ?? 'Failed to compute ETAs');
          setDriveSecondsArr(null);
          setDepotToFirstSec(null);
          setBackToDepotSec(null);
          setBackToDepotIso(null);
          setRoutingOrderIndices(null);
          setByIndexRows([]);
          setEtaRouteKeys(null);
          setEtaBlockLabelByKey({});
          setAppointmentBufferMinutes(5);
        }
      }
    })();

    return () => {
      on = false;
    };
  }, [households, startDepot, endDepot, date, selectedDoctorId, appts, schedStartIso, virtualAppt]);

  /* ---------- Display order: byIndex order when ETA returned it ---------- */
  const displayHouseholds = useMemo(
    () =>
      routingOrderIndices && routingOrderIndices.length === households.length
        ? routingOrderIndices.map((i) => households[i])
        : households,
    [households, routingOrderIndices]
  );
  // When using positionInDay order, timeline must align with byIndex (position 1 = byIndex[0], etc.)
  const displayTimeline = useMemo(() => {
    if (routingOrderIndices && routingOrderIndices.length === households.length && byIndexRows.length === households.length) {
      return byIndexRows.map((r) => ({
        eta: r.etaIso ?? null,
        etd: r.etdIso ?? null,
        windowStartIso: r.windowStartIso ?? null,
        windowEndIso: r.windowEndIso ?? null,
        ...(typeof r.bufferAfterMinutes === 'number' ? { bufferAfterMinutes: r.bufferAfterMinutes } : {}),
      }));
    }
    if (routingOrderIndices && routingOrderIndices.length === timeline.length) {
      return routingOrderIndices.map((i) => timeline[i]);
    }
    return timeline;
  }, [timeline, routingOrderIndices, households.length, byIndexRows]);

  /** driveSeconds aligned to display order when keys[] order ≠ positionInDay (same legs as API, summed per display hop). */
  const driveSecondsForLayout = useMemo(
    () =>
      alignDriveSecondsToDisplayOrder(
        driveSecondsArr,
        etaRouteKeys,
        households,
        routingOrderIndices
      ) ?? driveSecondsArr,
    [driveSecondsArr, etaRouteKeys, households, routingOrderIndices]
  );

  /* ------------ full-day grid (same span logic as My Week: ~6:30–7:30 PM) ------------ */
  const dayVisualGrid = useMemo(() => {
    const candidates: number[] = [];
    if (startDepotTimeStr) {
      candidates.push(timeStrToMinutesFromMidnight(startDepotTimeStr));
    }
    if (schedStartIso) {
      if (/^\d{1,2}:\d{2}/.test(schedStartIso.trim())) {
        candidates.push(timeStrToMinutesFromMidnight(schedStartIso));
      } else {
        const dt = DateTime.fromISO(schedStartIso);
        if (dt.isValid) candidates.push(dt.hour * 60 + dt.minute);
      }
    }
    for (const hh of displayHouseholds) {
      if (hh.startIso) {
        const dt = DateTime.fromISO(hh.startIso);
        if (dt.isValid) candidates.push(dt.hour * 60 + dt.minute);
      }
    }
    for (const t of displayTimeline) {
      const eta = t?.eta ?? t?.etd;
      if (eta) {
        const dt = DateTime.fromISO(eta);
        if (dt.isValid) candidates.push(dt.hour * 60 + dt.minute);
      }
    }
    const earliest = candidates.length ? Math.min(...candidates) : null;
    const gridStartMinutesFromMidnight =
      earliest === null
        ? DEFAULT_GRID_START_MINUTES
        : Math.max(0, earliest - BUFFER_MINUTES_BEFORE_START);
    const totalMinutes = Math.max(
      60,
      END_MINUTES_FROM_MIDNIGHT - gridStartMinutesFromMidnight
    );
    return { gridStartMinutesFromMidnight, totalMinutes };
  }, [displayHouseholds, displayTimeline, schedStartIso, startDepotTimeStr]);

  const hourTicksForLabels = useMemo(() => {
    const out: { top: number; label: string }[] = [];
    const startH = Math.floor(dayVisualGrid.gridStartMinutesFromMidnight / 60);
    for (let h = startH; h <= DAY_END_HOUR; h++) {
      const minAtHour = h * 60;
      const minutesFromGridStart = minAtHour - dayVisualGrid.gridStartMinutesFromMidnight;
      if (minutesFromGridStart >= 0 && minutesFromGridStart <= dayVisualGrid.totalMinutes) {
        out.push({
          top: minutesFromGridStart * PPM,
          label: DateTime.fromObject({ hour: h, minute: 0 }).toFormat('h a'),
        });
      }
    }
    return out;
  }, [dayVisualGrid.gridStartMinutesFromMidnight, dayVisualGrid.totalMinutes]);

  const timeTicks = useMemo(() => {
    const out: { top: number; isHour: boolean }[] = [];
    for (let min = 0; min <= dayVisualGrid.totalMinutes; min += 30) {
      out.push({
        top: min * PPM,
        isHour: (dayVisualGrid.gridStartMinutesFromMidnight + min) % 60 === 0,
      });
    }
    return out;
  }, [dayVisualGrid.totalMinutes, dayVisualGrid.gridStartMinutesFromMidnight]);

  /* ------------ derive ETD (from timeline) ------------ */
  const etdByIndex = useMemo(() => displayTimeline.map((t) => t?.etd ?? null), [displayTimeline]);

  /* ------------ compute drive-to-next minutes (server between if provided) ------------ */
  const driveBetweenMin = useMemo(() => {
    const N = displayHouseholds.length;
    if (N <= 1) return [] as number[];
    // Prefer server driveSeconds if shape matches between segments
    // driveSeconds[0] = depot→first; driveSeconds[1]..[N-1] = between stops (not a duplicate of [0] when first is a block).
    if (Array.isArray(driveSecondsForLayout)) {
      if (driveSecondsForLayout.length === N - 1) {
        return driveSecondsForLayout.map((s) => Math.max(0, Math.round((s || 0) / 60)));
      } else if (driveSecondsForLayout.length === N || driveSecondsForLayout.length === N + 1) {
        const between =
          driveSecondsForLayout.length === N + 1
            ? driveSecondsForLayout.slice(1, N)
            : driveSecondsForLayout.slice(1);
        return between.map((s) => Math.max(0, Math.round((s || 0) / 60)));
      }
    }
    // Fallback: ETA/ETD gaps between consecutive rows
    const out: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const prevETD = etdByIndex[i];
      const nextETA = displayTimeline[i + 1]?.eta ?? null;
      if (prevETD && nextETA) {
        const mins = Math.max(
          0,
          Math.round(DateTime.fromISO(nextETA).diff(DateTime.fromISO(prevETD)).as('minutes'))
        );
        out.push(mins);
      } else {
        // last fallback: scheduled gap
        const prevEnd = displayHouseholds[i].endIso;
        const nextStart = displayHouseholds[i + 1].startIso;
        const mins =
          prevEnd && nextStart
            ? Math.max(
                0,
                Math.round(
                  DateTime.fromISO(nextStart).diff(DateTime.fromISO(prevEnd)).as('minutes')
                )
              )
            : 0;
        out.push(mins);
      }
    }
    return out;
  }, [displayHouseholds, driveSecondsForLayout, displayTimeline, etdByIndex]);

  /** When outbound drive is painted above a flex/fixed block (same rule as My Week), do not add that leg to layout gap or between-row hatched bands. */
  const { driveBetweenMinForLayout, firstHopRelocatedDriveMin } = useMemo(() => {
    const N = displayHouseholds.length;
    const base = driveBetweenMin.slice();
    let firstHopRelocatedDriveMin = 0;
    if (N < 2 || !Array.isArray(driveSecondsForLayout)) {
      return { driveBetweenMinForLayout: base, firstHopRelocatedDriveMin: 0 };
    }
    const L = driveSecondsForLayout.length;
    const g0 = dayVisualGrid.gridStartMinutesFromMidnight;
    const gTot = dayVisualGrid.totalMinutes;
    const apptBufDefault = appointmentBufferMinutes ?? 5;
    const bufferMinAfter = (idx: number) => {
      const v = displayTimeline[idx]?.bufferAfterMinutes;
      if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
      return Math.max(0, apptBufDefault);
    };

    for (let hop = 0; hop < N - 1; hop++) {
      const prevH = displayHouseholds[hop];
      const nextH = displayHouseholds[hop + 1];
      if (!prevH?.isPersonalBlock || nextH?.isPersonalBlock) continue;
      if (L < hop + 2) continue;

      const dsLow = driveSecondsForLayout[hop] ?? 0;
      const dsHigh = driveSecondsForLayout[hop + 1] ?? 0;

      const prevHi = displayHouseholds[hop];
      const nextHi = displayHouseholds[hop + 1];
      const prevSlot = displayTimeline[hop];
      const nextSlot = displayTimeline[hop + 1];
      const prevEndIso = prevSlot?.etd ?? prevHi.endIso ?? null;
      const nextAnchorIso = nextSlot?.eta ?? nextHi.startIso ?? null;
      if (!prevEndIso || !nextAnchorIso) continue;

      const prevEndMin = minutesFromDayStart(g0, gTot, prevEndIso, date);
      const nextEtaMin = minutesFromDayStart(g0, gTot, nextAnchorIso, date);
      const gapAvailMin = Math.max(0, nextEtaMin - prevEndMin - bufferMinAfter(hop));

      let interSec = 0;
      if (dsHigh === 0 && dsLow > 0) interSec = dsLow;
      else if (dsLow > 0 && dsHigh > 0 && dsLow === dsHigh) interSec = dsLow;
      else if (dsLow > 0 && dsHigh > 0) interSec = dsHigh;
      else if (dsLow === 0 && dsHigh > 0) interSec = dsHigh;

      const interMin = interSec / 60;
      const fitsInGap = interSec > 0 && interMin <= gapAvailMin + 1e-6;

      // ds[hop]===0 and ds[hop+1]>0: leg is barrier → next visit only (e.g. flex with 0 prev drive).
      // When ETAs are flush (gapAvailMin 0), still keep routed minutes so layout opens space and
      // vConnectors can paint before the visit (My Week computeMyWeekDayColumnLayout parity).
      const routedLegOnVisitAfterBarrier = dsLow === 0 && dsHigh > 0;

      if (interSec > 0 && !fitsInGap) {
        if (!routedLegOnVisitAfterBarrier) {
          base[hop] = 0;
        }
        if (hop === 0 && dsLow > 0 && dsHigh > 0 && dsLow !== dsHigh) {
          firstHopRelocatedDriveMin += Math.max(0, Math.round(dsHigh / 60));
        }
      }
    }

    return { driveBetweenMinForLayout: base, firstHopRelocatedDriveMin };
  }, [
    displayHouseholds,
    displayTimeline,
    driveBetweenMin,
    driveSecondsForLayout,
    dayVisualGrid.gridStartMinutesFromMidnight,
    dayVisualGrid.totalMinutes,
    date,
    appointmentBufferMinutes,
  ]);

  // Resolved start/end for a household: personal blocks use effectiveWindow (scheduled time) when available.
  const householdStartEnd = (h: Household, idx: number) => {
    if (h.isPersonalBlock && h.primary?.effectiveWindow?.startIso && h.primary?.effectiveWindow?.endIso) {
      return { startIso: h.primary.effectiveWindow!.startIso, endIso: h.primary.effectiveWindow!.endIso };
    }
    return { startIso: h.startIso!, endIso: h.endIso! };
  };

  // Same address: same lat/lon (or keys like "lat,lon" and "lat,lon:2" for two clients at one location).
  const sameAddress = (a: Household, b: Household): boolean => {
    if (Number.isFinite(a.lat) && Number.isFinite(b.lat) && Number.isFinite(a.lon) && Number.isFinite(b.lon)) {
      if (Math.abs((a.lat as number) - (b.lat as number)) < 1e-6 && Math.abs((a.lon as number) - (b.lon as number)) < 1e-6) return true;
    }
    const base = (k: string) => (k.includes(':') ? k.slice(0, k.indexOf(':')) : k);
    return base(a.key) === base(b.key);
  };

  // Geometry of each appointment block (top + height). Use ETA/ETD when available. Consecutive same-address stops are placed back-to-back (prev ETD + buffer only).
  // Offsets computed sequentially (prev block's shifted end + drive) so end-of-day blocks (e.g. 3–4 PM) don't get over-shifted (same fix as My Week).
  const blockGeom = useMemo(() => {
    const bufferMin = appointmentBufferMinutes ?? 5;
    const N = displayHouseholds.length;
    const baseTops: number[] = [];
    const heights: number[] = [];
    const driveOffsetsPx: number[] = [];
    for (let idx = 0; idx < N; idx++) {
      const h = displayHouseholds[idx];
      const slot = displayTimeline[idx];
      const etaIso = slot?.eta ?? null;
      const etdIso = slot?.etd ?? null;
      const { startIso: sIso, endIso: eIso } = householdStartEnd(h, idx);
      let anchorIso = etaIso ?? sIso ?? h.startIso!;
      const endIso = etdIso ?? eIso ?? h.endIso!;
      if (idx >= 1) {
        const prev = displayHouseholds[idx - 1];
        const prevSlot = displayTimeline[idx - 1];
        if (sameAddress(prev, h)) {
          const prevEtd = prevSlot?.etd ?? prev.endIso ?? null;
          if (prevEtd) {
            const minStart = DateTime.fromISO(prevEtd).plus({ minutes: bufferMin });
            const anchorDt = DateTime.fromISO(anchorIso);
            if (minStart.isValid && anchorDt.isValid && anchorDt < minStart) {
              anchorIso = minStart.toISO()!;
            }
          }
        }
      }
      const s = anchorIso ? DateTime.fromISO(anchorIso) : null;
      const e = endIso ? DateTime.fromISO(endIso) : null;
      if (!s || !e || !s.isValid || !e.isValid) {
        baseTops.push(0);
        heights.push(22);
        driveOffsetsPx.push(0);
        continue;
      }
      const baseTop =
        minutesFromDayStart(
          dayVisualGrid.gridStartMinutesFromMidnight,
          dayVisualGrid.totalMinutes,
          anchorIso,
          date
        ) * PPM;
      const durMin = Math.max(1, Math.round(e.diff(s).as('minutes')));
      const height = Math.max(22, durMin * PPM);
      baseTops.push(baseTop);
      heights.push(height);
      if (idx === 0) {
        driveOffsetsPx.push(0);
      } else {
        const prevEndShiftedPx = baseTops[idx - 1] + driveOffsetsPx[idx - 1] + heights[idx - 1];
        const minsJ = driveBetweenMinForLayout[idx - 1] ?? 0;
        let off = Math.max(0, prevEndShiftedPx + minsJ * PPM - baseTop);
        const labelMeta = blockLabelMetaForDisplay(h, etaBlockLabelByKey);
        const flexRow =
          h.isPersonalBlock === true &&
          (isFlexBlockItem(labelMeta) ||
            isFlexBlockItem(h.primary) ||
            isFlexBlockItem({ blockLabel: h.client, title: h.client }));
        if (flexRow) off = 0;
        driveOffsetsPx.push(off);
      }
    }
    return displayHouseholds.map((_, idx) => {
      const top = baseTops[idx] + driveOffsetsPx[idx];
      const height = heights[idx];
      return { top, height };
    });
  }, [
    displayHouseholds,
    displayTimeline,
    dayVisualGrid.gridStartMinutesFromMidnight,
    dayVisualGrid.totalMinutes,
    date,
    appointmentBufferMinutes,
    driveBetweenMinForLayout,
    etaBlockLabelByKey,
  ]);

  // Between stops: buffer (see-through) then drive (hatched), same split as My Week.
  const vConnectors = useMemo(() => {
    const out: Array<{
      top: number;
      height: number;
      mins: number;
      kind: 'buffer' | 'drive';
      title: string;
      segKey: string;
    }> = [];
    const apptBufDefault = appointmentBufferMinutes ?? 5;
    const bufferMinAfterStop = (i: number) => {
      const v = displayTimeline[i]?.bufferAfterMinutes;
      if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
      return Math.max(0, apptBufDefault);
    };
    for (let i = 0; i < displayHouseholds.length - 1; i++) {
      const a = blockGeom[i];
      const b = blockGeom[i + 1];
      if (!a || !b) continue;
      const gapPx = b.top - (a.top + a.height);
      if (gapPx <= 1) continue;
      const bufMin = bufferMinAfterStop(i);
      const bufPx = Math.min(gapPx, bufMin * PPM);
      const remainingPx = gapPx - bufPx;
      let driveMinApi = driveBetweenMinForLayout[i] ?? 0;
      if (
        driveMinApi <= 0 &&
        i === 0 &&
        displayHouseholds[0]?.isPersonalBlock &&
        !displayHouseholds[1]?.isPersonalBlock &&
        Array.isArray(driveSecondsForLayout) &&
        driveSecondsForLayout.length >= 2
      ) {
        const d0 = driveSecondsForLayout[0] ?? 0;
        const d1 = driveSecondsForLayout[1] ?? 0;
        if (d0 > 0 && (d1 === 0 || d0 === d1)) {
          driveMinApi = Math.max(0, Math.round(remainingPx / PPM));
        }
      }
      const gapAvailMin = Math.max(0, remainingPx / PPM);
      const routeMinRounded =
        driveMinApi > 0 ? Math.max(1, Math.round(driveMinApi)) : 0;
      const prevBarrier = displayHouseholds[i]?.isPersonalBlock === true;
      const nextBarrier = displayHouseholds[i + 1]?.isPersonalBlock === true;
      const dsHop =
        Array.isArray(driveSecondsForLayout) && driveSecondsForLayout.length > i + 1
          ? driveSecondsForLayout[i + 1]
          : undefined;
      const routeMinForTitle =
        typeof dsHop === 'number' && Number.isFinite(dsHop) && dsHop > 0
          ? Math.max(1, Math.round(dsHop / 60))
          : routeMinRounded;
      const skipBarrierBarrierDrive = prevBarrier && nextBarrier && dsHop === 0;
      const paintDriveMin = skipBarrierBarrierDrive
        ? 0
        : routeMinForTitle > 0
          ? Math.min(gapAvailMin, routeMinForTitle)
          : gapAvailMin;
      const drivePx = paintDriveMin * PPM;
      const bottomAPx = a.top + a.height;
      let yBuf = bottomAPx;
      if (bufPx > 1) {
        const bm = Math.max(1, Math.round(bufPx / PPM));
        out.push({
          top: yBuf,
          height: Math.max(4, bufPx),
          mins: bm,
          kind: 'buffer',
          title: `Buffer after visit: ${bm} min`,
          segKey: `vdd-between-${i}-buf`,
        });
        yBuf += bufPx;
      }
      if (drivePx > 1) {
        const winStartPx = bottomAPx + bufPx;
        const nextTopPx = b.top;
        const placeHugNext = () => nextTopPx - drivePx >= winStartPx - 1e-6;
        const placeHugPrev = () => winStartPx + drivePx <= nextTopPx + 1e-6;
        let driveTopPx: number;
        if (prevBarrier && !nextBarrier) {
          if (placeHugNext()) driveTopPx = nextTopPx - drivePx;
          else if (placeHugPrev()) driveTopPx = winStartPx;
          else driveTopPx = nextTopPx - drivePx;
        } else if (!prevBarrier && nextBarrier) {
          if (placeHugPrev()) driveTopPx = winStartPx;
          else if (placeHugNext()) driveTopPx = nextTopPx - drivePx;
          else driveTopPx = winStartPx;
        } else if (prevBarrier && nextBarrier) {
          if (placeHugNext()) driveTopPx = nextTopPx - drivePx;
          else if (placeHugPrev()) driveTopPx = winStartPx;
          else driveTopPx = nextTopPx - drivePx;
        } else {
          if (placeHugPrev()) driveTopPx = winStartPx;
          else if (placeHugNext()) driveTopPx = nextTopPx - drivePx;
          else driveTopPx = winStartPx;
        }
        const schedMin = Math.max(1, Math.round(drivePx / PPM));
        const gapRound = Math.max(1, Math.round(gapAvailMin));
        const d0 =
          Array.isArray(driveSecondsForLayout) && driveSecondsForLayout.length > 0
            ? driveSecondsForLayout[0] ?? 0
            : 0;
        const visitLegOnNext =
          i === 0 &&
          prevBarrier &&
          !nextBarrier &&
          d0 === 0 &&
          typeof dsHop === 'number' &&
          dsHop > 0;
        const nextName = (displayHouseholds[i + 1]?.client || '').trim() || 'visit';
        const title = visitLegOnNext
          ? routeMinForTitle > 0 && gapRound > routeMinForTitle + 1e-6
            ? `Drive before ${nextName}: ${routeMinForTitle} min route (${gapRound} min gap)`
            : routeMinForTitle > 0
              ? `Drive before ${nextName}: ${routeMinForTitle} min`
              : `Drive before ${nextName}: ${schedMin} min`
          : routeMinForTitle > 0 && gapRound > routeMinForTitle + 1e-6
            ? `Drive to next stop: ${routeMinForTitle} min · ${gapRound} min until next stop`
            : routeMinForTitle > 0
              ? `Drive to next stop: ${routeMinForTitle} min`
              : `Drive to next stop: ${schedMin} min`;
        out.push({
          top: driveTopPx,
          height: Math.max(4, drivePx),
          mins: routeMinForTitle > 0 ? routeMinForTitle : schedMin,
          kind: 'drive',
          title,
          segKey: `vdd-between-${i}-drv`,
        });
      }
    }
    return out;
  }, [
    blockGeom,
    displayHouseholds,
    displayTimeline,
    appointmentBufferMinutes,
    driveBetweenMinForLayout,
    driveSecondsForLayout,
  ]);

  /* ------------ depot chips ------------ */
  // First segment: depot → first stop (driveSeconds[0] / byIndex[0].driveFromPrev), including when first stop is a personal block.
  const fromDepotMin = useMemo(() => {
    if (displayHouseholds.length === 0) return null;
    let m: number | null = null;
    if (depotToFirstSec != null && depotToFirstSec > 0) {
      m = Math.max(0, Math.round(depotToFirstSec / 60));
    } else if (
      Array.isArray(driveSecondsForLayout) &&
      driveSecondsForLayout.length >= displayHouseholds.length
    ) {
      m = Math.max(0, Math.round((driveSecondsForLayout[0] || 0) / 60));
    }
    if (m != null && firstHopRelocatedDriveMin > 0) {
      m += firstHopRelocatedDriveMin;
    }
    return m;
  }, [depotToFirstSec, driveSecondsForLayout, displayHouseholds, firstHopRelocatedDriveMin]);

  const backDepotMin = useMemo(() => {
    if (typeof backToDepotSec === 'number') return Math.max(0, Math.round(backToDepotSec / 60));
    if (Array.isArray(driveSecondsForLayout) && displayHouseholds.length > 0) {
      if (driveSecondsForLayout.length === displayHouseholds.length + 1) {
        const last = driveSecondsForLayout[driveSecondsForLayout.length - 1] || 0;
        return Math.max(0, Math.round(last / 60));
      }
    }
    return null;
  }, [driveSecondsForLayout, backToDepotSec, displayHouseholds]);

  // Depot → first stop: align to first blockGeom top (same layout space as My Week); optional clamp to leave-depot time.
  const fromDepotSegment = useMemo(() => {
    if (displayHouseholds.length === 0) return null;
    const g0 = dayVisualGrid.gridStartMinutesFromMidnight;
    const gTot = dayVisualGrid.totalMinutes;
    const depotFloorMin = depotMinutesFromGridStart(startDepotTimeStr, g0, gTot);
    const clampTopMin = (rawTopMin: number) =>
      depotFloorMin != null ? Math.max(rawTopMin, depotFloorMin) : rawTopMin;

    const firstBlock = blockGeom[0];
    if (!firstBlock) return null;
    const firstTopPx = firstBlock.top;

    const mins = fromDepotMin;
    if (mins != null && mins > 0) {
      const idealStartMin = firstTopPx / PPM - mins;
      const clampedStartMin = clampTopMin(Math.max(0, idealStartMin));
      const top = clampedStartMin * PPM;
      const actualHeight = firstTopPx - top;
      if (actualHeight <= 0) return null;
      const paintedMins = Math.max(1, Math.round(actualHeight / PPM));
      return { top, height: actualHeight, mins: paintedMins };
    }
    if (startDepotTimeStr?.trim() && depotFloorMin != null) {
      const startPx = depotFloorMin * PPM;
      const segH = Math.max(4, firstTopPx - startPx);
      if (segH > 2) {
        return { top: startPx, height: segH, mins: Math.max(1, Math.round(segH / PPM)) };
      }
    }
    return null;
  }, [
    displayHouseholds.length,
    blockGeom,
    fromDepotMin,
    dayVisualGrid.gridStartMinutesFromMidnight,
    dayVisualGrid.totalMinutes,
    startDepotTimeStr,
  ]);

  // Last stop → depot: buffer band then drive (matches My Week + routing API totals).
  const { backToDepotSegments, backToDepotArrivalDisplayIso } = useMemo(() => {
    type BackSeg = {
      top: number;
      height: number;
      mins: number;
      kind: 'buffer' | 'drive';
      title: string;
      segKey: string;
      zIndex?: number;
    };
    const empty: { backToDepotSegments: BackSeg[] | null; backToDepotArrivalDisplayIso: string | null } = {
      backToDepotSegments: null,
      backToDepotArrivalDisplayIso: null,
    };
    if (displayHouseholds.length === 0) return empty;
    const mins = backDepotMin;
    let lastAddressIdx = -1;
    for (let i = displayHouseholds.length - 1; i >= 0; i--) {
      if (!displayHouseholds[i]?.isPersonalBlock) {
        lastAddressIdx = i;
        break;
      }
    }
    if (lastAddressIdx < 0) return empty;
    const lastAddrH = displayHouseholds[lastAddressIdx];
    if ((lastAddrH as { isNoLocation?: boolean }).isNoLocation === true) return empty;
    const lastBlock = blockGeom[lastAddressIdx];
    if (!lastBlock) return empty;
    const startY = lastBlock.top + lastBlock.height;
    const g0 = dayVisualGrid.gridStartMinutesFromMidnight;
    const gTot = dayVisualGrid.totalMinutes;
    const apptBufDefault = appointmentBufferMinutes ?? 5;
    const rawLast = displayTimeline[lastAddressIdx]?.bufferAfterMinutes;
    const bufMinLast =
      typeof rawLast === 'number' && Number.isFinite(rawLast)
        ? Math.max(0, rawLast)
        : Math.max(0, apptBufDefault);
    const lastBottomMin = startY / PPM;
    const winStartMin = lastBottomMin + bufMinLast;

    const validationReturnIso =
      virtualAppt &&
      virtualAppt.date === date &&
      typeof virtualAppt.validationReturnSec === 'number' &&
      Number.isFinite(virtualAppt.validationReturnSec)
        ? isoFromSecSinceLocalMidnight(date, virtualAppt.validationReturnSec)
        : null;
    const returnClockIso =
      backToDepotIso && DateTime.fromISO(backToDepotIso).isValid
        ? backToDepotIso
        : validationReturnIso && DateTime.fromISO(validationReturnIso).isValid
          ? validationReturnIso
          : null;

    let dMin: number;
    if (mins != null && mins > 0) {
      dMin = mins;
    } else if (returnClockIso) {
      const endMin = minutesFromDayStart(g0, gTot, returnClockIso, date);
      dMin = Math.max(1, Math.round(Math.max(0, endMin - winStartMin)));
    } else {
      return empty;
    }

    const N = displayHouseholds.length;
    const kTrail = lastAddressIdx + 1;
    const trailH = kTrail < N ? displayHouseholds[kTrail] : null;
    const hasTrailBarrier = trailH?.isPersonalBlock === true;
    const trailLabelMeta =
      trailH && hasTrailBarrier ? blockLabelMetaForDisplay(trailH, etaBlockLabelByKey) : null;
    const firstTrailFlex =
      hasTrailBarrier &&
      (isFlexBlockItem(trailLabelMeta) ||
        isFlexBlockItem(trailH?.primary) ||
        isFlexBlockItem({ blockLabel: trailH?.client, title: trailH?.client }));
    const flexGeom = firstTrailFlex ? blockGeom[kTrail] : null;

    // API often sets backToDepotIso / return to the flex arrival instant; that leg is already painted as visit→flex in vConnectors.
    if (flexGeom && returnClockIso) {
      const flexEta = displayTimeline[kTrail]?.eta;
      if (flexEta && DateTime.fromISO(flexEta).isValid && DateTime.fromISO(returnClockIso).isValid) {
        const dSec = Math.abs(
          DateTime.fromISO(returnClockIso).diff(DateTime.fromISO(flexEta), 'seconds').seconds
        );
        if (dSec <= 180) return empty;
      }
    }

    // Same seconds on last address → flex hop and backToDepotSec (e.g. 2489 twice in driveSeconds); only paint once in vConnectors.
    const hopToTrailSec =
      Array.isArray(driveSecondsForLayout) &&
      driveSecondsForLayout.length > lastAddressIdx + 1 &&
      typeof driveSecondsForLayout[lastAddressIdx + 1] === 'number'
        ? driveSecondsForLayout[lastAddressIdx + 1]
        : null;
    if (
      flexGeom &&
      typeof backToDepotSec === 'number' &&
      Number.isFinite(backToDepotSec) &&
      hopToTrailSec != null &&
      Math.abs(hopToTrailSec - backToDepotSec) <= 2
    ) {
      return empty;
    }

    let driveStartMin: number;
    let driveEndMin: number;
    let returnDriveAfterFlex = false;
    /** Rounding (grid minutes vs ISO seconds) can make dMin slightly exceed the clock gap and wrongly paint "return" after flex. */
    const PRE_FLEX_GAP_SLACK_MIN = 3;
    if (flexGeom) {
      const flexTopMin = flexGeom.top / PPM;
      const flexBottomMin = (flexGeom.top + flexGeom.height) / PPM;
      const preFlexGapMin = Math.max(0, flexTopMin - winStartMin);
      if (dMin <= preFlexGapMin + PRE_FLEX_GAP_SLACK_MIN) {
        driveStartMin = winStartMin;
        driveEndMin = winStartMin + dMin;
      } else {
        returnDriveAfterFlex = true;
        driveStartMin = flexBottomMin;
        let ceilingMin = gTot;
        if (kTrail + 1 < N && blockGeom[kTrail + 1]) {
          ceilingMin = blockGeom[kTrail + 1].top / PPM;
        }
        const availAfter = Math.max(0, ceilingMin - driveStartMin);
        const paintedMin = Math.min(dMin, availAfter);
        driveEndMin = driveStartMin + paintedMin;
        if (paintedMin < 1e-6 && returnClockIso) {
          const endMin = minutesFromDayStart(g0, gTot, returnClockIso, date);
          const dMinCap = Math.min(dMin, Math.max(0, endMin - winStartMin));
          driveStartMin = Math.max(winStartMin, endMin - dMinCap);
          driveEndMin = endMin;
        }
      }
    } else if (returnClockIso) {
      const endMin = minutesFromDayStart(g0, gTot, returnClockIso, date);
      driveStartMin = winStartMin;
      driveEndMin = endMin;
    } else {
      driveStartMin = winStartMin;
      driveEndMin = winStartMin + dMin;
    }

    // If return band still sits under a trailing personal row (flex label missed, etc.), move to the gap after it.
    if (!flexGeom && hasTrailBarrier && blockGeom[kTrail] && returnClockIso) {
      const tTop = blockGeom[kTrail].top / PPM;
      const tBot = (blockGeom[kTrail].top + blockGeom[kTrail].height) / PPM;
      if (driveEndMin > tTop + 1e-6 && driveStartMin < tBot - 1e-6) {
        driveStartMin = tBot;
        const endMin = minutesFromDayStart(g0, gTot, returnClockIso, date);
        let ceilingMin = gTot;
        if (kTrail + 1 < N && blockGeom[kTrail + 1]) {
          ceilingMin = blockGeom[kTrail + 1].top / PPM;
        }
        const availAfter = Math.max(0, ceilingMin - driveStartMin);
        driveEndMin = driveStartMin + Math.min(dMin, availAfter);
      }
    }

    let driveTopPx = driveStartMin * PPM;
    let drivePx = Math.max(0, driveEndMin - driveStartMin) * PPM;
    let arrivalFromNextBlockEta: string | null = null;
    let returnDriveOverlapsNext = false;
    if (returnDriveAfterFlex && flexGeom && kTrail + 1 < N && blockGeom[kTrail + 1]) {
      const flexBotPx = flexGeom.top + flexGeom.height;
      const nextTopPx = blockGeom[kTrail + 1].top;
      driveTopPx = flexBotPx;
      const gridEndPx = gTot * PPM;
      let driveEndPx = nextTopPx;
      if (validationReturnIso && DateTime.fromISO(validationReturnIso).isValid) {
        driveEndPx = Math.max(driveEndPx, minutesFromDayStart(g0, gTot, validationReturnIso, date) * PPM);
      }
      if (backToDepotIso && DateTime.fromISO(backToDepotIso).isValid) {
        driveEndPx = Math.max(
          driveEndPx,
          minutesFromDayStart(g0, gTot, backToDepotIso, date) * PPM
        );
      }
      driveEndPx = Math.min(gridEndPx, driveEndPx);
      drivePx = Math.max(0, driveEndPx - flexBotPx);
      returnDriveOverlapsNext = driveEndPx > nextTopPx + 0.5;
      const ne = displayTimeline[kTrail + 1]?.eta;
      arrivalFromNextBlockEta =
        (validationReturnIso && DateTime.fromISO(validationReturnIso).isValid
          ? validationReturnIso
          : null) ??
        (backToDepotIso && DateTime.fromISO(backToDepotIso).isValid ? backToDepotIso : null) ??
        (ne && DateTime.fromISO(ne).isValid ? ne : null);
    }

    if (drivePx <= 1) return empty;

    const bufPx = Math.max(0, bufMinLast * PPM);

    const segs: Array<{
      top: number;
      height: number;
      mins: number;
      kind: 'buffer' | 'drive';
      title: string;
      segKey: string;
      zIndex?: number;
    }> = [];
    if (bufPx > 1) {
      const bm = Math.max(1, Math.round(bufPx / PPM));
      segs.push({
        top: startY,
        height: Math.max(4, bufPx),
        mins: bm,
        kind: 'buffer',
        title: `Buffer after visit: ${bm} min`,
        segKey: 'vdd-back-buf',
      });
    }
    let arrivalDisplayIso: string | null = null;
    if (drivePx > 1) {
      const schedDm = Math.max(1, Math.round(drivePx / PPM));
      const routeDm = Math.max(1, Math.round(dMin));
      arrivalDisplayIso =
        arrivalFromNextBlockEta ??
        isoFromMinutesFromGridStart(g0, gTot, (driveTopPx + drivePx) / PPM, date);
      const arrivalLabel = DateTime.fromISO(arrivalDisplayIso).toLocaleString(DateTime.TIME_SIMPLE);
      const driveTitle =
        routeDm !== schedDm
          ? `Drive back to depot: ${schedDm} min scheduled · ${routeDm} min route — Arrival ${arrivalLabel}`
          : `Drive back to depot: ${schedDm} min — Arrival ${arrivalLabel}`;
      segs.push({
        top: driveTopPx,
        height: Math.max(4, drivePx),
        mins: schedDm,
        kind: 'drive',
        title: driveTitle,
        segKey: 'vdd-back-drv',
        ...(returnDriveOverlapsNext ? { zIndex: 3 } : {}),
      });
    }
    return {
      backToDepotSegments: segs.length ? segs : null,
      backToDepotArrivalDisplayIso: arrivalDisplayIso,
    };
  }, [
    displayHouseholds,
    blockGeom,
    backDepotMin,
    backToDepotIso,
    displayTimeline,
    appointmentBufferMinutes,
    dayVisualGrid.gridStartMinutesFromMidnight,
    dayVisualGrid.totalMinutes,
    date,
    etaBlockLabelByKey,
    virtualAppt,
    driveSecondsForLayout,
    backToDepotSec,
  ]);

  /** Lowest Y on the day column (blocks + drive); "Back to depot" in hovers only for that last strip/card. */
  const maxDayVisualBottomPx = useMemo(() => {
    let m = 0;
    for (const g of blockGeom) m = Math.max(m, g.top + g.height);
    for (const c of vConnectors) m = Math.max(m, c.top + c.height);
    if (backToDepotSegments) for (const c of backToDepotSegments) m = Math.max(m, c.top + c.height);
    if (fromDepotSegment) m = Math.max(m, fromDepotSegment.top + fromDepotSegment.height);
    return m;
  }, [blockGeom, vConnectors, backToDepotSegments, fromDepotSegment]);

  /* ---------- Maps links ---------- */
  const stops: Stop[] = useMemo(
    () =>
      displayHouseholds
        .filter((h) => !h.isNoLocation)
        .map((h) => ({
          lat: h.lat,
          lon: h.lon,
          label: h.client,
          address: h.address,
        })),
    [displayHouseholds]
  );
  const links = useMemo(
    () =>
      buildGoogleMapsLinksForDay(stops, {
        start:
          startDepot && startDepotAddr
            ? { lat: startDepot.lat, lon: startDepot.lon, address: startDepotAddr }
            : startDepot ?? undefined,
        end:
          endDepot && endDepotAddr
            ? { lat: endDepot.lat, lon: endDepot.lon, address: endDepotAddr }
            : endDepot ?? undefined,
      }),
    [stops, startDepot, endDepot, startDepotAddr, endDepotAddr]
  );

  /* ---------- Stats (uses server times if present) ---------- */
  const stats = useMemo(() => {
    if (!displayHouseholds.length) {
      return {
        driveMin: 0,
        householdMin: 0,
        ratioText: '—',
        whiteMin: 0,
        whitePctText: '—',
        shiftMin: 0,
        points: 0,
        backToDepotIso: null as string | null,
      };
    }

    // ----- helpers -----
    const durSec = (startIso?: string | null, endIso?: string | null) =>
      startIso && endIso
        ? Math.max(0, DateTime.fromISO(endIso).diff(DateTime.fromISO(startIso), 'seconds').seconds)
        : 0;

    const hmsToSec = (hms?: string) => {
      if (!hms) return undefined;
      const [hh = 0, mm = 0, ss = 0] = hms.split(':').map(Number);
      if ([hh, mm, ss].some((n) => Number.isNaN(n))) return undefined;
      return hh * 3600 + mm * 60 + ss;
    };

    const isPreviewDay = Boolean(virtualAppt && virtualAppt.date === date);
    const previewServiceSec =
      isPreviewDay && Number.isFinite(virtualAppt?.serviceMinutes)
        ? Math.max(0, Math.floor((virtualAppt!.serviceMinutes as number) * 60))
        : 0;
    const previewReturnIso =
      isPreviewDay &&
      typeof virtualAppt?.validationReturnSec === 'number' &&
      Number.isFinite(virtualAppt.validationReturnSec)
        ? isoFromSecSinceLocalMidnight(date, virtualAppt.validationReturnSec)
        : null;

    // Fallback booked-service (excludes preview & blocks)
    const bookedServiceSecFallback = displayHouseholds.reduce((sum, h) => {
      if ((h as any)?.isPersonalBlock === true) return sum;
      if ((h as any)?.isPreview === true) return sum;
      return sum + durSec(h.startIso, h.endIso);
    }, 0);

    // Points per patient (exclude personal blocks and "Note To Staff"): 1 standard, 0.5 tech, 2 euthanasia
    const points = displayHouseholds.reduce((total, h) => {
      if ((h as any)?.isPersonalBlock) return total;
      const type = (h.primary?.appointmentType || '').toLowerCase();
      if (type.includes('note to staff')) return total;
      const n = Math.max(1, h.patients?.length ?? 1);
      if (type === 'euthanasia') return total + 2 * n;
      if (type.includes('tech appointment')) return total + 0.5 * n;
      return total + 1 * n;
    }, 0);

    // ---------- Prefer authoritative fields from Routing winner ----------
    const winnerDriveSec = Number.isFinite(virtualAppt?.projectedDriveSeconds as number)
      ? Math.floor(virtualAppt!.projectedDriveSeconds as number)
      : undefined;

    const winWs = hmsToSec(virtualAppt?.workStartLocal);
    const winEe = hmsToSec(virtualAppt?.effectiveEndLocal);
    const winnerWindowSec =
      winWs != null && winEe != null && winEe >= winWs ? winEe - winWs : undefined;

    const winnerBookedSec = Number.isFinite(virtualAppt?.bookedServiceSeconds as number)
      ? Math.floor(virtualAppt!.bookedServiceSeconds as number)
      : undefined;

    const winnerWhitespaceAfterBookingSec = Number.isFinite(
      virtualAppt?.whitespaceAfterBookingSeconds as number
    )
      ? Math.max(0, Math.floor(virtualAppt!.whitespaceAfterBookingSeconds as number))
      : undefined;

    // ---------- If we have the full winner quartet, use it exactly ----------
    if (winnerDriveSec != null && winnerWindowSec != null && winnerBookedSec != null) {
      const whiteSec =
        winnerWhitespaceAfterBookingSec != null
          ? winnerWhitespaceAfterBookingSec
          : Math.max(0, winnerWindowSec - winnerDriveSec - winnerBookedSec - previewServiceSec);

      const driveMin = Math.round(winnerDriveSec / 60);
      const householdMin = Math.round(winnerBookedSec / 60);
      const whiteMin = Math.round(whiteSec / 60);
      const shiftMin = Math.round(winnerWindowSec / 60);

      const ratioText = driveMin > 0 ? (householdMin / driveMin).toFixed(2) : '—';
      const whitePctText =
        shiftMin > 0 ? `${Math.round((whiteSec / (shiftMin * 60)) * 100)}%` : '—';

      const backToDepotIsoFinal =
        backToDepotArrivalDisplayIso ??
        (previewReturnIso && DateTime.fromISO(previewReturnIso).isValid ? previewReturnIso : null) ??
        backToDepotIso ??
        null;

      return {
        driveMin,
        householdMin,
        ratioText,
        whiteMin,
        whitePctText,
        shiftMin,
        points,
        backToDepotIso: backToDepotIsoFinal,
      };
    }

    // ---------- Fallback to derivation ----------
    const first = displayHouseholds[0];
    const last = displayHouseholds[displayHouseholds.length - 1];

    const firstArriveMs =
      (displayTimeline[0]?.eta ? DateTime.fromISO(displayTimeline[0].eta!).toMillis() : null) ??
      (first?.startIso ? DateTime.fromISO(first.startIso).toMillis() : 0);

    const lastDur = durSec(last?.startIso ?? null, last?.endIso ?? null);
    const lastEndMs =
      displayTimeline[displayTimeline.length - 1]?.etd != null
        ? DateTime.fromISO(displayTimeline[displayTimeline.length - 1].etd!).toMillis()
        : displayTimeline[displayTimeline.length - 1]?.eta != null
          ? DateTime.fromISO(displayTimeline[displayTimeline.length - 1].eta!).toMillis() + lastDur * 1000
          : last?.endIso
            ? DateTime.fromISO(last.endIso).toMillis()
            : 0;

    const N = displayHouseholds.length;
    let apiToFirstSec: number | null = null;
    let apiBetweenSecs: number[] = [];
    let apiBackSec: number | null = null;

    if (Array.isArray(driveSecondsForLayout)) {
      if (driveSecondsForLayout.length === N - 1) {
        apiBetweenSecs = driveSecondsForLayout;
      } else if (driveSecondsForLayout.length === N + 1) {
        apiToFirstSec = driveSecondsForLayout[0] ?? null;
        apiBetweenSecs = driveSecondsForLayout.slice(1, N) ?? [];
        apiBackSec = driveSecondsForLayout[N] ?? null;
      } else if (driveSecondsForLayout.length === N) {
        if (startDepot) {
          apiToFirstSec = driveSecondsForLayout[0] ?? null;
          apiBetweenSecs = driveSecondsForLayout.slice(1) ?? [];
        } else if (endDepot) {
          apiBetweenSecs = driveSecondsForLayout.slice(0, N - 1) ?? [];
          apiBackSec = driveSecondsForLayout[N - 1] ?? null;
        } else {
          apiBetweenSecs = driveSecondsForLayout;
        }
      }
    }

    const haversineMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const sLat = toRad(a.lat);
      const sLat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(sLat) * Math.cos(sLat2) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const fallbackDriveSec = (
      from: { lat: number; lon: number },
      to: { lat: number; lon: number }
    ) => Math.round(haversineMeters(from, to) / 11.65);

    const startPt = startDepot ?? endDepot ?? null;
    const endPt = endDepot ?? startDepot ?? null;

    const driveToFirstSec =
      (typeof apiToFirstSec === 'number' ? apiToFirstSec : undefined) ??
      (startPt && first ? fallbackDriveSec(startPt, { lat: first.lat, lon: first.lon }) : 0);

    const interDriveSec =
      apiBetweenSecs.length === Math.max(0, N - 1)
        ? apiBetweenSecs.reduce((s, v) => s + Math.max(0, v || 0), 0)
        : displayHouseholds.slice(1).reduce((s, curr, i) => {
            const prev = displayHouseholds[i];
            return (
              s +
              fallbackDriveSec({ lat: prev.lat, lon: prev.lon }, { lat: curr.lat, lon: curr.lon })
            );
          }, 0);

    const driveBackSecFinal =
      (typeof backToDepotSec === 'number' ? backToDepotSec : undefined) ??
      (typeof apiBackSec === 'number' ? apiBackSec : undefined) ??
      (endPt && last ? fallbackDriveSec({ lat: last.lat, lon: last.lon }, endPt) : 0);

    const driveSec =
      Math.max(0, driveToFirstSec) + Math.max(0, interDriveSec) + Math.max(0, driveBackSecFinal);

    const shiftStartMs = Math.max(0, firstArriveMs - Math.max(0, driveToFirstSec) * 1000);
    const shiftEndMs = Math.max(shiftStartMs, lastEndMs + Math.max(0, driveBackSecFinal) * 1000);

    const backToDepotIsoFinal =
      backToDepotArrivalDisplayIso ??
      (previewReturnIso && DateTime.fromISO(previewReturnIso).isValid ? previewReturnIso : null) ??
      backToDepotIso ??
      (shiftEndMs > 0 ? DateTime.fromMillis(shiftEndMs).toISO() : null);

    const scheduleSec =
      schedStartIso && schedEndIso
        ? Math.max(
            0,
            DateTime.fromISO(schedEndIso).diff(DateTime.fromISO(schedStartIso), 'seconds').seconds
          )
        : null;

    const derivedShiftSec = Math.max(0, (shiftEndMs - shiftStartMs) / 1000);
    const effectiveShiftSec = scheduleSec ?? derivedShiftSec;

    const bookedServiceSeconds = Math.floor(bookedServiceSecFallback);

    // match Routing: whitespace = shift − (drive + booked + preview)
    const whiteSec = Math.max(
      0,
      effectiveShiftSec - driveSec - Math.max(0, bookedServiceSeconds) - previewServiceSec
    );

    const driveMin = Math.round(driveSec / 60);
    const householdMin = Math.round(bookedServiceSeconds / 60);
    const whiteMin = Math.round(whiteSec / 60);
    const shiftMin = Math.round(effectiveShiftSec / 60);

    const ratioText = driveMin > 0 ? (householdMin / driveMin).toFixed(2) : '—';
    const whitePctText =
      effectiveShiftSec > 0 ? `${Math.round((whiteSec / effectiveShiftSec) * 100)}%` : '—';

    return {
      driveMin,
      householdMin,
      ratioText,
      whiteMin,
      whitePctText,
      shiftMin,
      points,
      backToDepotIso: backToDepotIsoFinal,
    };
  }, [
    displayHouseholds,
    appts,
    displayTimeline,
    startDepot,
    endDepot,
    driveSecondsForLayout,
    backToDepotSec,
    backToDepotIso,
    backToDepotArrivalDisplayIso,
    schedStartIso,
    schedEndIso,
    virtualAppt,
    date,
  ]);

  /* ---------- UI helpers ---------- */
  function fmtTime(iso?: string | null) {
    if (!iso) return '';
    return DateTime.fromISO(iso).toLocaleString(DateTime.TIME_SIMPLE);
  }

  const driveColor = colorForDrive(stats.driveMin);
  const whitePct =
    Number.isFinite(stats.shiftMin) && stats.shiftMin > 0
      ? (stats.whiteMin / stats.shiftMin) * 100
      : 0;
  const whiteColor = colorForWhitespace(whitePct);

  const ratioNum = stats.driveMin > 0 ? stats.householdMin / stats.driveMin : Infinity;
  const hdColor = colorForHDRatio(ratioNum);

  return (
    <div className="card" style={{ padding: '14px 18px 16px' }}>
      <h2 style={{ margin: '0 0 4px', lineHeight: 1.25 }}>My Day — Visual</h2>
      <p
        className="muted"
        style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.35 }}
      >
        {showByDriveTime
          ? 'Blocks are positioned by projected ETA/ETD (drive time).'
          : 'Blocks are positioned by appointment start/end time.'}
      </p>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 0 }}>
        <label className="muted" htmlFor="vdd-date">
          Date
        </label>
        <input
          id="vdd-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={readOnly}
        />
        <label className="muted" htmlFor="vdd-doc">
          Provider
        </label>
        <select
          id="vdd-doc"
          value={selectedDoctorId}
          onChange={(e) => setSelectedDoctorId(e.target.value)}
          disabled={providersLoading || readOnly}
        >
          <option value="">— My Team's Schedule —</option>
          {providersLoading && <option disabled>Loading providers…</option>}
          {providers.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="muted" style={{ marginLeft: 4 }}>
          Show blocks by:
        </span>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: '4px 18px',
            alignItems: 'center',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="vdd-drive-toggle"
              checked={showByDriveTime}
              onChange={() => setShowByDriveTime(true)}
            />
            Actual time (arrive/leave)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="vdd-drive-toggle"
              checked={!showByDriveTime}
              onChange={() => setShowByDriveTime(false)}
            />
            Appointment time (start/end)
          </label>
        </div>
        {providersErr && (
          <div className="error" style={{ marginTop: 4 }}>
            {providersErr}
          </div>
        )}
      </div>

      <div className="dd-grid" style={{ marginTop: 10 }}>
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            <h3 style={{ margin: 0 }}>Day Metrics</h3>
            {links.length > 0 && (
              <a
                href={links[0]}
                className="btn"
                style={{ fontSize: 13, padding: '7px 16px', whiteSpace: 'nowrap' }}
                target="_blank"
                rel="noreferrer"
                title={
                  links.length > 1
                    ? `Open segment 1 of ${links.length} in Google Maps (full day is split for the 25-stop limit)`
                    : 'Open this day in Google Maps'
                }
              >
                Google Maps
              </a>
            )}
          </div>
          <div
            className="dd-meta muted"
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <span>
              <strong>Points:</strong> {stats.points}
            </span>
            <span style={{ color: driveColor }}>
              <strong>Drive:</strong> {formatHM(stats.driveMin)}
            </span>
            <span>
              <strong>Households:</strong> {formatHM(stats.householdMin)}
            </span>
            <span style={{ color: hdColor }}>
              <strong>H:D ratio:</strong> {stats.ratioText}
            </span>
            <span style={{ color: whiteColor }}>
              <strong>Whitespace:</strong> {formatHM(stats.whiteMin)}
              {stats.shiftMin > 0 && <> ({stats.whitePctText})</>}
            </span>
            <span className="muted">Shift: {formatHM(stats.shiftMin)}</span>
            <span>
              <strong>Back to depot:</strong> {fmtTime(stats.backToDepotIso) || '—'}
            </span>
          </div>
        </div>
      </div>

      {loading && (
        <div className="dd-loading">
          <div className="dd-spinner" aria-hidden />
          <span>Loading…</span>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {etaErr && <p className="error">{etaErr}</p>}

      {/* Vertical timeline — My Week–style grid, hashed drive bands, times on the right */}
      <div
        style={{
          position: 'relative',
          marginTop: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 16,
          paddingBottom: 16,
          maxHeight: 'min(88vh, calc(100vh - 220px))',
          overflowY: 'auto',
          background: '#fff',
        }}
      >
        <div style={{ position: 'relative', height: dayVisualGrid.totalMinutes * PPM, minHeight: 300 }}>
          {startDepotTimeStr && (
            <div
              style={{
                position: 'absolute',
                left: 2,
                right: TIMELINE_LABEL_GUTTER_PX,
                top:
                  depotTimeToPx(
                    dayVisualGrid.gridStartMinutesFromMidnight,
                    dayVisualGrid.totalMinutes,
                    startDepotTimeStr
                  ) - DEPOT_LINE_OFFSET,
                height: 0,
                borderTop: `${DEPOT_LINE_PX}px solid ${DEPOT_LINE_COLOR}`,
                pointerEvents: 'none',
                zIndex: 2,
              }}
              aria-hidden
            />
          )}
          {endDepotTimeStr && (
            <div
              style={{
                position: 'absolute',
                left: 2,
                right: TIMELINE_LABEL_GUTTER_PX,
                top:
                  depotTimeToPx(
                    dayVisualGrid.gridStartMinutesFromMidnight,
                    dayVisualGrid.totalMinutes,
                    endDepotTimeStr
                  ) - DEPOT_LINE_OFFSET,
                height: 0,
                borderTop: `${DEPOT_LINE_PX}px solid ${DEPOT_LINE_COLOR}`,
                pointerEvents: 'none',
                zIndex: 2,
              }}
              aria-hidden
            />
          )}
          {timeTicks.map((tick, i) => (
            <div
              key={`tick-${i}`}
              style={{
                position: 'absolute',
                left: 2,
                right: TIMELINE_LABEL_GUTTER_PX,
                top: tick.top,
                height: 0,
                borderTop: tick.isHour ? TICK_HOUR_BORDER : TICK_HALF_BORDER,
                pointerEvents: 'none',
                zIndex: 0,
              }}
              aria-hidden
            />
          ))}
          {hourTicksForLabels.map((h, i) => (
            <div
              key={`hr-${i}`}
              style={{
                position: 'absolute',
                top: h.top,
                right: 4,
                width: TIMELINE_LABEL_GUTTER_PX - 6,
                textAlign: 'left',
                fontSize: 13,
                fontWeight: 600,
                color: '#475569',
                lineHeight: 1,
                transform: 'translateY(-50%)',
                fontVariantNumeric: 'tabular-nums',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            >
              {h.label}
            </div>
          ))}

          {fromDepotSegment && (() => {
            const segKey = 'vdd-drive-depot';
            const title = `Drive from depot: ${fromDepotSegment.mins} min`;
            return (
              <div
                onMouseEnter={(ev) => {
                  setDriveHoverCard({
                    segmentKey: segKey,
                    x: ev.clientX,
                    y: ev.clientY,
                    title,
                  });
                }}
                onMouseMove={(ev) => {
                  setDriveHoverCard((prev) =>
                    prev?.segmentKey === segKey ? { ...prev, x: ev.clientX, y: ev.clientY } : prev
                  );
                }}
                onMouseLeave={() => {
                  setDriveHoverCard((prev) => (prev?.segmentKey === segKey ? null : prev));
                }}
                style={{
                  position: 'absolute',
                  left: 2,
                  right: TIMELINE_LABEL_GUTTER_PX,
                  top: fromDepotSegment.top,
                  height: fromDepotSegment.height,
                  background: DRIVE_FILL,
                  borderRadius: 4,
                  zIndex: 1,
                  cursor: 'default',
                }}
              />
            );
          })()}

          {/* appointment blocks (single column); render in byIndex order */}
          {displayHouseholds.map((h, idx) => {
            const { startIso: resolvedStartIso, endIso: resolvedEndIso } = householdStartEnd(h, idx);
            const schedStart = resolvedStartIso ? DateTime.fromISO(resolvedStartIso) : null;
            const schedEnd = resolvedEndIso ? DateTime.fromISO(resolvedEndIso) : null;
            if (!schedStart || !schedEnd) return null;

            const durMin = Math.max(1, Math.round(schedEnd.diff(schedStart).as('minutes')));

            // Check if appointment type is "Fixed Time" - same logic as list view
            // Check multiple fields: appointmentType, appointmentTypeName, serviceName
            // Handle both string and object (with .name property) cases
            const getApptTypeString = (appt: DoctorDayAppt): string => {
              const type1 = str(appt, 'appointmentType');
              const type2 = str(appt, 'appointmentTypeName');
              const type3 = str(appt, 'serviceName');
              const type4 = (appt as any)?.appointmentType;
              const type5 = (appt as any)?.appointmentTypeName;
              // Handle object case (appointmentType might be { name: 'Fixed Time' })
              const type6 = typeof type4 === 'object' && type4?.name ? String(type4.name) : null;
              
              return type1 || type2 || type3 || (typeof type4 === 'string' ? type4 : null) || 
                     (typeof type5 === 'string' ? type5 : null) || type6 || '';
            };
            
            const primaryTypeLower = getApptTypeString(h.primary).toLowerCase();
            const firstPatientType = (h.patients[0]?.type || '').toLowerCase();

            const blockLabelMetaEarly = h.isPersonalBlock
              ? blockLabelMetaForDisplay(h, etaBlockLabelByKey)
              : null;
            const flexBlock = Boolean(
              h.isPersonalBlock &&
                isFlexBlockItem(blockLabelMetaEarly ?? h.primary)
            );

            // Regular personal blocks are fixed at scheduled time; Flex Blocks use an arrival window (like My Week intent).
            const isFixedTime =
              (h.isPersonalBlock && !flexBlock) ||
              primaryTypeLower === 'fixed time' ||
              firstPatientType === 'fixed time';

            // ---- Positioning: use ETA/ETD when available so blocks match route times (incl. personal block at 11:00–11:45) ----
            const etaIso = displayTimeline[idx]?.eta ?? null;
            const etdIso = displayTimeline[idx]?.etd ?? null;
            const useDriveTime = showByDriveTime && (etaIso ?? etdIso);
            const anchorIso = useDriveTime ? (etaIso ?? resolvedStartIso) : resolvedStartIso;
            const endIsoForHeight = useDriveTime && etdIso ? etdIso : resolvedEndIso;
            const durMinForHeight = Math.max(
              1,
              Math.round(DateTime.fromISO(endIsoForHeight).diff(DateTime.fromISO(anchorIso)).as('minutes'))
            );
            // Use blockGeom so blocks sit with gaps for drive segments (drive between appointments, not on top)
            const geom = blockGeom[idx];
            const top = geom
              ? geom.top
              : minutesFromDayStart(
                  dayVisualGrid.gridStartMinutesFromMidnight,
                  dayVisualGrid.totalMinutes,
                  anchorIso,
                  date
                ) * PPM;
            const height = geom ? geom.height : Math.max(22, durMinForHeight * PPM);

            // Window: prefer byIndex row window when both present, else appointment effectiveWindow, else frontend-calculated
            const slotWindow = displayTimeline[idx];
            const ew = h.primary?.effectiveWindow;
            const { winStartIso, winEndIso } = isFixedTime
              ? { winStartIso: resolvedStartIso, winEndIso: resolvedEndIso }
              : slotWindow?.windowStartIso && slotWindow?.windowEndIso
                ? { winStartIso: slotWindow.windowStartIso, winEndIso: slotWindow.windowEndIso }
                : ew?.startIso && ew?.endIso
                  ? { winStartIso: ew.startIso, winEndIso: ew.endIso }
                  : adjustedWindowForStart(date, h.startIso!, schedStartIso);

            const windowWarning =
              showByDriveTime &&
              useDriveTime &&
              !isFixedTime &&
              !h.isPersonalBlock &&
              shouldShowEtaWindowWarning(etaIso, winEndIso);

            const previewPatients = h.patients.slice(0, 3);
            const moreCount = Math.max(0, (h.patients?.length || 0) - 3);

            const blockLabelMeta = blockLabelMetaEarly;
            const blockTitleText =
              h.isPersonalBlock && blockLabelMeta ? blockDisplayLabel(blockLabelMeta) : h.client;

            return (
              <div
                key={h.key}
                onPointerEnter={(ev) => {
                  if (hoverCardDismissTimerRef.current) {
                    clearTimeout(hoverCardDismissTimerRef.current);
                    hoverCardDismissTimerRef.current = null;
                  }
                  const anchor = rectFromElement(ev.currentTarget);
                  setHoverCard({
                    key: h.key,
                    x: ev.clientX,
                    y: ev.clientY,
                    ...(anchor ? { anchor } : {}),
                    client: blockTitleText,
                    address: h.address,
                    durMin,
                    etaIso: isFixedTime ? h.startIso! : (etaIso ?? null),
                    etdIso: isFixedTime ? h.endIso! : (etdIso ?? null),
                    sIso: h.startIso!,
                    eIso: h.endIso!,
                    patients: h.patients || [],
                    clientAlert: h?.clientAlert,
                    isFixedTime,
                    isPersonalBlock: h.isPersonalBlock,
                    isNoLocation: h.isNoLocation,
                    effectiveWindow: h.primary?.effectiveWindow,
                    windowFromByIndex: slotWindow?.windowStartIso && slotWindow?.windowEndIso
                      ? { winStartIso: slotWindow.windowStartIso, winEndIso: slotWindow.windowEndIso }
                      : undefined,
                    resolvedWinStartIso: winStartIso,
                    resolvedWinEndIso: winEndIso,
                  });
                }}
                onPointerMove={(ev) => {
                  setHoverCard((prev) => {
                    if (!prev || prev.key !== h.key) return prev;
                    const nextAnchor = rectFromElement(ev.currentTarget);
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
                    setHoverCard((prev) => (prev?.key === h.key ? null : prev));
                    hoverCardDismissTimerRef.current = null;
                  }, 280);
                }}
                style={{
                  position: 'absolute',
                  left: 2,
                  right: TIMELINE_LABEL_GUTTER_PX,
                  top,
                  height,
                  background: flexBlock
                    ? '#fef9c3'
                    : h.isPersonalBlock
                      ? '#e5e7eb'
                      : h.isNoLocation
                        ? '#fee2e2'
                        : h.isPreview
                          ? '#ede9fe'
                          : '#e0f2fe',
                  border: `1px solid ${
                    flexBlock
                      ? '#ca8a04'
                      : h.isPersonalBlock
                        ? '#9ca3af'
                        : h.isNoLocation
                          ? '#ef4444'
                          : h.isPreview
                            ? '#a855f7'
                            : '#38bdf8'
                  }`,
                  borderRadius: 8,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 10px',
                  gap: 10,
                  overflow: 'hidden',
                  cursor: 'default',
                  zIndex: 2,
                  color: h.isPersonalBlock ? '#111827' : undefined,
                }}
              >
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {h.isPersonalBlock ? blockTitleText : h.client}
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flex: 1,
                  }}
                >
                  {h.address}
                </div>

                {/* status chips — block title is only in the left column (avoid "BLOCK BLOCK" from title + pill) */}
                {h.isPersonalBlock ? null : h.isNoLocation ? (
                  <div
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#fee2e2',
                      color: '#b91c1c',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    No location
                  </div>
                ) : h.isPreview ? (
                  <div
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#ede9fe',
                      color: '#6b21a8',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Preview
                  </div>
                ) : isFixedTime && !h.isPersonalBlock ? (
                  <div
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#fee2e2',
                      color: '#dc2626',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    FIXED TIME
                  </div>
                ) : null}

                {windowWarning && (
                  <div
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#fef3c7',
                      color: '#b45309',
                      border: '1px solid #f59e0b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Window Warning
                  </div>
                )}

                {!!h.patients?.length && !h.isPersonalBlock && (
                  <div
                    className="muted"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    •{' '}
                    {previewPatients.map((p, pi) => (
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
                          <span>{p.name}</span>
                        </span>
                      </span>
                    ))}
                    {moreCount > 0 ? ` +${moreCount} more` : ''}
                  </div>
                )}
              </div>
            );
          })}

          {vConnectors.map((c, i) => (
            <div
              key={c.segKey || `vdd-between-${i}`}
              onMouseEnter={(ev) => {
                setDriveHoverCard({
                  segmentKey: c.segKey,
                  x: ev.clientX,
                  y: ev.clientY,
                  title: c.title,
                });
              }}
              onMouseMove={(ev) => {
                setDriveHoverCard((prev) =>
                  prev?.segmentKey === c.segKey ? { ...prev, x: ev.clientX, y: ev.clientY } : prev
                );
              }}
              onMouseLeave={() => {
                setDriveHoverCard((prev) => (prev?.segmentKey === c.segKey ? null : prev));
              }}
              style={{
                position: 'absolute',
                left: 2,
                right: TIMELINE_LABEL_GUTTER_PX,
                top: c.top,
                height: c.height,
                background: c.kind === 'buffer' ? BUFFER_FILL : DRIVE_FILL,
                border: c.kind === 'buffer' ? BUFFER_BORDER : undefined,
                boxSizing: 'border-box',
                borderRadius: 4,
                zIndex: 1,
                cursor: 'default',
              }}
            />
          ))}

          {backToDepotSegments?.map((c, i) => (
            <div
              key={c.segKey || `vdd-back-${i}`}
              onMouseEnter={(ev) => {
                setDriveHoverCard({
                  segmentKey: c.segKey,
                  x: ev.clientX,
                  y: ev.clientY,
                  title: c.title,
                });
              }}
              onMouseMove={(ev) => {
                setDriveHoverCard((prev) =>
                  prev?.segmentKey === c.segKey ? { ...prev, x: ev.clientX, y: ev.clientY } : prev
                );
              }}
              onMouseLeave={() => {
                setDriveHoverCard((prev) => (prev?.segmentKey === c.segKey ? null : prev));
              }}
              style={{
                position: 'absolute',
                left: 2,
                right: TIMELINE_LABEL_GUTTER_PX,
                top: c.top,
                height: c.height,
                background: c.kind === 'buffer' ? BUFFER_FILL : DRIVE_FILL,
                border: c.kind === 'buffer' ? BUFFER_BORDER : undefined,
                boxSizing: 'border-box',
                borderRadius: 4,
                zIndex: c.zIndex ?? 1,
                cursor: 'default',
              }}
            />
          ))}
        </div>
      </div>

      {/* Global hover card (renders to document.body so it never gets clipped) */}
      {hoverCard &&
        createPortal(
          (() => {
            const CARD_MAX_W = 520; // room for patient list
            const CARD_MIN_W = 340;
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
            });
            const { left, top, maxCardH, width: popoverW } = pos;

            const s = DateTime.fromISO(hoverCard.sIso);

            const winStartIso = hoverCard.resolvedWinStartIso;
            const winEndIso = hoverCard.resolvedWinEndIso;
            const addrNoZip = stripZipFromAddressLine(hoverCard.address);
            const showArrive = !!(hoverCard.etaIso || hoverCard.etdIso);
            // Match My Week: hide window only for fixed personal blocks, not flex (arrival window) blocks.
            const showWindow =
              !!(winStartIso && winEndIso) &&
              !(hoverCard.isPersonalBlock && hoverCard.isFixedTime);
            const showSecondRow = showArrive || showWindow;
            const hoveredBlockIdx = displayHouseholds.findIndex((h) => h.key === hoverCard.key);
            const hoveredBlockBottomPx =
              hoveredBlockIdx >= 0 && blockGeom[hoveredBlockIdx]
                ? blockGeom[hoveredBlockIdx].top + blockGeom[hoveredBlockIdx].height
                : 0;
            const showBackToDepotInHover =
              !!stats.backToDepotIso && hoveredBlockBottomPx >= maxDayVisualBottomPx - 2;
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
                  setHoverCard(null);
                }}
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  width: popoverW,
                  maxWidth: CARD_MAX_W,
                  minWidth: Math.min(CARD_MIN_W, popoverW),
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
                  <span style={{ fontWeight: 800, color: '#14532d' }}>{hoverCard.client}</span>
                  <span style={{ color: '#64748b' }}>·</span>
                  <span style={{ color: '#64748b', flex: '1 1 12rem', minWidth: 0 }}>{addrNoZip}</span>
                </div>
                {hoverCard?.clientAlert && (
                  <div style={{ marginBottom: 4, color: '#dc2626', fontSize: 12, lineHeight: 1.35 }}>
                    Alert: {hoverCard.clientAlert}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', marginBottom: 4, fontSize: 13, color: '#334155' }}>
                  <span>
                    <b>Scheduled:</b> {s.toLocaleString(DateTime.TIME_SIMPLE)}
                  </span>
                  <span>
                    <b>Duration:</b> {hoverCard.durMin} min
                  </span>
                  {hoverCard.isFixedTime && !hoverCard.isPersonalBlock && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>FIXED TIME</span>
                  )}
                  {hoverCard.isPersonalBlock && (
                    <span style={{ color: '#6b7280', fontWeight: 600 }}>{hoverCard.client || 'Block'}</span>
                  )}
                  {hoverCard.isNoLocation && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>No location</span>
                  )}
                  {showBackToDepotInHover && (
                    <span>
                      <b>Back to depot:</b>{' '}
                      {DateTime.fromISO(stats.backToDepotIso!).toLocaleString(DateTime.TIME_SIMPLE)}
                    </span>
                  )}
                </div>

                {showSecondRow && (
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
                          ? DateTime.fromISO(hoverCard.etaIso).toLocaleString(DateTime.TIME_SIMPLE)
                          : '—'}
                        {' – '}
                        {hoverCard.etdIso
                          ? DateTime.fromISO(hoverCard.etdIso).toLocaleString(DateTime.TIME_SIMPLE)
                          : '—'}
                      </span>
                    )}
                    {showWindow && (
                      <span>
                        <b>Window of arrival:</b>{' '}
                        {DateTime.fromISO(winStartIso).toLocaleString(DateTime.TIME_SIMPLE)} –{' '}
                        {DateTime.fromISO(winEndIso).toLocaleString(DateTime.TIME_SIMPLE)}
                      </span>
                    )}
                  </div>
                )}

                {!!hoverCard.patients?.length && (
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

      {driveHoverCard &&
        createPortal(
          (() => {
            const PADDING = 12;
            const OFFSET = 14;
            let left = driveHoverCard.x + OFFSET;
            let top = driveHoverCard.y - 12;
            const vwW = window.innerWidth;
            const vwH = window.innerHeight;
            if (left + 260 > vwW - PADDING) left = driveHoverCard.x - OFFSET - 260;
            if (left < PADDING) left = PADDING;
            if (top + 80 > vwH - PADDING) top = vwH - PADDING - 80;
            if (top < PADDING) top = PADDING;
            const driveSegBottomPx = (() => {
              const v = vConnectors.find((c) => c.segKey === driveHoverCard.segmentKey);
              if (v) return v.top + v.height;
              const b = backToDepotSegments?.find((c) => c.segKey === driveHoverCard.segmentKey);
              return b ? b.top + b.height : 0;
            })();
            const showBackToDepotOnDriveHover =
              !!stats.backToDepotIso && driveSegBottomPx >= maxDayVisualBottomPx - 2;
            return (
              <div
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 10000,
                  minWidth: 200,
                  maxWidth: 320,
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
                <div style={{ fontWeight: 700, marginBottom: 4, color: '#475569' }}>Driving</div>
                <div style={{ fontSize: 13 }}>{driveHoverCard.title}</div>
                {showBackToDepotOnDriveHover && (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#334155' }}>
                    <b>Back to depot:</b>{' '}
                    {DateTime.fromISO(stats.backToDepotIso!).toLocaleString(DateTime.TIME_SIMPLE)}
                  </div>
                )}
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
}
