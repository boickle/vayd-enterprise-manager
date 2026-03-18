import { http } from './http';

export type FillDayRequestByDay = {
  date: string;
  requestCount: number;
};

export type FillDayUsageUser = {
  userEmail: string;
  employeeName?: string;
  requestsByDay: FillDayRequestByDay[];
  totalRequests: number;
};

export type FillDayUsageResponse = {
  startDate: string;
  endDate: string;
  users: FillDayUsageUser[];
};

/**
 * GET /analytics/fill-day-usage?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function fetchFillDayUsage(params: {
  startDate: string;
  endDate: string;
}): Promise<FillDayUsageResponse> {
  const { data } = await http.get<FillDayUsageResponse>('/analytics/fill-day-usage', {
    params: {
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return data;
}
