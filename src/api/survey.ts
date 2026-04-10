import axios from 'axios';
import { http, getToken } from './http';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/** Public client for survey form/submit - no auth headers (token from URL only). */
const publicSurveyClient = axios.create({ baseURL, withCredentials: false });

// ---------------------------------------------------------------------------
// Types (form load)
// ---------------------------------------------------------------------------

export type SurveyFormSurvey = {
  id: number;
  name: string;
  slug: string;
};

export type SurveyFormInvite = {
  appointmentId: number;
  expiresAt: string;
};

export type SurveyQuestionConfigScale = {
  scaleFrom: number;
  scaleTo: number;
  fromText: string;
  toText: string;
};

export type SurveyQuestionConfigImageOption = {
  value: string;
  label: string;
  imageUrl: string;
};

export type SurveyQuestionConfigImageChoice = {
  options: SurveyQuestionConfigImageOption[];
};

export type SurveyQuestionConfigRadio = {
  options: string[];
};

/** Conditional visibility: show this question only when another question has exactly this value. */
export type SurveyQuestionConfigShowWhen = {
  questionKey: string;
  value: string;
};

export type SurveyFormQuestion = {
  id: number;
  questionKey: string;
  questionText: string;
  questionType: 'scale' | 'radio' | 'dropdown' | 'image_choice' | 'textarea' | 'textbox';
  required: boolean;
  order: number;
  /** 1-based page number this question appears on (from API). Default 1. */
  page?: number | null;
  config?: SurveyQuestionConfigScale | SurveyQuestionConfigImageChoice | SurveyQuestionConfigRadio | Record<string, unknown>;
  /** Optional section header to show before this question (when API omits sections array) */
  pageSection?: string | null;
};

export type SurveyFormSection = {
  id: string;
  title?: string;
  subHeader?: string;
  pageInfo?: string;
  order: number;
};

export type SurveyFormResponse = {
  survey: SurveyFormSurvey;
  invite?: SurveyFormInvite;
  questions: SurveyFormQuestion[];
  sections: SurveyFormSection[];
};

// ---------------------------------------------------------------------------
// Types (submit)
// ---------------------------------------------------------------------------

export type SurveyAnswerInput = {
  questionKey: string;
  value: string;
};

export type SurveySubmitRequest = {
  token: string;
  answers: SurveyAnswerInput[];
};

export type SurveySubmitResponse = {
  responseId: number;
  message: string;
};

/**
 * POST /survey/post-appointment/referral (public, no auth).
 * referrerEmail must match the invite’s recipient / client email.
 */
export type SurveyReferralRequest = {
  /** Same survey invite token as the form URL. */
  token: string;
  referrerEmail: string;
  friendEmail: string;
  friendName?: string;
};

export type SurveyReferralResponse = {
  message?: string;
};

// ---------------------------------------------------------------------------
// Types (authenticated: responses & reports)
// ---------------------------------------------------------------------------

export type SurveyResponseListItem = {
  id: number;
  surveyId: number;
  appointmentId?: number;
  clientId?: number;
  /** Doctor/employee (provider) who had the appointment; may be present for filtering. */
  employeeId?: number | null;
  /** Alternative field name some APIs use for provider. */
  doctorId?: number | null;
  submittedAt: string;
};

export type SurveyResponseAnswer = {
  questionKey: string;
  questionText: string;
  value: string;
};

export type SurveyResponseDetail = {
  id: number;
  surveyId: number;
  appointmentId?: number;
  submittedAt: string;
  answers: SurveyResponseAnswer[];
};

export type SurveyReportQuestionScale = {
  questionKey: string;
  questionText: string;
  type: 'scale';
  stats: {
    average: number;
    distribution: Record<string, number>;
    totalResponses: number;
  };
};

export type SurveyReportQuestionChoice = {
  questionKey: string;
  questionText: string;
  type: 'image_choice' | 'radio' | 'dropdown';
  stats: {
    counts: Record<string, number>;
    totalResponses: number;
  };
};

/** Free-text questions (textarea, textbox): counts = response text → number of times submitted. */
export type SurveyReportQuestionText = {
  questionKey: string;
  questionText: string;
  type: 'textarea' | 'textbox';
  stats: {
    counts: Record<string, number>;
    totalResponses: number;
  };
};

export type SurveyReportQuestion =
  | SurveyReportQuestionScale
  | SurveyReportQuestionChoice
  | SurveyReportQuestionText;

export type SurveyReportSummary = {
  surveySlug: string;
  from: string;
  to: string;
  questions: SurveyReportQuestion[];
};

// ---------------------------------------------------------------------------
// Types (report questions with options – for filter dropdowns)
// ---------------------------------------------------------------------------

export type SurveyReportQuestionOption = {
  value: string;
  label: string;
};

export type SurveyReportQuestionWithOptions = {
  id: number;
  questionKey: string;
  questionText: string;
  questionType: string;
  options: SurveyReportQuestionOption[];
};

export type SurveyReportQuestionsResponse = {
  surveyId: number;
  surveySlug: string;
  questions: SurveyReportQuestionWithOptions[];
};

// ---------------------------------------------------------------------------
// Public (no auth)
// ---------------------------------------------------------------------------

/**
 * Load a public survey form by slug and invite token.
 * GET /survey/{surveySlug}/form?token={token}
 * No auth. 400/404 on invalid or expired token.
 */
export async function getSurveyForm(surveySlug: string, token: string): Promise<SurveyFormResponse> {
  const path = `/survey/${encodeURIComponent(surveySlug)}/form`;
  const { data } = await publicSurveyClient.get<SurveyFormResponse>(path, { params: { token } });
  return data;
}

/**
 * Submit survey answers for a slug (e.g. post-appointment, exit-interview).
 * POST /survey/{surveySlug}/submit
 * No auth. 201 on success; 400/404 on invalid, expired, or already submitted.
 */
export async function submitSurvey(
  surveySlug: string,
  token: string,
  answers: SurveyAnswerInput[]
): Promise<SurveySubmitResponse> {
  const path = `/survey/${encodeURIComponent(surveySlug)}/submit`;
  const { data } = await publicSurveyClient.post<SurveySubmitResponse>(path, { token, answers });
  return data;
}

/**
 * Submit a referral from the public post-appointment survey thank-you page.
 * POST /survey/post-appointment/referral — public, no JWT.
 * JSON body: token, referrerEmail (must match invite recipient), friendEmail, friendName?
 */
export async function submitSurveyReferral(body: SurveyReferralRequest): Promise<SurveyReferralResponse> {
  const { data } = await publicSurveyClient.post<SurveyReferralResponse>(
    '/survey/post-appointment/referral',
    body
  );
  return data ?? {};
}

// ---------------------------------------------------------------------------
// Authenticated (JWT)
// ---------------------------------------------------------------------------

/** Auth headers for authenticated survey endpoints (JWT required). */
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * List survey responses (paginated).
 * GET /survey/responses?surveySlug=post-appointment&from=&to=&page=&limit=
 * Requires: Authorization: Bearer <token>
 */
export async function listSurveyResponses(params: {
  surveySlug: string;
  from: string;
  to: string;
  page?: number;
  limit?: number;
  /** Filter by doctor/employee (appointment’s provider). Omit for all doctors. */
  employeeId?: number | null;
}): Promise<{ items: SurveyResponseListItem[]; total?: number }> {
  const { employeeId, ...rest } = params;
  const query: Record<string, unknown> = { ...rest };
  if (employeeId != null && typeof employeeId === 'number') {
    query.employeeId = employeeId;
    query.doctorId = employeeId;
  }
  const { data } = await http.get('/survey/responses', { params: query, headers: authHeaders() });
  return {
    items: Array.isArray(data) ? data : data?.items ?? data?.responses ?? [],
    total: data?.total,
  };
}

/**
 * Get a single survey response with all answers.
 * GET /survey/responses/:id
 * Requires: Authorization: Bearer <token>
 */
export async function getSurveyResponse(id: number): Promise<SurveyResponseDetail> {
  const { data } = await http.get<SurveyResponseDetail>(`/survey/responses/${id}`, { headers: authHeaders() });
  return data;
}

/**
 * Get per-question report summary for a date range.
 * GET /survey/reports/summary?surveySlug=post-appointment&from=&to=&questionId=&answerValue=
 * When questionId and answerValue are set, the summary is limited to responses with that question/answer.
 * Requires: Authorization: Bearer <token>
 */
export async function getSurveyReportSummary(params: {
  surveySlug: string;
  from: string;
  to: string;
  /** Filter by doctor/employee. Omit for all doctors. */
  employeeId?: number | null;
  /** Filter to responses that have this question with this answer. Use with answerValue. */
  questionId?: number | null;
  /** Exact value for the question (e.g. "5", "Dr. Abigail Messina"). Use with questionId. */
  answerValue?: string | null;
}): Promise<SurveyReportSummary> {
  const { employeeId, questionId, answerValue, ...rest } = params;
  const query: Record<string, unknown> = { ...rest };
  if (employeeId != null && typeof employeeId === 'number') {
    query.employeeId = employeeId;
    query.doctorId = employeeId;
  }
  if (questionId != null && typeof questionId === 'number') {
    query.questionId = questionId;
  }
  if (answerValue != null && answerValue !== '') {
    query.answerValue = answerValue;
  }
  const { data } = await http.get<SurveyReportSummary>('/survey/reports/summary', { params: query, headers: authHeaders() });
  return data;
}

/**
 * Get survey questions and their possible answers (for filter dropdowns).
 * GET /survey/reports/questions?surveySlug=post-appointment
 * Requires: Authorization: Bearer <token>
 */
export async function getSurveyReportQuestions(surveySlug: string): Promise<SurveyReportQuestionsResponse> {
  const { data } = await http.get<SurveyReportQuestionsResponse>('/survey/reports/questions', {
    params: { surveySlug },
    headers: authHeaders(),
  });
  return data;
}

// ---------------------------------------------------------------------------
// Authenticated: send survey invite (e.g. exit interview)
// ---------------------------------------------------------------------------

export type SendSurveyInviteRequest = {
  surveySlug: string;
  clientId: number;
  /** Omit when the server resolves the visit from the client only. */
  appointmentId?: number;
};

export type SendSurveyInviteResponse = {
  inviteId: number;
  sentTo: string;
  intendedRecipientEmail: string;
  surveySlug: string;
  surveyUrl: string;
};

/**
 * POST /survey/send-invite
 * Requires: Authorization: Bearer token
 */
export async function sendExitSurveyInvite(body: SendSurveyInviteRequest): Promise<SendSurveyInviteResponse> {
  const { data } = await http.post<SendSurveyInviteResponse>('/survey/send-invite', body, {
    headers: authHeaders(),
  });
  return data;
}
