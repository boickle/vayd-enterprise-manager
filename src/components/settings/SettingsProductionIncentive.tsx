import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DVM_SHARE_PERCENT,
  DEFAULT_TIERS,
  GOAL_PERIOD_LABELS,
  deleteProductionIncentiveGoal,
  describePayoutSchedule,
  fetchProductionIncentiveGoals,
  fetchProductionIncentiveSettings,
  resolveTierPool,
  saveProductionIncentiveGoal,
  saveProductionIncentiveSettings,
  type ProductionIncentiveDoctor,
  type ProductionIncentiveGoalPeriod,
  type ProductionIncentiveSettings,
} from '../../api/productionIncentive';

const GOAL_PERIODS_PER_YEAR: Record<ProductionIncentiveGoalPeriod, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

type PayoutMode = 'monthly' | 'quarterly' | 'custom';

function payoutModeOf(s: ProductionIncentiveSettings): PayoutMode {
  const label = describePayoutSchedule(s);
  return label === 'Monthly' ? 'monthly' : label === 'Quarterly' ? 'quarterly' : 'custom';
}

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

/** Tiers are edited as "% above goal" (5) and stored as percent of goal (105). */
type TierDraft = { aboveGoal: string; marginShare: string; amount: string };
type GoalDraft = {
  goalPeriod: ProductionIncentiveGoalPeriod;
  baseGoal: string;
  dvmShare: string;
  tiers: TierDraft[];
};

function draftFromDoctor(doc: ProductionIncentiveDoctor | undefined): GoalDraft {
  if (!doc?.goal) {
    return {
      goalPeriod: 'quarterly',
      baseGoal: '',
      dvmShare: String(DEFAULT_DVM_SHARE_PERCENT),
      tiers: DEFAULT_TIERS.map((t) => ({
        aboveGoal: String(t.percent - 100),
        marginShare: String(t.marginShare),
        amount: '',
      })),
    };
  }
  return {
    goalPeriod: doc.goal.goalPeriod,
    baseGoal: String(doc.goal.baseGoal),
    dvmShare: String(doc.goal.dvmSharePercent),
    tiers: doc.goal.tiers.map((t) => ({
      aboveGoal: String(Math.round((t.percent - 100) * 100) / 100),
      marginShare: String(t.marginShare),
      amount: t.amount == null ? '' : String(t.amount),
    })),
  };
}

function parseTier(t: TierDraft) {
  return {
    percent: 100 + Number(t.aboveGoal),
    marginShare: t.marginShare === '' ? 0 : Number(t.marginShare),
    amount: t.amount === '' ? null : Number(t.amount),
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
  const [settings, setSettings] = useState<ProductionIncentiveSettings | null>(null);
  const [payoutMode, setPayoutMode] = useState<PayoutMode>('quarterly');
  const [payoutMonths, setPayoutMonths] = useState('3');
  const [payoutStartMonth, setPayoutStartMonth] = useState(`${new Date().getFullYear()}-01`);
  const [savingSettings, setSavingSettings] = useState(false);

  const applySettings = (s: ProductionIncentiveSettings) => {
    setSettings(s);
    setPayoutMode(payoutModeOf(s));
    setPayoutMonths(String(s.payoutMonths));
    setPayoutStartMonth(s.payoutStartMonth);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [docs, s] = await Promise.all([
        fetchProductionIncentiveGoals(),
        fetchProductionIncentiveSettings(),
      ]);
      setDoctors(docs);
      applySettings(s);
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
  const dvmShareNum = Number(draft.dvmShare);
  const dvmShareValid =
    draft.dvmShare !== '' && Number.isFinite(dvmShareNum) && dvmShareNum >= 0 && dvmShareNum <= 100;

  const updateTier = (idx: number, patch: Partial<TierDraft>) =>
    setDraft((d) => ({
      ...d,
      tiers: d.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));

  const handleSave = async () => {
    if (!selected || !baseGoalValid) return;
    if (!dvmShareValid) {
      onMessage?.('DVM share must be between 0 and 100%.', 'error');
      return;
    }
    const tiers = draft.tiers.filter((t) => t.aboveGoal !== '').map(parseTier);
    if (tiers.some((t) => !Number.isFinite(t.percent) || t.percent <= 100)) {
      onMessage?.('Each tier must be more than 0% above goal.', 'error');
      return;
    }
    if (
      tiers.some((t) => !Number.isFinite(t.marginShare) || t.marginShare < 0 || t.marginShare > 100)
    ) {
      onMessage?.('Share of margin must be between 0 and 100%.', 'error');
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
        dvmSharePercent: dvmShareNum,
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

  const payoutDraft: ProductionIncentiveSettings | null = (() => {
    if (payoutMode === 'monthly') {
      return { payoutMonths: 1, payoutStartMonth: `${new Date().getFullYear()}-01` };
    }
    if (payoutMode === 'quarterly') {
      return { payoutMonths: 3, payoutStartMonth: `${new Date().getFullYear()}-01` };
    }
    const months = Number(payoutMonths);
    if (!Number.isInteger(months) || months < 1 || months > 12) return null;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payoutStartMonth)) return null;
    return { payoutMonths: months, payoutStartMonth };
  })();
  const payoutDirty =
    !!settings &&
    !!payoutDraft &&
    (payoutDraft.payoutMonths !== settings.payoutMonths ||
      (payoutMode === 'custom' && payoutDraft.payoutStartMonth !== settings.payoutStartMonth) ||
      payoutModeOf(payoutDraft) !== payoutModeOf(settings));

  const handleSaveSettings = async () => {
    if (!payoutDraft) {
      onMessage?.('Payout cycle must be 1–12 months with a valid start month.', 'error');
      return;
    }
    setSavingSettings(true);
    try {
      applySettings(await saveProductionIncentiveSettings(payoutDraft));
      onMessage?.(
        `Payout schedule saved: ${describePayoutSchedule(payoutDraft).toLowerCase()}.`,
        'success'
      );
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const periodLabel = GOAL_PERIOD_LABELS[draft.goalPeriod].toLowerCase();
  const payoutMonthsSaved = settings?.payoutMonths ?? 3;
  const payoutLabel = settings ? describePayoutSchedule(settings).toLowerCase() : 'quarterly';
  /** Pools are stated in the goal period; scale them to one payout cycle. */
  const toPayoutCycle = (amount: number) =>
    (amount * GOAL_PERIODS_PER_YEAR[draft.goalPeriod] * payoutMonthsSaved) / 12;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Production Incentive</h2>
      <p className="settings-section-description">
        Set each doctor&apos;s VSD goal (100%) and their incentive tiers. Reaching a tier pays its
        share of that tier&apos;s margin above goal: landing anywhere from 105% to 109% pays 30% of
        the 5% margin, not of the actual margin. The bonus pool is split between the DVM and tech.
        Bonuses are earned per payout period: a doctor has to reach a tier over the whole payout
        period to be paid for it. Goals are prorated to each period (52 weeks / 12 months / 4
        quarters per year).
      </p>

      {settings && (
        <div className="settings-card" style={{ marginBottom: 20 }}>
          <h3 className="settings-card-title">Payout schedule</h3>
          <p className="settings-muted" style={{ marginBottom: 8 }}>
            Applies to every doctor on the plan. Currently:{' '}
            <strong>{describePayoutSchedule(settings)}</strong>.
          </p>
          <div
            className="settings-form-group"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <div>
              <label className="settings-label" htmlFor="production-incentive-payout-mode">
                Pay out
              </label>
              <select
                id="production-incentive-payout-mode"
                className="settings-select"
                value={payoutMode}
                onChange={(e) => setPayoutMode(e.target.value as PayoutMode)}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly (calendar quarters)</option>
                <option value="custom">Every N months</option>
              </select>
            </div>
            {payoutMode === 'custom' && (
              <>
                <div>
                  <label className="settings-label" htmlFor="production-incentive-payout-months">
                    Months per payout
                  </label>
                  <input
                    id="production-incentive-payout-months"
                    type="number"
                    min={1}
                    max={12}
                    step={1}
                    className="settings-input"
                    value={payoutMonths}
                    onChange={(e) => setPayoutMonths(e.target.value)}
                  />
                </div>
                <div>
                  <label className="settings-label" htmlFor="production-incentive-payout-start">
                    A payout period starts in
                  </label>
                  <input
                    id="production-incentive-payout-start"
                    type="month"
                    className="settings-input"
                    value={payoutStartMonth}
                    onChange={(e) => setPayoutStartMonth(e.target.value)}
                  />
                </div>
              </>
            )}
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => void handleSaveSettings()}
                disabled={savingSettings || !payoutDirty}
              >
                {savingSettings ? 'Saving...' : 'Save schedule'}
              </button>
            </div>
          </div>
          {payoutMode === 'custom' && (
            <p className="settings-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Payout periods repeat every {payoutMonths || 'N'} months from the start month, in both
              directions (e.g. every 2 months from February: Dec–Jan, Feb–Mar, Apr–May…).
            </p>
          )}
        </div>
      )}

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
                  <th>Tiers (above goal → share of margin)</th>
                  <th>DVM / tech</th>
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
                                `+${Math.round((t.percent - 100) * 100) / 100}% → ${t.marginShare}%`
                            )
                            .join(' · ')
                        : '—'}
                    </td>
                    <td>
                      {d.goal ? `${d.goal.dvmSharePercent} / ${100 - d.goal.dvmSharePercent}` : '—'}
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
                <div>
                  <label className="settings-label" htmlFor="production-incentive-dvm-share">
                    DVM share of bonus (%)
                  </label>
                  <input
                    id="production-incentive-dvm-share"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    className="settings-input"
                    value={draft.dvmShare}
                    onChange={(e) => setDraft((d) => ({ ...d, dvmShare: e.target.value }))}
                  />
                  <p className="settings-muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Tech gets {dvmShareValid ? `${100 - dvmShareNum}%` : 'the rest'}.
                  </p>
                </div>
              </div>

              <h4 className="settings-card-title" style={{ marginTop: 16, fontSize: 16 }}>
                Tiers
              </h4>
              <p className="settings-muted" style={{ marginBottom: 8 }}>
                Threshold value defaults to the goal plus the percent above; enter an amount to
                override it. The bonus pool is the share of margin times (threshold − goal), shown
                for one {payoutLabel} payout.
              </p>
              <div className="settings-table-container">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>% above goal</th>
                      <th>Share of margin</th>
                      <th>Threshold value ({periodLabel})</th>
                      <th>Bonus pool (per {payoutLabel} payout)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.tiers.map((t, idx) => {
                      const tier = parseTier(t);
                      const valid = baseGoalValid && Number.isFinite(tier.percent);
                      const autoThreshold = valid ? fmtUSD((baseGoalNum * tier.percent) / 100) : '';
                      const cyclePool = toPayoutCycle(resolveTierPool(baseGoalNum, tier));
                      const pool =
                        valid && Number.isFinite(tier.marginShare) ? fmtUSD(cyclePool) : '—';
                      const dvmPool =
                        valid && dvmShareValid ? cyclePool * (dvmShareNum / 100) : null;
                      return (
                        <tr key={idx}>
                          <td>
                            <input
                              type="number"
                              min={0.01}
                              step={1}
                              className="settings-input"
                              style={{ width: 90 }}
                              value={t.aboveGoal}
                              onChange={(e) => updateTier(idx, { aboveGoal: e.target.value })}
                              aria-label={`Tier ${idx + 1} percent above goal`}
                            />
                            %
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              className="settings-input"
                              style={{ width: 90 }}
                              value={t.marginShare}
                              onChange={(e) => updateTier(idx, { marginShare: e.target.value })}
                              aria-label={`Tier ${idx + 1} share of margin`}
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
                              placeholder={autoThreshold ? `Auto: ${autoThreshold}` : 'Auto'}
                              value={t.amount}
                              onChange={(e) => updateTier(idx, { amount: e.target.value })}
                              aria-label={`Tier ${idx + 1} threshold value`}
                            />
                          </td>
                          <td>
                            {pool}
                            {dvmPool != null && (
                              <div className="settings-muted" style={{ fontSize: 12 }}>
                                DVM {fmtUSD(dvmPool)} · tech {fmtUSD(cyclePool - dvmPool)}
                              </div>
                            )}
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
                      const last = d.tiers[d.tiers.length - 1];
                      const top = Math.max(0, ...d.tiers.map((t) => Number(t.aboveGoal) || 0));
                      return {
                        ...d,
                        tiers: [
                          ...d.tiers,
                          {
                            aboveGoal: String(top + 5),
                            marginShare: last?.marginShare ?? '',
                            amount: '',
                          },
                        ],
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
