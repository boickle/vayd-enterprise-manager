import { useEffect, useState } from 'react';
import {
  getCountAlertSettings,
  patchCountAlertSettings,
  type CountAlertSettings,
} from '../../api/inventoryCounts';
import { currentPracticeId } from '../../utils/practiceIdFromToken';

const CLASSES: { abc: 'a' | 'b' | 'c'; label: string; hint: string }[] = [
  { abc: 'a', label: 'A items', hint: 'High-use or high-cost; counted weekly. Usually flag any difference.' },
  { abc: 'b', label: 'B items', hint: 'Middle tier; counted about monthly.' },
  { abc: 'c', label: 'C items', hint: 'Low-use, low-cost; counted about quarterly.' },
];

type Draft = Record<keyof CountAlertSettings, string | boolean>;

const toDraft = (s: CountAlertSettings): Draft => ({
  enabled: s.enabled,
  aUnits: String(s.aUnits),
  aUsd: String(s.aUsd),
  bUnits: String(s.bUnits),
  bUsd: String(s.bUsd),
  cUnits: String(s.cUnits),
  cUsd: String(s.cUsd),
  shrinkTaskEnabled: s.shrinkTaskEnabled,
  shrinkPctLimit: String(s.shrinkPctLimit),
  accuracyPctLimit: String(s.accuracyPctLimit),
});

export default function SettingsCountAlerts() {
  const practiceId = currentPracticeId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void getCountAlertSettings(practiceId)
      .then((s) => setDraft(toDraft(s)))
      .catch(() => setMessage({ ok: false, text: 'Could not load count alert settings' }));
  }, [practiceId]);

  if (!draft) return <p className="settings-muted">Loading…</p>;

  const field = (key: keyof CountAlertSettings, prefix?: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {prefix ? <span className="settings-muted">{prefix}</span> : null}
      <input
        className="settings-input"
        type="number"
        min={0}
        step="any"
        style={{ width: 90 }}
        value={String(draft[key])}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </span>
  );

  const save = () => {
    setSaving(true);
    setMessage(null);
    const n = (k: keyof CountAlertSettings) => Number(draft[k]) || 0;
    void patchCountAlertSettings(practiceId, {
      enabled: Boolean(draft.enabled),
      aUnits: n('aUnits'),
      aUsd: n('aUsd'),
      bUnits: n('bUnits'),
      bUsd: n('bUsd'),
      cUnits: n('cUnits'),
      cUsd: n('cUsd'),
      shrinkTaskEnabled: Boolean(draft.shrinkTaskEnabled),
      shrinkPctLimit: n('shrinkPctLimit'),
      accuracyPctLimit: n('accuracyPctLimit'),
    })
      .then((s) => {
        setDraft(toDraft(s));
        setMessage({ ok: true, text: 'Saved' });
      })
      .catch((e: unknown) =>
        setMessage({
          ok: false,
          text: e instanceof Error ? e.message : 'Could not save count alert settings',
        }),
      )
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <label className="settings-checkbox-item" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={Boolean(draft.enabled)}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        <span>Send the inventory manager a task when a count is off by more than:</span>
      </label>
      <div className="settings-table-container" style={{ marginBottom: 12 }}>
        <table className="settings-table">
          <thead>
            <tr>
              <th>Class</th>
              <th>Units off more than</th>
              <th>or $ off more than</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {CLASSES.map((c) => (
              <tr key={c.abc}>
                <td>
                  <strong>{c.label}</strong>
                </td>
                <td>{field(`${c.abc}Units` as keyof CountAlertSettings)}</td>
                <td>{field(`${c.abc}Usd` as keyof CountAlertSettings, '$')}</td>
                <td className="settings-muted" style={{ fontSize: 12 }}>
                  {c.hint}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="settings-muted" style={{ fontSize: 13 }}>
        Units 0 means any difference is flagged. $ 0 turns off the dollar check for that class.
        Counts still post to inventory right away; the task goes to whoever has “Count report and
        variance review” at that office (practice-wide holders if nobody local). First counts
        that set an opening balance are never flagged. Results: Analytics → Inventory.
      </p>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '20px 0 8px' }}>Monthly shrink review</h3>
      <label className="settings-checkbox-item" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={Boolean(draft.shrinkTaskEnabled)}
          onChange={(e) => setDraft({ ...draft, shrinkTaskEnabled: e.target.checked })}
        />
        <span>
          On the 1st of each month, send the inventory manager (with the practice manager watching)
          a task for any office whose last month was outside these limits:
        </span>
      </label>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="settings-label">
          Shrink over (% of inventory value)
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {field('shrinkPctLimit')}
            <span className="settings-muted">%</span>
          </span>
        </label>
        <label className="settings-label">
          Count accuracy under
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {field('accuracyPctLimit')}
            <span className="settings-muted">%</span>
          </span>
        </label>
      </div>
      <p className="settings-muted" style={{ fontSize: 13 }}>
        Typical targets: shrink under 2%, with over 3% usually meaning missed charges or unlogged
        waste; accuracy 95%+. Accuracy is only judged once an office has 10 or more counts that
        month. The same limits drive the red ! on Analytics → Inventory → Shrink &amp; Accuracy.
        If an office has no inventory manager, a practice manager gets the task.
      </p>
      {message ? (
        <div
          className={`settings-message ${message.ok ? 'settings-success-message' : 'settings-error-message'}`}
          style={{ marginBottom: 8 }}
        >
          {message.text}
        </div>
      ) : null}
      <button type="button" className="btn primary" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
