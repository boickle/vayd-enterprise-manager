import { useEffect, useState } from 'react';
import { getPracticeSettings, updatePracticeSettings } from '../../api/practiceSettings';
import {
  DEFAULT_PREMEDS_WINDOW_MINUTES,
  PREMEDS_WINDOW_MINUTES_KEY,
  parsePremedsWindowMinutes,
  premedsWindowSpanLabel,
  setPracticePremedsWindowMinutes,
} from '../../utils/premedsWindow';

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

/** Practice-wide "Needs pre-meds" arrival window (± minutes), shown above the type list. */
export default function SettingsPremedsWindow({ practiceId, onMessage }: Props) {
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPracticeSettings(practiceId)
      .then((s) => {
        if (cancelled) return;
        const m = parsePremedsWindowMinutes(s[PREMEDS_WINDOW_MINUTES_KEY]);
        setSaved(m);
        setDraft(String(m));
      })
      .catch(() => {
        if (cancelled) return;
        setSaved(DEFAULT_PREMEDS_WINDOW_MINUTES);
        setDraft(String(DEFAULT_PREMEDS_WINDOW_MINUTES));
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 240;
  const dirty = valid && saved != null && n !== saved;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await updatePracticeSettings(practiceId, {
        [PREMEDS_WINDOW_MINUTES_KEY]: String(n),
      });
      const m = parsePremedsWindowMinutes(res[PREMEDS_WINDOW_MINUTES_KEY] ?? n);
      setSaved(m);
      setDraft(String(m));
      setPracticePremedsWindowMinutes(m);
      onMessage?.(`Pre-meds window saved (±${m} min).`, 'success');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      onMessage?.(err?.response?.data?.message ?? err?.message ?? 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-premeds-window">
      <div className="settings-premeds-window-text">
        <strong>Pre-meds window</strong>
        <p className="settings-muted">
          Arrival window for visits marked <em>Needs pre-meds</em>. It only narrows a visit’s
          appointment-type window, never widens it. An in-office (0-minute) visit stays 0.
        </p>
      </div>
      <label className="settings-premeds-window-field">
        <span>±</span>
        <input
          type="number"
          min={0}
          max={240}
          step={5}
          className="settings-input"
          value={draft}
          disabled={saved == null || saving}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Pre-meds window, minutes before and after scheduled time"
        />
        <span>min</span>
        <span className="settings-muted">
          {valid ? `(up to ${premedsWindowSpanLabel(n)})` : '(0–240)'}
        </span>
      </label>
      <button type="button" className="btn" disabled={!dirty || saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
