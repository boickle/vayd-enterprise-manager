import { http } from './http';

/** GET /openphone/calls/summary — OpenPhone call metrics for Receptionist employees. */

export type OpenPhoneCallTotals = {
  incomingCalls: number;
  missedIncomingCalls: number;
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
  missedIncomingCalls: number;
  outgoingCalls: number;
  totalCalls: number;
  incomingMessages: number;
  outgoingMessages: number;
  totalMessages: number;
};

export type OpenPhoneReceptionistSummary = {
  employeeId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  phoneNumber: string;
  warning?: string;
  totals: OpenPhoneCallTotals;
  numbers: OpenPhoneCallSummaryByNumber[];
};

export type OpenPhoneCallSummaryResponse = {
  from: string;
  to: string;
  warnings?: string[];
  totals: OpenPhoneCallTotals;
  receptionists: OpenPhoneReceptionistSummary[];
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
