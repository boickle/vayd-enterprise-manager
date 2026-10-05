import { http } from './http';

/**
 * One primary provider's counts on one practice-local day.
 * `totalAppointments` is appropriate seen visits. `forwardBooked` is how many
 * of those have a real later visit on the calendar.
 */
export type ForwardBookingAnalyticsProviderDay = {
  date: string;
  primaryProviderId: number | null;
  primaryProviderPimsId: string | null;
  primaryProviderName: string;
  totalAppointments: number;
  forwardBooked: number;
};

export type ForwardBookingAnalyticsResponse = {
  startDate: string;
  endDate: string;
  timezone?: string;
  totalAppointments: number;
  forwardBooked: number;
  forwardBookedPercent: number | null;
  byProviderDay: ForwardBookingAnalyticsProviderDay[];
};

/**
 * Share of appropriate seen visits that led to a later appointment, by primary provider.
 * GET /analytics/forward-booking?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function fetchForwardBookingAnalytics(params: {
  startDate: string;
  endDate: string;
}): Promise<ForwardBookingAnalyticsResponse> {
  const { data } = await http.get<ForwardBookingAnalyticsResponse>('/analytics/forward-booking', {
    params: {
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return {
    startDate: data?.startDate ?? params.startDate,
    endDate: data?.endDate ?? params.endDate,
    timezone: data?.timezone,
    totalAppointments: Number(data?.totalAppointments ?? 0),
    forwardBooked: Number(data?.forwardBooked ?? 0),
    forwardBookedPercent:
      data?.forwardBookedPercent == null ? null : Number(data.forwardBookedPercent),
    byProviderDay: Array.isArray(data?.byProviderDay) ? data.byProviderDay : [],
  };
}
