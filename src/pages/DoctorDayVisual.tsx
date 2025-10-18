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
  return DateTime.fromISO(date).set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toISO()!; // ← non-null assert
}

function tenThirtyIsoFor(date: string): string {
  return DateTime.fromISO(date).set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toISO()!; // ← non-null assert
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
      .toISO()!; // ← non-null assert
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

  // symmetric 2h window anchor: [start-1h, start+1h]
  const symmetricEarly = start.minus({ hours: 1 });

  // If symmetric early < 08:30 AND appt <= 10:30 → force 08:30–10:30 (respect workStart)
  if (symmetricEarly < eightThirty && start <= tenThirty) {
    const ws = workStart > eightThirty ? workStart : eightThirty;
    const we = ws.plus({ hours: 2 });
    return { winStartIso: ws.toISO()!, winEndIso: we.toISO()! };
  }

  // Default: [max(workStart, start-1h), start+1h]
  const ws = DateTime.max(workStart, start.minus({ hours: 1 }));
  const we = start.plus({ hours: 1 });
  return { winStartIso: ws.toISO()!, winEndIso: we.toISO()! };
}

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

  // routing
  const [projEtas, setProjEtas] = useState<Record<string, string>>({});
  const [driveSecondsArr, setDriveSecondsArr] = useState<number[] | null>(null);
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

  /* ------------ group into households + patients ------------ */
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
          patients: [patient],
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

        // add unique patient
        const exists = h.patients.some(
          (p) =>
            (patient.pimsId && p.pimsId === patient.pimsId) ||
            (!patient.pimsId && p.name === patient.name && p.startIso === patient.startIso)
        );
        if (!exists) h.patients.push(patient);
      }
    }
    return Array.from(m.values()).sort(
      (a, b) =>
        (a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0) -
        (b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0)
    );
  }, [appts]);

  /* ------------ ETAs + driveSeconds ------------ */
  useEffect(() => {
    let on = true;
    (async () => {
      setEtaErr(null);
      setProjEtas({});
      setDriveSecondsArr(null);

      // Only route over households with usable lat/lon
      const routable = households.filter((h) => !h.isNoLocation);
      if (routable.length === 0) return;

      // Anchor: earliest routable start or 08:30 on that date
      const startAnchorIso =
        routable[0]?.startIso ??
        DateTime.fromISO(date).set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toISO();

      // infer doctor
      const inferredDoctorId =
        (appts[0] as any)?.primaryProviderPimsId ??
        (appts[0] as any)?.providerPimsId ??
        (appts[0] as any)?.doctorId ??
        selectedDoctorId ??
        '';

      const payload = {
        doctorId: inferredDoctorId,
        date,
        households: routable.map((h) => ({
          key: h.key,
          lat: h.lat,
          lon: h.lon,
          startIso: h.startIso ?? null,
          endIso: h.endIso ?? null,
        })),
        startDepot: startDepot ? { lat: startDepot.lat, lon: startDepot.lon } : undefined,
        endDepot: endDepot ? { lat: endDepot.lat, lon: endDepot.lon } : undefined,
        useTraffic: false,
      };

      try {
        const result: any = await fetchEtas(payload);

        const serverEtas: Record<string, string> = result?.etaByKey || {};
        if (serverEtas && Object.keys(serverEtas).length > 0 && on) {
          setProjEtas(serverEtas);
        }

        if (Array.isArray(result?.driveSeconds) && on) {
          setDriveSecondsArr(result.driveSeconds as number[]);
        }
      } catch (e: any) {
        if (on) setEtaErr(e?.message ?? 'Failed to compute ETAs');
      }
    })();

    return () => {
      on = false;
    };
  }, [households, startDepot, endDepot, date, selectedDoctorId, appts]);

  /* ------------ visual time window ------------ */
  const t0 = useMemo(() => {
    const first = households[0]?.startIso
      ? DateTime.fromISO(households[0].startIso).minus({ minutes: 10 })
      : DateTime.fromISO(date).set({ hour: 8, minute: 30 });
    return first.startOf('minute');
  }, [households, date]);

  const tEnd = useMemo(() => {
    const last = households[households.length - 1];
    const end = last?.endIso ? DateTime.fromISO(last.endIso) : t0.plus({ hours: 4 });
    return end.plus({ minutes: 30 });
  }, [households, t0]);

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

  /* ------------ helpers derived from ETAs ------------ */
  const etdByKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const h of households) {
      const s = h.startIso ? DateTime.fromISO(h.startIso) : null;
      const e = h.endIso ? DateTime.fromISO(h.endIso) : null;
      if (!s || !e) continue;
      const durMin = Math.max(1, Math.round(e.diff(s).as('minutes')));
      const etaIso = projEtas[h.key];
      const etdIso = etaIso
        ? DateTime.fromISO(etaIso).plus({ minutes: durMin }).toISO()
        : e.toISO(); // fallback to scheduled end
      map[h.key] = etdIso!;
    }
    return map;
  }, [households, projEtas]);

  /* ------------ compute drive-to-next minutes ------------ */
  const driveBetweenMin = useMemo(() => {
    const N = households.length;
    if (N <= 1) return [] as number[];

    // derive toFirst/between from API array if present
    let between: number[] | null = null;
    if (Array.isArray(driveSecondsArr)) {
      if (driveSecondsArr.length === N + 1) {
        between = driveSecondsArr.slice(1, N); // [between 0->1, 1->2, ...]
      } else if (driveSecondsArr.length === N) {
        if (startDepot) between = driveSecondsArr.slice(1);
        else if (!startDepot) between = driveSecondsArr.slice(0, N - 1);
      } else if (driveSecondsArr.length === N - 1) {
        between = driveSecondsArr;
      }
    }

    const out: number[] = [];

    for (let i = 0; i < N - 1; i++) {
      const apiMin =
        between && typeof between[i] === 'number' ? Math.round(Math.max(0, between[i]) / 60) : null;

      if (apiMin != null) {
        out.push(apiMin);
        continue;
      }

      // fallback from ETA gap: ETA(next) - ETD(prev)
      const prevETD = etdByKey[households[i].key];
      const nextETA = projEtas[households[i + 1].key];
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
  }, [households, driveSecondsArr, projEtas, etdByKey, startDepot]);

  /* ------------ visual drive bars placed at ETD(prev) ------------ */
  const driveBars = useMemo(() => {
    const bars: { top: number; width: number; label: string }[] = [];
    for (let i = 0; i < households.length - 1; i++) {
      const prev = households[i];
      const startIso = etdByKey[prev.key] ?? prev.endIso;
      if (!startIso) continue;

      const top = Math.max(0, Math.round(DateTime.fromISO(startIso).diff(t0).as('minutes'))) * PPM;
      const mins = Math.max(0, driveBetweenMin[i] || 0);
      const width = Math.max(24, mins * PPM);
      bars.push({ top, width, label: `${mins} min drive` });
    }
    return bars;
  }, [households, etdByKey, t0, driveBetweenMin]);

  return (
    <div className="card" style={{ paddingBottom: 16 }}>
      <h2>My Day — Visual</h2>
      <p className="muted">A time-scaled vertical view with drive time and patient details.</p>

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
            const s = h.startIso ? DateTime.fromISO(h.startIso) : null;
            const e = h.endIso ? DateTime.fromISO(h.endIso) : null;
            if (!s || !e) return null;

            const top = Math.max(0, Math.round(s.diff(t0).as('minutes'))) * PPM;
            const height = Math.max(22, Math.round(e.diff(s).as('minutes')) * PPM);

            const etaIso = projEtas[h.key];
            const durMin = Math.max(1, Math.round(e.diff(s).as('minutes')));
            const etdIso = etaIso
              ? DateTime.fromISO(etaIso).plus({ minutes: durMin }).toISO()
              : e.toISO();

            const patientsPreview = h.patients
              .map((p) => p.name)
              .slice(0, 3)
              .join(', ');
            const moreCount = Math.max(0, (h.patients?.length || 0) - 3);

            // drive to next chip
            const driveToNext = idx < households.length - 1 ? driveBetweenMin[idx] || 0 : null;

            // adjusted window for display
            const { winStartIso, winEndIso } = adjustedWindowForStart(
              date,
              s.toISO()!,
              schedStartIso
            );

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
                    sIso: s.toISO()!,
                    eIso: e.toISO()!,
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
                  background: h.isNoLocation ? '#fee2e2' : h.isPreview ? '#ede9fe' : '#e0f2fe',
                  border: `1px solid ${h.isNoLocation ? '#ef4444' : h.isPreview ? '#a855f7' : '#38bdf8'}`,
                  borderRadius: 8,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 10px',
                  gap: 10,
                  overflow: 'hidden',
                  cursor: 'default',
                  zIndex: 2,
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
                {!!h.patients?.length && (
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
