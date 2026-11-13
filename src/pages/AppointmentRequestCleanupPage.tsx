/**
 * One-time cleanup of the Appointments backlog (owner, Nov 11, 2026): open requests older than
 * 10 days, each with a proposal. Booked when a pet was seen (or has a visit coming) since the
 * request, linking that visit; otherwise Not booked ("Closed in cleanup – no response").
 * Nothing changes until someone reviews the list and clicks Apply.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  applyAppointmentRequestCleanup,
  fetchAppointmentRequestCleanup,
  type AppointmentRequestCleanupItem,
} from '../api/appointmentRequestSubmissions';
import { APPOINTMENT_REQUESTS_LIST_PATH } from '../appointments-nav';
import { currentPracticeId } from '../utils/practiceIdFromToken';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { receivedDateLabel, visitSinceLabel } from '../utils/appointmentRequestTableRow';
import '../components/appointmentRequests/apptTable.css';
import './AppointmentRequestCleanupPage.css';

type Choice = 'booked' | 'not_booked';

export default function AppointmentRequestCleanupPage() {
  const practiceId = currentPracticeId();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [days, setDays] = useState(10);
  const [items, setItems] = useState<AppointmentRequestCleanupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAppointmentRequestCleanup(practiceId, days);
      setItems(res.items);
      setSelected(new Set(res.items.map((i) => i.id)));
      setChoices(Object.fromEntries(res.items.map((i) => [i.id, i.proposal])));
    } catch (e) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not load the cleanup list.');
    } finally {
      setLoading(false);
    }
  }, [practiceId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    let booked = 0;
    let notBooked = 0;
    for (const i of items) {
      if (!selected.has(i.id)) continue;
      if (choices[i.id] === 'booked') booked++;
      else notBooked++;
    }
    return { booked, notBooked };
  }, [items, selected, choices]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    const chosen = items.filter((i) => selected.has(i.id));
    if (chosen.length === 0) return;
    const ok = window.confirm(
      `Close ${chosen.length} request${chosen.length === 1 ? '' : 's'}: ${counts.booked} as Booked (linked to the visit) and ${counts.notBooked} as Not booked?`
    );
    if (!ok) return;
    setApplying(true);
    setResult(null);
    setError(null);
    try {
      const res = await applyAppointmentRequestCleanup(
        chosen.map((i) => ({
          id: i.id,
          action: choices[i.id],
          appointmentId: choices[i.id] === 'booked' ? (i.visit?.appointmentId ?? null) : null,
        }))
      );
      setResult(
        `Done: ${res.booked} Booked, ${res.notBooked} Not booked` +
          (res.skipped ? `, ${res.skipped} skipped (already closed by someone)` : '') +
          '.'
      );
      await load();
    } catch (e) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not apply the cleanup.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="container appt-requests-container">
      <div className="settings-page appt-requests-page">
        <p className="cleanup-back">
          <Link to={APPOINTMENT_REQUESTS_LIST_PATH}>← Appointments</Link>
        </p>
        <h1 className="settings-title">Clean up old requests</h1>
        <p className="settings-muted cleanup-intro">
          Open requests (New or Contacted) older than{' '}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Older than"
          >
            {[10, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          . If a pet was seen, or has a visit coming, since the request, it is proposed as{' '}
          <strong>Booked</strong> and linked to that visit. Otherwise it is proposed as{' '}
          <strong>Not booked</strong> (&ldquo;Closed in cleanup – no response&rdquo;). Untick or
          change anything that looks wrong. Nothing changes until you click Apply. Closed requests
          stay searchable.
        </p>

        {error ? <p className="cleanup-error">{error}</p> : null}
        {result ? (
          <p className="cleanup-result" role="status">
            {result}
          </p>
        ) : null}

        <div className="cleanup-bar">
          <span>
            {items.length} open request{items.length === 1 ? '' : 's'} · selected:{' '}
            <strong>{counts.booked}</strong> Booked, <strong>{counts.notBooked}</strong> Not booked
          </span>
          <button
            type="button"
            className="req-action req-action--quiet"
            onClick={() => setSelected(new Set(items.map((i) => i.id)))}
          >
            Select all
          </button>
          <button
            type="button"
            className="req-action req-action--quiet"
            onClick={() => setSelected(new Set())}
          >
            Select none
          </button>
          <button
            type="button"
            className="req-action req-action--primary"
            disabled={applying || selected.size === 0}
            onClick={() => void apply()}
          >
            {applying ? 'Applying…' : `Apply to ${selected.size}`}
          </button>
        </div>

        {loading ? (
          <p className="settings-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="settings-muted">
            Nothing to clean up. Every open request is newer than {days} days.
          </p>
        ) : (
          <table className="cleanup-table">
            <thead>
              <tr>
                <th aria-label="Include" />
                <th>Received</th>
                <th>Client / Pets</th>
                <th>Status</th>
                <th>Since the request</th>
                <th>Close as</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const choice = choices[i.id];
                return (
                  <tr key={i.id} className={selected.has(i.id) ? undefined : 'cleanup-row--off'}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(i.id)}
                        onChange={() => toggle(i.id)}
                        aria-label={`Include ${i.clientName}`}
                      />
                    </td>
                    <td>{receivedDateLabel(i.submittedAt, practiceTz)}</td>
                    <td>
                      <strong>{i.clientName}</strong>
                      {i.petNames.length > 0 ? (
                        <div className="cleanup-pets">{i.petNames.join(', ')}</div>
                      ) : null}
                      {i.notes ? <div className="cleanup-notes">{i.notes}</div> : null}
                    </td>
                    <td>{i.status === 'contacted' ? 'Contacted' : 'New'}</td>
                    <td>
                      {i.visit ? (
                        <span className="appt-table-pill appt-table-pill--seen">
                          <span>{visitSinceLabel(i.visit, practiceTz)}</span>
                          {i.visit.typeName ? (
                            <span className="appt-table-pill-detail">{i.visit.typeName}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="settings-muted">No visit</span>
                      )}
                    </td>
                    <td>
                      <div
                        className="cleanup-choice"
                        role="radiogroup"
                        aria-label={`Close ${i.clientName} as`}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={choice === 'booked'}
                          disabled={!i.visit}
                          className={choice === 'booked' ? 'cleanup-choice--on' : undefined}
                          onClick={() => setChoices((c) => ({ ...c, [i.id]: 'booked' }))}
                        >
                          Booked
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={choice === 'not_booked'}
                          className={choice === 'not_booked' ? 'cleanup-choice--on' : undefined}
                          onClick={() => setChoices((c) => ({ ...c, [i.id]: 'not_booked' }))}
                        >
                          Not booked
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
