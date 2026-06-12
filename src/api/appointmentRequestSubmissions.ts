import { http } from './http';

export type AppointmentRequestSubmissionKind = 'submission' | 'abandoned';

export type AppointmentRequestSubmissionStatus = 'new' | 'contacted' | 'booked' | 'dismissed';

/** GET /appointments/request-submissions item shape */
export type AppointmentRequestSubmissionItem = {
  kind?: AppointmentRequestSubmissionKind;
  id: number;
  practiceId: number | null;
  submittedAt: string;
  clientIp?: string | null;
  requestData: Record<string, unknown>;
  created: string;
  updated: string;
  /** Completed submissions only */
  status?: AppointmentRequestSubmissionStatus;
  notes?: string | null;
  followUpBy?: number | null;
  followUpAt?: string | null;
  bookedAppointmentId?: number | null;
  bookedAt?: string | null;
  /** Abandoned drafts only */
  formSessionId?: string;
  currentStep?: string;
  currentStepName?: string;
  abandonReason?: string;
};

/** Staff detail / PATCH / book response */
export type AppointmentRequestSubmission = Omit<
  AppointmentRequestSubmissionItem,
  'kind' | 'formSessionId' | 'currentStep' | 'currentStepName' | 'abandonReason'
> & {
  status: AppointmentRequestSubmissionStatus;
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

export type PatchAppointmentRequestSubmissionBody = {
  status?: AppointmentRequestSubmissionStatus;
  /** Send `null` or `""` to clear. */
  notes?: string | null;
};

export type BookAppointmentRequestSubmissionBody = {
  appointmentId: number;
};

export type SendAppointmentRequestSubmissionSmsBody = {
  message: string;
  fromPhone?: string;
  overrideNonProd?: boolean;
};

export type SendAppointmentRequestSubmissionSmsResponse = {
  success: boolean;
  messageId?: string;
  to?: string;
  from?: string;
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

/** GET /appointments/request-submissions/:id — single completed submission. */
export async function fetchAppointmentRequestSubmission(
  id: number
): Promise<AppointmentRequestSubmission> {
  const { data } = await http.get<AppointmentRequestSubmission>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}`
  );
  return data;
}

/** PATCH /appointments/request-submissions/:id — status and/or notes. */
export async function patchAppointmentRequestSubmission(
  id: number,
  body: PatchAppointmentRequestSubmissionBody
): Promise<AppointmentRequestSubmission> {
  const { data } = await http.patch<AppointmentRequestSubmission>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}`,
    body
  );
  return data;
}

/** POST /appointments/request-submissions/:id/book — link a booked appointment. */
export async function bookAppointmentRequestSubmission(
  id: number,
  body: BookAppointmentRequestSubmissionBody
): Promise<AppointmentRequestSubmission> {
  const { data } = await http.post<AppointmentRequestSubmission>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/book`,
    body
  );
  return data;
}

/** POST /appointments/request-submissions/:id/sms — text the requester. */
export async function sendAppointmentRequestSubmissionSms(
  id: number,
  body: SendAppointmentRequestSubmissionSmsBody
): Promise<SendAppointmentRequestSubmissionSmsResponse> {
  const { data } = await http.post<SendAppointmentRequestSubmissionSmsResponse>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/sms`,
    body
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
    if (conversions == null && res.conversions != null) conversions = res.conversions;
    total = typeof res.total === 'number' ? res.total : out.length + (res.items?.length ?? 0);
    const batch = res.items ?? [];
    out.push(...batch);
    if (out.length >= total || batch.length === 0) break;
    page += 1;
  }
  return { items: out, conversions };
}
