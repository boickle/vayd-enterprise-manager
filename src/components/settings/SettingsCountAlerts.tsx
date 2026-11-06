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
  weeklyCountCap: String(s.weeklyCountCap ?? 20),
  staleSkipDraws: String(s.staleSkipDraws ?? 2),
  staleLowUnits: String(s.staleLowUnits ?? 2),
  staleLowPct: String(s.staleLowPct ?? 10),
  staleLowDays: String(s.staleLowDays ?? 30),
  staleLowDaysControlled: String(s.staleLowDaysControlled ?? 14),
  staleNoMoveDays: String(s.staleNoMoveDays ?? 90),
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

  const staleField = (key: keyof CountAlertSettings, label: string) => (
    <input
      className="settings-input"
      type="number"
      min={0}
      step="any"
      style={{ width: 80 }}
      aria-label={label}
      value={String(draft[key])}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
    />
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
      weeklyCountCap: Math.min(200, Math.max(1, Math.round(n('weeklyCountCap') || 20))),
      staleSkipDraws: Math.max(1, Math.round(n('staleSkipDraws') || 2)),
      staleLowUnits: n('staleLowUnits'),
      staleLowPct: Math.min(100, n('staleLowPct')),
      staleLowDays: Math.max(1, Math.round(n('staleLowDays') || 30)),
      staleLowDaysControlled: Math.max(1, Math.round(n('staleLowDaysControlled') || 14)),
      staleNoMoveDays: Math.max(1, Math.round(n('staleNoMoveDays') || 90)),
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
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Weekly count</h3>
      <label className="settings-label" style={{ marginBottom: 8 }}>
        Items per weekly count, per office
        <input
          className="settings-input"
          type="number"
          min={1}
          max={200}
          step={1}
          style={{ width: 90 }}
          value={String(draft.weeklyCountCap)}
          onChange={(e) => setDraft({ ...draft, weeklyCountCap: e.target.value })}
          aria-label="Items per weekly count, per office"
        />
      </label>
      <p className="settings-muted" style={{ fontSize: 13, marginTop: 0 }}>
        How many due items the system puts on each office&rsquo;s weekly count every Monday (1–200,
        default 20). Items not finished carry over and use part of next week&rsquo;s number. Raise
        it for the first months after go-live to get through everything sooner. Items a manager adds
        with &ldquo;+ Add to Weekly Count&rdquo; are extra and don&rsquo;t count toward it. A
        reminder goes out Thursday morning for anything still uncounted.
      </p>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '20px 0 8px' }}>
        Count difference alerts
      </h3>
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
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '20px 0 8px' }}>Stale lots review</h3>
      <p className="settings-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Analytics → Inventory → Stale lots flags a lot that still has stock when any of these is true.
      </p>
      <div style={{ display: 'grid', gap: 10, marginBottom: 8 }}>
        <label className="settings-label">
          Skipped over: a newer lot of the same item on the same shelf was drawn at least
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 6px' }}>
            {staleField('staleSkipDraws', 'Times a newer lot was drawn')}
          </span>
          times since this one last moved
        </label>
        <label className="settings-label">
          Nearly empty, then stuck: 
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 6px' }}>
            {staleField('staleLowUnits', 'Nearly empty units')}
          </span>
          units or fewer, or under
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 6px' }}>
            {staleField('staleLowPct', 'Nearly empty percent')}
          </span>
          % of what was received, with no draw in
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 6px' }}>
            {staleField('staleLowDays', 'Days without a draw')}
          </span>
          days (controlled drugs:
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 6px' }}>
            {staleField('staleLowDaysControlled', 'Days without a draw, controlled drugs')}
          </span>
          days)
        </label>
        <label className="settings-label">
          No movement: stock on hand and nothing moved in
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 6px' }}>
            {staleField('staleNoMoveDays', 'Days with no movement')}
          </span>
          days
        </label>
      </div>
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
