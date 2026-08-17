import { http } from './http';

export type SendClientSmsPayload = {
  message: string;
  overrideNonProd?: boolean;
  /** Send from this line (e.g. practice `phone1`). When omitted, API picks receptionist or default. */
  from?: string;
  /** Send from the visit assignee provider's phone line (`quoLinePhone`). */
  primaryProviderId?: number;
  /** Use server `SMS_REMINDERS_FROM` (scheduling tools outreach). Do not pass `from` with this — the API picks the line. */
  useRemindersFrom?: boolean;
  /** Mark the provider conversation as done after send (Quo; no-op on Schultz until wired). */
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

/** `SMS_REMINDERS_FROM` (or active phone-provider default) for scheduling-tools compose modals. */
export async function fetchSchedulingOutreachSmsFrom(): Promise<string | null> {
  try {
    const { data } = await http.get<{ from?: string | null }>('/sms/scheduling-outreach-from');
    const from = data?.from?.trim();
    return from || null;
  } catch {
    return null;
  }
}

export type ActivePhoneProviderResponse = {
  provider: 'quo' | 'schultz';
  displayName: string;
};

/** API `PHONE_PROVIDER` — source of truth after an env switch + API restart. */
export async function fetchActivePhoneProvider(): Promise<ActivePhoneProviderResponse | null> {
  try {
    const { data } = await http.get<ActivePhoneProviderResponse>('/sms/active-provider');
    if (data?.provider === 'quo' || data?.provider === 'schultz') return data;
    return null;
  } catch {
    return null;
  }
}

/** Undelivered staff SMS that the phone provider reported failed and staff have not dismissed. */
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
