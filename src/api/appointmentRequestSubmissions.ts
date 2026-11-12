import { http } from './http';

export type AppointmentRequestSubmissionKind = 'submission' | 'abandoned';

export type AppointmentRequestSubmissionStatus = 'new' | 'contacted' | 'booked' | 'dismissed';

/** Communication with the client, separate from booking. */
export type AppointmentRequestCommunicationStatus =
  | 'not_contacted'
  | 'contacted'
  | 'owner_replied'
  | 'complete';

/** Staff's records choice; null follows the records requests for the request's pets. */
export type AppointmentRequestRecordsChoice = 'not_needed' | 'waiting' | 'complete';

/** Records column, worked out on the server from the records requests and the staff choice. */
export type AppointmentRequestRecordsSummary = {
  state: 'none' | 'not_needed' | 'waiting' | 'requested' | 'received' | 'done' | 'complete';
  /** Records part finished, so it does not hold the request on the list. */
  finished: boolean;
  choice: AppointmentRequestRecordsChoice | null;
  total: number;
  pending: number;
  /** Received but not summarized in the chart yet. */
  toSummarize: number;
  patientId: number | null;
};

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
  /** True when the linked calendar visit is a HOLD (isHold type) — canonical on-hold signal. */
  linkedVisitIsHold?: boolean;
  /** Linked liaison Gmail thread when resolved. */
  gmailThreadId?: string | null;
  gmailMailbox?: string | null;
  gmailLinkedAt?: string | null;
  /** Employee who owns the request (liaison). Kept in step with the hold owner. */
  liaisonEmployeeId?: number | null;
  liaison?: { id: number; firstName: string | null; lastName: string | null } | null;
  liaisonAssignedAt?: string | null;
  /** Service zone name saved at submit; null on requests sent before Nov 2026. */
  zoneName?: string | null;
  /** Open requests only: a visit (or upcoming hold) for one of the pets since the request came in. */
  visitSinceRequest?: VisitSinceRequest | null;
  communicationStatus?: AppointmentRequestCommunicationStatus;
  recordsStatus?: AppointmentRequestRecordsChoice | null;
  /** Records column; null for Not booked requests (or if it could not be worked out). */
  records?: AppointmentRequestRecordsSummary | null;
  /** Client replies (email or text) nobody has opened yet; null when there are none. */
  unreadReplies?: AppointmentRequestUnreadReplies | null;
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
  /** Linked to a real visit, or matched to one booked after the request. */
  converted: number;
  /** Linked only to a HOLD. Not included in `converted` or the rate. */
  convertedToHold?: number;
  notConverted: number;
  /** Fraction in [0, 1]. Real appointments only. */
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
  /** Request owner. `null` clears it. Anyone may reassign to anyone. */
  liaisonEmployeeId?: number | null;
  /** A step on a New request also moves it to Contacted. */
  communicationStatus?: AppointmentRequestCommunicationStatus;
  /** `null` goes back to following the records requests. */
  recordsStatus?: AppointmentRequestRecordsChoice | null;
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
  /**
   * When true, server merges abandoned form drafts (`kind: 'abandoned'`).
   * Defaults to false on the API (fast path: completed submissions only).
   */
  includeAbandoned?: boolean;
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
        ...(params.includeAbandoned ? { includeAbandoned: 'true' } : {}),
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
const gmailLinkInflight = new Map<number, Promise<AppointmentRequestGmailLink>>();

export async function fetchAppointmentRequestGmailLink(
  id: number,
): Promise<AppointmentRequestGmailLink> {
  const key = Number(id);
  const existing = gmailLinkInflight.get(key);
  if (existing) return existing;

  const promise = http
    .get<AppointmentRequestGmailLink>(
      `/appointments/request-submissions/${encodeURIComponent(String(key))}/gmail-link`,
    )
    .then(({ data }) => data)
    .finally(() => {
      gmailLinkInflight.delete(key);
    });
  gmailLinkInflight.set(key, promise);
  return promise;
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
  includeAbandoned?: boolean;
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
  params: {
    practiceId: number;
    from?: string;
    to?: string;
    includeConversions?: boolean;
    includeAbandoned?: boolean;
  },
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
    // Counts come with page 1 only; later pages don't recompute them.
    const res = await fetchAppointmentRequestSubmissionsPage({
      ...params,
      includeConversions: false,
      page,
      limit,
    });
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

/** Texts with the request's phone number and staff call notes (emails come from Gmail). */
export type AppointmentRequestConversationResponse = {
  submissionId: number;
  phone: string | null;
  texts: Array<{ id: string; direction: 'in' | 'out'; body: string; at: string; beforeRequest: boolean }>;
  textsError: string | null;
  /** Quo calls with the request's phone: transcript and AI summary when Quo transcribed it. */
  quoCalls?: Array<{
    id: number;
    direction: 'in' | 'out';
    status: string | null;
    at: string;
    durationSeconds: number | null;
    staff: { id: number; firstName: string | null; lastName: string | null } | null;
    transcript: string | null;
    summary: string | null;
    transcriptStatus?: string | null;
    beforeRequest: boolean;
  }>;
  calls: Array<{
    id: number;
    at: string;
    outcome: 'reached' | 'voicemail' | 'no_answer';
    note: string | null;
    employee: { id: number; firstName: string | null; lastName: string | null } | null;
  }>;
};

/** GET /appointments/request-submissions/:id/conversation */
export async function fetchAppointmentRequestConversation(
  id: number,
  /** Load only texts (Quo, can be slow) or only calls (quick); default both. */
  include?: 'texts' | 'calls',
  /** Skip the API's short texts cache (a new reply came in, or we just sent). */
  fresh?: boolean,
): Promise<AppointmentRequestConversationResponse> {
  const params: Record<string, string> = {};
  if (include) params.include = include;
  if (fresh) params.fresh = '1';
  const { data } = await http.get<AppointmentRequestConversationResponse>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/conversation`,
    Object.keys(params).length ? { params } : undefined,
  );
  return data;
}

export type QuoCallSummaryResult = {
  id: number;
  transcript: string | null;
  summary: string | null;
  /** completed, absent (Quo has none), failed, not-found, in-progress… */
  transcriptStatus: string | null;
};

/** POST …/quo-calls/:callId/summary — fetch Quo's transcript if missing and summarize the call. */
export async function summarizeAppointmentRequestQuoCall(
  id: number,
  callId: number,
): Promise<QuoCallSummaryResult> {
  const { data } = await http.post<QuoCallSummaryResult>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/quo-calls/${encodeURIComponent(String(callId))}/summary`,
  );
  return data;
}

/** POST /appointments/request-submissions/:id/calls — log a phone call (counts as contact). */
export async function logAppointmentRequestCall(
  id: number,
  body: { outcome: 'reached' | 'voicemail' | 'no_answer'; note?: string | null },
): Promise<AppointmentRequestSubmission> {
  const { data } = await http.post<AppointmentRequestSubmission>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/calls`,
    body,
  );
  return data;
}

export type AppointmentRequestUnreadReplies = {
  count: number;
  lastAt: string;
  lastChannel: 'email' | 'text';
  lastPreview: string | null;
};

/** Anyone opening the request reads its replies; `read: false` is "Mark as unread". */
export async function markAppointmentRequestReplies(
  id: number,
  read: boolean,
): Promise<AppointmentRequestSubmission> {
  const { data } = await http.post<AppointmentRequestSubmission>(
    `/appointments/request-submissions/${encodeURIComponent(String(id))}/replies`,
    { read },
  );
  return data;
}

/** Requests with unread client replies: mine (or nobody's) in red, someone else's in blue. */
export async function fetchAppointmentRequestUnreadCounts(
  practiceId: number,
): Promise<{ mine: number; others: number; holdMine: number; holdOthers: number }> {
  const { data } = await http.get<{ mine: number; others: number; holdMine?: number; holdOthers?: number }>(
    '/appointments/request-submissions/unread-counts',
    { params: { practiceId } },
  );
  return {
    mine: Number(data?.mine) || 0,
    others: Number(data?.others) || 0,
    // Of the above, the ones on holds that did not come from a request (the Hold tab).
    holdMine: Number(data?.holdMine) || 0,
    holdOthers: Number(data?.holdOthers) || 0,
  };
}

/** A visit for one of the request's pets after the request came in. */
export type VisitSinceRequest = {
  appointmentId: number;
  start: string;
  typeName: string | null;
  isHold: boolean;
  past: boolean;
};

export type AppointmentRequestCleanupItem = {
  id: number;
  submittedAt: string;
  status: string;
  clientName: string;
  petNames: string[];
  notes: string | null;
  visit: VisitSinceRequest | null;
  proposal: 'booked' | 'not_booked';
};

/** GET /appointments/request-submissions/cleanup — open requests older than N days, with proposals. */
export async function fetchAppointmentRequestCleanup(
  practiceId: number,
  olderThanDays = 10,
): Promise<{ olderThanDays: number; items: AppointmentRequestCleanupItem[] }> {
  const { data } = await http.get('/appointments/request-submissions/cleanup', {
    params: { practiceId, olderThanDays },
  });
  return data;
}

/** POST /appointments/request-submissions/cleanup/apply */
export async function applyAppointmentRequestCleanup(
  items: Array<{ id: number; action: 'booked' | 'not_booked'; appointmentId?: number | null }>,
): Promise<{ booked: number; notBooked: number; skipped: number }> {
  const { data } = await http.post('/appointments/request-submissions/cleanup/apply', { items });
  return data;
}
