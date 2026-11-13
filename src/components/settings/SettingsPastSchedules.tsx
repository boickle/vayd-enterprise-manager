import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  addPastSchedule,
  fetchScheduleHistory,
  removePastSchedule,
  type ScheduleVersion,
} from '../../api/scheduleHistory';
import { appConfirm } from '../../utils/appDialog';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function errText(e: unknown): string {
  const any = e as { response?: { data?: { message?: unknown } }; message?: string };
  const m = any?.response?.data?.message;
  if (Array.isArray(m)) return m.join(' ');
  return String(m ?? any?.message ?? 'Something went wrong');
}

function daysLabel(workdays: number[]): string {
  return workdays.length ? workdays.map((d) => DAY_SHORT[d]).join(', ') : 'No days (not working)';
}

/**
 * Settings → Employee schedule → Past schedules. Goals on the VSD report use the schedule in
 * effect on each date, so changing the weekly schedule today doesn't rewrite the past. Changes
 * to the weekly schedule are recorded here by themselves; add a past one when it was never
 * recorded (for example a doctor who worked Mondays until August).
 */
export default function SettingsPastSchedules({
  employeeId,
  canEdit = true,
}: {
  employeeId: number;
  canEdit?: boolean;
}) {
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await fetchScheduleHistory(employeeId));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
    setAdding(false);
  }, [load]);

  const startAdding = () => {
    // Start from the schedule they had most recently.
    setDays(versions.length ? [...versions[versions.length - 1].workdays] : [1, 2, 3, 4, 5]);
    setFrom('');
    setAdding(true);
  };

  const save = async () => {
    if (!from) return;
    setSaving(true);
    setError(null);
    try {
      setVersions(await addPastSchedule(employeeId, from, days));
      setAdding(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v: ScheduleVersion) => {
    const ok = await appConfirm({
      title: 'Remove past schedule?',
      message: `Remove the schedule from ${dayjs(v.effectiveFrom).format('MMM D, YYYY')}? Goals for those dates then use the schedule before it.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setError(null);
    try {
      setVersions(await removePastSchedule(employeeId, v.effectiveFrom));
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="settings-past-schedules" style={{ marginTop: 24 }}>
      <h4 className="settings-card-title" style={{ fontSize: 16, marginBottom: 4 }}>
        Past schedules
      </h4>
      <p className="settings-card-subtitle" style={{ margin: '0 0 8px' }}>
        Which days they worked, and from when. Goals on the VSD report use the schedule in effect
        on each date. Changes to the weekly schedule above are added here by themselves, from the
        day you save them.
      </p>
      {error ? (
        <div className="settings-message settings-error-message" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : (
        <table className="settings-table" aria-label="Past schedules">
          <thead>
            <tr>
              <th>From</th>
              <th>Days worked</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 ? (
              <tr>
                <td colSpan={3} className="settings-muted">
                  Nothing recorded yet.
                </td>
              </tr>
            ) : (
              versions.map((v) => (
                <tr key={v.effectiveFrom}>
                  <td>{v.fromStart ? 'From the start' : dayjs(v.effectiveFrom).format('MMM D, YYYY')}</td>
                  <td>{daysLabel(v.workdays)}</td>
                  <td>
                    {!v.fromStart && canEdit ? (
                      <button type="button" className="btn secondary" onClick={() => void remove(v)}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
      {canEdit && !adding ? (
        <button type="button" className="btn secondary" style={{ marginTop: 8 }} onClick={startAdding}>
          Add a past schedule
        </button>
      ) : null}
      {adding ? (
        <div
          className="settings-past-schedules__add"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 8 }}
        >
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            From
            <input
              type="date"
              aria-label="Schedule started"
              value={from}
              max={dayjs().format('YYYY-MM-DD')}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <span role="group" aria-label="Days worked" style={{ display: 'inline-flex', gap: 8 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <input
                  type="checkbox"
                  checked={days.includes(d)}
                  onChange={(e) =>
                    setDays((cur) => (e.target.checked ? [...cur, d] : cur.filter((x) => x !== d)))
                  }
                />
                {DAY_SHORT[d]}
              </label>
            ))}
          </span>
          <button type="button" className="btn" disabled={!from || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save past schedule'}
          </button>
          <button type="button" className="btn secondary" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
