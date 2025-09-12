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

export default function DoctorDay() {
  const { userEmail } = useAuth() as { userEmail?: string };
  const [date, setDate] = useState<string>(() => DateTime.local().toISODate() || '');
  const [appts, setAppts] = useState<DoctorDayAppt[]>([]);
  const [startDepot, setStartDepot] = useState<Depot | null>(null);
  const [endDepot, setEndDepot] = useState<Depot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const resp: DoctorDayResponse = await fetchDoctorDay(date);
        if (!on) return;
        const sorted = [...resp.appointments].sort((a, b) => {
          const ta = a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0;
          const tb = b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0;
          return ta - tb;
        });
        setAppts(sorted);
        setStartDepot(resp.startDepot ?? null);
        setEndDepot(resp.endDepot ?? null);
      } catch (e: any) {
        if (on) setErr(e?.message || 'Failed to load');
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [date]);

  // ---- helper: group appointments by same address (lat/lon rounded) ----
  function keyFor(lat: number, lon: number, decimals = 6) {
    const m = Math.pow(10, decimals);
    const rl = Math.round(lat * m) / m;
    const ro = Math.round(lon * m) / m;
    return `${rl},${ro}`;
  }

  const stops: Stop[] = useMemo(() => {
    // Map of "lat,lon" -> { lat, lon, firstLabel, count }
    const grouped = new Map<string, { lat: number; lon: number; firstLabel: string; count: number }>();

    for (const a of appts) {
      const k = keyFor(a.lat, a.lon, 6); // 6 decimals ~ 0.11m; adjust if needed
      const cur = grouped.get(k);
      if (cur) {
        cur.count += 1;
        grouped.set(k, cur);
      } else {
        grouped.set(k, { lat: a.lat, lon: a.lon, firstLabel: a.clientName, count: 1 });
      }
    }

    const deduped: Stop[] = [];
    for (const g of grouped.values()) {
      const label =
        g.count > 1 ? `${g.firstLabel} (+${g.count - 1} more)` : g.firstLabel;
      deduped.push({ lat: g.lat, lon: g.lon, label });
    }
    return deduped;
  }, [appts]);

  const links = useMemo(
    () =>
      buildGoogleMapsLinksForDay(stops, {
        start: startDepot ?? undefined,
        end: endDepot ?? undefined,
      }),
    [stops, startDepot, endDepot]
  );

  return (
    <div className="dd-section">
      {/* Header */}
      <div className="card">
        <h2>My Day</h2>
        <p className="muted">
          {userEmail ? `Signed in as ${userEmail}` : 'Signed in'} — choose a date to view your route.
        </p>

        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {(startDepot || endDepot) && (
          <div className="dd-meta muted">
            {startDepot && <>Start depot: {startDepot.lat.toFixed(5)}, {startDepot.lon.toFixed(5)} · </>}
            {endDepot && <>End depot: {endDepot.lat.toFixed(5)}, {endDepot.lon.toFixed(5)}</>}
          </div>
        )}
      </div>

      {/* Content grid (list | navigate) */}
      <div className="dd-grid">
        {/* Appointments */}
        <div className="card">
          <h3>Appointments ({appts.length})</h3>
          {loading && <p>Loading…</p>}
          {err && <p className="error">{err}</p>}
          {!loading && !err && appts.length === 0 && (
            <p className="muted">No appointments for this date.</p>
          )}

          {appts.length > 0 && (
            <ul className="dd-list">
              {appts.map((a, i) => (
                <li key={a.id} className="dd-item">
                  <div className="dd-top">
                    <div className="dd-title">#{i + 1} {a.clientName}</div>
                    {a.confirmStatusName && (
                      <span className="pill dd-status">{a.confirmStatusName}</span>
                    )}
                  </div>

                  <div className="dd-sub">
                    {a.startIso && (
                      <div className="dd-time">
                        {DateTime.fromISO(a.startIso).toLocaleString(DateTime.TIME_SIMPLE)}
                      </div>
                    )}
                    <div className="dd-geo">
                      {a.lat.toFixed(5)}, {a.lon.toFixed(5)}
                    </div>
                  </div>

                  {(a.clientPimsId || a.patientPimsId) && (
                    <div className="dd-actions">
                      {a.clientPimsId && (
                        <a className="btn secondary" href={evetClientLink(a.clientPimsId)} target="_blank" rel="noreferrer">
                          Open Client in EVet
                        </a>
                      )}
                      {a.patientPimsId && (
                        <a className="btn secondary" href={evetPatientLink(a.patientPimsId)} target="_blank" rel="noreferrer">
                          Open Patient in EVet
                        </a>
                      )}
                    </div>
                  )}
                </li>
              ))}
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
                Your route has many stops. We split it into {links.length} segments (Google Maps allows up to 25 points per link).
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
            Tip: On iOS/Android, this opens the Google Maps app if installed; otherwise it opens in the browser.
          </p>
        </div>
      </div>
    </div>
  );
}
