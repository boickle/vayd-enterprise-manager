// src/pages/MyWeek.tsx — Weekly calendar view: each day in a column, same APIs as My Day.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  fetchDoctorDay,
  clientDisplayName,
  isBlockEntry,
  blockDisplayLabel,
  type DoctorDayAppt,
  type DoctorDayResponse,
  type Depot,
  type MiniZone,
} from '../api/appointments';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { getZonePercentagesForProvider } from '../api/patients';
import { fetchEtas } from '../api/routing';
import { useAuth } from '../auth/useAuth';
import { buildGoogleMapsLinksForDay, type Stop } from '../utils/maps';
import { colorForDrive } from '../utils/statsFormat';
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

/** Thicker line for depot start/end times (centered on the grid line) */
const DEPOT_LINE_PX = 3;
const DEPOT_LINE_OFFSET = Math.floor(DEPOT_LINE_PX / 2); // so depot line aligns with grid
/** Full-width subtle line at hour (:00) and half-hour (:30) */
const TICK_COLOR = '#cbd5e1';
/** Half-hour lines: dashed and more muted */
const TICK_HALF_COLOR = '#e2e8f0';
/** Drive segment shading: diagonal stripes so drive vs whitespace is obvious */
const DRIVE_FILL = 'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';

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

/** Key variants for matching ETA byIndex row key to household (avoids precision/rounding mismatches). */
function keyVariantsForKeyString(s: string): string[] {
  const parts = s.split(',');
  if (parts.length !== 2) return [s];
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return [s];
  return [s, keyFor(lat, lon, 6), keyFor(lat, lon, 5)];
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
  status?: string | null;
  alerts?: string | null;
};
function makePatientBadge(a: any): PatientBadge {
  const name =
    str(a, 'patientName') || str(a, 'petName') || str(a, 'animalName') || str(a, 'name') || 'Patient';
  const type = str(a, 'appointmentType') || str(a, 'appointmentTypeName') || str(a, 'serviceName') || null;
  const desc = str(a, 'description') || str(a, 'visitReason') || null;
  const status = str(a, 'confirmStatusName') || str(a, 'statusName') || null;
  const alerts = str(a, 'alerts') || null;
  return { name, type, desc, status, alerts };
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
    const key = hasGeo ? keyFor(lat, lon, 6) : addrKey ? `addr:${addrKey}` : `noloc:${idPart}`;
    const isPersonalBlock = isBlockEntry({ ...a, key });
    const isPreview = (a as any)?.isPreview === true;
    const patient = makePatientBadge(a);

    const effectiveWindow = (a as any)?.effectiveWindow;
    const windowStartIso = effectiveWindow?.startIso ?? null;
    const windowEndIso = effectiveWindow?.endIso ?? null;

    if (!m.has(key)) {
      m.set(key, {
        key,
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
      const h = m.get(key)!;
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
  // Preserve visit order (from day API or after insert): use firstApptIndex so display and ETA match.
  return Array.from(m.values()).sort((a, b) => {
    if (a.firstApptIndex != null && b.firstApptIndex != null) {
      return a.firstApptIndex - b.firstApptIndex;
    }
    return (
      (a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0) -
      (b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0)
    );
  });
}

type DayData = {
  date: string;
  households: WeekHousehold[];
  timeline: { eta?: string | null; etd?: string | null }[];
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
  /** Minutes after ETD before next appointment can start or drive starts. Use only for next-available/block end; ETD is appointment end. Default 5. */
  appointmentBufferMinutes?: number;
  /** When set, render in byIndex order: displayHouseholds[i] = households[routingOrderIndices[i]]. */
  routingOrderIndices?: number[] | null;
};

/** Sunday of the week containing the given date (YYYY-MM-DD). */
function weekStartSunday(dateIso: string): string {
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

/** Base time for the day column (grid start on that date). */
function dayBaseIso(gridStartMinutesFromMidnight: number, dateIso: string): string {
  const h = Math.floor(gridStartMinutesFromMidnight / 60);
  const m = gridStartMinutesFromMidnight % 60;
  return DateTime.fromISO(dateIso)
    .set({ hour: h, minute: m, second: 0, millisecond: 0 })
    .toISO()!;
}

/** Minutes from grid start to the given ISO time; clamp to [0, totalMinutes]. */
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

const MYWEEK_STORAGE_KEY = 'myweek-state';

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
  } | null>(null);
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
                ...(h.isPersonalBlock
                  ? { isPersonalBlock: true, windowStartIso: h.startIso, windowEndIso: h.endIso }
                  : {}),
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
            const keyToSlot: Record<string, { eta: string | null; etd: string | null }> = {};
            if (Array.isArray(result?.byIndex)) {
              for (const row of result.byIndex as { key?: string; etaIso?: string; etdIso?: string }[]) {
                const k = row?.key;
                if (k == null) continue;
                const eta = valid(row?.etaIso) ? row.etaIso! : null;
                const etd = valid(row?.etdIso) ? row.etdIso! : null;
                keyToSlot[k] = { eta, etd };
              }
            }
            const tl = day.households.map((h, i) => {
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
              return { eta: eta ?? undefined, etd: etd ?? undefined };
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
            // When first stop is a personal block, keep driveSeconds from ETA (byIndex): ds[0] = depot→block (e.g. 42 min).
            // Do not overwrite with depotToFirstRoutableSec (drive to first routable stop), or we lose the depot→block segment.
            if (!firstIsBlock && driveSeconds && depotToFirstRoutableSec != null && depotToFirstRoutableSec > 0) {
              driveSeconds = [depotToFirstRoutableSec, ...driveSeconds.slice(1)];
            }
            const backToDepotSec =
              typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null;
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
            return {
              ...day,
              timeline: tl,
              driveSeconds: driveSeconds ?? undefined,
              depotToFirstRoutableSec: depotToFirstRoutableSec ?? undefined,
              backToDepotSec: backToDepotSec ?? undefined,
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
      const candidates: number[] = [];
      if (day.startDepotTime) {
        candidates.push(timeStrToMinutesFromMidnight(day.startDepotTime));
      }
      const first = day.households?.[0];
      if (first?.startIso) {
        const dt = DateTime.fromISO(first.startIso);
        if (dt.isValid) {
          candidates.push(dt.hour * 60 + dt.minute);
        }
      }
      const firstSlot = day.timeline?.[0];
      const eta = firstSlot?.eta ?? firstSlot?.etd;
      if (eta) {
        const dt = DateTime.fromISO(eta);
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
    const out: { top: number; label: string }[] = [];
    const startH = Math.floor(weekGrid.gridStartMinutesFromMidnight / 60);
    for (let h = startH; h <= DAY_END_HOUR; h++) {
      const minAtHour = h * 60;
      const minutesFromGridStart = minAtHour - weekGrid.gridStartMinutesFromMidnight;
      if (minutesFromGridStart >= 0 && minutesFromGridStart <= weekGrid.totalMinutes) {
        out.push({
          top: minutesFromGridStart * PPM,
          label: DateTime.fromObject({ hour: h, minute: 0 }).toFormat('h a'),
        });
      }
    }
    return out;
  }, [weekGrid.gridStartMinutesFromMidnight, weekGrid.totalMinutes]);

  /** Hour and half-hour tick positions (little markers, less thick than depot lines) */
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
        style={{
          marginTop: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          overflow: 'auto',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', minWidth: 800 }}>
          {/* Time column — header height matches day column (day name + date + points/buttons) so labels align with grid lines */}
          <div style={{ width: 56, flexShrink: 0, position: 'sticky', left: 0, background: '#f9fafb', zIndex: 2 }}>
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
                    left: 8,
                    fontSize: 12,
                    color: '#6b7280',
                    lineHeight: 1,
                    transform: 'translateY(-50%)',
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
            const dt = DateTime.fromISO(dateIso);
            const isToday = dateIso === DateTime.local().toISODate();
            return (
              <div
                key={dateIso}
                style={{
                  width: (dayData?.households?.length ?? 0) > 0 ? 220 : 70,
                  minWidth: (dayData?.households?.length ?? 0) > 0 ? 220 : 70,
                  flexShrink: 0,
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
                        borderTop: `${DEPOT_LINE_PX}px solid #94a3b8`,
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
                        borderTop: `${DEPOT_LINE_PX}px solid #94a3b8`,
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
                        borderTop: tick.isHour
                          ? `1px solid ${TICK_COLOR}`
                          : `1px dashed ${TICK_HALF_COLOR}`,
                        pointerEvents: 'none',
                        zIndex: 0,
                      }}
                      aria-hidden
                    />
                  ))}
                  {/* Drive segments (shaded): only when "Actual time" is selected */}
                  {showByDriveTime &&
                    dayData?.households &&
                    dayData.households.length > 0 &&
                    (() => {
                      const N = dayData.households.length;
                      const tl = dayData.timeline ?? [];
                      const order = dayData.routingOrderIndices;
                      const displayHouseholds =
                        order && order.length === N
                          ? order.map((i) => dayData.households[i])
                          : dayData.households;
                      const displayTimeline =
                        order && order.length === N ? order.map((i) => tl[i]) : tl;
                      const ds = dayData.driveSeconds ?? [];
                      const backSec = dayData.backToDepotSec ?? null;
                      const bufferMin = dayData.appointmentBufferMinutes ?? 5;
                      const segs: { top: number; height: number; title: string }[] = [];
                      const toMin = (iso: string) =>
                        minutesFromDayStart(
                          weekGrid.gridStartMinutesFromMidnight,
                          weekGrid.totalMinutes,
                          iso,
                          dateIso
                        );
                      const toPx = (min: number) =>
                        Math.max(0, Math.min(weekGrid.totalMinutes, min)) * PPM;
                      const driveLabel = (min: number, kind: string) =>
                        kind === 'Drive from depot' || kind === 'Drive back to depot'
                          ? `${kind}: ${min} min`
                          : `${kind}: ${min} min drive`;
                      // Index of chronologically first stop (depot segment ends there)
                      let firstByTimeIdx = 0;
                      let firstByTimeIso = displayTimeline[0]?.eta ?? displayTimeline[0]?.etd ?? displayHouseholds[0]?.startIso;
                      if (firstByTimeIso) {
                        for (let j = 1; j < N; j++) {
                          const slotJ = displayTimeline[j];
                          const anchorJ = slotJ?.eta ?? slotJ?.etd ?? displayHouseholds[j]?.startIso;
                          if (anchorJ && anchorJ < firstByTimeIso) {
                            firstByTimeIso = anchorJ;
                            firstByTimeIdx = j;
                          }
                        }
                      }

                      for (let i = 0; i < N; i++) {
                        const h = displayHouseholds[i];
                        const slot = displayTimeline[i];
                        const useEta = slot?.eta ?? slot?.etd;
                        const anchorIso = useEta ? (slot?.eta ?? h.startIso!) : h.startIso!;
                        const endIsoForHeight =
                          useEta && slot?.etd ? slot.etd : h.endIso!;
                        const topMin = toMin(anchorIso);
                        const endMin = toMin(endIsoForHeight);
                        const durMin = Math.max(1, endMin - topMin);
                        const curIsBlock = (h as any)?.isPersonalBlock === true || (h as any)?.isNoLocation === true;
                        // Depot → first stop: draw once, ending at chronologically first stop
                        if (i === 0 && (dayData.startDepotTime || ds.length > 0) && firstByTimeIdx === 0) {
                          const firstEta = slot?.eta ?? h.startIso!;
                          const firstIsBlock = curIsBlock;
                          let toFirstSec = typeof ds[0] === 'number' ? ds[0] : 0;
                          if (firstIsBlock && toFirstSec <= 0 && typeof ds[1] === 'number' && ds[1] > 0) {
                            toFirstSec = ds[1];
                          }
                          if (toFirstSec > 0) {
                            const startIso = DateTime.fromISO(firstEta)
                              .minus({ seconds: toFirstSec })
                              .toISO()!;
                            const segTop = toPx(toMin(startIso));
                            const segH = Math.max(4, (toFirstSec / 60) * PPM);
                            const min = Math.round(toFirstSec / 60);
                            segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Drive from depot') });
                          } else if (!firstIsBlock) {
                            const startPx = dayData.startDepotTime
                              ? depotTimeToPx(
                                  weekGrid.gridStartMinutesFromMidnight,
                                  weekGrid.totalMinutes,
                                  dayData.startDepotTime
                                )
                              : 0;
                            const segTop = startPx;
                            const segH = Math.max(4, topMin * PPM - startPx);
                            if (segH > 2) {
                              const min = Math.round(segH / PPM);
                              segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Drive from depot') });
                            }
                          }
                        }
                        // When chronologically first stop is not at index 0 (e.g. block first by time), draw depot segment before it here
                        if (i === firstByTimeIdx && i > 0) {
                          const depotSec = dayData.depotToFirstRoutableSec ?? (typeof ds[0] === 'number' ? ds[0] : 0);
                          if (depotSec > 0) {
                            const startIso = DateTime.fromISO(anchorIso).minus({ seconds: depotSec }).toISO()!;
                            const segTop = toPx(toMin(startIso));
                            const segH = Math.max(4, (depotSec / 60) * PPM);
                            const min = Math.round(depotSec / 60);
                            segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Drive from depot') });
                          }
                        }
                        if (i < N - 1) {
                          const nextH = displayHouseholds[i + 1];
                          const nextSlot = displayTimeline[i + 1];
                          const nextAnchorIso = nextSlot?.eta ?? nextSlot?.etd ?? nextH.startIso;
                          const etdIso = slot?.etd ?? DateTime.fromISO(anchorIso).plus({ minutes: durMin }).toISO()!;
                          const curIsBlock = (h as any)?.isPersonalBlock === true || (h as any)?.isNoLocation === true;
                          const usedFirstForDepot = i === 0 && curIsBlock && (typeof ds[0] !== 'number' || ds[0] <= 0) && (typeof ds[1] === 'number' && ds[1] > 0);
                          // Segment between stop i and i+1: use ds[i+1] (drive to stop i+1). Position so it hugs the next block (segment bottom = next block top in px).
                          const driveSec = usedFirstForDepot ? (typeof ds[2] === 'number' ? ds[2] : 0) : (typeof ds[i + 1] === 'number' ? ds[i + 1] : 0);
                          if (driveSec > 0 && nextAnchorIso) {
                            const segH = Math.max(4, (driveSec / 60) * PPM);
                            const nextBlockTopPx = toPx(toMin(nextAnchorIso));
                            const segTop = nextBlockTopPx - segH;
                            const min = Math.round(driveSec / 60);
                            segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Drive to next stop') });
                          }
                          // When drive is 0 (e.g. to personal block), don't paint the gap as "drive" — leave it as whitespace
                        } else if (dayData.endDepotTime || typeof ds[N] === 'number' || backSec != null) {
                          const lastIsNoAddressBlock = (h as any)?.isPersonalBlock === true || (h as any)?.isNoLocation === true;
                          let driveStartMin: number;
                          if (lastIsNoAddressBlock) {
                            let lastRoutableIdx = -1;
                            for (let j = displayHouseholds.length - 1; j >= 0; j--) {
                              const hh = displayHouseholds[j];
                              if (!(hh as any)?.isPersonalBlock && !(hh as any)?.isNoLocation) {
                                lastRoutableIdx = j;
                                break;
                              }
                            }
                            if (lastRoutableIdx < 0) {
                              driveStartMin = toMin(slot?.etd ?? DateTime.fromISO(anchorIso).plus({ minutes: durMin }).toISO()!) + bufferMin;
                            } else {
                              const lastRoutable = displayHouseholds[lastRoutableIdx];
                              const lastSlot = displayTimeline[lastRoutableIdx];
                              const lastUseEta = lastSlot?.eta ?? lastSlot?.etd;
                              const lastAnchorIso = lastUseEta ? (lastSlot?.eta ?? lastRoutable.startIso!) : lastRoutable.startIso!;
                              const lastEndIso = lastUseEta && lastSlot?.etd ? lastSlot.etd : lastRoutable.endIso!;
                              const lastDurMin = Math.max(
                                1,
                                Math.round(DateTime.fromISO(lastEndIso).diff(DateTime.fromISO(lastAnchorIso)).as('minutes'))
                              );
                              const lastEtdIso = lastSlot?.etd ?? DateTime.fromISO(lastAnchorIso).plus({ minutes: lastDurMin }).toISO()!;
                              driveStartMin = toMin(lastEtdIso) + bufferMin;
                            }
                          } else {
                            const etdIso = slot?.etd ?? DateTime.fromISO(anchorIso).plus({ minutes: durMin }).toISO()!;
                            driveStartMin = toMin(etdIso) + bufferMin;
                          }
                          const driveStartPx = toPx(driveStartMin);
                          const sec = (typeof ds[N] === 'number' && ds[N] > 0) ? ds[N] : (backSec ?? 0);
                          const gridBaseIso = dayBaseIso(weekGrid.gridStartMinutesFromMidnight, dateIso);
                          const arrivalTitle = (arrivalIso: string) =>
                            ` — Arrival: ${DateTime.fromISO(arrivalIso).toLocaleString(DateTime.TIME_SIMPLE)}`;
                          if (sec > 0) {
                            const min = Math.round(sec / 60);
                            const driveDurationMin = sec / 60;
                            const arrivalIso = DateTime.fromISO(gridBaseIso).plus({ minutes: driveStartMin + driveDurationMin }).toISO()!;
                            segs.push({
                              top: driveStartPx,
                              height: Math.max(4, (sec / 60) * PPM),
                              title: driveLabel(min, 'Drive back to depot') + arrivalTitle(arrivalIso),
                            });
                          } else if (!lastIsNoAddressBlock) {
                            const endDepotPx = dayData.endDepotTime
                              ? depotTimeToPx(
                                  weekGrid.gridStartMinutesFromMidnight,
                                  weekGrid.totalMinutes,
                                  dayData.endDepotTime
                                )
                              : weekGrid.totalMinutes * PPM;
                            const segH = Math.max(4, endDepotPx - driveStartPx);
                            const driveDurationMin = segH / PPM;
                            const arrivalIso = DateTime.fromISO(gridBaseIso).plus({ minutes: driveStartMin + driveDurationMin }).toISO()!;
                            if (segH > 2) segs.push({ top: driveStartPx, height: segH, title: driveLabel(Math.round(segH / PPM), 'Drive back to depot') + arrivalTitle(arrivalIso) });
                          }
                        }
                      }
                      return segs.map((seg, i) => (
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
                            background: DRIVE_FILL,
                            borderRadius: 4,
                            zIndex: 0,
                            cursor: 'default',
                          }}
                        />
                      ));
                    })()}
                  {(() => {
                    const households = dayData?.households ?? [];
                    const tl = dayData?.timeline ?? [];
                    const order = dayData?.routingOrderIndices;
                    const displayHouseholds =
                      order && order.length === households.length
                        ? order.map((i) => households[i])
                        : households;
                    const displayTimeline =
                      order && order.length === tl.length ? order.map((i) => tl[i]) : tl;
                    return displayHouseholds.map((h, idx) => {
                    const startIso = h.startIso;
                    const endIso = h.endIso;
                    if (!startIso || !endIso) return null;
                    const slot = displayTimeline[idx];
                    const useEta = showByDriveTime && (slot?.eta ?? slot?.etd);
                    const anchorIso = useEta ? (slot?.eta ?? startIso) : startIso;
                    const endIsoForHeight = useEta && slot?.etd ? slot.etd : endIso;
                    const topMin = minutesFromDayStart(
                      weekGrid.gridStartMinutesFromMidnight,
                      weekGrid.totalMinutes,
                      anchorIso,
                      dateIso
                    );
                    const endMin = minutesFromDayStart(
                      weekGrid.gridStartMinutesFromMidnight,
                      weekGrid.totalMinutes,
                      endIsoForHeight,
                      dateIso
                    );
                    const durMin = Math.max(1, endMin - topMin);
                    const top = topMin * PPM;
                    const height = Math.max(14, durMin * PPM);

                    const isFixedTime =
                      (str(h.primary, 'appointmentType') || '').toLowerCase() === 'fixed time' ||
                      (h.patients[0]?.type || '').toLowerCase() === 'fixed time';

                    const etaIso = slot?.eta ?? null;
                    const etdIso = slot?.etd ?? null;
                    return (
                      <div
                        key={h.key}
                        onMouseEnter={(ev) => {
                          setHoverCard({
                            dayDate: dateIso,
                            key: h.key,
                            x: ev.clientX,
                            y: ev.clientY,
                            client: h.client,
                            clientAlert: str(h.primary, 'clientAlert') ?? null,
                            address: h.address,
                            startIso,
                            endIso,
                            durMin,
                            etaIso: showByDriveTime ? etaIso : null,
                            etdIso: showByDriveTime ? etdIso : null,
                            windowStartIso: h.windowStartIso ?? null,
                            windowEndIso: h.windowEndIso ?? null,
                            isFixedTime,
                            isPersonalBlock: h.isPersonalBlock,
                            isNoLocation: h.isNoLocation,
                            patients: h.patients,
                          });
                        }}
                        onMouseMove={(ev) => {
                          setHoverCard((prev) =>
                            prev && prev.key === h.key && prev.dayDate === dateIso
                              ? { ...prev, x: ev.clientX, y: ev.clientY }
                              : prev
                          );
                        }}
                        onMouseLeave={() => {
                          setHoverCard((prev) =>
                            prev?.key === h.key && prev?.dayDate === dateIso ? null : prev
                          );
                        }}
                        style={{
                          position: 'absolute',
                          left: 4,
                          right: 4,
                          top,
                          height,
                          zIndex: 1,
                          background: h.isPersonalBlock
                            ? '#e5e7eb'
                            : h.isPreview
                              ? '#ede9fe'
                              : h.isNoLocation
                                ? '#fee2e2'
                                : '#e0f2fe',
                          border: `1px solid ${h.isPersonalBlock ? '#9ca3af' : h.isPreview ? '#a855f7' : h.isNoLocation ? '#ef4444' : '#38bdf8'}`,
                          borderRadius: 6,
                          fontSize: 11,
                          overflow: 'hidden',
                          padding: 4,
                          cursor: 'default',
                        }}
                      >
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {h.isPersonalBlock ? blockDisplayLabel(h.primary) : h.client}
                        </div>
                        {!h.isPersonalBlock && (
                        <div style={{ color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {h.patients.map((p) => p.name).join(', ')}
                        </div>
                        )}
                        {isFixedTime && (
                          <span style={{ fontSize: 10, color: '#b91c1c', fontWeight: 600 }}>Fixed</span>
                        )}
                      </div>
                    );
                  });
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
            const PADDING = 12;
            const OFFSET = 14;
            let left = hoverCard.x - OFFSET - CARD_MAX_W;
            let top = hoverCard.y - 12;
            if (left < PADDING) left = hoverCard.x + OFFSET;
            const vwH = window.innerHeight;
            if (top + 320 > vwH - PADDING) top = vwH - PADDING - 320;
            if (top < PADDING) top = PADDING;
            const s = DateTime.fromISO(hoverCard.startIso);
            const e = DateTime.fromISO(hoverCard.endIso);
            return (
              <div
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  maxWidth: CARD_MAX_W,
                  minWidth: 300,
                  maxHeight: '70vh',
                  overflow: 'auto',
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
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{hoverCard.client}</div>
                {hoverCard.clientAlert && (
                  <div style={{ marginBottom: 6, color: '#dc2626', fontSize: 13 }}>
                    Alert: {hoverCard.clientAlert}
                  </div>
                )}
                <div style={{ color: '#475569', marginBottom: 10, fontSize: 13 }}>{hoverCard.address}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: 13 }}>
                  <span>
                    <b>Scheduled:</b> {s.toFormat('t')} – {e.toFormat('t')}
                  </span>
                  <span>
                    <b>Duration:</b> {hoverCard.durMin} min
                  </span>
                  {(hoverCard.etaIso || hoverCard.etdIso) && (
                    <span>
                      <b>Arrive/Leave:</b>{' '}
                      {hoverCard.etaIso
                        ? DateTime.fromISO(hoverCard.etaIso).toFormat('t')
                        : '—'}
                      {' – '}
                      {hoverCard.etdIso
                        ? DateTime.fromISO(hoverCard.etdIso).toFormat('t')
                        : '—'}
                    </span>
                  )}
                  {(hoverCard.windowStartIso || hoverCard.windowEndIso) && (
                    <span>
                      <b>Window of arrival:</b>{' '}
                      {hoverCard.windowStartIso
                        ? DateTime.fromISO(hoverCard.windowStartIso).toFormat('t')
                        : '—'}
                      {' – '}
                      {hoverCard.windowEndIso
                        ? DateTime.fromISO(hoverCard.windowEndIso).toFormat('t')
                        : '—'}
                    </span>
                  )}
                  {hoverCard.isFixedTime && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>FIXED TIME</span>
                  )}
                  {hoverCard.isPersonalBlock && (
                    <span style={{ color: '#6b7280', fontWeight: 600 }}>{hoverCard.client || 'Block'}</span>
                  )}
                  {hoverCard.isNoLocation && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>No location</span>
                  )}
                </div>
                {hoverCard.patients?.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Patients</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {hoverCard.patients.map((p, i) => (
                        <li key={i} style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 600 }}>
                            {p.name}
                            {p?.alerts ? (
                              <>
                                {' '}
                                — <strong>Alert</strong>:{' '}
                                <span style={{ color: '#dc2626' }}>{p.alerts}</span>
                              </>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 13, color: '#475569' }}>
                            {p.type ? (
                              <>
                                <b>{p.type}</b>
                                {p.desc ? ` — ${p.desc}` : ''}
                              </>
                            ) : (
                              p.desc || '—'
                            )}
                          </div>
                          {p.status && (
                            <div
                              style={{
                                display: 'inline-block',
                                marginTop: 4,
                                fontSize: 12,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: p.status.toLowerCase().includes('pre-appt email')
                                  ? '#fee2e2'
                                  : p.status.toLowerCase().includes('pre-appt form')
                                    ? '#dcfce7'
                                    : '#e5e7eb',
                                color: p.status.toLowerCase().includes('pre-appt email')
                                  ? '#b91c1c'
                                  : p.status.toLowerCase().includes('pre-appt form')
                                    ? '#166534'
                                    : '#334155',
                              }}
                            >
                              {p.status}
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
            let left = driveHoverCard.x + OFFSET;
            let top = driveHoverCard.y - 12;
            const vwW = window.innerWidth;
            const vwH = window.innerHeight;
            if (left + 260 > vwW - PADDING) left = driveHoverCard.x - OFFSET - 260;
            if (left < PADDING) left = PADDING;
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
