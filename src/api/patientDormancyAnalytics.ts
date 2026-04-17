import { http } from './http';

export type PatientDormancyByDay = {
  date: string;
  count: number;
};

export type PatientDormancyAnalyticsResponse = {
  byDay?: PatientDormancyByDay[];
  returningByDay?: PatientDormancyByDay[];
  /** Calendar-day active patient counts in `timezone` (same shape as `byDay`). */
  activePatientsByDay?: PatientDormancyByDay[];
  /** Calendar-day active client (owner–practice) counts; same shape as `byDay`. */
  activeClientsByDay?: PatientDormancyByDay[];
  totalDormantTransitionsInRange?: number;
  totalReturningTransitionsInRange?: number;
  definition?: string;
  returningDefinition?: string;
  activePatientsDefinition?: string;
  activeClientsDefinition?: string;
  startDate?: string;
  endDate?: string;
  asOf?: string;
};

/**
 * GET /analytics/patient-dormancy
 * startDate/endDate: YYYY-MM-DD inclusive. timezone: IANA (optional).
 */
export async function fetchPatientDormancyAnalytics(params: {
  startDate: string;
  endDate: string;
  timezone?: string;
  practiceId?: number;
  asOf?: string;
}): Promise<PatientDormancyAnalyticsResponse> {
  const query: Record<string, string | number> = {
    startDate: params.startDate,
    endDate: params.endDate,
  };
  if (params.timezone?.trim()) query.timezone = params.timezone.trim();
  if (params.practiceId != null && Number.isFinite(params.practiceId)) {
    query.practiceId = params.practiceId;
  }
  if (params.asOf?.trim()) query.asOf = params.asOf.trim();

  const { data } = await http.get<PatientDormancyAnalyticsResponse>('/analytics/patient-dormancy', {
    params: query,
  });
  return data ?? {};
}
