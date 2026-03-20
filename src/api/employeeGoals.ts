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
