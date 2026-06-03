// src/api/appointmentFormDrafts.ts
import { apiBaseUrl, http } from './http';

/** Set to 'false' to disable draft save / abandon beacons (GA tracking unchanged). */
export const APPOINTMENT_FORM_DRAFTS_ENABLED =
  import.meta.env.VITE_APPOINTMENT_FORM_DRAFTS_ENABLED !== 'false';

const DEFAULT_ABANDON_IDLE_MINUTES = 15;

/** Inactivity before `idle_timeout` abandon. Set minutes to `0` to disable. */
export function getAppointmentFormAbandonIdleMs(): number {
  const raw = import.meta.env.VITE_APPOINTMENT_FORM_ABANDON_IDLE_MINUTES;
  if (raw === '0' || raw === 'false' || raw === 'off') return 0;
  const minutes = Number(raw);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return DEFAULT_ABANDON_IDLE_MINUTES * 60 * 1000;
}

export type AppointmentFormDraftClientType = 'new' | 'existing';

export type AppointmentFormDraftAbandonReason =
  | 'page_hide'
  | 'component_unmount'
  | 'browser_back'
  | 'exit_to_portal'
  | 'idle_timeout'
  | 'zone_not_serviced';

export type AppointmentFormDraftStatus =
  | 'in_progress'
  | 'abandoned'
  | 'converted'
  | 'dismissed';

export type AppointmentFormDraftFollowUpStatus =
  | 'pending'
  | 'contacted'
  | 'scheduled'
  | 'not_interested'
  | 'dismissed';

export type AppointmentFormDraftData = Record<string, unknown>;

export type UpsertAppointmentFormDraftRequest = {
  formSessionId: string;
  practiceId: number;
  currentStep: string;
  currentStepName?: string;
  clientType: AppointmentFormDraftClientType;
  isLoggedIn: boolean;
  userId?: number;
  lastActivityAt?: string;
  draftData: AppointmentFormDraftData;
  analyticsContext?: Record<string, string | number>;
};

export type UpsertAppointmentFormDraftResponse = {
  draftId: number;
  formSessionId: string;
  status: AppointmentFormDraftStatus;
  contactCaptured: boolean;
  notifyEligible: boolean;
  updatedAt: string;
};

export type AbandonAppointmentFormDraftRequest = {
  formSessionId: string;
  practiceId: number;
  abandonReason: AppointmentFormDraftAbandonReason;
  currentStep: string;
  currentStepName?: string;
  clientType: AppointmentFormDraftClientType;
  isLoggedIn: boolean;
  draftData: AppointmentFormDraftData;
};

export type AbandonAppointmentFormDraftResponse = {
  draftId: number;
  status: AppointmentFormDraftStatus;
  notificationSent: boolean;
  notificationSkippedReason: string | null;
};

export type AppointmentFormDraftListItem = {
  id: number;
  practiceId: number;
  formSessionId: string;
  status: AppointmentFormDraftStatus;
  clientType: AppointmentFormDraftClientType;
  isLoggedIn: boolean;
  currentStep: string;
  currentStepName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  clientDisplayName: string | null;
  serviceArea: string | null;
  appointmentTypeSummary: string | null;
  petSummary: string | null;
  abandonReason: string | null;
  abandonedAt: string | null;
  notificationSentAt: string | null;
  receptionistEmail: string | null;
  submissionId: number | null;
  followUpStatus: AppointmentFormDraftFollowUpStatus;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentFormDraftListResponse = {
  items: AppointmentFormDraftListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AppointmentFormDraftDetail = AppointmentFormDraftListItem & {
  abandonReason: string | null;
  draftData: AppointmentFormDraftData;
  followUpNotes: string | null;
  followUpBy: number | null;
  followUpAt: string | null;
  clientIp: string | null;
  convertedAt: string | null;
};

const publicDraftsAbandonUrl = `${apiBaseUrl}/public/appointments/form-drafts/abandon`;

/**
 * Tab close / pagehide: fetch keepalive with credentials omitted.
 * sendBeacon to a cross-origin API with ACAO:* fails when credentials are included (browser default).
 */
export function keepaliveAppointmentFormAbandon(
  body: AbandonAppointmentFormDraftRequest
): void {
  if (!APPOINTMENT_FORM_DRAFTS_ENABLED || typeof fetch !== 'function') return;
  try {
    void fetch(publicDraftsAbandonUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Form-Session-Id': body.formSessionId,
      },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    });
  } catch {
    // ignore
  }
}

/** @deprecated Use keepaliveAppointmentFormAbandon — beacon hits CORS with credentials + ACAO:* */
export function sendAppointmentFormAbandonBeacon(
  body: AbandonAppointmentFormDraftRequest
): boolean {
  keepaliveAppointmentFormAbandon(body);
  return true;
}

/**
 * PUT /public/appointments/form-drafts — upsert in-progress draft (JWT when logged in).
 */
export async function upsertAppointmentFormDraft(
  body: UpsertAppointmentFormDraftRequest
): Promise<UpsertAppointmentFormDraftResponse> {
  const { data } = await http.put<UpsertAppointmentFormDraftResponse>(
    '/public/appointments/form-drafts',
    body,
    {
      headers: {
        'X-Form-Session-Id': body.formSessionId,
      },
    }
  );
  return data;
}

/**
 * POST /public/appointments/form-drafts/abandon — same axios client as PUT (visible in Network → Fetch/XHR).
 */
export async function abandonAppointmentFormDraft(
  body: AbandonAppointmentFormDraftRequest
): Promise<AbandonAppointmentFormDraftResponse> {
  const { data } = await http.post<AbandonAppointmentFormDraftResponse>(
    '/public/appointments/form-drafts/abandon',
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Form-Session-Id': body.formSessionId,
      },
    }
  );
  return data;
}

/**
 * GET /appointments/form-drafts — staff list.
 */
export async function fetchAppointmentFormDraftsPage(params: {
  practiceId: number;
  from?: string;
  to?: string;
  status?: string;
  contactCaptured?: boolean;
  page?: number;
  limit?: number;
}): Promise<AppointmentFormDraftListResponse> {
  const { data } = await http.get<AppointmentFormDraftListResponse>('/appointments/form-drafts', {
    params: {
      practiceId: params.practiceId,
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.contactCaptured != null ? { contactCaptured: params.contactCaptured } : {}),
      page: params.page ?? 1,
      limit: params.limit ?? 50,
    },
  });
  return data;
}

/**
 * GET /appointments/form-drafts/:id — staff detail.
 */
export async function fetchAppointmentFormDraft(
  id: number,
  practiceId: number
): Promise<AppointmentFormDraftDetail> {
  const { data } = await http.get<AppointmentFormDraftDetail>(`/appointments/form-drafts/${id}`, {
    params: { practiceId },
  });
  return data;
}

/**
 * PATCH /appointments/form-drafts/:id — update follow-up status.
 */
export async function patchAppointmentFormDraft(
  id: number,
  practiceId: number,
  body: {
    followUpStatus: AppointmentFormDraftFollowUpStatus;
    followUpNotes?: string;
  }
): Promise<AppointmentFormDraftDetail> {
  const { data } = await http.patch<AppointmentFormDraftDetail>(
    `/appointments/form-drafts/${id}`,
    body,
    { params: { practiceId } }
  );
  return data;
}

/** Map UI/GA abandon strings to API enum (defaults to page_hide). */
export function toAbandonReason(reason: string): AppointmentFormDraftAbandonReason {
  const allowed: AppointmentFormDraftAbandonReason[] = [
    'page_hide',
    'component_unmount',
    'browser_back',
    'exit_to_portal',
    'idle_timeout',
    'zone_not_serviced',
  ];
  if (allowed.includes(reason as AppointmentFormDraftAbandonReason)) {
    return reason as AppointmentFormDraftAbandonReason;
  }
  return 'page_hide';
}
