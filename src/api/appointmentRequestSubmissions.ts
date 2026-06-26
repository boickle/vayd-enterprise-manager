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
  /** Present when status is dismissed (shown as "Not booked" in the UI). */
  notBookedReason?: string | null;
  /** Independent flag — can coexist with booked / contacted / etc. */
  needsRecords?: boolean;
  /** Set when staff confirms an auto-booked online request. */
  staffConfirmedAt?: string | null;
  /** Ops points on the linked calendar visit when `bookedAppointmentId` is set (from server). */
  linkedVisitPoints?: number | null;
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
  /** Required when setting status to `dismissed`. */
  notBookedReason?: string | null;
  needsRecords?: boolean;
  /** Marks an auto-booked online request as staff-confirmed. */
  confirm?: boolean;
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
  const first = await fetchAppointmentRequestSubmissionsPage({ ...params, page: 1, limit });
  const items = await fetchRemainingAppointmentRequestSubmissionPages(params, first, limit);
  return {
    items,
    conversions: first.conversions ?? null,
  };
}

/** Pages after the first — used to show page 1 quickly, then backfill the rest. */
export async function fetchRemainingAppointmentRequestSubmissionPages(
  params: { practiceId: number; from?: string; to?: string },
  firstPage: AppointmentRequestSubmissionsListResponse,
  limit = 200,
): Promise<AppointmentRequestSubmissionItem[]> {
  const total =
    typeof firstPage.total === 'number'
      ? firstPage.total
      : (firstPage.items?.length ?? 0);
  const out: AppointmentRequestSubmissionItem[] = [...(firstPage.items ?? [])];
  if (out.length >= total) return out;

  let page = 2;
  for (;;) {
    const res = await fetchAppointmentRequestSubmissionsPage({ ...params, page, limit });
    const batch = res.items ?? [];
    out.push(...batch);
    if (out.length >= total || batch.length === 0) break;
    page += 1;
  }
  return out;
}
