// src/pages/DoctorDayVisual.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import type { DoctorDayProps } from './DoctorDay';
import {
  fetchDoctorDay,
  clientDisplayName,
  isBlockEntry,
  blockDisplayLabel,
  type DoctorDayAppt,
  type DoctorDayResponse,
  type Depot,
} from '../api/appointments';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchEtas } from '../api/routing';
import { useAuth } from '../auth/useAuth';
import { buildGoogleMapsLinksForDay, type Stop } from '../utils/maps';
import { reverseGeocode } from '../api/geo';
import { formatHM, colorForWhitespace, colorForHDRatio, colorForDrive } from '../utils/statsFormat';
import './DoctorDay.css';

// ===== Vertical scale (pixels per minute). Tweak to taste. =====
const PPM = 2.2;

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
  status?: string | null;
  type?: string | null;
  desc?: string | null;
  startIso?: string | null;
  endIso?: string | null;
  alerts?: string | null;
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
  const status = str(a, 'confirmStatusName') || str(a, 'statusName') || null;
  return {
    name,
    type,
    desc,
    status,
    pimsId: str(a, 'patientPimsId') ?? null,
    startIso: getStartISO(a) ?? null,
    endIso: getEndISO(a) ?? null,
    alerts: str(a, 'alerts') ?? null,
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
    Array<{ etaIso?: string; etdIso?: string; windowStartIso?: string; windowEndIso?: string }>
  >([]);

  // schedule bounds for visual work start
  const [schedStartIso, setSchedStartIso] = useState<string | null>(null);
  const [schedEndIso, setSchedEndIso] = useState<string | null>(null);

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
  } | null>(null);

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
          ...(isBlock
            ? {
                isPersonalBlock: true,
                windowStartIso: h.startIso ?? null,
                windowEndIso: h.endIso ?? null,
              }
            : {}),
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

        // 1) byIndex aligns 1:1 with ordered (includes blocks). Render in byIndex order; match by key for name/address.
        const byIndex: Array<{
          key?: string;
          etaIso?: string;
          etdIso?: string;
          driveFromPrevMinutes?: number;
          driveFromPrevSec?: number;
          bufferAfterMinutes?: number;
          earlyClamped?: boolean;
        }> = Array.isArray(result?.byIndex) ? result.byIndex : [];

        for (let i = 0; i < ordered.length; i++) {
          const { h, viewIdx } = ordered[i];
          const row = byIndex[i] || {};
          let eta = row.etaIso;
          let etd = row.etdIso;
          if (h.isPersonalBlock === true && h.startIso && validIso(eta)) {
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
        }

        // 2) Fallback arrays
        const etaIsoArr: string[] = Array.isArray(result?.etaIso) ? result.etaIso : [];
        const etdIsoArr: string[] = Array.isArray(result?.etdIso) ? result.etdIso : [];
        for (let i = 0; i < ordered.length; i++) {
          const { viewIdx } = ordered[i];
          if (!tl[viewIdx].eta && validIso(etaIsoArr[i])) {
            tl[viewIdx].eta = etaIsoArr[i];
            serverETA[viewIdx] = true;
          }
          if (!tl[viewIdx].etd && validIso(etdIsoArr[i])) {
            tl[viewIdx].etd = etdIsoArr[i];
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

        // 6) store drive/depot/buffer fields. First segment = drive from depot; use normalized result.driveSeconds[0] (same logic as My Week / routing.ts).
        const driveArr = Array.isArray(result?.driveSeconds) ? result.driveSeconds : null;
        setDriveSecondsArr(driveArr);
        const fromApiFirst =
          driveArr && driveArr.length > 0 && typeof driveArr[0] === 'number' ? driveArr[0] : null;
        const firstRow = byIndex[0] as { driveFromPrevMinutes?: number; driveFromPrevSec?: number } | undefined;
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

        // Render in positionInDay order from ETA byIndex; keyToPositionInDay uses all key variants so lookup works across precision differences
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
            const h = households[householdIndex];
            const pos = keyToPositionInDay[h.key];
            if (pos != null) return pos;
            if (Number.isFinite(h.lat) && Number.isFinite(h.lon)) {
              const k5 = keyFor(h.lat as number, h.lon as number, 5);
              if (keyToPositionInDay[k5] != null) return keyToPositionInDay[k5];
            }
            return 999;
          };
          const order = Array.from({ length: households.length }, (_, i) => i).sort(
            (a, b) => getPositionInDay(a) - getPositionInDay(b)
          );
          setRoutingOrderIndices(order);
          setByIndexRows(result.byIndex.map((r: any) => ({
            etaIso: r.etaIso,
            etdIso: r.etdIso,
            windowStartIso: r.windowStartIso ?? undefined,
            windowEndIso: r.windowEndIso ?? undefined,
          })));
        } else {
          setRoutingOrderIndices(null);
          setByIndexRows([]);
        }

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
      }));
    }
    if (routingOrderIndices && routingOrderIndices.length === timeline.length) {
      return routingOrderIndices.map((i) => timeline[i]);
    }
    return timeline;
  }, [timeline, routingOrderIndices, households.length, byIndexRows]);

  /* ------------ visual time window (based on ETA; include drive-from-depot so segment is proportional) ------------ */
  const t0 = useMemo(() => {
    const firstEta =
      displayTimeline
        .map((t, i) => (t?.eta ? DateTime.fromISO(t.eta) : null))
        .filter(Boolean)
        .sort((a: any, b: any) => a!.toMillis() - b!.toMillis())[0] || null;
    const firstHouseholdStart =
      displayHouseholds[0]?.startIso ?? displayHouseholds[0]?.primary?.effectiveWindow?.startIso;
    const anchor =
      firstEta ?? (firstHouseholdStart ? DateTime.fromISO(firstHouseholdStart) : null);
    const base = anchor ?? DateTime.fromISO(date).set({ hour: 8, minute: 30 });
    // Start timeline early enough so "drive from depot" (depotToFirstSec) fits proportionally above first block
    const depotMin = depotToFirstSec != null && depotToFirstSec > 0
      ? Math.ceil(depotToFirstSec / 60)
      : 0;
    return base.minus({ minutes: depotMin + 10 }).startOf('minute');
  }, [displayTimeline, displayHouseholds, date, depotToFirstSec]);

  const tEnd = useMemo(() => {
    // last ETD if present; else last scheduled end; else +4h
    const lastEtd =
      displayTimeline
        .map((t) => (t?.etd ? DateTime.fromISO(t.etd) : null))
        .filter(Boolean)
        .sort((a: any, b: any) => b!.toMillis() - a!.toMillis())[0] || null;
    const lastSchedEnd = displayHouseholds[displayHouseholds.length - 1]?.endIso
      ? DateTime.fromISO(displayHouseholds[displayHouseholds.length - 1].endIso!)
      : null;
    const end = lastEtd ?? lastSchedEnd ?? t0.plus({ hours: 4 });
    return end.plus({ minutes: 30 });
  }, [displayTimeline, displayHouseholds, t0]);

  const totalMin = Math.max(60, Math.round(tEnd.diff(t0).as('minutes')));

  /* ------------ hour tick marks ------------ */
  const hours = useMemo(() => {
    const out: { top: number; label: string }[] = [];
    let h = t0.startOf('hour');
    while (h <= tEnd) {
      out.push({
        top: Math.max(0, Math.round(h.diff(t0).as('minutes'))) * PPM,
        label: h.toFormat('h a'),
      });
      h = h.plus({ hours: 1 });
    }
    return out;
  }, [t0, tEnd]);

  /* ------------ derive ETD (from timeline) ------------ */
  const etdByIndex = useMemo(() => displayTimeline.map((t) => t?.etd ?? null), [displayTimeline]);

  /* ------------ compute drive-to-next minutes (server between if provided) ------------ */
  const driveBetweenMin = useMemo(() => {
    const N = displayHouseholds.length;
    if (N <= 1) return [] as number[];
    const firstIsBlock =
      (displayHouseholds[0] as any)?.isPersonalBlock === true ||
      (displayHouseholds[0] as any)?.isNoLocation === true;
    // Prefer server driveSeconds if shape matches between segments
    if (Array.isArray(driveSecondsArr)) {
      if (driveSecondsArr.length === N - 1) {
        return driveSecondsArr.map((s) => Math.max(0, Math.round((s || 0) / 60)));
      } else if (driveSecondsArr.length === N || driveSecondsArr.length === N + 1) {
        const between =
          driveSecondsArr.length === N + 1 ? driveSecondsArr.slice(1, N) : driveSecondsArr.slice(1);
        const result = between.map((s) => Math.max(0, Math.round((s || 0) / 60)));
        // When first stop is block and API sends 0 for block→first appt, use ds[0] so "drive after personal block" shows (same as My Week).
        if (firstIsBlock && N >= 2 && (driveSecondsArr[1] ?? 0) === 0 && (driveSecondsArr[0] ?? 0) > 0) {
          result[0] = Math.max(0, Math.round(driveSecondsArr[0] / 60));
        }
        return result;
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
  }, [displayHouseholds, driveSecondsArr, displayTimeline, etdByIndex]);

  /* ------------ drive bars (placed at ETD(prev), by row order) ------------ */
  const driveBars = useMemo(() => {
    const bars: { top: number; width: number; label: string }[] = [];
    for (let i = 0; i < displayHouseholds.length - 1; i++) {
      const startIso = etdByIndex[i] ?? displayHouseholds[i].endIso;
      if (!startIso) continue;

      const top = Math.max(0, Math.round(DateTime.fromISO(startIso).diff(t0).as('minutes'))) * PPM;
      const mins = Math.max(0, driveBetweenMin[i] || 0);
      const width = Math.max(24, mins * PPM);
      bars.push({ top, width, label: `${mins} min drive` });
    }
    return bars;
  }, [displayHouseholds, etdByIndex, t0, driveBetweenMin]);

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
      const baseTop = Math.max(0, Math.round(s.diff(t0).as('minutes'))) * PPM;
      const durMin = Math.max(1, Math.round(e.diff(s).as('minutes')));
      const height = Math.max(22, durMin * PPM);
      baseTops.push(baseTop);
      heights.push(height);
      if (idx === 0) {
        driveOffsetsPx.push(0);
      } else {
        const prevEndShiftedPx = baseTops[idx - 1] + driveOffsetsPx[idx - 1] + heights[idx - 1];
        const minsJ = driveBetweenMin[idx - 1] ?? 0;
        driveOffsetsPx.push(Math.max(0, prevEndShiftedPx + minsJ * PPM - baseTop));
      }
    }
    return displayHouseholds.map((_, idx) => {
      const top = baseTops[idx] + driveOffsetsPx[idx];
      const height = heights[idx];
      return { top, height };
    });
  }, [displayHouseholds, displayTimeline, t0, appointmentBufferMinutes, driveBetweenMin]);

  // Vertical connectors: when current stop is a block, or segment would overlap current block, place segment below it (same as My Week).
  const vConnectors = useMemo(() => {
    const out: Array<{ top: number; height: number; mins: number }> = [];
    for (let i = 0; i < displayHouseholds.length - 1; i++) {
      const a = blockGeom[i];
      const b = blockGeom[i + 1];
      if (!a || !b) continue;
      const mins = Math.max(0, driveBetweenMin[i] || 0);
      if (mins <= 0) continue;
      const height = Math.max(24, mins * PPM);
      const curIsBlock =
        (displayHouseholds[i] as any)?.isPersonalBlock === true ||
        (displayHouseholds[i] as any)?.isNoLocation === true;
      const wouldOverlap = b.top - height < a.top + a.height;
      const top = curIsBlock || wouldOverlap ? a.top + a.height : b.top - height;
      out.push({ top, height, mins });
    }
    return out;
  }, [blockGeom, displayHouseholds, driveBetweenMin]);

  /* ------------ depot chips ------------ */
  // First segment: "Drive from depot: X min". When first stop is block and ds[1]==0 we draw that drive below the block (vConnectors), so don't show it above the block (same as My Week).
  const fromDepotMin = useMemo(() => {
    if (displayHouseholds.length === 0) return null;
    const firstIsBlock =
      (displayHouseholds[0] as any)?.isPersonalBlock === true ||
      (displayHouseholds[0] as any)?.isNoLocation === true;
    if (
      firstIsBlock &&
      Array.isArray(driveSecondsArr) &&
      driveSecondsArr.length >= 2 &&
      (driveSecondsArr[1] ?? 0) === 0 &&
      (driveSecondsArr[0] ?? 0) > 0
    ) {
      return 0;
    }
    if (depotToFirstSec != null && depotToFirstSec > 0) {
      return Math.max(0, Math.round(depotToFirstSec / 60));
    }
    if (Array.isArray(driveSecondsArr) && driveSecondsArr.length >= displayHouseholds.length) {
      return Math.max(0, Math.round((driveSecondsArr[0] || 0) / 60));
    }
    return null;
  }, [depotToFirstSec, driveSecondsArr, displayHouseholds]);

  const backDepotMin = useMemo(() => {
    if (typeof backToDepotSec === 'number') return Math.max(0, Math.round(backToDepotSec / 60));
    if (Array.isArray(driveSecondsArr) && displayHouseholds.length > 0) {
      if (driveSecondsArr.length === displayHouseholds.length + 1) {
        const last = driveSecondsArr[driveSecondsArr.length - 1] || 0;
        return Math.max(0, Math.round(last / 60));
      }
    }
    return null;
  }, [driveSecondsArr, backToDepotSec, displayHouseholds]);

  // Segment for drive from depot to first stop (drawn before first appointment)
  const fromDepotSegment = useMemo(() => {
    const mins = fromDepotMin;
    if (mins == null || mins <= 0 || displayHouseholds.length === 0) return null;
    const firstBlock = blockGeom[0];
    if (!firstBlock) return null;
    const height = Math.max(24, mins * PPM);
    const top = Math.max(0, firstBlock.top - height);
    const actualHeight = firstBlock.top - top;
    if (actualHeight <= 0) return null;
    return { top, height: actualHeight, mins };
  }, [displayHouseholds, blockGeom, fromDepotMin]);

  // Segment for drive from last stop back to depot (drawn after last appointment)
  // Position from last block's bottom + buffer so it never overlaps the last block
  const backToDepotSegment = useMemo(() => {
    const mins = backDepotMin;
    if (mins == null || mins <= 0 || displayHouseholds.length === 0) return null;
    const lastIdx = displayHouseholds.length - 1;
    const lastBlock = blockGeom[lastIdx];
    if (!lastBlock) return null;
    const bufferPx = appointmentBufferMinutes * PPM;
    const startY = lastBlock.top + lastBlock.height + bufferPx;
    const height = Math.max(24, mins * PPM);
    return { top: startY, height, mins };
  }, [displayHouseholds, blockGeom, backDepotMin, appointmentBufferMinutes]);

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

      const backToDepotIsoFinal = backToDepotIso ?? null;

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

    if (Array.isArray(driveSecondsArr)) {
      if (driveSecondsArr.length === N - 1) {
        apiBetweenSecs = driveSecondsArr;
      } else if (driveSecondsArr.length === N + 1) {
        apiToFirstSec = driveSecondsArr[0] ?? null;
        apiBetweenSecs = driveSecondsArr.slice(1, N) ?? [];
        apiBackSec = driveSecondsArr[N] ?? null;
      } else if (driveSecondsArr.length === N) {
        if (startDepot) {
          apiToFirstSec = driveSecondsArr[0] ?? null;
          apiBetweenSecs = driveSecondsArr.slice(1) ?? [];
        } else if (endDepot) {
          apiBetweenSecs = driveSecondsArr.slice(0, N - 1) ?? [];
          apiBackSec = driveSecondsArr[N - 1] ?? null;
        } else {
          apiBetweenSecs = driveSecondsArr;
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
      backToDepotIso ?? (shiftEndMs > 0 ? DateTime.fromMillis(shiftEndMs).toISO() : null);

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
    driveSecondsArr,
    backToDepotSec,
    backToDepotIso,
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
    <div className="card" style={{ paddingBottom: 16 }}>
      <h2>My Day — Visual</h2>
      <p className="muted">
        {showByDriveTime
          ? 'Blocks are positioned by projected ETA/ETD (drive time).'
          : 'Blocks are positioned by appointment start/end time.'}
      </p>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <span className="muted" style={{ marginLeft: 8 }}>Show blocks by:</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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

      {/* Grid with stats and navigation */}
      <div className="dd-grid" style={{ marginTop: 16 }}>
        {/* Navigate */}
        <div className="card dd-nav">
          <h3>Navigate</h3>
          {links.length === 0 ? (
            <p className="muted">Add at least two stops to generate a route.</p>
          ) : links.length === 1 ? (
            <a className="btn" href={links[0]} target="_blank" rel="noreferrer">
              Open Full Day in Google Maps
            </a>
          ) : (
            <>
              <p className="muted">
                Your route has many stops. We split it into {links.length} segments (Google Maps
                allows up to 25 points per link).
              </p>
              <div className="dd-links">
                {links.map((u, idx) => (
                  <a key={idx} className="btn" href={u} target="_blank" rel="noreferrer">
                    Open Segment {idx + 1}
                  </a>
                ))}
              </div>
            </>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            Tip: On iOS/Android, this opens the Google Maps app if installed; otherwise it opens in
            the browser.
          </p>
        </div>

        {/* Day stats */}
        <div className="card">
          <h3>Day Metrics</h3>
          <div
            className="dd-meta muted"
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
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

      {/* Vertical timeline */}
      <div
        style={{
          position: 'relative',
          marginTop: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          paddingLeft: 72, // room for hour labels
          paddingRight: 16,
          paddingTop: 16,
          paddingBottom: 16,
          height: Math.min(700, totalMin * PPM + 80),
          maxHeight: 700,
          overflowY: 'auto',
          background: '#fff',
        }}
      >
        <div style={{ position: 'relative', height: totalMin * PPM, minHeight: 300 }}>
          {/* hour lines + labels */}
          {hours.map((h, i) => (
            <div key={i}>
              <div
                style={{
                  position: 'absolute',
                  top: h.top,
                  left: 64,
                  right: 8,
                  borderTop: '1px dashed #e5e7eb',
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: h.top,
                  left: 8,
                  width: 48,
                  textAlign: 'right',
                  fontSize: 12,
                  color: '#6b7280',
                  lineHeight: 1,
                  transform: 'translateY(-50%)',
                }}
              >
                {h.label}
              </div>
            </div>
          ))}

          {/* drive from depot: striped segment before first appointment */}
          {fromDepotSegment && (
            <div>
              <div
                style={{
                  position: 'absolute',
                  left: 88,
                  right: 24,
                  top: fromDepotSegment.top,
                  height: fromDepotSegment.height,
                  background: 'repeating-linear-gradient(-45deg, #e5e7eb, #e5e7eb 4px, #d1d5db 4px, #d1d5db 8px)',
                  borderRadius: 8,
                  border: '1px solid #9ca3af',
                  zIndex: 1,
                }}
                title="Drive from depot to first stop"
              />
              <div
                style={{
                  position: 'absolute',
                  top: fromDepotSegment.top + fromDepotSegment.height / 2 - 10,
                  left: 96,
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#e5e7eb',
                  color: '#334155',
                  whiteSpace: 'nowrap',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                }}
                title="Drive from depot to first stop"
              >
                Drive from depot: {fromDepotSegment.mins} min
              </div>
            </div>
          )}

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
            // Also check first patient's type as fallback. Personal blocks are always fixed at their scheduled time.
            const firstPatientType = (h.patients[0]?.type || '').toLowerCase();
            const isFixedTime =
              h.isPersonalBlock ||
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
            const top = geom ? geom.top : Math.max(0, Math.round(DateTime.fromISO(anchorIso).diff(t0).as('minutes'))) * PPM;
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

            const patientsPreview = h.patients
              .map((p) => p.name)
              .slice(0, 3)
              .join(', ');
            const moreCount = Math.max(0, (h.patients?.length || 0) - 3);

            // drive to next chip (uses computed between mins)
            const driveToNext = idx < displayHouseholds.length - 1 ? driveBetweenMin[idx] || 0 : null;

            return (
              <div
                key={h.key}
                onMouseEnter={(ev) => {
                  setHoverCard({
                    key: h.key,
                    x: ev.clientX,
                    y: ev.clientY,
                    client: h.client,
                    address: h.address,
                    durMin,
                    etaIso: isFixedTime ? h.startIso! : (etaIso ?? null),
                    etdIso: isFixedTime ? h.endIso! : (etdIso ?? null),
                    sIso: h.startIso!,
                    eIso: h.endIso!,
                    patients: h.patients || [],
                    clientAlert: h?.clientAlert,
                    isFixedTime,
                    effectiveWindow: h.primary?.effectiveWindow,
                    windowFromByIndex: slotWindow?.windowStartIso && slotWindow?.windowEndIso
                      ? { winStartIso: slotWindow.windowStartIso, winEndIso: slotWindow.windowEndIso }
                      : undefined,
                  });
                }}
                onMouseMove={(ev) => {
                  setHoverCard((prev) =>
                    prev && prev.key === h.key ? { ...prev, x: ev.clientX, y: ev.clientY } : prev
                  );
                }}
                onMouseLeave={() => setHoverCard((prev) => (prev?.key === h.key ? null : prev))}
                style={{
                  position: 'absolute',
                  left: 88,
                  right: 24,
                  top,
                  height,
                  background: h.isPersonalBlock
                    ? '#e5e7eb'
                    : h.isNoLocation
                      ? '#fee2e2'
                      : h.isPreview
                        ? '#ede9fe'
                        : '#e0f2fe',
                  border: `1px solid ${
                    h.isPersonalBlock
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
                title={
                  !h.isPersonalBlock && isFixedTime
                    ? 'FIXED TIME'
                    : `Window: ${DateTime.fromISO(winStartIso).toLocaleString(
                        DateTime.TIME_SIMPLE
                      )} – ${DateTime.fromISO(winEndIso).toLocaleString(DateTime.TIME_SIMPLE)}`
                }
              >
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  #{idx + 1}{' '}
                  {h.isPersonalBlock ? blockDisplayLabel(h.primary) : h.client}
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

                {/* status chips */}
                {h.isPersonalBlock ? (
                  <div
                    title={blockDisplayLabel(h.primary)}
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#000',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {blockDisplayLabel(h.primary)}
                  </div>
                ) : h.isNoLocation ? (
                  <div
                    title="No location — routing not available"
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
                    title="Preview"
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
                ) : isFixedTime ? (
                  <div
                    title="FIXED TIME"
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
                    • {patientsPreview}
                    {moreCount > 0 ? ` +${moreCount} more` : ''}
                  </div>
                )}

                {driveToNext != null && driveToNext > 0 && idx < displayHouseholds.length - 1 && (
                  <div
                    title="Drive to next stop"
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#e5e7eb',
                      color: '#334155',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    → {driveToNext}m
                  </div>
                )}
              </div>
            );
          })}

          {/* drive bars (true drive duration; placed at ETD(prev)) */}
          {/* drive bars (true drive duration; placed at ETD(prev)) */}
          {/* vertical connectors between appointments */}
          {vConnectors.map((c, i) => (
            <div key={i}>
              {/* the vertical line */}
              <div
                style={{
                  position: 'absolute',
                  left: 110, // x-position of the connector (kept constant)
                  width: 2, // thin vertical line
                  top: c.top,
                  height: c.height,
                  background: '#94a3b8',
                  borderRadius: 999,
                  zIndex: 1,
                }}
              />
              {/* centered minutes badge next to the line */}
              <div
                style={{
                  position: 'absolute',
                  top: c.top + c.height / 2 - 10, // center on the line
                  left: 118, // a bit to the right of the line
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#e5e7eb',
                  color: '#334155',
                  whiteSpace: 'nowrap',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                }}
                title="Drive to next stop"
              >
                → {c.mins}m
              </div>
            </div>
          ))}

          {/* drive back to depot: segment after last appointment */}
          {backToDepotSegment && (
            <div>
              <div
                style={{
                  position: 'absolute',
                  left: 88,
                  right: 24,
                  top: backToDepotSegment.top,
                  height: backToDepotSegment.height,
                  background: 'repeating-linear-gradient(-45deg, #e5e7eb, #e5e7eb 4px, #d1d5db 4px, #d1d5db 8px)',
                  borderRadius: 8,
                  border: '1px solid #9ca3af',
                  zIndex: 1,
                }}
                title={
                  backToDepotIso
                    ? `Drive from last stop back to depot — Arrival: ${DateTime.fromISO(backToDepotIso).toLocaleString(DateTime.TIME_SIMPLE)}`
                    : 'Drive from last stop back to depot'
                }
              />
              <div
                style={{
                  position: 'absolute',
                  top: backToDepotSegment.top + backToDepotSegment.height / 2 - 10,
                  left: 96,
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#e5e7eb',
                  color: '#334155',
                  whiteSpace: 'nowrap',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                }}
                title={
                  backToDepotIso
                    ? `Drive back to depot — Arrival: ${DateTime.fromISO(backToDepotIso).toLocaleString(DateTime.TIME_SIMPLE)}`
                    : 'Drive back to depot'
                }
              >
                Drive back to depot: {backToDepotSegment.mins} min
              </div>
            </div>
          )}

          {/* Depot drive chips */}
          {fromDepotMin != null && fromDepotMin > 0 && (
            <div
              title="Drive from depot to first stop"
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                fontSize: 12,
                fontWeight: 800,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#e5e7eb',
                color: '#111827',
                whiteSpace: 'nowrap',
                zIndex: 3,
              }}
            >
              Drive from depot: {fromDepotMin} min
            </div>
          )}

          {backDepotMin != null && (
            <div
              title={
                backToDepotIso
                  ? `Back to depot ETA: ${DateTime.fromISO(backToDepotIso).toLocaleString(
                      DateTime.TIME_SIMPLE
                    )}`
                  : 'Drive back to depot'
              }
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                fontSize: 12,
                fontWeight: 800,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#e5e7eb',
                color: '#111827',
                whiteSpace: 'nowrap',
                zIndex: 3,
              }}
            >
              Drive back to depot: {backDepotMin} min
            </div>
          )}
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

            // Prefer left of cursor; flip right if needed
            let left = hoverCard.x - OFFSET - CARD_MAX_W;
            let top = hoverCard.y - 12;

            if (left < PADDING) left = hoverCard.x + OFFSET;

            const vwH = window.innerHeight;
            const estimatedH = 280;
            if (top + estimatedH > vwH - PADDING) top = vwH - PADDING - estimatedH;
            if (top < PADDING) top = PADDING;

            const s = DateTime.fromISO(hoverCard.sIso);
            const e = DateTime.fromISO(hoverCard.eIso);

            // Window: prefer byIndex row when present, else effectiveWindow, else frontend-calculated
            const ew = hoverCard.effectiveWindow;
            const { winStartIso, winEndIso } = hoverCard.isFixedTime
              ? { winStartIso: hoverCard.sIso, winEndIso: hoverCard.eIso }
              : hoverCard.windowFromByIndex
                ? { winStartIso: hoverCard.windowFromByIndex.winStartIso, winEndIso: hoverCard.windowFromByIndex.winEndIso }
                : ew?.startIso && ew?.endIso
                  ? { winStartIso: ew.startIso, winEndIso: ew.endIso }
                  : adjustedWindowForStart(date, hoverCard.sIso, schedStartIso);
            return (
              <div
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  maxWidth: CARD_MAX_W,
                  minWidth: CARD_MIN_W,
                  maxHeight: '60vh',
                  overflow: 'auto',
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: 14,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
                  fontSize: 15,
                  lineHeight: 1.35,
                  pointerEvents: 'none',
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{hoverCard.client}</div>
                {hoverCard?.clientAlert && (
                  <div style={{ marginBottom: 6, color: '#dc2626' }}>
                    Alert: {hoverCard.clientAlert}
                  </div>
                )}
                <div style={{ color: '#475569', marginBottom: 10 }}>{hoverCard.address}</div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 10 }}>
                  <span>
                    <b>Scheduled:</b> {s.toLocaleString(DateTime.TIME_SIMPLE)} –{' '}
                    {e.toLocaleString(DateTime.TIME_SIMPLE)}
                  </span>
                  <span>
                    <b>Duration:</b> {hoverCard.durMin} min
                  </span>
                  <span>
                    <b>ETA/ETD:</b>{' '}
                    {hoverCard.etaIso
                      ? `${DateTime.fromISO(hoverCard.etaIso).toLocaleString(DateTime.TIME_SIMPLE)} – ${
                          hoverCard.etdIso
                            ? DateTime.fromISO(hoverCard.etdIso).toLocaleString(
                                DateTime.TIME_SIMPLE
                              )
                            : '—'
                        }`
                      : '—'}
                  </span>
                  <span>
                    <b>Window:</b>{' '}
                    {hoverCard.isFixedTime ? (
                      <strong style={{ color: '#dc2626' }}>FIXED TIME</strong>
                    ) : (
                      <>
                        {DateTime.fromISO(winStartIso).toLocaleString(DateTime.TIME_SIMPLE)} –{' '}
                        {DateTime.fromISO(winEndIso).toLocaleString(DateTime.TIME_SIMPLE)}
                      </>
                    )}
                  </span>
                  {backToDepotIso && (
                    <span>
                      <b>Back to depot:</b>{' '}
                      {DateTime.fromISO(backToDepotIso).toLocaleString(DateTime.TIME_SIMPLE)}
                    </span>
                  )}
                </div>

                {!!hoverCard.patients?.length && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Patients</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {hoverCard.patients.map((p, i) => (
                        <li key={i} style={{ marginBottom: 6 }}>
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
    </div>
  );
}
