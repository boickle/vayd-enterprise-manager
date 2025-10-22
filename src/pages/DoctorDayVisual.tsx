// src/pages/DoctorDayVisual.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import type { DoctorDayProps } from './DoctorDay';
import {
  fetchDoctorDay,
  type DoctorDayAppt,
  type DoctorDayResponse,
  type Depot,
} from '../api/appointments';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchEtas } from '../api/routing';
import { useAuth } from '../auth/useAuth';

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

/* ----------------- patient extraction ----------------- */
type PatientBadge = {
  name: string;
  pimsId?: string | null;
  status?: string | null;
  type?: string | null;
  desc?: string | null;
  startIso?: string | null;
  endIso?: string | null;
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
  };
}

/* ----------------- data types ----------------- */
type Household = {
  key: string;
  client: string;
  address: string;
  lat: number;
  lon: number;
  startIso?: string | null;
  endIso?: string | null;
  isNoLocation?: boolean;
  isPreview?: boolean;
  isPersonalBlock?: boolean;
  patients: PatientBadge[];
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
type DisplaySlot = { eta?: string | null; etd?: string | null };

export default function DoctorDayVisual({
  readOnly,
  initialDate,
  initialDoctorId,
  virtualAppt,
}: DoctorDayProps) {
  const { userEmail } = useAuth() as { userEmail?: string };

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
  const [backToDepotSec, setBackToDepotSec] = useState<number | null>(null);
  const [backToDepotIso, setBackToDepotIso] = useState<string | null>(null);
  const [etaErr, setEtaErr] = useState<string | null>(null);

  // schedule bounds for visual work start
  const [schedStartIso, setSchedStartIso] = useState<string | null>(null);
  const [schedEndIso, setSchedEndIso] = useState<string | null>(null);

  // hover card (global, mouse-anchored)
  const [hoverCard, setHoverCard] = useState<{
    key: string;
    x: number;
    y: number;
    client: string;
    address: string;
    durMin: number;
    etaIso?: string | null;
    etdIso?: string | null;
    sIso: string;
    eIso: string;
    patients: PatientBadge[];
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
    if (didInitDoctor.current || !providers.length || !userEmail || initialDoctorId) return;
    const me = providers.find(
      (p: any) => (p?.email || '').toLowerCase() === userEmail.toLowerCase()
    );
    if (me?.id != null) {
      setSelectedDoctorId(String(me.id));
      didInitDoctor.current = true;
    }
  }, [providers, userEmail, initialDoctorId]);

  /* ------------ load day (with optional preview injection) ------------ */
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
          return (
            (sa ? DateTime.fromISO(sa).toMillis() : 0) - (sb ? DateTime.fromISO(sb).toMillis() : 0)
          );
        });

        // inject preview if provided
        const final = (() => {
          if (!virtualAppt || virtualAppt.date !== date) return sorted;
          const start = DateTime.fromISO(virtualAppt.suggestedStartIso);
          const end = start.plus({ minutes: Math.max(0, virtualAppt.serviceMinutes || 0) });
          const mid = sorted[Math.floor(sorted.length / 2)];
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
          } as any as DoctorDayAppt;
          const idx = Math.max(0, Math.min(sorted.length, virtualAppt.insertionIndex));
          return [...sorted.slice(0, idx), prev, ...sorted.slice(idx)];
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

  /* ------------ group into households + patients (keep personal blocks) ------------ */
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
      const key = hasGeo ? keyFor(lat, lon, 6) : addrKey ? `addr:${addrKey}` : `noloc:${idPart}`;

      const isPersonalBlock = (a as any)?.isPersonalBlock === true;

      const patient = makePatientBadge(a);
      const apptIsPreview = (a as any)?.isPreview === true;

      if (!m.has(key)) {
        m.set(key, {
          key,
          client: (a as any)?.clientName ?? 'Client',
          address: formatAddress(a),
          lat,
          lon,
          startIso: getStartISO(a) ?? null,
          endIso: getEndISO(a) ?? null,
          isNoLocation: !hasGeo,
          isPreview: apptIsPreview,
          isPersonalBlock,
          patients: isPersonalBlock ? [] : [patient],
        });
      } else {
        const h = m.get(key)!;

        // time window expand
        const s = getStartISO(a);
        const e = getEndISO(a);
        const sDt = s ? DateTime.fromISO(s) : null;
        const eDt = e ? DateTime.fromISO(e) : null;
        if (sDt && (!h.startIso || sDt < DateTime.fromISO(h.startIso))) h.startIso = sDt.toISO();
        if (eDt && (!h.endIso || eDt > DateTime.fromISO(h.endIso))) h.endIso = eDt.toISO();

        // mark preview if any appt in household is preview
        if (apptIsPreview) h.isPreview = true;

        // add unique patient (skip for blocks)
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
    return Array.from(m.values()).sort(
      (a, b) =>
        (a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0) -
        (b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0)
    );
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
      setBackToDepotSec(null);
      setBackToDepotIso(null);

      if (households.length === 0) return;

      // Keep the original order (do NOT filter out blocks anymore)
      const ordered = households.map((h, viewIdx) => ({ h, viewIdx }));

      // Pick doctorId from the first appt with provider info; fallback to selection
      const inferredDoctorId =
        (appts[0] as any)?.primaryProviderPimsId ??
        (appts[0] as any)?.providerPimsId ??
        (appts[0] as any)?.doctorId ??
        selectedDoctorId ??
        '';

      // Build payload: include ALL rows, but only provide lat/lon when routable.
      const payload = {
        doctorId: inferredDoctorId,
        date,
        households: ordered.map(({ h }) => {
          const isBlock = h.isPersonalBlock === true;
          const isRoutable =
            !isBlock && !h.isNoLocation && Number.isFinite(h.lat) && Number.isFinite(h.lon);

          return {
            key: h.key,
            ...(isRoutable ? { lat: h.lat, lon: h.lon } : {}),
            startIso: h.startIso ?? null,
            endIso: h.endIso ?? null,
            ...(isBlock
              ? {
                  isPersonalBlock: true,
                  windowStartIso: h.startIso ?? null,
                  windowEndIso: h.endIso ?? null,
                }
              : {}),
            // lightweight hints (optional)
            isAlternateStop: undefined,
            alternateAddressText: undefined,
            appointmentTypeName: undefined,
          };
        }),
        startDepot: startDepot ? { lat: startDepot.lat, lon: startDepot.lon } : undefined,
        endDepot: endDepot ? { lat: endDepot.lat, lon: endDepot.lon } : undefined,
        useTraffic: false,
      };

      try {
        const result: any = await fetchEtas(payload);
        if (!on) return;

        const tl: DisplaySlot[] = households.map(() => ({ eta: null, etd: null }));
        const serverETA: boolean[] = households.map(() => false);
        const serverETD: boolean[] = households.map(() => false);
        const validIso = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);

        // 1) byIndex aligns 1:1 with ordered (includes blocks)
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

          // ETA fallback
          if (!tl[viewIdx].eta && h.startIso) {
            if (h.isPersonalBlock) {
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
          setDriveSecondsArr(null);
          setBackToDepotSec(null);
          setBackToDepotIso(null);
        }
      }
    })();

    return () => {
      on = false;
    };
  }, [households, startDepot, endDepot, date, selectedDoctorId, appts, schedStartIso]);

  /* ------------ visual time window (based on ETA) ------------ */
  const t0 = useMemo(() => {
    const firstEta =
      timeline
        .map((t) => (t?.eta ? DateTime.fromISO(t.eta) : null))
        .filter(Boolean)
        .sort((a: any, b: any) => a!.toMillis() - b!.toMillis())[0] || null;
    const anchor =
      firstEta ?? (households[0]?.startIso ? DateTime.fromISO(households[0].startIso) : null);
    const base = anchor ?? DateTime.fromISO(date).set({ hour: 8, minute: 30 });
    return base.minus({ minutes: 10 }).startOf('minute');
  }, [timeline, households, date]);

  const tEnd = useMemo(() => {
    // last ETD if present; else last scheduled end; else +4h
    const lastEtd =
      timeline
        .map((t) => (t?.etd ? DateTime.fromISO(t.etd) : null))
        .filter(Boolean)
        .sort((a: any, b: any) => b!.toMillis() - a!.toMillis())[0] || null;
    const lastSchedEnd = households[households.length - 1]?.endIso
      ? DateTime.fromISO(households[households.length - 1].endIso!)
      : null;
    const end = lastEtd ?? lastSchedEnd ?? t0.plus({ hours: 4 });
    return end.plus({ minutes: 30 });
  }, [timeline, households, t0]);

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
  const etdByIndex = useMemo(() => timeline.map((t) => t?.etd ?? null), [timeline]);

  /* ------------ compute drive-to-next minutes (server between if provided) ------------ */
  const driveBetweenMin = useMemo(() => {
    const N = households.length;
    if (N <= 1) return [] as number[];
    // Prefer server driveSeconds if shape matches between segments
    if (Array.isArray(driveSecondsArr)) {
      if (driveSecondsArr.length === N - 1) {
        return driveSecondsArr.map((s) => Math.max(0, Math.round((s || 0) / 60)));
      } else if (driveSecondsArr.length === N || driveSecondsArr.length === N + 1) {
        // try to extract between segments heuristically
        const between =
          driveSecondsArr.length === N + 1 ? driveSecondsArr.slice(1, N) : driveSecondsArr.slice(1);
        return between.map((s) => Math.max(0, Math.round((s || 0) / 60)));
      }
    }
    // Fallback: ETA/ETD gaps between consecutive rows
    const out: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const prevETD = etdByIndex[i];
      const nextETA = timeline[i + 1]?.eta ?? null;
      if (prevETD && nextETA) {
        const mins = Math.max(
          0,
          Math.round(DateTime.fromISO(nextETA).diff(DateTime.fromISO(prevETD)).as('minutes'))
        );
        out.push(mins);
      } else {
        // last fallback: scheduled gap
        const prevEnd = households[i].endIso;
        const nextStart = households[i + 1].startIso;
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
  }, [households, driveSecondsArr, timeline, etdByIndex]);

  /* ------------ drive bars (placed at ETD(prev), by row order) ------------ */
  const driveBars = useMemo(() => {
    const bars: { top: number; width: number; label: string }[] = [];
    for (let i = 0; i < households.length - 1; i++) {
      const startIso = etdByIndex[i] ?? households[i].endIso;
      if (!startIso) continue;

      const top = Math.max(0, Math.round(DateTime.fromISO(startIso).diff(t0).as('minutes'))) * PPM;
      const mins = Math.max(0, driveBetweenMin[i] || 0);
      const width = Math.max(24, mins * PPM);
      bars.push({ top, width, label: `${mins} min drive` });
    }
    return bars;
  }, [households, etdByIndex, t0, driveBetweenMin]);

  return (
    <div className="card" style={{ paddingBottom: 16 }}>
      <h2>My Day — Visual</h2>
      <p className="muted">
        Blocks are positioned by <b>projected ETA</b> (server-calculated), not scheduled start.
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
        {providersErr && (
          <div className="error" style={{ marginTop: 4 }}>
            {providersErr}
          </div>
        )}
      </div>

      {loading && <p>Loading…</p>}
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
                  top: h.top - 8,
                  left: 8,
                  width: 48,
                  textAlign: 'right',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                {h.label}
              </div>
            </div>
          ))}

          {/* appointment blocks (single column) */}
          {households.map((h, idx) => {
            const schedStart = h.startIso ? DateTime.fromISO(h.startIso) : null;
            const schedEnd = h.endIso ? DateTime.fromISO(h.endIso) : null;
            if (!schedStart || !schedEnd) return null;

            const durMin = Math.max(1, Math.round(schedEnd.diff(schedStart).as('minutes')));

            // ---- ETA-based positioning (authoritative) ----
            const etaIso = timeline[idx]?.eta ?? null;
            const etdIso = timeline[idx]?.etd ?? null;

            const anchorIso = etaIso ?? h.startIso!; // position by ETA; fallback to scheduled start
            const top =
              Math.max(0, Math.round(DateTime.fromISO(anchorIso).diff(t0).as('minutes'))) * PPM;
            const height = Math.max(22, durMin * PPM);

            // adjusted window for tooltip
            const { winStartIso, winEndIso } = adjustedWindowForStart(
              date,
              h.startIso!,
              schedStartIso
            );

            const patientsPreview = h.patients
              .map((p) => p.name)
              .slice(0, 3)
              .join(', ');
            const moreCount = Math.max(0, (h.patients?.length || 0) - 3);

            // drive to next chip (uses computed between mins)
            const driveToNext = idx < households.length - 1 ? driveBetweenMin[idx] || 0 : null;

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
                    etaIso: etaIso ?? null,
                    etdIso: etdIso ?? null,
                    sIso: h.startIso!,
                    eIso: h.endIso!,
                    patients: h.patients || [],
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
                    ? '#f3f4f6'
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
                  opacity: h.isPersonalBlock ? 0.65 : 1,
                }}
                title={`Window: ${DateTime.fromISO(winStartIso).toLocaleString(
                  DateTime.TIME_SIMPLE
                )} – ${DateTime.fromISO(winEndIso).toLocaleString(DateTime.TIME_SIMPLE)}`}
              >
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  #{idx + 1} {h.client}
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
                    title="Personal Block"
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
                    Personal Block
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

                {driveToNext != null && idx < households.length - 1 && (
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
          {driveBars.map((d, i) => (
            <div key={i}>
              <div
                style={{
                  position: 'absolute',
                  left: 110,
                  right: 48,
                  top: d.top,
                  height: 6,
                  background: '#94a3b8',
                  borderRadius: 999,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: d.top - 16,
                  left: 110,
                  fontSize: 12,
                  color: '#64748b',
                  fontWeight: 700,
                }}
              >
                {d.label}
              </div>
            </div>
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

            // adjusted visual window (for hover)
            const { winStartIso, winEndIso } = adjustedWindowForStart(
              date,
              hoverCard.sIso,
              schedStartIso
            );

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
                    {DateTime.fromISO(winStartIso).toLocaleString(DateTime.TIME_SIMPLE)} –{' '}
                    {DateTime.fromISO(winEndIso).toLocaleString(DateTime.TIME_SIMPLE)}
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
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
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
