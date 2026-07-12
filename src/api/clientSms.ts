import { http } from './http';

export type SendClientSmsPayload = {
  message: string;
  overrideNonProd?: boolean;
  /** Send from this line (e.g. practice `phone1`). When omitted, API picks receptionist or default. */
  from?: string;
  /** Send from the visit assignee provider's Quo/OpenPhone line (`quoLinePhone`). */
  primaryProviderId?: number;
  /** Use server `SMS_REMINDERS_FROM` (scheduling tools outreach). Do not pass `from` with this — the API picks the line. */
  useRemindersFrom?: boolean;
  /** Mark the Quo/OpenPhone conversation as done after send. */
  markInboxDone?: boolean;
};

export async function sendClientSms(
  clientId: number | string,
  payload: SendClientSmsPayload
): Promise<void> {
  await http.post(`/sms/client/${encodeURIComponent(String(clientId))}`, payload);
}

/** `SMS_REMINDERS_FROM` (or OpenPhone default) for scheduling-tools compose modals. */
export async function fetchSchedulingOutreachSmsFrom(): Promise<string | null> {
  try {
    const { data } = await http.get<{ from?: string | null }>('/sms/scheduling-outreach-from');
    const from = data?.from?.trim();
    return from || null;
  } catch {
    return null;
  }
}
