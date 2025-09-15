import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const resp: DoctorDayResponse = await fetchDoctorDay(date);
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
      } catch (e: unknown) {
        if (on) setErr(extractErrorMessage(e));
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [date]);

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
        // the earliest start at this address becomes the household start
        const hStart = h.startIso ? DateTime.fromISO(h.startIso) : null;
        const aStart = badge.startIso ? DateTime.fromISO(badge.startIso) : null;
        if (aStart && (!hStart || aStart < hStart)) {
          h.startIso = aStart.toISO();
        }
        // track latest end for the household
        const hEnd = h.endIso ? DateTime.fromISO(h.endIso) : null;
        const aEnd = badge.endIso ? DateTime.fromISO(badge.endIso) : null;
        if (aEnd && (!hEnd || aEnd > hEnd)) {
          h.endIso = aEnd.toISO();
        }
      }
    }

    return Array.from(map.values());
  }, [appts]);

  useEffect(() => {
    let on = true;
    (async () => {
      setEtaErr(null);
      setEtas({});
      if (households.length === 0) return;

      // Try to infer a doctor id from the data if you don’t have it as a prop.
      // Adjust these lookups to match your payload shape.
      console.log(households[0]);
      const doctorId =
        (households[0]?.primary as any)?.primaryProviderPimsId ||
        (households[0]?.primary as any)?.providerPimsId ||
        (households[0]?.primary as any)?.doctorId ||
        '';

      // Build request body in the same order you render households
      const payload = {
        doctorId,
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
        const { etaByKey } = await fetchEtas(payload); // auto stringifies + normalizes response
        if (on) setEtas(etaByKey);
      } catch (e: any) {
        if (on) setEtaErr(e?.message ?? 'Failed to compute ETAs');
      }
    })();

    return () => {
      on = false;
    };
  }, [households, startDepot, date]);

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

  return (
    <div className="dd-section">
      {/* Header */}
      <div className="card">
        <h2>My Day</h2>
        <p className="muted">
          {userEmail ? `Signed in as ${userEmail}` : 'Signed in'} — choose a date to view your
          route.
        </p>

        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted" htmlFor="dd-date">
            Date
          </label>
          <input id="dd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {(startDepot || endDepot) && (
          <div className="dd-meta muted">
            {startDepot && (
              <>
                Start depot: {startDepot.lat.toFixed(5)}, {startDepot.lon.toFixed(5)} ·{' '}
              </>
            )}
            {endDepot && (
              <>
                End depot: {endDepot.lat.toFixed(5)}, {endDepot.lon.toFixed(5)}
              </>
            )}
          </div>
        )}
      </div>

      {/* Content grid */}
      <div className="dd-grid">
        {/* Households */}
        <div className="card">
          <h3>Households ({households.length})</h3>
          {loading && <p>Loading…</p>}
          {err && <p className="error">{err}</p>}
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
                            <strong>Duration:</strong> {lengthText}
                          </div>
                        )}
                        {h.startIso && (
                          <div>
                            <strong>Start:</strong> {fmtTime(h.startIso)} <strong>Window:</strong>{' '}
                            {windowTextFromStart(h.startIso)}
                          </div>
                        )}
                        {h.startIso && (
                          <div>
                            {etaIso && (
                              <>
                                <strong>ETA:</strong> {fmtTime(etaIso)}
                                {etdIso && (
                                  <>
                                    {' '}
                                    <strong>ETD:</strong> {fmtTime(etdIso)}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* {h.endIso && (
                          <div>
                            <strong>End:</strong> {fmtTime(h.endIso)}
                          </div>
                        )} */}
                        {/* {h.startIso && (
                          <div>
                            <strong>Window:</strong> {windowTextFromStart(h.startIso)}
                          </div>
                        )} */}
                      </div>
                    )}

                    {/* Patients list: clickable + pill per patient */}
                    {h.patients.length > 0 && (
                      <div className="dd-pets">
                        <div className="dd-pets-label">Pets:</div>
                        <div className="dd-pets-chips">
                          {h.patients.map((p, idx) => {
                            const href = p.pimsId ? evetPatientLink(p.pimsId) : undefined;
                            return (
                              <div key={`${p.pimsId || p.name}-${idx}`} className="chip">
                                {href ? (
                                  <a
                                    className="chip-name"
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {p.name}
                                  </a>
                                ) : (
                                  <span className="chip-name">{p.name}</span>
                                )}
                                {p.status && (
                                  <span className={pillClass(p.status)}>{p.status}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

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
      </div>
    </div>
  );
}
