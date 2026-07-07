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
  /** Staff flagged that records are still needed — independent of booked / contacted / etc. */
  needsRecords?: boolean;
  /** Set when staff clicks Records received (not inferred from `needsRecords === false`). */
  recordsReceivedAt?: string | null;
  /** Set when staff confirms an auto-booked online request. */
  staffConfirmedAt?: string | null;
  /** Ops points on the linked calendar visit when `bookedAppointmentId` is set (from server). */
  linkedVisitPoints?: number | null;
  /** Linked liaison Gmail thread when resolved. */
  gmailThreadId?: string | null;
  gmailMailbox?: string | null;
  gmailLinkedAt?: string | null;
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
  /** Send `null` to clear after marking need records again. */
  recordsReceivedAt?: string | null;
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

/** Liaison Gmail thread for a submission (stored link or server-side Gmail search). */
export type AppointmentRequestGmailLink = {
  threadId: string | null;
  mailbox: string | null;
  linkedAt: string | null;
  subject: string | null;
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
  /** When true, server scans appointments to populate `conversions` (requires from/to for large sets). */
  includeConversions?: boolean;
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
        ...(params.includeConversions ? { includeConversions: 'true' } : {}),
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

/**
 * GET /appointments/request-submissions/:id/gmail-link — liaison Gmail thread.
 *
 * Returns the stored link when `gmailThreadId` is set. When missing, the server should
 * search info@ for the notification around `submittedAt` (±5 minutes), persist the
 * thread id, and return it. Ideally that runs once at submission create time.
 */
export async function fetchAppointmentRequestGmailLink(
  id: number,
): Promise<AppointmentRequestGmailLink> {
  const { data } = await http.get<AppointmentRequestGmailLink>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/gmail-link`,
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
  includeConversions?: boolean;
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

/** GET /appointments/request-submissions/:id/pdf — staff PDF of the submitted form. */
async function assertPdfBlob(blob: Blob): Promise<Blob> {
  const header = await blob.slice(0, 5).text();
  if (header.startsWith('%PDF')) return blob;

  let message = 'Server did not return a valid PDF.';
  try {
    const text = await blob.text();
    const json = JSON.parse(text) as { message?: string | string[] };
    if (typeof json.message === 'string' && json.message.trim()) {
      message = json.message;
    } else if (Array.isArray(json.message) && json.message.length > 0) {
      message = json.message.join(', ');
    }
  } catch {
    /* ignore parse errors */
  }
  throw new Error(message);
}

export async function fetchAppointmentRequestSubmissionPdf(id: number): Promise<Blob> {
  const { data } = await http.get(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/pdf`,
    { responseType: 'blob' },
  );
  const blob = data instanceof Blob ? data : new Blob([data]);
  return assertPdfBlob(blob);
}

export function appointmentRequestSubmissionPdfFilename(
  submissionId: number,
  clientLabel?: string | null,
): string {
  const slug = (clientLabel ?? '')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug
    ? `appointment-request-${submissionId}-${slug}.pdf`
    : `appointment-request-${submissionId}.pdf`;
}

export async function downloadAppointmentRequestSubmissionPdf(
  submissionId: number,
  clientLabel?: string | null,
): Promise<void> {
  const blob = await fetchAppointmentRequestSubmissionPdf(submissionId);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = appointmentRequestSubmissionPdfFilename(submissionId, clientLabel);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
