import { apiBaseUrl, http } from './http';

/** Appointment deposits (owner, Nov 12, 2026). Not the bank deposits in deposits.ts. */
export type AppointmentDepositStatus = 'none' | 'requested' | 'part_paid' | 'paid';

export type AppointmentDeposit = {
  appointmentId: number;
  clientId: number | null;
  patientId: number | null;
  petName: string | null;
  appointmentStart: string | null;
  invoiceId: string | null;
  scoutInvoiceNumber: number | null;
  requested: number;
  paid: number;
  owed: number;
  creditLeft: number;
  status: AppointmentDepositStatus;
  label: string;
};

export type DepositPayLink = { url: string; amount: number; label: string; invoiceId: string };

export async function getAppointmentDeposit(appointmentId: number): Promise<AppointmentDeposit> {
  const { data } = await http.get<AppointmentDeposit>(`/appointment-deposits/${appointmentId}`);
  return data;
}

/** Ask for a deposit (default $100 on the server) or change the amount asked for. */
export async function requestAppointmentDeposit(
  appointmentId: number,
  amount?: number | null,
): Promise<AppointmentDeposit> {
  const { data } = await http.post<AppointmentDeposit>(`/appointment-deposits/${appointmentId}`, {
    amount: amount ?? undefined,
  });
  return data;
}

export async function createDepositPayLink(
  appointmentId: number,
  opts?: { successUrl?: string; cancelUrl?: string },
): Promise<DepositPayLink> {
  const { data } = await http.post<DepositPayLink>(`/appointment-deposits/${appointmentId}/pay-link`, {
    successUrl: opts?.successUrl,
    cancelUrl: opts?.cancelUrl,
  });
  const url = data?.url?.startsWith('/') ? `${apiBaseUrl.replace(/\/+$/, '')}${data.url}` : data.url;
  return { ...data, url };
}

export async function getAppointmentDepositStatuses(
  appointmentIds: number[],
): Promise<Array<{ appointmentId: number; status: AppointmentDepositStatus; requested: number; paid: number }>> {
  const ids = [...new Set(appointmentIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const { data } = await http.get(`/appointment-deposits/statuses`, {
    params: { appointmentIds: ids.join(',') },
  });
  return Array.isArray(data) ? data : [];
}

export type ClientDepositRequired = {
  depositRequired: boolean;
  depositRequiredNote: string | null;
  depositRequiredByName: string | null;
  depositRequiredAt: string | null;
};

/** Mark or clear "Deposit required" (managers, billing and lead CLs). */
export async function setClientDepositRequired(
  clientId: number,
  required: boolean,
  note?: string | null,
): Promise<ClientDepositRequired> {
  const { data } = await http.post<ClientDepositRequired>(`/clients/${clientId}/deposit-required`, {
    required,
    note: note ?? null,
  });
  return data;
}
