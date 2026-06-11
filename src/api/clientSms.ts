import { http } from './http';

export type SendClientSmsPayload = {
  message: string;
  overrideNonProd?: boolean;
  /** Send from the visit assignee provider's Quo/OpenPhone line (`quoLinePhone`). */
  primaryProviderId?: number;
};

export async function sendClientSms(
  clientId: number | string,
  payload: SendClientSmsPayload
): Promise<void> {
  await http.post(`/sms/client/${encodeURIComponent(String(clientId))}`, payload);
}
