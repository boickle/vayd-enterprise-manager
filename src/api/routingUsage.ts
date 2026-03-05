import { http } from './http';

export type RoutingRequestByDay = {
  date: string;
  requestCount: number;
};

export type RoutingUsageUser = {
  userEmail: string;
  employeeName?: string;
  requestsByDay: RoutingRequestByDay[];
  totalRequests: number;
};

export type RoutingUsageResponse = {
  startDate: string;
  endDate: string;
  users: RoutingUsageUser[];
};

/**
 * GET /analytics/routing-usage?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function fetchRoutingUsage(params: {
  startDate: string;
  endDate: string;
}): Promise<RoutingUsageResponse> {
  const { data } = await http.get<RoutingUsageResponse>('/analytics/routing-usage', {
    params: {
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return data;
}
