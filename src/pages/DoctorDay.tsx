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

/** Per-patient row rendered inside a household card */
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
  // household-level meta (derived from first appt at this address)
  startIso?: string | null;
  endIso?: string | null;
  patients: PatientBadge[];
};

// ---------- helpers to avoid `any` ----------
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

// ---------- time helpers (robust to various payload shapes) ----------
function getStartISO(a: DoctorDayAppt): string | undefined {
  return str(a, 'appointmentStart') ?? str(a, 'scheduledStartIso') ?? str(a, 'startIso');
}
function getEndISO(a: DoctorDayAppt): string | undefined {
  return str(a, 'appointmentEnd') ?? str(a, 'scheduledEndIso') ?? str(a, 'endIso');
}

// ---------- address formatting ----------
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

  return `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}`;
}

// ---------- misc ----------
function keyFor(lat: number, lon: number, decimals = 6) {
  const m = Math.pow(10, decimals);
  const rl = Math.round(lat * m) / m;
  const ro = Math.round(lon * m) / m;
  return `${rl},${ro}`;
}
function minutes(n?: number | null) {
  return Math.round((n ?? 0) / 60);
}

function pickScheduleBounds(
  resp: DoctorDayResponse,
  sortedAppts: DoctorDayAppt[]
): { start: string | null; end: string | null } {
  // Try common response shapes first
  console.log(resp);
  const start =
    str(resp as any, 'startDepotTime') ??
    str(resp as any, 'workdayStartIso') ??
    str(resp as any, 'shiftStartIso') ??
    // nested schedule objects
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

  console.log(start, end);

  if (start && end) return { start, end };

  // Fallback: earliest start to latest end across the day
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

export default function DoctorDay() {
  const { userEmail } = useAuth() as { userEmail?: string };
  const [date, setDate] = useState<string>(() => DateTime.local().toISODate() || '');
  const [appts, setAppts] = useState<DoctorDayAppt[]>([]);
  const [startDepot, setStartDepot] = useState<Depot | null>(null);
  const [endDepot, setEndDepot] = useState<Depot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [etas, setEtas] = useState<Record<string, string>>({});
  const [etaErr, setEtaErr] = useState<string | null>(null);
  const [driveSecondsArr, setDriveSecondsArr] = useState<number[] | null>(null);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(''); // '' = me (token)

  const [startDepotAddr, setStartDepotAddr] = useState<string | null>(null);
  const [endDepotAddr, setEndDepotAddr] = useState<string | null>(null);
  const didInitDoctor = useRef(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersErr, setProvidersErr] = useState<string | null>(null);
  const [schedStartIso, setSchedStartIso] = useState<string | null>(null);
  const [schedEndIso, setSchedEndIso] = useState<string | null>(null);
  const [backToDepotSec, setBackToDepotSec] = useState<number | null>(null);
  const [backToDepotIso, setBackToDepotIso] = useState<string | null>(null);

  // Reverse geocode depots to pretty addresses
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
        /* noop: fall back to lat/lon */
      }
    })();
    return () => {
      on = false;
    };
  }, [startDepot, endDepot]);

  // Load providers once
  useEffect(() => {
    let on = true;

    // wait until we at least know who’s logged in (auth ready)
    if (!userEmail) return;

    (async () => {
      console.log(userEmail);
      setProvidersLoading(true);
      setProvidersErr(null);
      try {
        const raw = await fetchPrimaryProviders();

        // normalize various shapes to an array
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

  // Try to auto-select by email once (if provider objects include email)
  useEffect(() => {
    if (didInitDoctor.current) return;
    if (!providers.length) return;
    if (!userEmail) return;
    const me = providers.find(
      (p: any) => (p?.email || '').toLowerCase() === userEmail.toLowerCase()
    );
    if (me?.id != null) {
      setSelectedDoctorId(String(me.id));
      didInitDoctor.current = true;
    }
  }, [providers, userEmail]);

  // Fetch doctor's day (depends on date & selected provider)
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
        setAppts(sorted);
        setStartDepot(resp.startDepot ?? null);
        setEndDepot(resp.endDepot ?? null);
        const { start: schedStart, end: schedEnd } = pickScheduleBounds(resp, sorted);
        setSchedStartIso(schedStart);
        setSchedEndIso(schedEnd);
        // Ensure the inferred doctor appears in the dropdown even if provider fetch fails.
        const firstAppt = sorted[0];
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
            return exists
              ? prev
              : [...prev, { id: inferredId, name: inferredName } as any as Provider];
          });
        }
        if (!didInitDoctor.current && !selectedDoctorId) {
          const firstAppt = sorted[0];
          const inferredId =
            (firstAppt as any)?.primaryProviderPimsId ??
            (firstAppt as any)?.providerPimsId ??
            (firstAppt as any)?.doctorId ??
            null;

          if (inferredId != null && providers.length) {
            // If your providers use the same id namespace, this will select the matching provider.
            const match = providers.find((p) => String(p.id) === String(inferredId));
            if (match) {
              setSelectedDoctorId(String(match.id));
              didInitDoctor.current = true;
            }
          }
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
  }, [date, selectedDoctorId]);

  // Group into households (by lat/lon)
  const households: Household[] = useMemo(() => {
    const map = new Map<string, Household>();

    for (const a of appts) {
      const key = keyFor(a.lat, a.lon, 6);

      // build patient row for this appt using safe string lookups
      const patientName =
        str(a, 'patientName') ?? str(a, 'petName') ?? str(a, 'animalName') ?? 'Patient';
      const badge: PatientBadge = {
        name: patientName,
        pimsId: str(a, 'patientPimsId') ?? null,
        status: str(a, 'confirmStatusName') ?? null,
        startIso: getStartISO(a) ?? null,
        endIso: getEndISO(a) ?? null,
      };

      if (!map.has(key)) {
        map.set(key, {
          key,
          primary: a,
          addressDisplay: formatAddress(a),
          lat: a.lat,
          lon: a.lon,
          startIso: getStartISO(a) ?? null,
          endIso: getEndISO(a) ?? null,
          patients: [badge],
        });
      } else {
        const h = map.get(key)!;
        // dedupe by pimsId if possible, otherwise by name+start time
        const exists = h.patients.some(
          (p) =>
            (badge.pimsId && p.pimsId === badge.pimsId) ||
            (!badge.pimsId && p.name === badge.name && p.startIso === badge.startIso)
        );
        if (!exists) h.patients.push(badge);
        // earliest start becomes household start
        const hStart = h.startIso ? DateTime.fromISO(h.startIso) : null;
        const aStart = badge.startIso ? DateTime.fromISO(badge.startIso) : null;
        if (aStart && (!hStart || aStart < hStart)) h.startIso = aStart.toISO();
        // latest end becomes household end
        const hEnd = h.endIso ? DateTime.fromISO(h.endIso) : null;
        const aEnd = badge.endIso ? DateTime.fromISO(badge.endIso) : null;
        if (aEnd && (!hEnd || aEnd > hEnd)) h.endIso = aEnd.toISO();
      }
    }

    return Array.from(map.values());
  }, [appts]);

  // Fetch ETAs and (optionally) drive seconds for stats
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
        '';

      const payload = {
        doctorId: selectedDoctorId || inferredDoctorId || '',
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

  // ---------- navigation ----------
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

  // ---------- header stats ----------
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
      };
    }

    // points
    const points = appts.reduce((total, a) => {
      const type = a?.appointmentType?.toLowerCase();
      if (type === 'euthanasia') return total + 2;
      if (type?.toLowerCase().includes('tech appointment')) {
        return total + 0.5;
      }
      return total + 1;
    }, 0);

    // --- shift window: depot -> first arrival, last end -> depot (works for 1+ appts) ---
    const first = households[0];
    const last = households[households.length - 1];

    const durSec = (startIso?: string | null, endIso?: string | null) =>
      startIso && endIso
        ? Math.max(0, DateTime.fromISO(endIso).diff(DateTime.fromISO(startIso), 'seconds').seconds)
        : 0;

    // total service
    const householdSec = households.reduce((sum, h) => sum + durSec(h.startIso, h.endIso), 0);

    // first arrival time: ETA if available, else scheduled start
    const firstArriveMs =
      (first?.key && etas[first.key] ? DateTime.fromISO(etas[first.key]).toMillis() : null) ??
      (first?.startIso ? DateTime.fromISO(first.startIso).toMillis() : 0);

    // last end time: prefer explicit endIso; else ETA+duration; else start+duration
    const lastEndMsExplicit = last?.endIso ? DateTime.fromISO(last.endIso).toMillis() : null;
    const lastEtaMs =
      last?.key && etas[last.key] ? DateTime.fromISO(etas[last.key]).toMillis() : null;
    const lastStartMs = last?.startIso ? DateTime.fromISO(last.startIso).toMillis() : null;
    const lastDurationSec = durSec(last?.startIso ?? null, last?.endIso ?? null);
    const lastEndMsFallback =
      (lastEtaMs != null ? lastEtaMs : (lastStartMs ?? 0)) + lastDurationSec * 1000;
    const lastEndMs = lastEndMsExplicit ?? lastEndMsFallback;

    // depot legs used to expand the shift
    const fallbackDepotSec = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const R = 6371000,
        toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat),
        dLon = toRad(b.lon - a.lon);
      const sLat = toRad(a.lat),
        sLat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(sLat) * Math.cos(sLat2) * Math.sin(dLon / 2) ** 2;
      const meters = 2 * R * Math.asin(Math.sqrt(h));
      return Math.round(meters / 15.65); // ~35 mph
    };
    const startPt = startDepot ?? endDepot ?? null; // reuse one if only one depot known
    const endPt = endDepot ?? startDepot ?? null;

    const driveToFirstSec =
      startPt && first
        ? fallbackDepotSec(
            { lat: startPt.lat, lon: startPt.lon },
            { lat: first.lat, lon: first.lon }
          )
        : 0;
    const driveBackSec =
      (typeof backToDepotSec === 'number' ? backToDepotSec : undefined) ??
      (endPt && last
        ? fallbackDepotSec({ lat: last.lat, lon: last.lon }, { lat: endPt.lat, lon: endPt.lon })
        : 0);

    // final shift span (derived)
    const shiftStartMs = Math.max(0, firstArriveMs - driveToFirstSec * 1000);
    const shiftEndMs = Math.max(shiftStartMs, lastEndMs + driveBackSec * 1000);

    // --- DRIVE SECONDS (split inter-household vs depot legs) ---
    const haversineMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const R = 6371000,
        toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat),
        dLon = toRad(b.lon - a.lon);
      const sLat = toRad(a.lat),
        sLat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(sLat) * Math.cos(sLat2) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const fallbackDriveSec = (
      from: { lat: number; lon: number },
      to: { lat: number; lon: number }
    ) => Math.round(haversineMeters(from, to) / 15.65);

    let driveSec = 0; // includes depot legs
    let interDriveSec = 0; // only between households
    const idleGapSec = 0;
    let idleSec = 0;

    // depot -> first
    if (startPt && first) {
      driveSec += fallbackDriveSec(
        { lat: startPt.lat, lon: startPt.lon },
        { lat: first.lat, lon: first.lon }
      );
    }

    // between households
    for (let i = 1; i < households.length; i++) {
      const prev = households[i - 1];
      const curr = households[i];

      const prevEndMs2 = prev.endIso ? DateTime.fromISO(prev.endIso).toMillis() : null;
      const currStartMs2 = curr.startIso ? DateTime.fromISO(curr.startIso).toMillis() : null;

      const estDrive = fallbackDriveSec(
        { lat: prev.lat, lon: prev.lon },
        { lat: curr.lat, lon: curr.lon }
      );
      driveSec += estDrive;
      interDriveSec += estDrive;

      if (prevEndMs2 != null && currStartMs2 != null) {
        const gapSec = Math.max(0, (currStartMs2 - prevEndMs2) / 1000);
        idleSec += Math.max(0, gapSec - estDrive);
      }
    }

    // last -> depot
    if (endPt && households.length) {
      driveSec += driveBackSec; // use backend-sec if available, fallback otherwise
    }

    // early arrival before first start (if ETA is earlier)
    if (first) {
      const firstEtaMs = etas[first.key] ? DateTime.fromISO(etas[first.key]).toMillis() : null;
      const firstStartMs2 = first.startIso ? DateTime.fromISO(first.startIso).toMillis() : null;
      if (firstEtaMs != null && firstStartMs2 != null && firstEtaMs < firstStartMs2) {
        idleSec += (firstStartMs2 - firstEtaMs) / 1000;
      }
    }

    const backToDepotIsoFinal =
      backToDepotIso ??
      (Number.isFinite(shiftEndMs) && shiftEndMs > 0
        ? DateTime.fromMillis(shiftEndMs).toISO()
        : null);

    // --- compute SHIFT based on schedule when available ---
    const scheduleSec =
      schedStartIso && schedEndIso
        ? Math.max(
            0,
            DateTime.fromISO(schedEndIso).diff(DateTime.fromISO(schedStartIso), 'seconds').seconds
          )
        : null;

    const derivedShiftSec = Math.max(0, (shiftEndMs - shiftStartMs) / 1000);

    // Prefer schedule window; fall back to derived
    const effectiveShiftSec = scheduleSec ?? derivedShiftSec;

    // Use inter-household drive when schedule exists; else include depot legs
    const driveUsedSec = driveSec;

    // Allow negative whitespace (overbooked/overrun)
    const whiteSec = effectiveShiftSec - householdSec - driveUsedSec;

    const driveMin = Math.round(driveUsedSec / 60);
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
    backToDepotSec,
    backToDepotIso,
    schedStartIso,
    schedEndIso,
  ]);

  // ---------- display helpers ----------
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

  // Derive numerics if not already present
  const whitePct =
    Number.isFinite(stats.shiftMin) && stats.shiftMin > 0
      ? (stats.whiteMin / stats.shiftMin) * 100
      : 0;

  const hdRatio =
    Number.isFinite(stats.driveMin) && stats.driveMin > 0
      ? stats.householdMin / stats.driveMin // H:D (Household : Drive)
      : Infinity;

  // Colors
  const driveColor = colorForDrive(stats.driveMin);
  const whiteColor = colorForWhitespace(whitePct);
  const hdColor = colorForHDRatio(hdRatio);

  // Optional: nice text versions
  const ratioText = Number.isFinite(hdRatio) ? hdRatio.toFixed(2) : '∞';
  const whitePctText = Number.isFinite(whitePct) ? `${whitePct.toFixed(0)}%` : '—';

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
          <input id="dd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

          <label className="muted" htmlFor="dd-doctor">
            Provider
          </label>
          <select
            id="dd-doctor"
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            disabled={providersLoading}
          >
            {/* Empty = token doctor (logged-in) */}
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
            <strong>Points:</strong> {stats.points}
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
        {/* Navigate (now first) */}
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

                // compute a readable household duration if we have both ends
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
                  <li key={h.key} className="dd-item">
                    {/* Title row with client (clickable) */}
                    <div className="dd-top">
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
                    </div>

                    {/* Address */}
                    <div className="dd-address muted">{h.addressDisplay}</div>

                    {/* Meta row: Start · End · Window */}
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
                        {h.startIso && (
                          <div>
                            {etaIso && (
                              <>
                                <strong>Projected ETA:</strong> {fmtTime(etaIso)}
                                {etdIso && (
                                  <>
                                    {' '}
                                    <strong>Projected ETD:</strong> {fmtTime(etdIso)}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Patients list: bullet list with details */}
                    {h.patients.length > 0 && (
                      <div className="dd-pets">
                        <div className="dd-pets-label">Patients:</div>

                        <ul className="dd-patients-list">
                          {h.patients.map((p, idx) => {
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
                              <li key={`${p.pimsId || p.name}-${idx}`} className="dd-patient-item">
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
