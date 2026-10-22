import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TIER_PERCENTS,
  GOAL_PERIOD_LABELS,
  deleteProductionIncentiveGoal,
  fetchProductionIncentiveGoals,
  resolveTierAmount,
  saveProductionIncentiveGoal,
  type ProductionIncentiveDoctor,
  type ProductionIncentiveGoalPeriod,
} from '../../api/productionIncentive';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

type TierDraft = { percent: string; amount: string };
type GoalDraft = {
  goalPeriod: ProductionIncentiveGoalPeriod;
  baseGoal: string;
  tiers: TierDraft[];
};

function draftFromDoctor(doc: ProductionIncentiveDoctor | undefined): GoalDraft {
  if (!doc?.goal) {
    return {
      goalPeriod: 'quarterly',
      baseGoal: '',
      tiers: DEFAULT_TIER_PERCENTS.map((p) => ({ percent: String(p), amount: '' })),
    };
  }
  return {
    goalPeriod: doc.goal.goalPeriod,
    baseGoal: String(doc.goal.baseGoal),
    tiers: doc.goal.tiers.map((t) => ({
      percent: String(t.percent),
      amount: t.amount == null ? '' : String(t.amount),
    })),
  };
}

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsProductionIncentive({ onMessage }: Props) {
  const [doctors, setDoctors] = useState<ProductionIncentiveDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(draftFromDoctor(undefined));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDoctors(await fetchProductionIncentiveGoals());
    } catch (err) {
      setLoadError(extractErr(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => doctors.find((d) => d.employeeId === selectedId),
    [doctors, selectedId]
  );

  const selectDoctor = (id: number | null) => {
    setSelectedId(id);
    setDraft(draftFromDoctor(doctors.find((d) => d.employeeId === id)));
  };

  const baseGoalNum = Number(draft.baseGoal);
  const baseGoalValid = draft.baseGoal !== '' && Number.isFinite(baseGoalNum) && baseGoalNum >= 0;

  const updateTier = (idx: number, patch: Partial<TierDraft>) =>
    setDraft((d) => ({ ...d, tiers: d.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)) }));

  const handleSave = async () => {
    if (!selected || !baseGoalValid) return;
    const tiers = draft.tiers
      .filter((t) => t.percent !== '')
      .map((t) => ({
        percent: Number(t.percent),
        amount: t.amount === '' ? null : Number(t.amount),
      }));
    if (tiers.some((t) => !Number.isFinite(t.percent) || t.percent <= 100)) {
      onMessage?.('Tier percentages must be above 100%.', 'error');
      return;
    }
    if (tiers.some((t) => t.amount != null && (!Number.isFinite(t.amount) || t.amount < 0))) {
      onMessage?.('Tier values must be positive numbers (or blank to auto-calculate).', 'error');
      return;
    }
    setSaving(true);
    try {
      const goal = await saveProductionIncentiveGoal(selected.employeeId, {
        goalPeriod: draft.goalPeriod,
        baseGoal: baseGoalNum,
        tiers,
      });
      setDoctors((prev) =>
        prev.map((d) => (d.employeeId === selected.employeeId ? { ...d, goal } : d))
      );
      setDraft(draftFromDoctor({ ...selected, goal }));
      onMessage?.(`Production incentive goal saved for ${selected.name}.`, 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selected?.goal) return;
    if (!window.confirm(`Remove ${selected.name} from the production incentive plan?`)) return;
    setSaving(true);
    try {
      await deleteProductionIncentiveGoal(selected.employeeId);
      setDoctors((prev) =>
        prev.map((d) => (d.employeeId === selected.employeeId ? { ...d, goal: null } : d))
      );
      setDraft(draftFromDoctor(undefined));
      onMessage?.(`${selected.name} removed from the production incentive plan.`, 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Production Incentive</h2>
      <p className="settings-section-description">
        Set each doctor&apos;s VSD goal (100%) and the stretch tiers for the incentive plan. Tier
        values are calculated from the 100% goal unless you enter a specific amount. Goals are
        prorated to week, month, and quarter on the Production Incentive analytics tab (52 weeks /
        12 months / 4 quarters per year).
      </p>

      {loadError && (
        <div className="settings-message settings-error-message">
          {loadError}
          <button onClick={() => setLoadError(null)} className="settings-close" type="button">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="settings-loading">
          <div className="settings-spinner"></div>
          <span>Loading doctors...</span>
        </div>
      ) : (
        <>
          <div className="settings-table-container" style={{ marginBottom: 20 }}>
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Goal period</th>
                  <th>100% goal</th>
                  <th>Tiers</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {doctors.map((d) => (
                  <tr key={d.employeeId}>
                    <td>{d.name}</td>
                    <td>{d.goal ? GOAL_PERIOD_LABELS[d.goal.goalPeriod] : '—'}</td>
                    <td>
                      {d.goal ? (
                        fmtUSD(d.goal.baseGoal)
                      ) : (
                        <span className="settings-muted">Not set</span>
                      )}
                    </td>
                    <td>
                      {d.goal?.tiers.length
                        ? d.goal.tiers
                            .map(
                              (t) =>
                                `${t.percent}%: ${fmtUSD(resolveTierAmount(d.goal!.baseGoal, t))}`
                            )
                            .join(' · ')
                        : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => selectDoctor(d.employeeId)}
                      >
                        {d.goal ? 'Edit' : 'Set goal'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="settings-card">
              <h3 className="settings-card-title">{selected.name}</h3>
              <div
                className="settings-form-group"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <div>
                  <label className="settings-label" htmlFor="production-incentive-goal-period">
                    Goal period
                  </label>
                  <select
                    id="production-incentive-goal-period"
                    className="settings-select"
                    value={draft.goalPeriod}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        goalPeriod: e.target.value as ProductionIncentiveGoalPeriod,
                      }))
                    }
                  >
                    {(Object.keys(GOAL_PERIOD_LABELS) as ProductionIncentiveGoalPeriod[]).map(
                      (p) => (
                        <option key={p} value={p}>
                          {GOAL_PERIOD_LABELS[p]}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="settings-label" htmlFor="production-incentive-base-goal">
                    VSD goal (100%)
                  </label>
                  <input
                    id="production-incentive-base-goal"
                    type="number"
                    min={0}
                    step={100}
                    className="settings-input"
                    value={draft.baseGoal}
                    onChange={(e) => setDraft((d) => ({ ...d, baseGoal: e.target.value }))}
                  />
                </div>
              </div>

              <h4 className="settings-card-title" style={{ marginTop: 16, fontSize: 16 }}>
                Stretch tiers
              </h4>
              <p className="settings-muted" style={{ marginBottom: 8 }}>
                Leave the value blank to use the percentage of the 100% goal.
              </p>
              <div className="settings-table-container">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Percent of goal</th>
                      <th>Value ({GOAL_PERIOD_LABELS[draft.goalPeriod].toLowerCase()})</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.tiers.map((t, idx) => {
                      const pct = Number(t.percent);
                      const auto =
                        baseGoalValid && Number.isFinite(pct)
                          ? fmtUSD((baseGoalNum * pct) / 100)
                          : '';
                      return (
                        <tr key={idx}>
                          <td>
                            <input
                              type="number"
                              min={100.01}
                              step={1}
                              className="settings-input"
                              style={{ width: 100 }}
                              value={t.percent}
                              onChange={(e) => updateTier(idx, { percent: e.target.value })}
                            />
                            %
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={100}
                              className="settings-input"
                              style={{ width: 160 }}
                              placeholder={auto ? `Auto: ${auto}` : 'Auto'}
                              value={t.amount}
                              onChange={(e) => updateTier(idx, { amount: e.target.value })}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  tiers: d.tiers.filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={draft.tiers.length >= 10}
                  onClick={() =>
                    setDraft((d) => {
                      const top = Math.max(100, ...d.tiers.map((t) => Number(t.percent) || 0));
                      return {
                        ...d,
                        tiers: [...d.tiers, { percent: String(top + 5), amount: '' }],
                      };
                    })
                  }
                >
                  Add tier
                </button>
              </div>

              <div
                className="settings-action-bar"
                style={{ marginTop: 24, display: 'flex', gap: 10 }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleSave()}
                  disabled={saving || !baseGoalValid}
                >
                  {saving ? 'Saving...' : 'Save goal'}
                </button>
                {selected.goal && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => void handleRemove()}
                    disabled={saving}
                  >
                    Remove from plan
                  </button>
                )}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => selectDoctor(null)}
                  disabled={saving}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
