import { http } from './http';

export type AppointmentRequestSubmissionKind = 'submission' | 'abandoned';

/** GET /appointments/request-submissions item shape */
export type AppointmentRequestSubmissionItem = {
  kind?: AppointmentRequestSubmissionKind;
  id: number;
  practiceId: number | null;
  submittedAt: string;
  clientIp: string | null;
  requestData: Record<string, unknown>;
  created: string;
  updated: string;
  formSessionId?: string;
  currentStep?: string;
  currentStepName?: string;
  abandonReason?: string;
};

/** Conversion of public appointment requests into actual appointments. */
export type AppointmentRequestSubmissionConversions = {
  totalRequests: number;
  converted: number;
  notConverted: number;
  /** Fraction in [0, 1]. */
  conversionRate: number;
};

export type AppointmentRequestSubmissionsListResponse = {
  items: AppointmentRequestSubmissionItem[];
  total: number;
  limit: number;
  offset: number;
  conversions?: AppointmentRequestSubmissionConversions;
};

/**
 * GET /appointments/request-submissions — staff JWT (same as other appointments routes).
 */
export async function fetchAppointmentRequestSubmissionsPage(params: {
  practiceId: number;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}): Promise<AppointmentRequestSubmissionsListResponse> {
  const { data } = await http.get<AppointmentRequestSubmissionsListResponse>(
    '/appointments/request-submissions',
    {
      params: {
        practiceId: params.practiceId,
        ...(params.from != null && params.from !== '' ? { from: params.from } : {}),
        ...(params.to != null && params.to !== '' ? { to: params.to } : {}),
        page: params.page ?? 1,
        limit: params.limit ?? 50,
      },
    }
  );
  return data;
}

export type AllAppointmentRequestSubmissionsResult = {
  items: AppointmentRequestSubmissionItem[];
  conversions: AppointmentRequestSubmissionConversions | null;
};

/** Fetches every page (limit 200) until all rows for the filter are loaded. */
export async function fetchAllAppointmentRequestSubmissions(params: {
  practiceId: number;
  from?: string;
  to?: string;
}): Promise<AllAppointmentRequestSubmissionsResult> {
  const limit = 200;
  let page = 1;
  const out: AppointmentRequestSubmissionItem[] = [];
  let conversions: AppointmentRequestSubmissionConversions | null = null;
  let total = 0;
  for (;;) {
    const res = await fetchAppointmentRequestSubmissionsPage({ ...params, page, limit });
    // The conversions summary describes the full filtered set, so capture it once.
    if (conversions == null && res.conversions != null) conversions = res.conversions;
    total = typeof res.total === 'number' ? res.total : out.length + (res.items?.length ?? 0);
    const batch = res.items ?? [];
    out.push(...batch);
    if (out.length >= total || batch.length === 0) break;
    page += 1;
  }
  return { items: out, conversions };
}
