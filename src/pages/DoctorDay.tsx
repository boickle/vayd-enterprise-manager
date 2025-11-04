// src/pages/DoctorDay.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { buildGoogleMapsLinksForDay, type Stop } from '../utils/maps';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import {
  fetchDoctorDay,
  type DoctorDayAppt,
  type Depot,
  type DoctorDayResponse,
} from '../api/appointments';
import { useAuth } from '../auth/useAuth';
import './DoctorDay.css';
import { fetchEtas } from '../api/routing';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { reverseGeocode } from '../api/geo';
import { formatHM, colorForWhitespace, colorForHDRatio, colorForDrive } from '../utils/statsFormat';

/* =========================================================================
   Public props
   ========================================================================= */
export type DoctorDayProps = {
  readOnly?: boolean;
  initialDate?: string; // YYYY-MM-DD
  initialDoctorId?: string;
  virtualAppt?: {
    date: string;
    insertionIndex: number;
    suggestedStartIso: string;
    serviceMinutes: number;
    clientName?: string;
    lat?: number;
    lon?: number;
    address1?: string;
    city?: string;
    state?: string;
    zip?: string;
    projectedDriveSeconds?: number;
    currentDriveSeconds?: number;
    workStartLocal?: string;
    effectiveEndLocal?: string;
    bookedServiceSeconds?: number;
    whitespaceAfterBookingSeconds?: number;
  };
};

/* =========================================================================
   Small utils
   ========================================================================= */
function str(obj: unknown, key: string): string | undefined {
  const v = (obj as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function num(obj: unknown, key: string): number | undefined {
  const v = (obj as Record<string, unknown> | null)?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; response?: { data?: { message?: string } } };
    return e.response?.data?.message ?? e.message ?? 'Failed to load';
  }
  return 'Failed to load';
}
function getStartISO(a: DoctorDayAppt): string | undefined {
  return str(a, 'appointmentStart') ?? str(a, 'scheduledStartIso') ?? str(a, 'startIso');
}
function getEndISO(a: DoctorDayAppt): string | undefined {
  return str(a, 'appointmentEnd') ?? str(a, 'scheduledEndIso') ?? str(a, 'endIso');
}
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
function formatAddress(a: DoctorDayAppt) {
  const address1 = str(a, 'address1');
  const city = str(a, 'city');
  const state = str(a, 'state');
  const zip = str(a, 'zip');
  const line = [address1, [city, state].filter(Boolean).join(', '), zip]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+,/g, ',');
  if (line) return line;
  const freeForm =
    str(a as any, 'address') ?? str(a as any, 'addressStr') ?? str(a as any, 'fullAddress');
  if (freeForm) return freeForm;
  const lat = num(a as any, 'lat');
  const lon = num(a as any, 'lon');
  if (typeof lat === 'number' && typeof lon === 'number') {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  return 'Address not available';
}
function eightThirtyIsoFor(date: string): string {
  return DateTime.fromISO(date).set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toISO()!;
}
function tenThirtyIsoFor(date: string): string {
  return DateTime.fromISO(date).set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toISO()!;
}
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

/* =========================================================================
   Types
   ========================================================================= */
// add these optional fields
type PatientBadge = {
  name: string;
  pimsId?: string | null;
  status?: string | null;
  startIso?: string | null;
  endIso?: string | null;
  apptTypeName?: string | null;
  description?: string | null;
  recordStatus?: string | null;
  alerts?: string | null;
};

type Household = {
  key: string;
  primary: DoctorDayAppt;
  addressDisplay: string;
  lat: number;
  lon: number;
  startIso?: string | null;
  endIso?: string | null;
  patients: PatientBadge[];
  isPreview?: boolean;
  isNoLocation?: boolean;
  isPersonalBlock?: boolean;
};
/** one row per rendered household */
type DisplaySlot = { eta?: string | null; etd?: string | null };

/* =========================================================================
   Component
   ========================================================================= */
export default function DoctorDay({
  readOnly,
  initialDate,
  initialDoctorId,
  virtualAppt,
}: DoctorDayProps) {
  const { userEmail } = useAuth() as { userEmail?: string };

  // state
  const [date, setDate] = useState<string>(() => initialDate || DateTime.local().toISODate() || '');
  const [appts, setAppts] = useState<DoctorDayAppt[]>([]);
  const [startDepot, setStartDepot] = useState<Depot | null>(null);
  const [endDepot, setEndDepot] = useState<Depot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // routing
  const [driveSecondsArr, setDriveSecondsArr] = useState<number[] | null>(null);
  const [backToDepotSec, setBackToDepotSec] = useState<number | null>(null);
  const [backToDepotIso, setBackToDepotIso] = useState<string | null>(null);
  const [etaErr, setEtaErr] = useState<string | null>(null);

  // authoritative display timeline (index-aligned to households)
  const [timeline, setTimeline] = useState<DisplaySlot[]>([]);

  // providers
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(initialDoctorId || '');
  const didInitDoctor = useRef(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersErr, setProvidersErr] = useState<string | null>(null);

  // schedule bounds (optional)
  const [schedStartIso, setSchedStartIso] = useState<string | null>(null);
  const [schedEndIso, setSchedEndIso] = useState<string | null>(null);

  // pretty depot addresses
  const [startDepotAddr, setStartDepotAddr] = useState<string | null>(null);
  const [endDepotAddr, setEndDepotAddr] = useState<string | null>(null);

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

  /* ---------- Load providers ---------- */
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
      } catch (e) {
        if (on) setProvidersErr(extractErrorMessage(e));
      } finally {
        if (on) setProvidersLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [userEmail]);

  useEffect(() => {
    if (didInitDoctor.current || !providers.length || !userEmail) return;
    const me = providers.find(
      (p: any) => (p?.email || '').toLowerCase() === userEmail.toLowerCase()
    );
    if (me?.id != null && !initialDoctorId) {
      setSelectedDoctorId(String(me.id));
      didInitDoctor.current = true;
    }
  }, [providers, userEmail, initialDoctorId]);

  /* ---------- Load the day (+ optional preview appt) ---------- */
  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const resp: DoctorDayResponse = await fetchDoctorDay(date, selectedDoctorId || undefined);
        if (!on) return;

        const sorted = [...resp.appointments].sort((a, b) => {
          const sa = getStartISO(a);
          const sb = getStartISO(b);
          const ta = sa ? DateTime.fromISO(sa).toMillis() : 0;
          const tb = sb ? DateTime.fromISO(sb).toMillis() : 0;
          return ta - tb;
        });

        const finalAppts = (() => {
          if (!virtualAppt || virtualAppt.date !== date) return sorted;
          const start = DateTime.fromISO(virtualAppt.suggestedStartIso);
          const end = start.plus({ minutes: Math.max(0, virtualAppt.serviceMinutes || 0) });
          const startIso = start.toISO();
          const endIso = end.toISO();

          let lat = virtualAppt.lat;
          let lon = virtualAppt.lon;
          if ((lat == null || lon == null) && sorted.length > 0) {
            const mid = sorted[Math.floor(sorted.length / 2)];
            lat = (mid as any)?.lat;
            lon = (mid as any)?.lon;
          }

          const previewAppt: DoctorDayAppt = {
            id: `virtual-${start.toMillis()}`,
            clientName: virtualAppt.clientName || 'New Appointment',
            ...(lat != null && lon != null ? { lat, lon } : {}),
            address1: virtualAppt.address1 ?? '',
            city: virtualAppt.city ?? '',
            state: virtualAppt.state ?? '',
            zip: virtualAppt.zip ?? '',
            appointmentType: 'Preview',
            confirmStatusName: 'Proposed',
            statusName: 'Proposed',
            appointmentStart: startIso,
            appointmentEnd: endIso,
            scheduledStartIso: startIso,
            scheduledEndIso: endIso,
            startIso,
            endIso,
            providerPimsId:
              selectedDoctorId || initialDoctorId || (sorted[0] as any)?.providerPimsId,
            providerName: (sorted[0] as any)?.providerName ?? (sorted[0] as any)?.doctorName ?? '',
            mins: Math.max(1, Math.round(end.diff(start).as('minutes'))),
            isPreview: true as any,
          } as any;

          const idx = Math.max(0, Math.min(sorted.length, virtualAppt.insertionIndex));
          return [...sorted.slice(0, idx), previewAppt, ...sorted.slice(idx)];
        })();

        setAppts(finalAppts);
        setStartDepot(resp.startDepot ?? null);
        setEndDepot(resp.endDepot ?? null);

        const schedStart =
          str(resp as any, 'startDepotTime') ??
          str(resp as any, 'workdayStartIso') ??
          str(resp as any, 'shiftStartIso') ??
          (resp as any)?.schedule?.startIso ??
          (resp as any)?.schedule?.start ??
          null;
        const schedEnd =
          str(resp as any, 'endDepotTime') ??
          str(resp as any, 'workdayEndIso') ??
          str(resp as any, 'shiftEndIso') ??
          (resp as any)?.schedule?.endIso ??
          (resp as any)?.schedule?.end ??
          null;
        setSchedStartIso(schedStart);
        setSchedEndIso(schedEnd);

        // make sure provider choice stays in sync with what the day shows
        const firstAppt = finalAppts[0];
        const inferredId =
          (firstAppt as any)?.primaryProviderPimsId ??
          (firstAppt as any)?.providerPimsId ??
          (firstAppt as any)?.doctorId ??
          null;
        const inferredName =
          (firstAppt as any)?.providerName ??
          (firstAppt as any)?.doctorName ??
          (firstAppt as any)?.primaryProviderName ??
          'My Schedule';
        if (inferredId != null) {
          setProviders((prev) => {
            const exists = prev.some((p) => String(p.id) === String(inferredId));
            return exists ? prev : [...prev, { id: inferredId, name: inferredName } as any];
          });
        }
        if (
          !didInitDoctor.current &&
          !selectedDoctorId &&
          (initialDoctorId || inferredId != null)
        ) {
          setSelectedDoctorId(String(initialDoctorId || inferredId));
          didInitDoctor.current = true;
        }
      } catch (e) {
        if (on) setErr(extractErrorMessage(e));
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [date, selectedDoctorId, initialDoctorId, virtualAppt]);

  /* ---------- Group into households (lat/lon) ---------- */
  const households: Household[] = useMemo(() => {
    const map = new Map<string, Household>();
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
      const key = hasGeo
        ? `${lat.toFixed(6)},${lon.toFixed(6)}`
        : addrKey
          ? `addr:${addrKey}`
          : `noloc:${idPart}`;

      const patientName =
        str(a, 'patientName') ??
        str(a as any, 'petName') ??
        str(a as any, 'animalName') ??
        'Patient';

      const badge: PatientBadge = {
        name: patientName,
        pimsId: str(a, 'patientPimsId') ?? null,
        status: str(a, 'confirmStatusName') ?? null,
        startIso: getStartISO(a) ?? null,
        endIso: getEndISO(a) ?? null,
        // NEW: per-pet fields
        apptTypeName:
          str(a, 'appointmentType') ??
          str(a, 'appointmentTypeName') ??
          str(a, 'serviceName') ??
          str(a as any, 'apptTypeName') ??
          'Appointment',
        description: str(a as any, 'description') ?? str(a as any, 'visitReason') ?? null,
        recordStatus: str(a, 'statusName') ?? null,
        alerts: str(a, 'alerts') ?? null,
      };

      const apptIsPreview = (a as any)?.isPreview === true;
      const isPersonalBlock = (a as any)?.isPersonalBlock === true;

      if (!map.has(key)) {
        map.set(key, {
          key,
          primary: a,
          addressDisplay: formatAddress(a),
          lat,
          lon,
          startIso: getStartISO(a) ?? null,
          endIso: getEndISO(a) ?? null,
          patients: [badge],
          isPreview: apptIsPreview,
          isNoLocation: !hasGeo,
          isPersonalBlock,
        });
      } else {
        const h = map.get(key)!;
        if (!isPersonalBlock) {
          const exists = h.patients.some(
            (p) =>
              (badge.pimsId && p.pimsId === badge.pimsId) ||
              (!badge.pimsId && p.name === badge.name && p.startIso === badge.startIso)
          );
          if (!exists) h.patients.push(badge);
        }
        if (apptIsPreview) h.isPreview = true;

        const hStart = h.startIso ? DateTime.fromISO(h.startIso) : null;
        const aStart = badge.startIso ? DateTime.fromISO(badge.startIso) : null;
        if (aStart && (!hStart || aStart < hStart)) h.startIso = aStart.toISO();

        const hEnd = h.endIso ? DateTime.fromISO(h.endIso) : null;
        const aEnd = badge.endIso ? DateTime.fromISO(badge.endIso) : null;
        if (aEnd && (!hEnd || aEnd > hEnd)) h.endIso = aEnd.toISO();
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const ta = a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0;
      const tb = b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0;
      return ta - tb;
    });
  }, [appts]);

  /* =========================================================================
     ROUTING: Make server ETA/ETD authoritative (no local overrides)
     ========================================================================= */
  useEffect(() => {
    let on = true;

    (async () => {
      setEtaErr(null);
      setDriveSecondsArr(null);
      setBackToDepotSec(null);
      setBackToDepotIso(null);
      setTimeline(households.map(() => ({ eta: null, etd: null })));

      if (households.length === 0) return;

      // Keep the original order (do NOT filter out blocks anymore)
      const ordered = households.map((h, viewIdx) => ({ h, viewIdx }));

      // If there are zero routables, we still want blocks stamped, so keep going

      // Pick doctorId from the first thing with a primary, else fallback
      const firstWithPrimary = ordered.find((o) => o.h.primary) ?? ordered[0];
      const inferredDoctorId =
        (firstWithPrimary?.h.primary as any)?.primaryProviderPimsId ||
        (firstWithPrimary?.h.primary as any)?.providerPimsId ||
        (firstWithPrimary?.h.primary as any)?.doctorId ||
        selectedDoctorId ||
        '';

      // Build payload: include ALL rows, but only provide lat/lon when routable
      const householdsPayload = ordered.map(({ h }) => {
        const isBlock = (h as any)?.isPersonalBlock === true;
        const isRoutable =
          !isBlock && !h.isNoLocation && Number.isFinite(h.lat) && Number.isFinite(h.lon);

        // EtaHouseholdInput requires numbers for lat/lon → always provide them.
        const lat = Number.isFinite(h.lat) ? (h.lat as number) : 0;
        const lon = Number.isFinite(h.lon) ? (h.lon as number) : 0;

        return {
          key: h.key,
          lat, // always present
          lon, // always present
          startIso: h.startIso ?? null,
          endIso: h.endIso ?? null,
          ...(isBlock
            ? {
                isPersonalBlock: true,
                windowStartIso: h.startIso ?? null,
                windowEndIso: h.endIso ?? null,
              }
            : {}),
          isAlternateStop: (h.primary as any)?.isAlternateStop ?? undefined,
          alternateAddressText: (h.primary as any)?.alternateAddressText ?? undefined,
          appointmentTypeName:
            (h.primary as any)?.appointmentTypeName ??
            (h.primary as any)?.appointmentType ??
            undefined,
        } as any; // keeps compile-time happy if EtaHouseholdInput isn't imported here
      });

      const payload = {
        doctorId: inferredDoctorId,
        date,
        households: householdsPayload,
        startDepot: startDepot ? { lat: startDepot.lat, lon: startDepot.lon } : undefined,
        endDepot: endDepot ? { lat: endDepot.lat, lon: endDepot.lon } : undefined,
        useTraffic: false,
      } as any; // or `as EtaRequest` if you can import the type

      try {
        const result: any = await fetchEtas(payload);
        if (!on) return;

        const tl: DisplaySlot[] = households.map(() => ({ eta: null, etd: null }));
        const serverETA: boolean[] = households.map(() => false);
        const serverETD: boolean[] = households.map(() => false);
        const validIso = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);

        // ----------------------------
        // 1) byIndex is now 1:1 with "ordered" (includes blocks)
        // ----------------------------
        const byIndex: Array<{ etaIso?: string; etdIso?: string }> = Array.isArray(result?.byIndex)
          ? result.byIndex
          : [];

        for (let i = 0; i < ordered.length; i++) {
          const { viewIdx } = ordered[i];
          const row = byIndex[i] || {};
          if (validIso(row.etaIso)) {
            tl[viewIdx].eta = row.etaIso!;
            serverETA[viewIdx] = true;
          }
          if (validIso(row.etdIso)) {
            tl[viewIdx].etd = row.etdIso!;
            serverETD[viewIdx] = true;
          }
        }

        // ----------------------------
        // 2) Position arrays as a fallback (same length & order as input)
        // ----------------------------
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

        // ----------------------------
        // 3) key maps (only helps for routables that had lat/lon)
        // ----------------------------
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

        // ----------------------------
        // 4) Local fallbacks only where server omitted values
        // ----------------------------
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

          // ETA fallback to window start (skip if it's a personal block — server should have stamped it,
          // but if not, use startIso as arrival)
          if (!tl[viewIdx].eta && h.startIso) {
            const isBlock = (h as any)?.isPersonalBlock === true;
            if (isBlock) {
              tl[viewIdx].eta = h.startIso;
            } else {
              const { winStartIso } = adjustedWindowForStart(date, h.startIso, schedStartIso);
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

        // ----------------------------
        // 5) Monotonic pass — only shift rows whose ETA & ETD are BOTH fallbacks
        // (unchanged logic; still works because tl is full length)
        // ----------------------------
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

        // 6) store drive/depot fields
        setDriveSecondsArr(Array.isArray(result?.driveSeconds) ? result.driveSeconds : null);
        setBackToDepotSec(
          typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null
        );
        setBackToDepotIso(result?.backToDepotIso ?? null);

        if (on) setTimeline(tl);
      } catch (e: any) {
        if (on) {
          setEtaErr(e?.message ?? 'Failed to compute ETAs');
          setBackToDepotSec(null);
          setBackToDepotIso(null);
        }
      }
    })();

    return () => {
      on = false;
    };
  }, [households, startDepot, endDepot, date, selectedDoctorId, schedStartIso]);

  /* ---------- Maps links ---------- */
  const stops: Stop[] = useMemo(
    () =>
      households
        .filter((h) => !h.isNoLocation)
        .map((h) => ({ lat: h.lat, lon: h.lon, label: h.primary.clientName })),
    [households]
  );
  const links = useMemo(
    () =>
      buildGoogleMapsLinksForDay(stops, {
        start: startDepot ?? undefined,
        end: endDepot ?? undefined,
      }),
    [stops, startDepot, endDepot]
  );

  /* ---------- Stats (uses server times if present) ---------- */
  /* ---------- Stats (prefer Routing winner fields; fall back to derivation) ---------- */
  const stats = useMemo(() => {
    if (!households.length) {
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
    const bookedServiceSecFallback = households.reduce((sum, h) => {
      if ((h as any)?.isPersonalBlock === true) return sum;
      if ((h as any)?.isPreview === true) return sum;
      return sum + durSec(h.startIso, h.endIso);
    }, 0);

    // Points (unchanged)
    const points = appts.reduce((total, a) => {
      if ((a as any)?.isPersonalBlock) return total;
      const type = (a?.appointmentType || '').toLowerCase();
      console.log(type, total);
      if (type === 'euthanasia') return total + 2;
      if (type.includes('tech appointment')) return total + 0.5;
      return total + 1;
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

    // If the backend already computed whitespace-after-booking for this option,
    // we can use it directly for the header (most exact match to the card).
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

      // Choose what “Households” means in header:
      //   booked only (consistent with day facts concept)
      const householdMin = Math.round(winnerBookedSec / 60);
      //   or booked + preview (uncomment if you want it to include the new appt)
      // const householdMin = Math.round((winnerBookedSec + previewServiceSec) / 60);

      const whiteMin = Math.round(whiteSec / 60);
      const shiftMin = Math.round(winnerWindowSec / 60);

      const ratioText = driveMin > 0 ? (householdMin / driveMin).toFixed(2) : '—';
      const whitePctText =
        shiftMin > 0 ? `${Math.round((whiteSec / (shiftMin * 60)) * 100)}%` : '—';

      // Back to depot display: keep existing behavior (derived if server didn’t send)
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

    // ---------- Fallback to your existing derivation (when winner fields not present) ----------
    const first = households[0];
    const last = households[households.length - 1];

    const firstArriveMs =
      (timeline[0]?.eta ? DateTime.fromISO(timeline[0].eta!).toMillis() : null) ??
      (first?.startIso ? DateTime.fromISO(first.startIso).toMillis() : 0);

    const lastDur = durSec(last?.startIso ?? null, last?.endIso ?? null);
    const lastEndMs =
      timeline[timeline.length - 1]?.etd != null
        ? DateTime.fromISO(timeline[timeline.length - 1].etd!).toMillis()
        : timeline[timeline.length - 1]?.eta != null
          ? DateTime.fromISO(timeline[timeline.length - 1].eta!).toMillis() + lastDur * 1000
          : last?.endIso
            ? DateTime.fromISO(last.endIso).toMillis()
            : 0;

    const N = households.length;
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
        : households.slice(1).reduce((s, curr, i) => {
            const prev = households[i];
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
    households,
    appts,
    timeline,
    startDepot,
    endDepot,
    driveSecondsArr,
    backToDepotSec,
    backToDepotIso,
    schedStartIso,
    schedEndIso,
    virtualAppt, // <-- important for winner fields
    date,
  ]);

  /* ---------- UI helpers ---------- */
  function fmtTime(iso?: string | null) {
    if (!iso) return '';
    return DateTime.fromISO(iso).toLocaleString(DateTime.TIME_SIMPLE);
  }
  function windowTextFromStart(iso?: string | null) {
    if (!iso) return '';
    const { winStartIso, winEndIso } = adjustedWindowForStart(date, iso, schedStartIso);
    const start = DateTime.fromISO(winStartIso).toLocaleString(DateTime.TIME_SIMPLE);
    const end = DateTime.fromISO(winEndIso).toLocaleString(DateTime.TIME_SIMPLE);
    return `${start} – ${end}`;
  }
  function pillClass(status?: string | null) {
    const s = (status || '').trim().toLowerCase();
    if (s.includes('pre-appt email')) return 'pill pill--danger';
    if (s.includes('client submitted pre-appt form')) return 'pill pill--success';
    return 'pill pill--neutral';
  }

  const driveColor = colorForDrive(stats.driveMin);
  const whitePct =
    Number.isFinite(stats.shiftMin) && stats.shiftMin > 0
      ? (stats.whiteMin / stats.shiftMin) * 100
      : 0;
  const whiteColor = colorForWhitespace(whitePct);

  // ✅ numeric ratio for color; text stays from stats.ratioText
  const ratioNum = stats.driveMin > 0 ? stats.householdMin / stats.driveMin : Infinity;
  const hdColor = colorForHDRatio(ratioNum);

  const whitePctText = Number.isFinite(whitePct) ? `${whitePct.toFixed(0)}%` : '—';

  const points = appts.reduce((total, a) => {
    if ((a as any)?.isPersonalBlock) return total;
    const type = (a?.appointmentType || '').toLowerCase();
    console.log(type, total);
    if (type === 'euthanasia') return total + 2;
    if (type.includes('tech appointment')) return total + 0.5;
    return total + 1;
  }, 0);

  /* ---------- Render ---------- */
  return (
    <div className="dd-section">
      {/* Header */}
      <div className="card">
        <h2>My Day</h2>
        <p className="muted">
          {userEmail ? `Signed in as ${userEmail}` : 'Signed in'} — choose a date and provider.
        </p>

        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted" htmlFor="dd-date">
            Date
          </label>
          <input
            id="dd-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={readOnly}
          />

          <label className="muted" htmlFor="dd-doctor">
            Provider
          </label>
          <select
            id="dd-doctor"
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

          {providersErr && (
            <div className="error" style={{ marginTop: 4 }}>
              {providersErr}
            </div>
          )}
        </div>

        {(startDepot || endDepot) && (
          <div className="dd-meta muted" style={{ marginTop: 6 }}>
            {startDepot && (
              <>
                Start depot:{' '}
                {startDepotAddr ?? `${startDepot.lat.toFixed(5)}, ${startDepot.lon.toFixed(5)}`}{' '}
                ·{' '}
              </>
            )}
            {endDepot && (
              <>
                End depot:{' '}
                {endDepotAddr ?? `${endDepot.lat.toFixed(5)}, ${endDepot.lon.toFixed(5)}`}
              </>
            )}
          </div>
        )}

        {/* Day stats */}
        <div
          className="dd-meta muted"
          style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}
        >
          <span>
            <strong>Points:</strong> {points}
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
            {stats.shiftMin > 0 && <> ({whitePctText})</>}
          </span>
          <span className="muted">Shift: {formatHM(stats.shiftMin)}</span>
          <span>
            <strong>Back to depot:</strong> {fmtTime(stats.backToDepotIso) || '—'}
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="dd-grid">
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

        {/* Households */}
        <div className="card">
          <h3>Households ({households.length})</h3>
          {loading && <p>Loading…</p>}
          {err && <p className="error">{err}</p>}
          {etaErr && <p className="error">{etaErr}</p>}
          {!loading && !err && households.length === 0 && (
            <p className="muted">No appointments for this date.</p>
          )}

          {households.length > 0 && (
            <ul className="dd-list">
              {households.map((h, i) => {
                const a = h.primary;
                const clientHref = str(a, 'clientPimsId')
                  ? evetClientLink(str(a, 'clientPimsId') as string)
                  : undefined;

                let lengthText: string | null = null;
                if (h.startIso && h.endIso) {
                  const mins = Math.round(
                    DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
                  );
                  if (mins > 0) lengthText = `${mins}m`;
                }

                const etaIso = timeline[i]?.eta ?? null;
                const etdIso = timeline[i]?.etd ?? null;

                return (
                  <li
                    key={h.key}
                    className="dd-item"
                    style={
                      h.isPersonalBlock
                        ? {
                            background: '#f3f4f6', // light gray
                            border: '1px solid #9ca3af', // gray-400
                            borderRadius: 8,
                            padding: 12,
                            color: '#111827', // near-black text
                            opacity: 0.65, // greyed out feel
                          }
                        : h.isNoLocation
                          ? {
                              background: '#fee2e2',
                              border: '1px solid #ef4444',
                              borderRadius: 8,
                              padding: 12,
                            }
                          : h.isPreview
                            ? {
                                background: '#f3e8ff',
                                border: '1px solid #a855f7',
                                borderRadius: 8,
                                padding: 12,
                              }
                            : undefined
                    }
                  >
                    {/* Title row */}
                    <div
                      className="dd-top"
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      {clientHref ? (
                        <>
                          <a
                            className="dd-title link-strong"
                            href={clientHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            #{i + 1} {a.clientName}
                          </a>
                          {a?.clientAlert && (
                            <div style={{ color: '#dc2626' }}>Alert: {a.clientAlert}</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="dd-title">
                            #{i + 1} {a.clientName}
                          </div>
                        </>
                      )}

                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        {h.isPersonalBlock ? (
                          <span
                            style={{
                              background: '#000',
                              color: '#fff',
                              fontWeight: 700,
                              fontSize: 12,
                              padding: '2px 8px',
                              borderRadius: 999,
                            }}
                          >
                            Personal Block
                          </span>
                        ) : (
                          h.isNoLocation && (
                            <span
                              style={{
                                background: '#fee2e2',
                                color: '#b91c1c',
                                fontWeight: 700,
                                fontSize: 12,
                                padding: '2px 8px',
                                borderRadius: 999,
                              }}
                            >
                              No location
                            </span>
                          )
                        )}
                        {h.isPreview && (
                          <span
                            style={{
                              background: '#ede9fe',
                              color: '#6b21a8',
                              fontWeight: 700,
                              fontSize: 12,
                              padding: '2px 8px',
                              borderRadius: 999,
                            }}
                          >
                            Preview
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Address */}
                    <div className="dd-address muted">{h.addressDisplay}</div>

                    {h.isNoLocation && (
                      <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 600 }}>
                        No location — routing not available
                      </div>
                    )}

                    {/* Meta */}
                    {(h.startIso || h.endIso) && (
                      <div className="dd-meta-vertical" style={{ marginTop: 6, lineHeight: 1.4 }}>
                        {lengthText && (
                          <div className="muted">
                            <strong>Scheduled Appointment Duration:</strong> {lengthText}
                          </div>
                        )}
                        {h.startIso && (
                          <div>
                            <strong>Scheduled Start:</strong> {fmtTime(h.startIso)}
                            {!h.isPersonalBlock && (
                              <>
                                {' '}
                                <strong>Window:</strong> {windowTextFromStart(h.startIso)}
                              </>
                            )}
                          </div>
                        )}

                        {h.startIso && etaIso && (
                          <div>
                            <strong>Projected ETA:</strong> {fmtTime(etaIso)}
                            {etdIso && (
                              <>
                                {' '}
                                <strong>Projected ETD:</strong> {fmtTime(etdIso)}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {!h.isPersonalBlock && (
                      <div className="dd-address muted">{h.addressDisplay}</div>
                    )}
                    {h.isPersonalBlock && (
                      <div className="dd-address muted">
                        Provider not available during this time
                      </div>
                    )}

                    {/* Patients */}
                    {h.patients.length > 0 && (
                      <div className="dd-pets">
                        <div className="dd-pets-label">Patients:</div>
                        <ul className="dd-patients-list">
                          {h.patients.map((p, idx2) => {
                            const href = p.pimsId ? evetPatientLink(p.pimsId) : undefined;
                            const apptType =
                              (p as any)?.apptTypeName ??
                              str(h.primary, 'appointmentType') ??
                              str(h.primary, 'appointmentTypeName') ??
                              str(h.primary, 'serviceName') ??
                              'Appointment';
                            const apptDesc =
                              (p as any)?.description ??
                              str(h.primary, 'description') ??
                              str(h.primary, 'visitReason') ??
                              '';
                            return (
                              <li key={`${p.pimsId || p.name}-${idx2}`} className="dd-patient-item">
                                {href ? (
                                  <a
                                    className="link-strong"
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {p.name}
                                  </a>
                                ) : (
                                  <span>{p.name}</span>
                                )}{' '}
                                {p?.alerts ? (
                                  <>
                                    {' '}
                                    — <strong>Alert:</strong>{' '}
                                    <span style={{ color: '#dc2626' }}>{p.alerts}</span>
                                  </>
                                ) : null}
                                <ul className="dd-patient-sublist">
                                  <li>
                                    <strong>{apptType}:</strong>
                                    {apptDesc ? <> — {apptDesc}</> : null}
                                  </li>
                                  <li>
                                    <strong>Status:</strong>{' '}
                                    {p.status ? (
                                      <span className={pillClass(p.status)}>{p.status}</span>
                                    ) : (
                                      '—'
                                    )}
                                  </li>
                                  <li>
                                    <strong>Records Status:</strong>{' '}
                                    {p.recordStatus ? (
                                      <span className={pillClass(p.recordStatus)}>
                                        {p.recordStatus}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </li>
                                </ul>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
