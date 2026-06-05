import { http } from './http';

export type SendClientSmsPayload = {
  message: string;
  overrideNonProd?: boolean;
};

export async function sendClientSms(
  clientId: number | string,
  payload: SendClientSmsPayload
): Promise<void> {
  await http.post(`/sms/client/${encodeURIComponent(String(clientId))}`, payload);
}
