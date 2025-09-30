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

/* =========================
   Public props (used by PreviewMyDayModal)
   ========================= */
export type DoctorDayProps = {
  readOnly?: boolean;
  initialDate?: string; // YYYY-MM-DD
  initialDoctorId?: string; // provider/doctor id used by fetchDoctorDay
  virtualAppt?: {
    date: string; // YYYY-MM-DD
    insertionIndex: number; // position in the day's route
    suggestedStartIso: string; // ISO start in doctor's TZ
    serviceMinutes: number;
    clientName?: string;
    lat?: number;
    lon?: number;
    address1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
};

/* =========================
   Narrow helpers
   ========================= */
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

// ISO getters (varied backend shapes)
function getStartISO(a: DoctorDayAppt): string | undefined {
  return str(a, 'appointmentStart') ?? str(a, 'scheduledStartIso') ?? str(a, 'startIso');
}
function getEndISO(a: DoctorDayAppt): string | undefined {
  return str(a, 'appointmentEnd') ?? str(a, 'scheduledEndIso') ?? str(a, 'endIso');
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

  const freeForm = str(a, 'address') ?? str(a, 'addressStr') ?? str(a, 'fullAddress');
  if (freeForm) return freeForm;

  const lat = (a as any)?.lat ?? 0;
  const lon = (a as any)?.lon ?? 0;
  return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

type PatientBadge = {
  name: string;
  pimsId?: string | null;
  status?: string | null;
  startIso?: string | null;
  endIso?: string | null;
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
  isPreview?: boolean; // 👈 marks the injected appointment's card
};

function keyFor(lat: number, lon: number, decimals = 6) {
  const m = Math.pow(10, decimals);
  const rl = Math.round(lat * m) / m;
  const ro = Math.round(lon * m) / m;
  return `${rl},${ro}`;
}

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

/* =========================
   Component
   ========================= */
export default function DoctorDay({
  readOnly,
  initialDate,
  initialDoctorId,
  virtualAppt,
}: DoctorDayProps) {
  const { userEmail } = useAuth() as { userEmail?: string };

  // ── state
  const [date, setDate] = useState<string>(() => initialDate || DateTime.local().toISODate() || '');
  const [appts, setAppts] = useState<DoctorDayAppt[]>([]);
  const [startDepot, setStartDepot] = useState<Depot | null>(null);
  const [endDepot, setEndDepot] = useState<Depot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [etas, setEtas] = useState<Record<string, string>>({});
  const [etaErr, setEtaErr] = useState<string | null>(null);
  const [driveSecondsArr, setDriveSecondsArr] = useState<number[] | null>(null);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(initialDoctorId || '');
  const didInitDoctor = useRef(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersErr, setProvidersErr] = useState<string | null>(null);

  const [schedStartIso, setSchedStartIso] = useState<string | null>(null);
  const [schedEndIso, setSchedEndIso] = useState<string | null>(null);
  const [backToDepotSec, setBackToDepotSec] = useState<number | null>(null);
  const [backToDepotIso, setBackToDepotIso] = useState<string | null>(null);

  // Reverse geocode depots to pretty addresses
  const [startDepotAddr, setStartDepotAddr] = useState<string | null>(null);
  const [endDepotAddr, setEndDepotAddr] = useState<string | null>(null);

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

  // Providers
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

  // Auto-select by email once
  useEffect(() => {
    if (didInitDoctor.current) return;
    if (!providers.length) return;
    if (!userEmail) return;
    const me = providers.find(
      (p: any) => (p?.email || '').toLowerCase() === userEmail.toLowerCase()
    );
    if (me?.id != null && !initialDoctorId) {
      setSelectedDoctorId(String(me.id));
      didInitDoctor.current = true;
    }
  }, [providers, userEmail, initialDoctorId]);

  /* =========================
     Fetch real day, then inject the virtual appt
     ========================= */
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

        // inject virtual appointment if provided and date matches
        const finalAppts = (() => {
          if (!virtualAppt || virtualAppt.date !== date) return sorted;

          const start = DateTime.fromISO(virtualAppt.suggestedStartIso);
          const end = start.plus({ minutes: Math.max(0, virtualAppt.serviceMinutes || 0) });
          const startIso = start.toISO();
          const endIso = end.toISO();

          // coords: use provided; if absent, borrow median appt coords to avoid empty group
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
            lat: lat ?? 0,
            lon: lon ?? 0,
            address1: virtualAppt.address1 ?? '',
            city: virtualAppt.city ?? '',
            state: virtualAppt.state ?? '',
            zip: virtualAppt.zip ?? '',
            appointmentType: 'Preview',
            confirmStatusName: 'Proposed',
            statusName: 'Proposed',
            // timing (multiple shapes)
            appointmentStart: startIso,
            appointmentEnd: endIso,
            scheduledStartIso: startIso,
            scheduledEndIso: endIso,
            startIso,
            endIso,
            // provider hints
            providerPimsId:
              selectedDoctorId || initialDoctorId || (sorted[0] as any)?.providerPimsId,
            providerName: (sorted[0] as any)?.providerName ?? (sorted[0] as any)?.doctorName ?? '',
            mins: Math.max(1, Math.round(end.diff(start).as('minutes'))),
            // 🔑 mark as preview so we can style its card
            isPreview: true as any,
          } as any;

          const idx = Math.max(0, Math.min(sorted.length, virtualAppt.insertionIndex));
          return [...sorted.slice(0, idx), previewAppt, ...sorted.slice(idx)];
        })();

        setAppts(finalAppts);
        setStartDepot(resp.startDepot ?? null);
        setEndDepot(resp.endDepot ?? null);

        const { start: schedStart, end: schedEnd } = pickScheduleBounds(resp, finalAppts);
        setSchedStartIso(schedStart);
        setSchedEndIso(schedEnd);

        // inferred doctor fallback
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

  /* =========================
     Group into households (by lat/lon) — carry isPreview flag
     ========================= */
  const households: Household[] = useMemo(() => {
    const map = new Map<string, Household>();

    for (const a of appts) {
      const lat = num(a, 'lat') ?? (a as any)?.lat ?? 0;
      const lon = num(a, 'lon') ?? (a as any)?.lon ?? 0;
      const key = keyFor(lat, lon, 6);

      const patientName =
        str(a, 'patientName') ?? str(a, 'petName') ?? str(a, 'animalName') ?? 'Patient';
      const badge: PatientBadge = {
        name: patientName,
        pimsId: str(a, 'patientPimsId') ?? null,
        status: str(a, 'confirmStatusName') ?? null,
        startIso: getStartISO(a) ?? null,
        endIso: getEndISO(a) ?? null,
      };

      const apptIsPreview = (a as any)?.isPreview === true;

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
          isPreview: apptIsPreview, // 👈 mark household if this stop is preview
        });
      } else {
        const h = map.get(key)!;
        const exists = h.patients.some(
          (p) =>
            (badge.pimsId && p.pimsId === badge.pimsId) ||
            (!badge.pimsId && p.name === badge.name && p.startIso === badge.startIso)
        );
        if (!exists) h.patients.push(badge);
        if (apptIsPreview) h.isPreview = true; // 👈 carry forward if any appt at this address is preview

        const hStart = h.startIso ? DateTime.fromISO(h.startIso) : null;
        const aStart = badge.startIso ? DateTime.fromISO(badge.startIso) : null;
        if (aStart && (!hStart || aStart < hStart)) h.startIso = aStart.toISO();

        const hEnd = h.endIso ? DateTime.fromISO(h.endIso) : null;
        const aEnd = badge.endIso ? DateTime.fromISO(badge.endIso) : null;
        if (aEnd && (!hEnd || aEnd > hEnd)) h.endIso = aEnd.toISO();
      }
    }

    // Keep timeline order
    return Array.from(map.values()).sort((a, b) => {
      const ta = a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0;
      const tb = b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0;
      return ta - tb;
    });
  }, [appts]);

  /* =========================
     ETAs + drive seconds for stats
     ========================= */
  useEffect(() => {
    let on = true;
    (async () => {
      setEtaErr(null);
      setEtas({});
      setDriveSecondsArr(null);
      if (households.length === 0) return;

      const inferredDoctorId =
        (households[0]?.primary as any)?.primaryProviderPimsId ||
        (households[0]?.primary as any)?.providerPimsId ||
        (households[0]?.primary as any)?.doctorId ||
        selectedDoctorId ||
        '';

      const payload = {
        doctorId: inferredDoctorId,
        date,
        households: households.map((h) => ({
          key: h.key,
          lat: h.lat,
          lon: h.lon,
          startIso: h.startIso ?? null,
          endIso: h.endIso ?? null,
        })),
        startDepot: startDepot ? { lat: startDepot.lat, lon: startDepot.lon } : undefined,
        useTraffic: true,
      };

      try {
        const result: any = await fetchEtas(payload);
        if (!on) return;
        setEtas(result?.etaByKey ?? {});
        if (Array.isArray(result?.driveSeconds)) setDriveSecondsArr(result.driveSeconds);
        setBackToDepotSec(
          typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null
        );
        setBackToDepotIso(result?.backToDepotIso ?? null);
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
  }, [households, startDepot, date, selectedDoctorId]);

  /* =========================
     Navigation links
     ========================= */
  const stops: Stop[] = useMemo(
    () =>
      households.map((h) => ({
        lat: h.lat,
        lon: h.lon,
        label: h.primary.clientName,
      })),
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

  /* =========================
     Stats (drive/household/whitespace/points)
     ========================= */
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

    // Points (simple rule)
    const points = appts.reduce((total, a) => {
      const type = (a?.appointmentType || '').toLowerCase();
      if (type === 'euthanasia') return total + 2;
      if (type.includes('tech appointment')) return total + 0.5;
      return total + 1;
    }, 0);

    const durSec = (startIso?: string | null, endIso?: string | null) =>
      startIso && endIso
        ? Math.max(0, DateTime.fromISO(endIso).diff(DateTime.fromISO(startIso), 'seconds').seconds)
        : 0;

    // Fallback distance → time (~35 mph) if API drive times are missing
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

    const first = households[0];
    const last = households[households.length - 1];

    const householdSec = households.reduce((sum, h) => sum + durSec(h.startIso, h.endIso), 0);

    const firstArriveMs =
      (first?.key && etas[first.key] ? DateTime.fromISO(etas[first.key]).toMillis() : null) ??
      (first?.startIso ? DateTime.fromISO(first.startIso).toMillis() : 0);

    const lastEtaMs =
      last?.key && etas[last.key] ? DateTime.fromISO(etas[last.key]).toMillis() : null;
    const lastDurSec = durSec(last?.startIso ?? null, last?.endIso ?? null);
    const lastStartMs = last?.startIso ? DateTime.fromISO(last.startIso).toMillis() : null;
    const lastEndMsFromEta = lastEtaMs != null ? lastEtaMs + lastDurSec * 1000 : null;
    const lastEndMsFromStart = lastStartMs != null ? lastStartMs + lastDurSec * 1000 : null;
    const lastEndMsExplicit = last?.endIso ? DateTime.fromISO(last.endIso).toMillis() : null;
    const lastEndMs = lastEndMsFromEta ?? lastEndMsFromStart ?? lastEndMsExplicit ?? 0;

    // Drive seconds – use API when present
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

    const whiteSec = effectiveShiftSec - householdSec - driveSec;

    const driveMin = Math.round(driveSec / 60);
    const householdMin = Math.round(householdSec / 60);
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
    etas,
    startDepot,
    endDepot,
    driveSecondsArr,
    backToDepotSec,
    backToDepotIso,
    schedStartIso,
    schedEndIso,
  ]);

  // ----- small display helpers -----
  function fmtTime(iso?: string | null) {
    if (!iso) return '';
    return DateTime.fromISO(iso).toLocaleString(DateTime.TIME_SIMPLE);
  }
  function windowTextFromStart(iso?: string | null) {
    if (!iso) return '';
    const t = DateTime.fromISO(iso);
    const start = t.minus({ hours: 1 }).toLocaleString(DateTime.TIME_SIMPLE);
    const end = t.plus({ hours: 1 }).toLocaleString(DateTime.TIME_SIMPLE);
    return `${start} – ${end}`;
  }
  function pillClass(status?: string | null) {
    const s = (status || '').trim().toLowerCase();
    if (s.includes('pre-appt email')) return 'pill pill--danger';
    if (s.includes('client submitted pre-appt form')) return 'pill pill--success';
    return 'pill pill--neutral';
  }

  // Colors for header chips
  const driveColor = colorForDrive(stats.driveMin);
  const whitePct =
    Number.isFinite(stats.shiftMin) && stats.shiftMin > 0
      ? (stats.whiteMin / stats.shiftMin) * 100
      : 0;
  const whiteColor = colorForWhitespace(whitePct);
  const hdRatio =
    Number.isFinite(stats.driveMin) && stats.driveMin > 0
      ? stats.householdMin / stats.driveMin
      : Infinity;
  const hdColor = colorForHDRatio(hdRatio);
  const ratioText = Number.isFinite(hdRatio) ? hdRatio.toFixed(2) : '∞';
  const whitePctText = Number.isFinite(whitePct) ? `${whitePct.toFixed(0)}%` : '—';

  /* =========================
     Render
     ========================= */
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
            disabled={readOnly} // lock date inside modal preview
          />

          <label className="muted" htmlFor="dd-doctor">
            Provider
          </label>
          <select
            id="dd-doctor"
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            disabled={providersLoading || readOnly} // lock provider in preview
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
            <strong>Points:</strong> {appts.length}
          </span>

          <span style={{ color: driveColor }}>
            <strong>Drive:</strong> {formatHM(stats.driveMin)}
          </span>

          <span>
            <strong>Households:</strong> {formatHM(stats.householdMin)}
          </span>

          <span style={{ color: hdColor }}>
            <strong>H:D ratio:</strong> {ratioText}
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

      {/* Content grid */}
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

                const etaIso = etas[h.key];
                const durationMins =
                  h.startIso && h.endIso
                    ? Math.max(
                        0,
                        Math.round(
                          DateTime.fromISO(h.endIso)
                            .diff(DateTime.fromISO(h.startIso))
                            .as('minutes')
                        )
                      )
                    : 0;

                const etdIso =
                  etaIso != null
                    ? DateTime.fromISO(etaIso).plus({ minutes: durationMins }).toISO()
                    : null;

                return (
                  <li
                    key={h.key}
                    className="dd-item"
                    style={
                      h.isPreview
                        ? {
                            background: '#f3e8ff', // light purple background
                            border: '1px solid #a855f7', // purple border
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
                        <a
                          className="dd-title link-strong"
                          href={clientHref}
                          target="_blank"
                          rel="noreferrer"
                        >
                          #{i + 1} {a.clientName}
                        </a>
                      ) : (
                        <div className="dd-title">
                          #{i + 1} {a.clientName}
                        </div>
                      )}
                      {h.isPreview && (
                        <span
                          style={{
                            marginLeft: 'auto',
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

                    {/* Address */}
                    <div className="dd-address muted">{h.addressDisplay}</div>

                    {/* Meta row */}
                    {(h.startIso || h.endIso) && (
                      <div className="dd-meta-vertical" style={{ marginTop: 6, lineHeight: 1.4 }}>
                        {lengthText && (
                          <div className="muted">
                            <strong>Scheduled Appointment Duration:</strong> {lengthText}
                          </div>
                        )}
                        {h.startIso && (
                          <div>
                            <strong>Scheduled Start:</strong> {fmtTime(h.startIso)}{' '}
                            <strong>Window:</strong> {windowTextFromStart(h.startIso)}
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

                    {/* Patients list */}
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
                                )}

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
                                    {str(h.primary, 'statusName') ? (
                                      <span className={pillClass(str(h.primary, 'statusName'))}>
                                        {str(h.primary, 'statusName')}
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
