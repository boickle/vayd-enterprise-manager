import { http } from './http';

export type UpsertServiceAreaInterestRequest = {
  practiceId: number;
  formSessionId?: string;
  city: string;
  state: string;
  zip?: string;
  addressLine1?: string;
  latitude?: number;
  longitude?: number;
  email?: string;
  phone?: string;
  fullName?: string;
  /** When true, join the notify-when-in-area waitlist (email required). */
  notifyRequested?: boolean;
  source?: string;
};

export type UpsertServiceAreaInterestResponse = {
  id: number;
  status: 'recorded' | 'waitlisted' | 'notified' | 'unsubscribed';
  notifyRequested: boolean;
  city: string;
  state: string;
  created: string;
  updated: string;
};

export type ServiceAreaInterestCityStateRow = {
  city: string;
  state: string;
  attempts: number;
  waitlistSignups: number;
};

export type ServiceAreaInterestAnalyticsResponse = {
  startDate: string;
  endDate: string;
  practiceId: number;
  totalAttempts: number;
  totalWaitlistSignups: number;
  byCityState: ServiceAreaInterestCityStateRow[];
};

/**
 * Record an out-of-service-area attempt and/or join the notify waitlist.
 * POST /public/appointments/service-area-interest
 */
export async function upsertServiceAreaInterest(
  body: UpsertServiceAreaInterestRequest
): Promise<UpsertServiceAreaInterestResponse> {
  const { data } = await http.post<UpsertServiceAreaInterestResponse>(
    '/public/appointments/service-area-interest',
    body
  );
  return data;
}

/**
 * Staff analytics: OOSA attempts + waitlist by city/state.
 * GET /analytics/appointment-service-area-interest
 */
export async function fetchServiceAreaInterestAnalytics(params: {
  startDate: string;
  endDate: string;
  practiceId?: number;
}): Promise<ServiceAreaInterestAnalyticsResponse> {
  const { data } = await http.get<ServiceAreaInterestAnalyticsResponse>(
    '/analytics/appointment-service-area-interest',
    {
      params: {
        startDate: params.startDate,
        endDate: params.endDate,
        practiceId: params.practiceId ?? 1,
      },
    }
  );
  return data;
}
