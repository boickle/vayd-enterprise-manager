import { useEffect, useState } from 'react';
import { getPracticeSettings, updatePracticeSettings } from '../../api/practiceSettings';

export const CLOSED_DATES_KEY = 'scheduling.closedDates' as const;

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
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

/** Collapsed-list label for upcoming days, e.g. "4 upcoming closed days · next Thu, Nov 26, 2026". */
export function summaryText(upcoming: string[]): string {
  if (upcoming.length === 0) return 'No upcoming closed days';
  const n = upcoming.length;
  return `${n} upcoming closed day${n === 1 ? '' : 's'} · next ${label(upcoming[0]!)}`;
}

/** Practice-wide closed days (holidays): online booking offers no times on these dates. */
export default function SettingsClosedDates({ practiceId, onMessage }: Props) {
  const [dates, setDates] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPracticeSettings(practiceId)
      .then((s) => {
        if (!cancelled) setDates(parseClosedDates(s[CLOSED_DATES_KEY]));
      })
      .catch(() => {
        if (!cancelled) setDates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  const persist = async (next: string[], doneMessage: string) => {
    setSaving(true);
    try {
      const res = await updatePracticeSettings(practiceId, {
        [CLOSED_DATES_KEY]: JSON.stringify(next),
      });
      setDates(parseClosedDates(res[CLOSED_DATES_KEY] ?? next));
      onMessage?.(doneMessage, 'success');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      onMessage?.(err?.response?.data?.message ?? err?.message ?? 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const todayIso = isoDay(new Date());
  const split = splitClosedDates(dates ?? []);
  const valid = ISO_DATE.test(draft);
  const already = valid && dates?.includes(draft);

  return (
    <div className="settings-premeds-window">
      <div className="settings-premeds-window-text">
        <strong>Closed days</strong>
        <p className="settings-muted">
          Online booking offers no times on these dates (holidays). Staff can still book and route
          by hand.
        </p>
        {dates != null && dates.length === 0 && <p className="settings-muted">No closed days.</p>}
        {dates != null && dates.length > 0 && (
          <details className="settings-closed-dates">
            <summary>{summaryText(split.upcoming)}</summary>
            <ul>
              {(showPast ? dates : split.upcoming).map((d) => (
                <li key={d} className={d < todayIso ? 'settings-muted' : undefined}>
                  {label(d)}
                  {d < todayIso ? ' (past)' : ''}{' '}
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    aria-label={`Remove ${d}`}
                    onClick={() =>
                      void persist(
                        dates.filter((x) => x !== d),
                        `${label(d)} reopened for online booking.`
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {split.past.length > 0 && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowPast((v) => !v)}
              >
                {showPast
                  ? 'Hide past days'
                  : `Show ${split.past.length} past day${split.past.length === 1 ? '' : 's'}`}
              </button>
            )}
          </details>
        )}
      </div>
      <label className="settings-premeds-window-field">
        <input
          type="date"
          className="settings-input"
          value={draft}
          disabled={dates == null || saving}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Closed day to add"
        />
      </label>
      <button
        type="button"
        className="btn"
        disabled={!valid || already || dates == null || saving}
        onClick={() =>
          void persist(
            [...(dates ?? []), draft].sort(),
            `${label(draft)} closed for online booking.`
          ).then(() => setDraft(''))
        }
      >
        {saving ? 'Saving…' : 'Add closed day'}
      </button>
    </div>
  );
}
