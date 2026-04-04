import { http } from './http';

/** GET /openphone/calls/summary — company-wide totals, per company line (`numbers`), and per-employee attribution. */

export type OpenPhoneCallTotals = {
  incomingCalls: number;
  /** Inbound calls counted as missed (missed, no-answer, abandoned). */
  missedIncomingCallsTotal: number;
  /** Subset whose time falls inside hoursOfOperation for that weekday in PRACTICE_TIMEZONE. */
  missedIncomingDuringBusinessHours: number;
  /** Subset outside those windows (includes closed days / null day rows). */
  missedIncomingOutsideBusinessHours: number;
  outgoingCalls: number;
  totalCalls: number;
  incomingMessages: number;
  outgoingMessages: number;
  totalMessages: number;
};

export type OpenPhoneCallSummaryByNumber = {
  phoneNumberId: string;
  phoneNumber: string;
  label: string | null;
  incomingCalls: number;
  missedIncomingCallsTotal: number;
  missedIncomingDuringBusinessHours: number;
  missedIncomingOutsideBusinessHours: number;
  outgoingCalls: number;
  totalCalls: number;
  incomingMessages: number;
  outgoingMessages: number;
  totalMessages: number;
};

export type OpenPhoneEmployeeSummary = {
  employeeId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  phoneNumber: string;
  openPhoneUserId?: string | null;
  warning?: string;
  totals: OpenPhoneCallTotals;
  numbers: OpenPhoneCallSummaryByNumber[];
};

/** @deprecated Use `OpenPhoneEmployeeSummary`; same shape as `employees` from the API. */
export type OpenPhoneReceptionistSummary = OpenPhoneEmployeeSummary;

/** One webhook-normalized row for timeline charts (calls and messages; chart filters to calls). */
export type OpenPhoneCallItem = {
  openPhoneId: string;
  kind: string;
  createdAt: string;
  direction: string;
  status: string | null;
  phoneNumberId: string;
  phoneNumber: string;
  lastEvent: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  staffOpenPhoneUserId: string | null;
};

export type OpenPhoneCallSummaryResponse = {
  from: string;
  to: string;
  warnings?: string[];
  totals: OpenPhoneCallTotals;
  /** One row per company-owned OpenPhone line — primary breakdown for org-wide traffic and missed calls per main/office number. */
  numbers: OpenPhoneCallSummaryByNumber[];
  employees: OpenPhoneEmployeeSummary[];
  /** @deprecated Same as `employees`; prefer `employees` when present. */
  receptionists?: OpenPhoneEmployeeSummary[];
  /**
   * Per-event rows (same `from`/`to`) for the inbound call timeline — same shape as `OpenPhoneCallItem`.
   */
  events?: OpenPhoneCallItem[];
};

/**
 * GET /openphone/calls/summary?from=&to=
 * Query values should be ISO 8601 datetimes (prefer explicit offset for predictable ranges).
 */
export async function fetchOpenPhoneCallSummary(params: {
  from: string;
  to: string;
}): Promise<OpenPhoneCallSummaryResponse> {
  const { data } = await http.get<OpenPhoneCallSummaryResponse>('/openphone/calls/summary', {
    params: { from: params.from, to: params.to },
  });
  return data;
}
