import { useCallback, useEffect, useState } from 'react';
import { getPracticeSettings, updatePracticeSettings } from '../../api/practiceSettings';
import {
  closeStaffSchedules,
  listClosedDayStaffCounts,
  reopenStaffSchedules,
  type ClosedDayStaffOffResult,
} from '../../api/closedDays';

export const CLOSED_DATES_KEY = 'scheduling.closedDates' as const;

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
  /** May give all staff the day off (schedule_override.manage, or an admin login). */
  canCloseSchedules?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stored value (JSON array string) -> sorted unique YYYY-MM-DD list. Bad input gives []. */
export function parseClosedDates(raw: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = raw.split(/[\s,;]+/);
    }
  }
  const out = new Set<string>();
  for (const i of items) {
    if (typeof i === 'string' && ISO_DATE.test(i.trim())) out.add(i.trim());
  }
  return [...out].sort();
}

function label(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Local YYYY-MM-DD for a Date. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Splits closed days into today-or-later and already passed. */
export function splitClosedDates(
  dates: string[],
  today = new Date()
): { upcoming: string[]; past: string[] } {
  const t = isoDay(today);
  return { upcoming: dates.filter((d) => d >= t), past: dates.filter((d) => d < t) };
}

function errorText(e: unknown): string {
  const err = e as { response?: { data?: { message?: string } }; message?: string };
  return err?.response?.data?.message ?? err?.message ?? 'Could not save.';
}

function staffOffText(r: ClosedDayStaffOffResult): string {
  const parts = [`${r.markedOff} staff given the day off`];
  if (r.alreadyOff > 0) parts.push(`${r.alreadyOff} already off`);
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} kept their custom hours`);
  return parts.join(', ');
}

/**
 * Settings → Scheduling → Manage Closed Days. Practice-wide closed days (holidays): online booking
 * offers no times on these dates. Optionally every active staff member also gets the day off;
 * removing the closed day removes only those days off (owner, Nov 13, 2026).
 */
export default function SettingsClosedDates({ practiceId, onMessage, canCloseSchedules }: Props) {
  const [dates, setDates] = useState<string[] | null>(null);
  const [staffOff, setStaffOff] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState('');
  const [closeSchedules, setCloseSchedules] = useState(!!canCloseSchedules);
  const [saving, setSaving] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [lastResult, setLastResult] = useState<ClosedDayStaffOffResult | null>(null);

  const loadStaffOff = useCallback(async () => {
    try {
      const rows = await listClosedDayStaffCounts();
      setStaffOff(Object.fromEntries(rows.map((r) => [r.date, r.staffOff])));
    } catch {
      setStaffOff({});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPracticeSettings(practiceId)
      .then((s) => {
        if (!cancelled) setDates(parseClosedDates(s[CLOSED_DATES_KEY]));
      })
      .catch(() => {
        if (!cancelled) setDates([]);
      });
    void loadStaffOff();
    return () => {
      cancelled = true;
    };
  }, [practiceId, loadStaffOff]);

  useEffect(() => {
    setCloseSchedules(!!canCloseSchedules);
  }, [canCloseSchedules]);

  const saveDates = async (next: string[]) => {
    const res = await updatePracticeSettings(practiceId, {
      [CLOSED_DATES_KEY]: JSON.stringify(next),
    });
    setDates(parseClosedDates(res[CLOSED_DATES_KEY] ?? next));
  };

  const giveStaffDayOff = async (d: string): Promise<ClosedDayStaffOffResult> => {
    const r = await closeStaffSchedules(d);
    setLastResult(r);
    await loadStaffOff();
    return r;
  };

  const add = async () => {
    const d = draft;
    setSaving(true);
    setLastResult(null);
    try {
      await saveDates([...(dates ?? []), d].sort());
      let msg = `${label(d)} closed for online booking.`;
      if (closeSchedules && canCloseSchedules) {
        try {
          const r = await giveStaffDayOff(d);
          msg = `${label(d)} closed: online booking off, ${staffOffText(r)}.`;
        } catch (e) {
          onMessage?.(
            `${label(d)} closed for online booking, but staff schedules were not changed: ${errorText(e)}`,
            'error'
          );
          setDraft('');
          return;
        }
      }
      setDraft('');
      onMessage?.(msg, 'success');
    } catch (e) {
      onMessage?.(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const closeExisting = async (d: string) => {
    setSaving(true);
    setLastResult(null);
    try {
      const r = await giveStaffDayOff(d);
      onMessage?.(`${label(d)}: ${staffOffText(r)}.`, 'success');
    } catch (e) {
      onMessage?.(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: string) => {
    setSaving(true);
    setLastResult(null);
    try {
      let reopened = 0;
      if ((staffOff[d] ?? 0) > 0) {
        reopened = (await reopenStaffSchedules(d)).reopened;
        await loadStaffOff();
      }
      await saveDates((dates ?? []).filter((x) => x !== d));
      onMessage?.(
        reopened > 0
          ? `${label(d)} reopened: online booking back on, ${reopened} staff day${reopened === 1 ? '' : 's'} off removed.`
          : `${label(d)} reopened for online booking.`,
        'success'
      );
    } catch (e) {
      onMessage?.(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const todayIso = isoDay(new Date());
  const split = splitClosedDates(dates ?? []);
  const valid = ISO_DATE.test(draft);
  const already = valid && dates?.includes(draft);
  const shown = showPast ? (dates ?? []) : split.upcoming;

  return (
    <div className="settings-closed-days">
      <div className="settings-card settings-closed-days-add">
        <label className="settings-closed-days-field">
          <span>Date</span>
          <input
            type="date"
            className="settings-input"
            value={draft}
            disabled={dates == null || saving}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Closed day to add"
          />
        </label>
        {canCloseSchedules && (
          <label className="settings-closed-days-check">
            <input
              type="checkbox"
              checked={closeSchedules}
              disabled={saving}
              onChange={(e) => setCloseSchedules(e.target.checked)}
            />
            Also give all staff the day off
          </label>
        )}
        <button
          type="button"
          className="btn"
          disabled={!valid || already || dates == null || saving}
          onClick={() => void add()}
        >
          {saving ? 'Saving…' : 'Add closed day'}
        </button>
        {already && <span className="settings-muted">Already a closed day.</span>}
      </div>

      {lastResult && lastResult.skipped.length > 0 && (
        <div className="settings-message settings-closed-days-skipped" role="status">
          <strong>Still working on {label(lastResult.date)}</strong> (they already had custom hours
          that day, so they were left alone):
          <ul>
            {lastResult.skipped.map((s) => (
              <li key={s.employeeId}>
                {s.name}
                {s.workStartLocal || s.workEndLocal
                  ? ` · ${s.workStartLocal ?? '?'}–${s.workEndLocal ?? '?'}`
                  : ''}
              </li>
            ))}
          </ul>
          To give them the day off too, mark it in Staff → Schedule.
        </div>
      )}

      {dates != null && dates.length === 0 && <p className="settings-muted">No closed days.</p>}
      {dates != null && dates.length > 0 && (
        <div className="settings-card">
          {shown.length === 0 && <p className="settings-muted">No upcoming closed days.</p>}
          {shown.length > 0 && (
            <table className="settings-table settings-closed-days-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Closed for</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const past = d < todayIso;
                  const n = staffOff[d] ?? 0;
                  return (
                    <tr key={d} className={past ? 'settings-muted' : undefined}>
                      <td>
                        {label(d)}
                        {past ? ' (past)' : ''}
                      </td>
                      <td>
                        {n > 0
                          ? `Online booking · ${n} staff day${n === 1 ? '' : 's'} off`
                          : 'Online booking only'}
                      </td>
                      <td className="settings-closed-days-actions">
                        {canCloseSchedules && n === 0 && !past && (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={saving}
                            aria-label={`Give all staff ${d} off`}
                            onClick={() => void closeExisting(d)}
                          >
                            Give all staff the day off
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={saving || (n > 0 && !canCloseSchedules)}
                          title={
                            n > 0 && !canCloseSchedules
                              ? 'Staff have this day off. Ask someone who manages staff schedules to remove it.'
                              : undefined
                          }
                          aria-label={`Remove ${d}`}
                          onClick={() => void remove(d)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {split.past.length > 0 && (
            <button type="button" className="btn secondary" onClick={() => setShowPast((v) => !v)}>
              {showPast
                ? 'Hide past days'
                : `Show ${split.past.length} past day${split.past.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
