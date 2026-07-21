import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchEmployeeRoles,
  fetchEmployeesByRole,
  type Employee,
  type EmployeeRole,
} from '../../api/appointmentSettings';
import {
  fetchClSeatAssignments,
  fetchClSeatPar,
  sundayWeekStartLocal,
  updateClSeatPar,
  upsertClSeatAssignments,
  type ClSeatParSettings,
} from '../../api/clSeatAssignments';
import {
  CL_SEAT_LABELS,
  type ClSeat,
} from '../../utils/clPoints';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

function findReceptionistRoleId(roles: EmployeeRole[]): number | null {
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const byName = roles.find((r) => norm(r.name) === 'receptionist');
  if (byName) return byName.id;
  const byValue = roles.find((r) => norm(r.roleValue) === 'receptionist');
  if (byValue) return byValue.id;
  const fuzzy = roles.find((r) => norm(r.name).includes('receptionist'));
  return fuzzy?.id ?? null;
}

function formatWeekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startLabel = start.toLocaleDateString(undefined, opts);
  const endLabel = end.toLocaleDateString(undefined, {
    ...opts,
    year: 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
}

const SEAT_OPTIONS: Array<{ value: ClSeat | ''; label: string }> = [
  { value: '', label: 'Unassigned' },
  { value: 'phones', label: CL_SEAT_LABELS.phones },
  { value: 'outreach', label: CL_SEAT_LABELS.outreach },
  { value: 'email', label: CL_SEAT_LABELS.email },
];

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsClSeatAssignment({ practiceId, onMessage }: Props) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const [liaisons, setLiaisons] = useState<Employee[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [weekStart, setWeekStart] = useState(() =>
    sundayWeekStartLocal(new Date().toISOString().slice(0, 10))
  );
  /** employeeId → seat or '' */
  const [seatByEmployee, setSeatByEmployee] = useState<Record<number, ClSeat | ''>>({});
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [savingWeek, setSavingWeek] = useState(false);

  const [seatPar, setSeatPar] = useState<ClSeatParSettings>({
    phones: 80,
    outreach: 140,
    email: 100,
  });
  const [loadingPar, setLoadingPar] = useState(true);
  const [savingPar, setSavingPar] = useState(false);

  const weekLabel = useMemo(() => formatWeekLabel(weekStart), [weekStart]);

  const loadRoster = useCallback(async () => {
    setLoadingRoster(true);
    setRosterError(null);
    try {
      const roles = await fetchEmployeeRoles();
      const roleId = findReceptionistRoleId(roles);
      if (roleId == null) {
        setLiaisons([]);
        setRosterError('No Receptionist (Client Liaison) role found.');
        return;
      }
      const emps = await fetchEmployeesByRole(roleId);
      const list = (Array.isArray(emps) ? emps : [])
        .filter((e) => e && !e.isDeleted && e.isActive !== false)
        .sort((a, b) =>
          formatEmployeeDisplayName(a).localeCompare(formatEmployeeDisplayName(b))
        );
      setLiaisons(list);
    } catch (e) {
      setRosterError(extractErr(e));
      setLiaisons([]);
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  const loadWeek = useCallback(async () => {
    setLoadingWeek(true);
    try {
      const res = await fetchClSeatAssignments(practiceId, weekStart);
      const map: Record<number, ClSeat | ''> = {};
      for (const row of res.assignments ?? []) {
        map[row.employeeId] = row.seat;
      }
      setSeatByEmployee(map);
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
      setSeatByEmployee({});
    } finally {
      setLoadingWeek(false);
    }
  }, [practiceId, weekStart]);

  const loadPar = useCallback(async () => {
    setLoadingPar(true);
    try {
      const par = await fetchClSeatPar(practiceId);
      setSeatPar(par);
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setLoadingPar(false);
    }
  }, [practiceId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    void loadPar();
  }, [loadPar]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  const shiftWeek = (delta: number) => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta * 7);
    const next = sundayWeekStartLocal(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    );
    setWeekStart(next);
  };

  const onWeekInputChange = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setWeekStart(sundayWeekStartLocal(value));
  };

  const setSeat = (employeeId: number, seat: ClSeat | '') => {
    setSeatByEmployee((prev) => ({ ...prev, [employeeId]: seat }));
  };

  const handleSaveWeek = async () => {
    setSavingWeek(true);
    try {
      const assignments = liaisons.map((emp) => ({
        employeeId: emp.id,
        seat: (seatByEmployee[emp.id] || null) as ClSeat | null,
      }));
      const res = await upsertClSeatAssignments(practiceId, {
        weekStart,
        assignments,
      });
      const map: Record<number, ClSeat | ''> = {};
      for (const row of res.assignments ?? []) {
        map[row.employeeId] = row.seat;
      }
      setSeatByEmployee(map);
      onMessageRef.current?.(`Saved CL seats for ${formatWeekLabel(weekStart)}.`, 'success');
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setSavingWeek(false);
    }
  };

  const handleCopyFromPriorWeek = async () => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 7);
    const prior = sundayWeekStartLocal(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    );
    setLoadingWeek(true);
    try {
      const res = await fetchClSeatAssignments(practiceId, prior);
      const map: Record<number, ClSeat | ''> = {};
      for (const row of res.assignments ?? []) {
        map[row.employeeId] = row.seat;
      }
      setSeatByEmployee(map);
      onMessageRef.current?.(
        `Loaded seats from prior week (${formatWeekLabel(prior)}). Save to apply to this week.`,
        'success'
      );
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setLoadingWeek(false);
    }
  };

  const handleSavePar = async () => {
    setSavingPar(true);
    try {
      const saved = await updateClSeatPar(practiceId, seatPar);
      setSeatPar(saved);
      onMessageRef.current?.('Saved seat par targets.', 'success');
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setSavingPar(false);
    }
  };

  const seatCounts = useMemo(() => {
    const counts: Record<ClSeat | 'unassigned', number> = {
      phones: 0,
      outreach: 0,
      email: 0,
      unassigned: 0,
    };
    for (const emp of liaisons) {
      const seat = seatByEmployee[emp.id];
      if (seat === 'phones' || seat === 'outreach' || seat === 'email') {
        counts[seat] += 1;
      } else {
        counts.unassigned += 1;
      }
    }
    return counts;
  }, [liaisons, seatByEmployee]);

  return (
    <div className="settings-section">
      <div className="settings-card" style={{ marginBottom: 24 }}>
        <h3 className="settings-card-title">Seat par (weekly targets)</h3>
        <p className="settings-muted" style={{ marginBottom: 16 }}>
          Normalized score = points ÷ seat par. 1.0 means on target for that rotating seat.
          Adjust these when the competition targets change.
        </p>
        {loadingPar ? (
          <p className="settings-muted">Loading par…</p>
        ) : (
          <>
            <div className="settings-form-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {(['phones', 'outreach', 'email'] as ClSeat[]).map((seat) => (
                <div key={seat} className="settings-form-group">
                  <label htmlFor={`cl-par-${seat}`}>{CL_SEAT_LABELS[seat]} par</label>
                  <input
                    id={`cl-par-${seat}`}
                    type="number"
                    min={1}
                    step={1}
                    value={seatPar[seat]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setSeatPar((prev) => ({
                        ...prev,
                        [seat]: Number.isFinite(n) ? n : prev[seat],
                      }));
                    }}
                    style={{ width: 120 }}
                  />
                </div>
              ))}
            </div>
            <div className="settings-action-bar">
              <button
                type="button"
                className="btn"
                onClick={() => void handleSavePar()}
                disabled={savingPar}
              >
                {savingPar ? 'Saving…' : 'Save seat par'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Weekly seat assignment</h3>
        <p className="settings-muted" style={{ marginBottom: 16 }}>
          Assign each Client Liaison to Phones, Outreach, or Email for the week (Sunday–Saturday).
          Used by Analytics → CL Performance for normalized scores.
        </p>

        <div
          className="settings-form-row"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}
        >
          <button type="button" className="btn secondary" onClick={() => shiftWeek(-1)}>
            ← Prior week
          </button>
          <div className="settings-form-group" style={{ margin: 0 }}>
            <label htmlFor="cl-week-start">Week of</label>
            <input
              id="cl-week-start"
              type="date"
              value={weekStart}
              onChange={(e) => onWeekInputChange(e.target.value)}
            />
          </div>
          <button type="button" className="btn secondary" onClick={() => shiftWeek(1)}>
            Next week →
          </button>
          <span className="settings-muted">{weekLabel}</span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void handleCopyFromPriorWeek()}
            disabled={loadingWeek || savingWeek}
          >
            Copy prior week
          </button>
        </div>

        <p className="settings-muted" style={{ marginBottom: 12 }}>
          Phones {seatCounts.phones} · Outreach {seatCounts.outreach} · Email {seatCounts.email}
          {seatCounts.unassigned > 0 ? ` · Unassigned ${seatCounts.unassigned}` : ''}
        </p>

        {loadingRoster ? (
          <p className="settings-muted">Loading Client Liaisons…</p>
        ) : rosterError ? (
          <p className="settings-error-message">{rosterError}</p>
        ) : liaisons.length === 0 ? (
          <p className="settings-muted">No active Receptionist-role employees found.</p>
        ) : (
          <div className="settings-table-container">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Client liaison</th>
                  <th>Email</th>
                  <th>Seat this week</th>
                </tr>
              </thead>
              <tbody>
                {liaisons.map((emp) => (
                  <tr key={emp.id}>
                    <td>{formatEmployeeDisplayName(emp)}</td>
                    <td className="settings-muted">{emp.email || '—'}</td>
                    <td>
                      <select
                        value={seatByEmployee[emp.id] ?? ''}
                        onChange={(e) =>
                          setSeat(emp.id, (e.target.value || '') as ClSeat | '')
                        }
                        disabled={loadingWeek || savingWeek}
                        aria-label={`Seat for ${formatEmployeeDisplayName(emp)}`}
                      >
                        {SEAT_OPTIONS.map((opt) => (
                          <option key={opt.value || 'none'} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="settings-action-bar">
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveWeek()}
            disabled={savingWeek || loadingWeek || loadingRoster || liaisons.length === 0}
          >
            {savingWeek ? 'Saving…' : 'Save seat assignments'}
          </button>
        </div>
      </div>
    </div>
  );
}
