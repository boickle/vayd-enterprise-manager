import { useEffect, useMemo, useState } from 'react';
import {
  fetchOffboardPreview,
  offboardEmployee,
  type OffboardPreview,
  type OffboardResult,
} from '../../api/offboarding';
import { searchClientsStaff, type ClientSearchRow } from '../../api/clientsStaff';
import { formatYmd } from '../../utils/formatYmd';

/** Someone who can take over tasks, pets or a tech's "works with". */
export type OffboardColleague = { id: number; name: string; isProvider?: boolean };

type Props = {
  employeeId: number;
  employeeName: string;
  /** Active colleagues (the person being offboarded is filtered out here). */
  colleagues: OffboardColleague[];
  onClose: () => void;
  onDone: (result: OffboardResult, preview: OffboardPreview | null) => void;
};

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return msg ?? e?.message ?? 'Request failed';
}

function formatVisit(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function clientLabel(c: ClientSearchRow): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || `Household #${c.id}`;
  const where = [c.address1, c.city].filter(Boolean).join(', ');
  return where ? `${name} — ${where}` : name;
}

/**
 * RP-03 Offboard (owner spec, Nov 8, 2026). One step that lets someone go: Settings → Staff and
 * Admin → Users ("turn off login") both open it. Nothing is changed until Offboard is pressed;
 * Cancel leaves everything as it was.
 */
export default function OffboardDialog({
  employeeId,
  employeeName,
  colleagues,
  onClose,
  onDone,
}: Props) {
  const [lastDay, setLastDay] = useState('');
  const [preview, setPreview] = useState<OffboardPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskTo, setTaskTo] = useState('');
  const [doctorTo, setDoctorTo] = useState('');
  const [worksWith, setWorksWith] = useState<Record<number, string>>({});
  const [householdQuery, setHouseholdQuery] = useState('');
  const [householdHits, setHouseholdHits] = useState<ClientSearchRow[]>([]);
  const [household, setHousehold] = useState<ClientSearchRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    setLoadError(null);
    void fetchOffboardPreview(employeeId, lastDay || null)
      .then((p) => {
        if (!on) return;
        setPreview(p);
        if (!lastDay) setLastDay(p.lastDay);
      })
      .catch((err) => {
        if (on) setLoadError(extractErr(err));
      });
    return () => {
      on = false;
    };
  }, [employeeId, lastDay]);

  useEffect(() => {
    const q = householdQuery.trim();
    if (q.length < 2 || household) {
      setHouseholdHits([]);
      return;
    }
    let on = true;
    const t = setTimeout(() => {
      void searchClientsStaff(q)
        .then((rows) => {
          if (on) setHouseholdHits(rows.slice(0, 8));
        })
        .catch(() => {
          if (on) setHouseholdHits([]);
        });
    }, 250);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [householdQuery, household]);

  const others = useMemo(
    () => colleagues.filter((c) => c.id !== employeeId),
    [colleagues, employeeId]
  );
  const doctors = useMemo(() => others.filter((c) => c.isProvider), [others]);

  const already = preview?.offboarding ?? null;
  const w = preview?.warnings;
  const primary = preview?.primaryDoctorOf;
  const hasPrimary = !!primary && primary.pets + primary.households + primary.forwardBookings > 0;
  const visits = preview?.futureVisits ?? [];
  const doctorName = preview?.employee.doctorName ?? employeeName;

  const submit = async () => {
    const toId = Number(taskTo);
    if (!Number.isFinite(toId) || toId <= 0) {
      setError('Pick who receives their tasks.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await offboardEmployee(employeeId, {
        lastDay: lastDay || null,
        taskToEmployeeId: toId,
        primaryDoctorToId: doctorTo ? Number(doctorTo) : null,
        worksWith: (preview?.worksWith ?? []).map((t) => ({
          userId: t.userId,
          doctorId: worksWith[t.userId] ? Number(worksWith[t.userId]) : null,
        })),
        householdClientId: household ? Number(household.id) : null,
      });
      onDone(result, preview);
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-employee-modal-root" role="presentation">
      <button
        type="button"
        className="settings-employee-modal-backdrop"
        aria-label="Close"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div
        className="settings-employee-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-offboard-title"
      >
        <div className="settings-employee-modal__head">
          <h3 id="employee-offboard-title">Offboard {employeeName}</h3>
        </div>
        <div
          className="settings-employee-modal__form"
          style={{ maxHeight: '70vh', overflowY: 'auto' }}
        >
          {loadError ? (
            <p className="settings-error" role="alert">
              {loadError}
            </p>
          ) : null}
          {already ? (
            <p className="settings-warning" role="status">
              Already offboarded with last day {formatYmd(already.lastDay)}
              {already.completedAt ? ' (done)' : ''}.
            </p>
          ) : null}

          <label>
            <span className="label">Last day</span>
            <input
              className="input"
              type="date"
              aria-label="Last day"
              value={lastDay}
              onChange={(e) => setLastDay(e.target.value)}
              disabled={saving || !!already}
            />
          </label>
          <p
            className="muted"
            style={{ margin: '6px 0 12px', fontSize: 13 }}
            data-testid="offboard-summary"
          >
            Nothing changes until the end of their last day (midnight Eastern). Then their login
            ends and every session is signed out; turning them back on later does not turn the login
            back on (an admin does that in Admin → Users). No new visits can be booked with them
            after their last day. Their records, signatures, invoices and reports stay as they are.
          </p>

          <label>
            <span className="label">Their tasks go to</span>
            <select
              className="input"
              aria-label="Their tasks go to"
              value={taskTo}
              onChange={(e) => setTaskTo(e.target.value)}
              disabled={saving || !!already}
              required
            >
              <option value="">
                {preview && preview.openTaskCount > 0
                  ? `Select a person (${preview.openTaskCount} open)…`
                  : 'Select a person…'}
              </option>
              {others.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ margin: '4px 0 12px', fontSize: 12 }}>
            Open tasks move to this person at the end of the last day, and automatic tasks that
            would have gone to them go here from then on.
          </p>

          {visits.length ? (
            <section aria-label="Future visits" style={{ marginBottom: 12 }}>
              <strong>
                {plural(visits.length, 'visit')} still booked with them after their last day
              </strong>
              <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
                {visits.slice(0, 10).map((v) => (
                  <li key={v.id}>
                    {formatVisit(v.start)}
                    {v.patientName || v.clientName
                      ? ` — ${[v.patientName, v.clientName].filter(Boolean).join(' / ')}`
                      : ''}
                  </li>
                ))}
                {visits.length > 10 ? <li>…and {visits.length - 10} more</li> : null}
              </ul>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                They stay booked. A “Rebook {doctorName}&apos;s visits” task is created, and their
                calendar stays open in the Scheduler (labelled “(Deactivated)”) so client liaisons
                can move them. No client is emailed.
              </p>
            </section>
          ) : null}

          {hasPrimary ? (
            <label>
              <span className="label">
                New primary doctor for {plural(primary!.pets, 'pet')},{' '}
                {plural(primary!.households, 'household')}
                {primary!.forwardBookings
                  ? ` and ${plural(primary!.forwardBookings, 'forward booking')}`
                  : ''}
              </span>
              <select
                className="input"
                aria-label="New primary doctor"
                value={doctorTo}
                onChange={(e) => setDoctorTo(e.target.value)}
                disabled={saving || !!already}
              >
                <option value="">Leave blank</option>
                {doctors.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Moved at the end of the last day. No email or text goes to clients.
              </span>
            </label>
          ) : null}

          {preview?.worksWith.length ? (
            <section aria-label="Works with" style={{ margin: '12px 0' }}>
              <strong>Works with {employeeName}</strong>
              {preview.worksWith.map((t) => (
                <label key={t.userId} style={{ display: 'block', marginTop: 6 }}>
                  <span className="label">{t.name}</span>
                  <select
                    className="input"
                    aria-label={`${t.name} works with`}
                    value={worksWith[t.userId] ?? ''}
                    onChange={(e) =>
                      setWorksWith((prev) => ({ ...prev, [t.userId]: e.target.value }))
                    }
                    disabled={saving || !!already}
                  >
                    <option value="">Clear (works with no one)</option>
                    {doctors.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        Move to {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </section>
          ) : null}

          <label>
            <span className="label">Their own household (staff pricing ends at the last day)</span>
            {household ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>{clientLabel(household)}</span>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setHousehold(null);
                    setHouseholdQuery('');
                  }}
                  disabled={saving}
                >
                  Change
                </button>
              </div>
            ) : (
              <input
                className="input"
                aria-label="Search their household"
                placeholder="Search by name (optional)"
                value={householdQuery}
                onChange={(e) => setHouseholdQuery(e.target.value)}
                disabled={saving || !!already}
              />
            )}
          </label>
          {!household && householdHits.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0' }}>
              {householdHits.map((c) => (
                <li key={String(c.id)}>
                  <button type="button" className="btn secondary" onClick={() => setHousehold(c)}>
                    {clientLabel(c)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {w &&
          (w.draftSoaps > 0 || w.controlledStockItems > 0 || w.onlyHolderOfRoles.length > 0) ? (
            <section
              aria-label="Before their last day"
              className="settings-warning"
              style={{ marginTop: 12 }}
            >
              <strong>Before their last day</strong>
              <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
                {w.draftSoaps > 0 ? (
                  <li data-testid="offboard-warning-drafts">
                    {plural(w.draftSoaps, 'unsigned record')} (draft SOAP) to finish and sign.
                  </li>
                ) : null}
                {w.controlledStockItems > 0 ? (
                  <li data-testid="offboard-warning-stock">
                    Stock is still at their controlled-drug location (
                    {plural(w.controlledStockItems, 'item')}): count it and move it (DEA).
                  </li>
                ) : null}
                {w.onlyHolderOfRoles.length > 0 ? (
                  <li data-testid="offboard-warning-roles">
                    They are the only {w.onlyHolderOfRoles.join(', ')}. Automatic tasks for a role
                    with no one in it are not created, and a superadmin must give these roles to
                    someone else.
                  </li>
                ) : null}
              </ul>
              <span className="muted" style={{ fontSize: 12 }}>
                These don&apos;t stop you offboarding them.
              </span>
            </section>
          ) : null}

          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void submit()}
              disabled={saving || !preview || !taskTo || !!already}
            >
              {saving ? 'Offboarding…' : 'Offboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
