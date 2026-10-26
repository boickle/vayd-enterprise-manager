import { http } from './http';

/* =========================
 * Production incentive plan (admin only)
 * Base path: /analytics/production-incentive
 * ========================= */

export type ProductionIncentiveGoalPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annual';
/** `payout` = the plan's payout cycle (every N months from the cycle start month). */
export type ProductionIncentiveGranularity = 'week' | 'month' | 'quarter' | 'payout';

/** Plan-wide: bonuses are earned over each payout cycle of `payoutMonths` months. */
export type ProductionIncentiveSettings = {
  payoutMonths: number;
  /** YYYY-MM a cycle starts on; cycles repeat every payoutMonths from it. */
  payoutStartMonth: string;
};

export function describePayoutSchedule(s: ProductionIncentiveSettings): string {
  if (s.payoutMonths === 1) return 'Monthly';
  const startsInQuarterMonth = (Number(s.payoutStartMonth.slice(5, 7)) - 1) % 3 === 0;
  if (s.payoutMonths === 3 && startsInQuarterMonth) return 'Quarterly';
  return `Every ${s.payoutMonths} months`;
}

export const GOAL_PERIOD_LABELS: Record<ProductionIncentiveGoalPeriod, string> = {
  weekly: 'Per week',
  monthly: 'Per month',
  quarterly: 'Per quarter',
  annual: 'Per year',
};

/** Default plan: tier threshold (percent of goal) → share of the margin above goal. */
export const DEFAULT_TIERS: ReadonlyArray<{ percent: number; marginShare: number }> = [
  { percent: 105, marginShare: 30 },
  { percent: 110, marginShare: 35 },
  { percent: 115, marginShare: 40 },
  { percent: 120, marginShare: 50 },
];

export const DEFAULT_DVM_SHARE_PERCENT = 70;

/**
 * Stretch tier above 100%. `amount` null = 100% goal × percent.
 * Reaching it pays `marginShare`% of (tier goal − 100% goal).
 */
export type ProductionIncentiveTier = {
  percent: number;
  amount: number | null;
  marginShare: number;
};

export type ProductionIncentiveGoal = {
  goalPeriod: ProductionIncentiveGoalPeriod;
  baseGoal: number;
  tiers: ProductionIncentiveTier[];
  dvmSharePercent: number;
  updated: string | null;
};

export type ProductionIncentiveDoctor = {
  employeeId: number;
  name: string;
  email: string | null;
  goal: ProductionIncentiveGoal | null;
};

export type ProductionIncentivePeriod = {
  key: string;
  label: string;
  start: string;
  end: string;
  totalDays: number;
  elapsedDays: number;
  status: 'complete' | 'in_progress' | 'future';
};

export type ProductionIncentiveTierResult = {
  percent: number;
  goal: number;
  achieved: boolean;
  remaining: number;
  marginShare: number;
  /** Bonus pool paid when this tier is reached. */
  pool: number;
};

export type ProductionIncentiveBonus = {
  tierPercent: number;
  pool: number;
  dvm: number;
  tech: number;
};

export type ProductionIncentiveEvaluation = {
  key: string;
  actual: number;
  goal: number;
  percentOfGoal: number | null;
  projected: number | null;
  projectedPercentOfGoal: number | null;
  tiers: ProductionIncentiveTierResult[];
  highestTierAchieved: number | null;
  nextTier: ProductionIncentiveTierResult | null;
  /** Bonus for the highest stretch tier reached; null below the first stretch tier. */
  bonus: ProductionIncentiveBonus | null;
  dvmSharePercent: number;
};

export type ProductionIncentiveReport = {
  granularity: ProductionIncentiveGranularity;
  start: string;
  end: string;
  today: string;
  settings: ProductionIncentiveSettings;
  periods: ProductionIncentivePeriod[];
  /** Payout cycle the last (selected) period counts toward. */
  payoutPeriod: ProductionIncentivePeriod;
  doctors: Array<{
    employeeId: number;
    name: string;
    email: string | null;
    goal: ProductionIncentiveGoal;
    /** Bonus and tier pools are only set on periods that are exactly one payout cycle. */
    periods: ProductionIncentiveEvaluation[];
    /** Progress and bonus for `payoutPeriod`. */
    payout: ProductionIncentiveEvaluation;
  }>;
};

export async function fetchProductionIncentiveSettings(): Promise<ProductionIncentiveSettings> {
  const { data } = await http.get('/analytics/production-incentive/settings');
  return data;
}

export async function saveProductionIncentiveSettings(
  body: ProductionIncentiveSettings
): Promise<ProductionIncentiveSettings> {
  const { data } = await http.put('/analytics/production-incentive/settings', body);
  return data;
}

export async function fetchProductionIncentiveGoals(): Promise<ProductionIncentiveDoctor[]> {
  const { data } = await http.get('/analytics/production-incentive/goals');
  return Array.isArray(data) ? data : [];
}

export async function saveProductionIncentiveGoal(
  employeeId: number,
  body: {
    goalPeriod: ProductionIncentiveGoalPeriod;
    baseGoal: number;
    tiers: ProductionIncentiveTier[];
    dvmSharePercent: number;
  }
): Promise<ProductionIncentiveGoal> {
  const { data } = await http.put(`/analytics/production-incentive/goals/${employeeId}`, body);
  return data;
}

export async function deleteProductionIncentiveGoal(employeeId: number): Promise<void> {
  await http.delete(`/analytics/production-incentive/goals/${employeeId}`);
}

export async function fetchProductionIncentiveReport(params: {
  granularity: ProductionIncentiveGranularity;
  start: string;
  end: string;
}): Promise<ProductionIncentiveReport> {
  const { data } = await http.get('/analytics/production-incentive/report', { params });
  return data;
}

/** Tier amount in the goal's own period (override, else 100% goal × percent). */
export function resolveTierAmount(
  baseGoal: number,
  tier: Pick<ProductionIncentiveTier, 'percent' | 'amount'>
): number {
  if (tier.amount != null) return tier.amount;
  return Math.round(baseGoal * tier.percent) / 100;
}

/** Bonus pool for a tier in the goal's own period. */
export function resolveTierPool(baseGoal: number, tier: ProductionIncentiveTier): number {
  const margin = Math.max(0, resolveTierAmount(baseGoal, tier) - baseGoal);
  return Math.round(margin * tier.marginShare) / 100;
}
