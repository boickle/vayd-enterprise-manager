// src/pages/MyWeek.tsx — Weekly calendar view: each day in a column, same APIs as My Day.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  fetchDoctorDay,
  clientDisplayName,
  type DoctorDayAppt,
  type DoctorDayResponse,
  type Depot,
  type MiniZone,
} from '../api/appointments';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { getZonePercentagesForProvider } from '../api/patients';
import { fetchEtas } from '../api/routing';
import { useAuth } from '../auth/useAuth';
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
    const isPersonalBlock = (a as any)?.isPersonalBlock === true;
    const isPreview = (a as any)?.isPreview === true;
    const patient = makePatientBadge(a);

    const effectiveWindow = (a as any)?.effectiveWindow;
    const windowStartIso = effectiveWindow?.startIso ?? null;
    const windowEndIso = effectiveWindow?.endIso ?? null;

    if (!m.has(key)) {
      m.set(key, {
        key,
        client: clientDisplayName(a),
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
  /** Drive durations in seconds: [toFirst, between..., back] from ETA API */
  driveSeconds?: number[] | null;
  /** Back-to-depot drive seconds when not in driveSeconds array */
  backToDepotSec?: number | null;
  /** Minutes after ETD before next appointment can start or drive starts. Use only for next-available/block end; ETD is appointment end. Default 5. */
  appointmentBufferMinutes?: number;
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

export default function MyWeek(props: MyWeekProps = {}) {
  const { readOnly, initialWeekStart, initialDoctorId, virtualAppt } = props;
  const { userEmail, doctorId: userDoctorId } = useAuth() as { userEmail?: string; doctorId?: string | null };
  const [weekStart, setWeekStart] = useState<string>(() => {
    if (initialWeekStart) return initialWeekStart;
    const today = DateTime.local().toISODate() ?? '';
    return weekStartSunday(today);
  });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(initialDoctorId ?? '');
  const [showByDriveTime, setShowByDriveTime] = useState<boolean>(true);
  const [dayDataList, setDayDataList] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [etaLoading, setEtaLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [patientZoneMix, setPatientZoneMix] = useState<ZonePatientStat[] | null>(null);
  const [patientZoneMixLoading, setPatientZoneMixLoading] = useState(false);
  const [patientZoneMixErr, setPatientZoneMixErr] = useState<string | null>(null);
  const [zoneFillOpen, setZoneFillOpen] = useState(true);
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
  }, [providers, userEmail, userDoctorId, initialDoctorId]);

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
            const payload = {
              doctorId: selectedDoctorId || '',
              date: day.date,
              households: day.households.map((h) => ({
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
            } as any;
            const result: any = await fetchEtas(payload);
            const tl = day.households.map((_, i) => {
              const row = Array.isArray(result?.byIndex) ? result.byIndex[i] : {};
              const etaIso = row?.etaIso ?? (Array.isArray(result?.etaIso) ? result.etaIso[i] : null);
              const etdIso = row?.etdIso ?? (Array.isArray(result?.etdIso) ? result.etdIso[i] : null);
              const valid = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);
              let eta = valid(etaIso) ? etaIso : null;
              let etd = valid(etdIso) ? etdIso : null;
              const h = day.households[i];
              if (!eta && h?.startIso) eta = h.startIso;
              if (!etd && eta && h?.endIso) {
                const dur = h.startIso && h.endIso
                  ? DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
                  : 60;
                etd = DateTime.fromISO(eta!).plus({ minutes: dur }).toISO();
              }
              return { eta: eta ?? undefined, etd: etd ?? undefined };
            });
            const driveSeconds = Array.isArray(result?.driveSeconds) ? result.driveSeconds : null;
            const backToDepotSec =
              typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null;
            const appointmentBufferMinutes =
              typeof result?.appointmentBufferMinutes === 'number' ? result.appointmentBufferMinutes : 5;
            return {
              ...day,
              timeline: tl,
              driveSeconds: driveSeconds ?? undefined,
              backToDepotSec: backToDepotSec ?? undefined,
              appointmentBufferMinutes,
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
  }, [showByDriveTime, dayDataList, selectedDoctorId]);

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
          {/* Time column — header height matches day column (day name + date + points) so labels align with grid lines */}
          <div style={{ width: 56, flexShrink: 0, position: 'sticky', left: 0, background: '#f9fafb', zIndex: 2 }}>
            <div style={{ minHeight: 32 }} />
            <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: -8, marginBottom: 2 }} aria-hidden>&nbsp;</div>
            <div style={{ minHeight: 32, marginBottom: 4 }} aria-hidden />
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
                  width: 140,
                  minWidth: 140,
                  flexShrink: 0,
                  borderLeft: '1px solid #e5e7eb',
                  background: isToday ? '#fefce8' : undefined,
                }}
              >
                <div
                  style={{
                    minHeight: 32,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  {dt.toFormat('ccc')}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#6b7280',
                    textAlign: 'center',
                    marginTop: -8,
                    marginBottom: 2,
                  }}
                >
                  {dt.toFormat('M/d')}
                </div>
                {/* Points and total driving time at top of each day; fixed min-height so empty days align with the time axis */}
                <div
                  style={{
                    fontSize: 10,
                    color: '#475569',
                    textAlign: 'center',
                    marginBottom: 4,
                    lineHeight: 1.3,
                    minHeight: 32,
                  }}
                >
                  {dayData ? (
                    (() => {
                      const pts = dayPoints(dayData.households);
                      const driveSec = dayTotalDriveSeconds(dayData);
                      const driveMin = Math.round(driveSec / 60);
                      return (
                        <>
                          {pts > 0 && <div><strong>Points:</strong> {pts}</div>}
                          {showByDriveTime && driveMin > 0 && (
                            <div><strong>Drive:</strong> {driveMin} min</div>
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
                        `${kind}: ${min} min drive`;

                      for (let i = 0; i < N; i++) {
                        const h = dayData.households[i];
                        const slot = tl[i];
                        const useEta = slot?.eta ?? slot?.etd;
                        const anchorIso = useEta ? (slot?.eta ?? h.startIso!) : h.startIso!;
                        const endIsoForHeight =
                          useEta && slot?.etd ? slot.etd : h.endIso!;
                        const topMin = toMin(anchorIso);
                        const endMin = toMin(endIsoForHeight);
                        const durMin = Math.max(1, endMin - topMin);
                        if (i === 0 && (dayData.startDepotTime || ds.length > 0)) {
                          const firstEta = slot?.eta ?? h.startIso!;
                          const startPx = dayData.startDepotTime
                            ? depotTimeToPx(
                                weekGrid.gridStartMinutesFromMidnight,
                                weekGrid.totalMinutes,
                                dayData.startDepotTime
                              )
                            : 0;
                          if (typeof ds[0] === 'number' && ds[0] > 0) {
                            const startIso = DateTime.fromISO(firstEta)
                              .minus({ seconds: ds[0] })
                              .toISO()!;
                            const segTop = toPx(toMin(startIso));
                            const segH = Math.max(4, (ds[0] / 60) * PPM);
                            const min = Math.round(ds[0] / 60);
                            segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Depot → first stop') });
                          } else {
                            const segTop = startPx;
                            const segH = Math.max(4, topMin * PPM - startPx);
                            if (segH > 2) {
                              const min = Math.round(segH / PPM);
                              segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Depot → first stop') });
                            }
                          }
                        }
                        if (i < N - 1) {
                          const etdIso = slot?.etd ?? DateTime.fromISO(anchorIso).plus({ minutes: durMin }).toISO()!;
                          if (typeof ds[i + 1] === 'number' && ds[i + 1] > 0) {
                            // Drive segment starts after buffer (ETD + buffer = white; then drive = shaded)
                            const driveStartMin = toMin(etdIso) + bufferMin;
                            const segTop = toPx(driveStartMin);
                            const segH = Math.max(4, (ds[i + 1] / 60) * PPM);
                            const min = Math.round(ds[i + 1] / 60);
                            segs.push({ top: segTop, height: segH, title: driveLabel(min, 'Drive to next stop') });
                          } else {
                            const nextSlot = tl[i + 1];
                            const nextH = dayData.households[i + 1];
                            const nextAnchor = nextSlot?.eta ?? nextSlot?.etd ?? nextH.startIso!;
                            const nextStartMin = toMin(nextAnchor);
                            const driveStartMin = endMin + bufferMin;
                            const gapH = Math.max(4, (nextStartMin - driveStartMin) * PPM);
                            if (gapH > 2) {
                              const min = Math.round(gapH / PPM);
                              segs.push({ top: toPx(driveStartMin), height: gapH, title: driveLabel(min, 'Drive to next stop') });
                            }
                          }
                        } else if (dayData.endDepotTime || typeof ds[N] === 'number' || backSec != null) {
                          const etdIso = slot?.etd ?? DateTime.fromISO(anchorIso).plus({ minutes: durMin }).toISO()!;
                          const driveStartMin = toMin(etdIso) + bufferMin;
                          const blockEndPx = endMin * PPM;
                          const driveStartPx = toPx(driveStartMin);
                          const endDepotPx = dayData.endDepotTime
                            ? depotTimeToPx(
                                weekGrid.gridStartMinutesFromMidnight,
                                weekGrid.totalMinutes,
                                dayData.endDepotTime
                              )
                            : weekGrid.totalMinutes * PPM;
                          const sec = typeof ds[N] === 'number' ? ds[N] : backSec;
                          if (typeof sec === 'number' && sec > 0) {
                            const min = Math.round(sec / 60);
                            segs.push({
                              top: driveStartPx,
                              height: Math.max(4, (sec / 60) * PPM),
                              title: driveLabel(min, 'Last stop → depot'),
                            });
                          } else {
                            const segH = Math.max(4, endDepotPx - driveStartPx);
                            if (segH > 2) segs.push({ top: driveStartPx, height: segH, title: driveLabel(Math.round(segH / PPM), 'Last stop → depot') });
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
                          title={seg.title}
                          aria-label={seg.title}
                        />
                      ));
                    })()}
                  {dayData?.households?.map((h, idx) => {
                    const startIso = h.startIso;
                    const endIso = h.endIso;
                    if (!startIso || !endIso) return null;
                    const slot = dayData.timeline[idx];
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
                            ? '#f3f4f6'
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
                          {h.client}
                        </div>
                        <div style={{ color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {h.patients.map((p) => p.name).join(', ')}
                        </div>
                        {isFixedTime && (
                          <span style={{ fontSize: 10, color: '#b91c1c', fontWeight: 600 }}>Fixed</span>
                        )}
                      </div>
                    );
                  })}
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
                    <span style={{ color: '#6b7280', fontWeight: 600 }}>Personal Block</span>
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
