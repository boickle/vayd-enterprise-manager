// src/pages/DoctorDayVisual.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
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
};

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

  // providers
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

  // fetch day
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

  // households
  const households = useMemo<Household[]>(() => {
    const m = new Map<string, Household>();
    for (const a of appts) {
      const lat = num(a, 'lat');
      const lon = num(a, 'lon');
      const hasGeo =
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180 &&
        Math.abs(lat) > 1e-6 &&
        Math.abs(lon) > 1e-6;
      const k = hasGeo ? keyFor(lat!, lon!) : `noloc:${(a as any)?.id ?? Math.random()}`;
      const s = getStartISO(a) ?? null;
      const e = getEndISO(a) ?? null;
      if (!m.has(k)) {
        m.set(k, {
          key: k,
          client: (a as any)?.clientName ?? 'Client',
          address: formatAddress(a),
          lat: hasGeo ? lat! : 0,
          lon: hasGeo ? lon! : 0,
          startIso: s,
          endIso: e,
          isNoLocation: !hasGeo,
          isPreview: (a as any)?.isPreview === true,
        });
      } else {
        const h = m.get(k)!;
        const sDt = s ? DateTime.fromISO(s) : null;
        const eDt = e ? DateTime.fromISO(e) : null;
        if (sDt && (!h.startIso || sDt < DateTime.fromISO(h.startIso))) h.startIso = sDt.toISO();
        if (eDt && (!h.endIso || eDt > DateTime.fromISO(h.endIso))) h.endIso = eDt.toISO();
      }
    }
    return Array.from(m.values()).sort(
      (a, b) =>
        (a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0) -
        (b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0)
    );
  }, [appts]);

  // ETAs (prefer server; fallback clamps to earliest window start = startIso - 60m)
  const [projEtas, setProjEtas] = useState<Record<string, string>>({});
  const [etaErr, setEtaErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      setEtaErr(null);
      setProjEtas({});

      // Only route over households with usable lat/lon
      const routable = households.filter((h) => !h.isNoLocation);
      if (routable.length === 0) return;

      // Anchor: earliest routable start or 08:30 on that date
      const startAnchorIso =
        routable[0]?.startIso ??
        DateTime.fromISO(date).set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toISO();

      // infer doctor the same way the list view does (best-effort)
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

        // ---------- 1) Prefer server-provided ETAs (already clamped) ----------
        const serverEtas: Record<string, string> = result?.etaByKey || {};
        if (serverEtas && Object.keys(serverEtas).length > 0) {
          if (on) setProjEtas(serverEtas);
          return;
        }

        // ---------- 2) Fallback: build ETAs from driveSeconds AND clamp to (startIso - 60m) ----------
        const ds: number[] | null = Array.isArray(result?.driveSeconds)
          ? result.driveSeconds
          : null;
        const N = routable.length;

        // derive toFirst/between from driveSeconds
        let toFirst = 0;
        let between: number[] = [];
        if (ds) {
          if (ds.length === N + 1) {
            toFirst = ds[0] || 0;
            between = ds.slice(1, N).map((v) => Math.max(0, v || 0));
          } else if (ds.length === N) {
            if (startDepot) {
              toFirst = ds[0] || 0;
              between = ds.slice(1).map((v) => Math.max(0, v || 0));
            } else {
              between = ds.slice(0, N - 1).map((v) => Math.max(0, v || 0));
            }
          } else if (ds.length === N - 1) {
            between = ds.map((v) => Math.max(0, v || 0));
          }
        }

        // duration helper from scheduled bounds (or 60m default)
        const durMins = (h: (typeof routable)[number]) =>
          h.startIso && h.endIso
            ? Math.max(
                1,
                Math.round(
                  DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
                )
              )
            : 60;

        // clamp helper: earliest window time = startIso - 60m
        const clampToWindowStart = (arriveIso: string, startIso?: string | null) => {
          if (!startIso) return arriveIso;
          const arrive = DateTime.fromISO(arriveIso);
          const winStart = DateTime.fromISO(startIso).minus({ hours: 1 });
          return arrive < winStart ? winStart.toISO()! : arriveIso;
        };

        // sequential chain
        let cursor = DateTime.fromISO(startAnchorIso!);
        const out: Record<string, string> = {};

        if (N > 0) {
          // first stop (depart at anchor + toFirst, then clamp to earliest window)
          const eta0Raw = cursor.plus({ seconds: Math.max(0, toFirst) }).toISO()!;
          const eta0 = clampToWindowStart(eta0Raw, routable[0].startIso);
          out[routable[0].key] = eta0;

          cursor = DateTime.fromISO(eta0).plus({ minutes: durMins(routable[0]) });

          // subsequent stops
          for (let i = 1; i < N; i++) {
            const travel = Math.max(0, between[i - 1] || 0);
            const etaRaw = cursor.plus({ seconds: travel }).toISO()!;
            const eta = clampToWindowStart(etaRaw, routable[i].startIso);
            out[routable[i].key] = eta;

            cursor = DateTime.fromISO(eta).plus({ minutes: durMins(routable[i]) });
          }
        }

        if (on) setProjEtas(out);
      } catch (e: any) {
        if (on) setEtaErr(e?.message ?? 'Failed to compute ETAs');
      }
    })();

    return () => {
      on = false;
    };
  }, [households, startDepot, endDepot, date, selectedDoctorId, appts]);

  // vertical window
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

  // hour ticks (horizontal lines)
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

  // drive bars (between appts)
  const drives = useMemo(() => {
    const arr: { top: number; width: number; label: string }[] = [];
    for (let i = 1; i < households.length; i++) {
      const prev = households[i - 1],
        curr = households[i];
      if (!prev.endIso || !curr.startIso) continue;
      const gapMin = Math.max(
        0,
        Math.round(
          DateTime.fromISO(curr.startIso).diff(DateTime.fromISO(prev.endIso)).as('minutes')
        )
      );
      if (gapMin <= 0) continue;
      const top =
        Math.max(0, Math.round(DateTime.fromISO(prev.endIso).diff(t0).as('minutes'))) * PPM;
      arr.push({ top, width: Math.max(24, gapMin * PPM), label: `${gapMin} min drive` });
    }
    return arr;
  }, [households, t0]);

  return (
    <div className="card" style={{ paddingBottom: 16 }}>
      <h2>My Day — Visual</h2>
      <p className="muted">A time-scaled vertical view with hover details.</p>

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
            const height = Math.max(18, Math.round(e.diff(s).as('minutes')) * PPM);

            const etaIso = projEtas[h.key];
            const durMin = Math.max(1, Math.round(e.diff(s).as('minutes')));
            const etdIso = etaIso
              ? DateTime.fromISO(etaIso).plus({ minutes: durMin }).toISO()
              : null;

            return (
              <div
                key={h.key}
                title={
                  `${h.client}\n${h.address}\nDuration: ${durMin} min` +
                  (etaIso
                    ? `\nETA: ${DateTime.fromISO(etaIso).toLocaleString(DateTime.TIME_SIMPLE)}  ETD: ${etdIso ? DateTime.fromISO(etdIso).toLocaleString(DateTime.TIME_SIMPLE) : '—'}`
                    : '') +
                  `\nWindow: ${s.minus({ hours: 1 }).toLocaleString(DateTime.TIME_SIMPLE)} – ${s.plus({ hours: 1 }).toLocaleString(DateTime.TIME_SIMPLE)}`
                }
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
                  gap: 8,
                  overflow: 'hidden',
                }}
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
                  }}
                >
                  {h.address}
                </div>
              </div>
            );
          })}

          {/* drive bars (small horizontal bars between blocks) */}
          {drives.map((d, i) => (
            <div
              key={i}
              title={d.label}
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
          ))}
        </div>
      </div>
    </div>
  );
}
