// src/api/employeeGoals.ts
import { http } from './http';

export type DailyGoalOverride = {
  id?: number;
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  dailyPointGoal?: number;
  dailyRevenueGoal?: number;
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

/**
 * Get employee goals (creates with defaults if none exist).
 * GET /employees/:id/goals
 */
export async function fetchEmployeeGoals(employeeId: number): Promise<EmployeeGoalsResponseDto> {
  const { data } = await http.get(`/employees/${employeeId}/goals`);
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

/** True if the goals record has at least one goal set (for filtering "employees with goals"). */
export function hasAnyGoal(goals: EmployeeGoalsResponseDto): boolean {
  if (Number(goals.dailyPointGoal) > 0 || Number(goals.dailyRevenueGoal) > 0) return true;
  if (Number(goals.weeklyPointGoal) > 0 || Number(goals.bonusRevenueGoal) > 0) return true;
  if (goals.dailyGoals?.length) return true;
  return false;
}

/** Day header / My Day — `8/9` when a daily point goal exists, else points only. */
export function formatPointsAgainstGoal(
  points: number,
  pointGoal: number | null | undefined
): string {
  const pts = Math.round(Number(points) || 0);
  const goal = normalizedPointGoal(pointGoal);
  return goal != null ? `${pts}/${goal}` : String(pts);
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
  const pts = Math.round(Number(points) || 0);
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
