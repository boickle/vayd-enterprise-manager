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

/** Practice-wide closed days (holidays): online booking offers no times on these dates. */
export default function SettingsClosedDates({ practiceId, onMessage }: Props) {
  const [dates, setDates] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

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
        <ul>
          {(dates ?? []).map((d) => (
            <li key={d}>
              {label(d)}{' '}
              <button
                type="button"
                className="btn"
                disabled={saving}
                aria-label={`Remove ${d}`}
                onClick={() =>
                  void persist(
                    (dates ?? []).filter((x) => x !== d),
                    `${label(d)} reopened for online booking.`
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
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
