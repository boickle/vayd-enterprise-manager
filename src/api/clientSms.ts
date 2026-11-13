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
  practiceId?: number;
  patientIds?: number[];
  typeLabel?: string;
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
  /** B13-1: true when the signed-in person sent it; managers also see other people's. */
  sentByMe?: boolean;
  /** Who sent it; null when Scout sent it on its own. */
  senderName?: string | null;
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

/** Undelivered texts this person sent (and, for managers, everyone's) that they haven't dismissed. */
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

export type PreferredSmsFrom = {
  /** The provider's own Quo line, or null when they have none. */
  phone: string | null;
  providerName: string | null;
  source: 'appointment' | 'patient' | 'client' | null;
};

/**
 * The line a text to this family starts on: the visit's provider (a visit named, else the family's
 * visit today or in the next 7 days), else the pet's primary provider, else the client's.
 */
export async function fetchPreferredSmsFrom(args: {
  clientId: number;
  patientId?: number | null;
  appointmentId?: number | null;
}): Promise<PreferredSmsFrom> {
  const params: Record<string, number> = { clientId: args.clientId };
  if (args.patientId) params.patientId = args.patientId;
  if (args.appointmentId) params.appointmentId = args.appointmentId;
  const { data } = await http.get<PreferredSmsFrom>('/sms/preferred-from', { params });
  return {
    phone: data?.phone ?? null,
    providerName: data?.providerName ?? null,
    source: data?.source ?? null,
  };
}
