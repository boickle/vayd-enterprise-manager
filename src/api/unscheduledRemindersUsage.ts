import { http } from './http';
import type { FillDayUsageResponse } from './fillDayUsage';

/** Same shape as fill-day usage analytics. */
export type UnscheduledRemindersUsageResponse = FillDayUsageResponse;

/**
 * GET /analytics/unscheduled-reminders-usage?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Counts GET /reminders/unscheduled from api_audit (same rules as fill-day usage).
 */
export async function fetchUnscheduledRemindersUsage(params: {
  startDate: string;
  endDate: string;
}): Promise<UnscheduledRemindersUsageResponse> {
  const { data } = await http.get<UnscheduledRemindersUsageResponse>(
    '/analytics/unscheduled-reminders-usage',
    {
      params: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
    }
  );
  return data;
}
