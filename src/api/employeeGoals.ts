// src/api/employeeGoals.ts
import { http } from './http';

export type DailyGoalOverride = {
  id?: number;
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  dailyPointGoal?: number;
  dailyRevenueGoal?: number;
};

export type DailyGoalBreakdownItem = {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  isWorkday: boolean;
  dailyPointGoal: number;
  dailyRevenueGoal: number;
};

export type EmployeeGoalsResponseDto = {
  id?: number;
  defaultWorkStartLocal?: string;
  defaultWorkEndLocal?: string;
  defaultStartDepotLat?: number;
  defaultStartDepotLon?: number;
  defaultEndDepotLat?: number;
  defaultEndDepotLon?: number;
  dailyRevenueGoal?: number;
  bonusRevenueGoal?: number;
  dailyPointGoal?: number;
  weeklyPointGoal?: number;
  dailyGoals?: DailyGoalOverride[];
  goalPeriodStart?: string;
  goalPeriodEnd?: string;
  effectiveWeeklyPointGoal?: number;
  effectiveWeeklyRevenueGoal?: number;
  dailyGoalBreakdown?: DailyGoalBreakdownItem[];
};

export type UpdateEmployeeGoalsDto = {
  defaultWorkStartLocal?: string;
  defaultWorkEndLocal?: string;
  defaultStartDepotLat?: number;
  defaultStartDepotLon?: number;
  defaultEndDepotLat?: number;
  defaultEndDepotLon?: number;
  dailyRevenueGoal?: number;
  bonusRevenueGoal?: number;
  dailyPointGoal?: number;
  weeklyPointGoal?: number;
  dailyGoals?: { dayOfWeek: number; dailyPointGoal?: number; dailyRevenueGoal?: number }[];
};

export type FetchEmployeeGoalsParams = {
  /** Goal period start (YYYY-MM-DD). Must be sent with endDate. */
  startDate?: string;
  /** Goal period end (YYYY-MM-DD, inclusive). Must be sent with startDate. */
  endDate?: string;
};

/**
 * Get employee goals (creates with defaults if none exist).
 * GET /employees/:id/goals?startDate=&endDate=
 * When startDate/endDate are provided, response includes dailyGoalBreakdown with OFF days zeroed.
 */
export async function fetchEmployeeGoals(
  employeeId: number,
  params?: FetchEmployeeGoalsParams
): Promise<EmployeeGoalsResponseDto> {
  const { data } = await http.get(`/employees/${employeeId}/goals`, { params });
  return data;
}

/**
 * Create or update employee goals. Only include fields to change.
 * PUT /employees/:id/goals
 */
export async function updateEmployeeGoals(
  employeeId: number,
  body: UpdateEmployeeGoalsDto
): Promise<EmployeeGoalsResponseDto> {
  const { data } = await http.put(`/employees/${employeeId}/goals`, body);
  return data;
}

export function getGoalBreakdownForDate(
  goals: EmployeeGoalsResponseDto,
  dateStr: string
): DailyGoalBreakdownItem | undefined {
  const key = dateStr.slice(0, 10);
  return goals.dailyGoalBreakdown?.find((d) => String(d.date ?? '').slice(0, 10) === key);
}

/**
 * Resolve daily point and revenue goal for a day of week (0=Sunday … 6=Saturday).
 * Uses per-day override from dailyGoals if present, otherwise default goals.
 */
export function getGoalForDay(
  goals: EmployeeGoalsResponseDto,
  dayOfWeek: number
): { pointGoal: number; revenueGoal: number } {
  const override = goals.dailyGoals?.find((d) => d.dayOfWeek === dayOfWeek);
  return {
    pointGoal: override?.dailyPointGoal ?? goals.dailyPointGoal ?? 0,
    revenueGoal: override?.dailyRevenueGoal ?? goals.dailyRevenueGoal ?? 0,
  };
}

/**
 * Resolve goals for a calendar date. Prefers server-computed dailyGoalBreakdown when present.
 */
export function getGoalForDate(
  goals: EmployeeGoalsResponseDto,
  dateStr: string,
  dayOfWeek?: number
): { pointGoal: number; revenueGoal: number; isWorkday?: boolean } {
  const breakdown = getGoalBreakdownForDate(goals, dateStr);
  if (breakdown) {
    return {
      pointGoal: breakdown.dailyPointGoal ?? 0,
      revenueGoal: breakdown.dailyRevenueGoal ?? 0,
      isWorkday: breakdown.isWorkday,
    };
  }
  const dow =
    dayOfWeek ??
    (() => {
      const parsed = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
      return Number.isFinite(parsed.getTime()) ? parsed.getDay() : 0;
    })();
  const legacy = getGoalForDay(goals, dow);
  return { ...legacy };
}

/** True when the goals record has configured defaults or per-day overrides. */
export function hasConfiguredGoalSettings(goals: EmployeeGoalsResponseDto): boolean {
  if (Number(goals.dailyPointGoal) > 0 || Number(goals.dailyRevenueGoal) > 0) return true;
  if (Number(goals.weeklyPointGoal) > 0 || Number(goals.bonusRevenueGoal) > 0) return true;
  if (goals.dailyGoals?.some((d) => Number(d.dailyPointGoal) > 0 || Number(d.dailyRevenueGoal) > 0)) {
    return true;
  }
  return false;
}

/** True if the goals record has at least one goal set (for filtering "employees with goals"). */
export function hasAnyGoal(goals: EmployeeGoalsResponseDto): boolean {
  if (hasConfiguredGoalSettings(goals)) return true;
  if (goals.dailyGoalBreakdown?.some((d) => d.dailyPointGoal > 0 || d.dailyRevenueGoal > 0)) {
    return true;
  }
  if (Number(goals.effectiveWeeklyPointGoal) > 0 || Number(goals.effectiveWeeklyRevenueGoal) > 0) {
    return true;
  }
  return false;
}

/** Normalize ops points to one decimal (avoids float noise); preserves 0.5 etc. */
export function normalizePointsValue(points: number): number {
  const n = Number(points);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/** Display ops points — whole numbers without decimals, halves as `1.5`. */
export function formatPointsValue(points: number): string {
  const n = normalizePointsValue(points);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Day header / My Day — `8/9` when a daily point goal exists, else points only. */
export function formatPointsAgainstGoal(
  points: number,
  pointGoal: number | null | undefined
): string {
  const pts = formatPointsValue(points);
  const goal = normalizedPointGoal(pointGoal);
  return goal != null ? `${pts}/${goal}` : pts;
}

export function normalizedPointGoal(pointGoal: number | null | undefined): number | null {
  if (pointGoal == null || !Number.isFinite(Number(pointGoal)) || Number(pointGoal) <= 0) {
    return null;
  }
  return Math.round(Number(pointGoal));
}

/** Green at/above goal; yellow 1–2 below; red 3+ below; null when no goal. */
export type PointsGoalProgressTone = 'met' | 'near' | 'below';

export function pointsGoalProgressTone(
  points: number,
  pointGoal: number | null | undefined
): PointsGoalProgressTone | null {
  const goal = normalizedPointGoal(pointGoal);
  if (goal == null) return null;
  const pts = normalizePointsValue(points);
  if (pts >= goal) return 'met';
  if (goal - pts <= 2) return 'near';
  return 'below';
}

export function meetsDailyPointGoal(
  points: number,
  pointGoal: number | null | undefined
): boolean {
  return pointsGoalProgressTone(points, pointGoal) === 'met';
}

export function schedulerPointsGoalClassName(
  points: number,
  pointGoal: number | null | undefined,
  variant: 'day-header' | 'week-summary'
): string | undefined {
  const tone = pointsGoalProgressTone(points, pointGoal);
  if (!tone) return undefined;
  const base =
    variant === 'day-header' ? 'scheduler-day-header-points--goal-' : 'scheduler-week-points--goal-';
  return `${base}${tone}`;
}

/** Luxon weekday (1=Mon … 7=Sun) → goals API dayOfWeek (0=Sun … 6=Sat). */
export function goalDayOfWeekFromLuxonWeekday(luxonWeekday: number): number {
  return luxonWeekday % 7;
}
