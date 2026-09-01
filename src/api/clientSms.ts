import { http } from './http';

export type SendClientSmsPayload = {
  message: string;
  overrideNonProd?: boolean;
  /** Client phone1 or phone2. When omitted, API uses phone1 then phone2. */
  to?: string;
  /** Send from this line (e.g. practice `phone1`). When omitted, API picks receptionist or default. */
  from?: string;
  /** Send from the visit assignee provider's Quo/OpenPhone line (`quoLinePhone`). */
  primaryProviderId?: number;
  /** Use server `SMS_REMINDERS_FROM` (scheduling tools outreach). Do not pass `from` with this — the API picks the line. */
  useRemindersFrom?: boolean;
  /** Mark the Quo/OpenPhone conversation as done after send. */
  markInboxDone?: boolean;
  /** Label for delivery-failure alerts (e.g. care_outreach, forward_booking). */
  source?: string;
};

export type StaffSmsDeliveryFailure = {
  id: number;
  clientId: number;
  clientName: string;
  phone: string;
  fromPhone: string | null;
  bodyPreview: string;
  providerMessageId: string;
  status: 'accepted' | 'delivered' | 'failed';
  errorMessage: string | null;
  source: string | null;
  created: string;
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

/** Undelivered staff SMS that Quo reported failed and staff have not dismissed. */
export async function fetchStaffSmsDeliveryFailures(
  limit = 25,
): Promise<StaffSmsDeliveryFailure[]> {
  const { data } = await http.get<{ failures?: StaffSmsDeliveryFailure[] }>(
    '/sms/delivery-failures',
    { params: { limit } },
  );
  return Array.isArray(data?.failures) ? data.failures : [];
}

export async function acknowledgeStaffSmsDeliveryFailure(id: number): Promise<void> {
  await http.post(`/sms/delivery-failures/${encodeURIComponent(String(id))}/acknowledge`);
}
