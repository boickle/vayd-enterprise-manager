import { http } from './http';

export type CreateMailOrderRequest = {
  formData: Record<string, unknown>;
  clientId?: number;
  practiceId?: number;
  clientEmail?: string;
  paymentIntentId?: string;
  paymentAmountCents?: number;
};

export type MailOrderSubmission = {
  id: number;
  formData: Record<string, unknown>;
  status: string;
  created: string;
  paymentIntentId?: string | null;
  paymentAmountCents?: number | null;
  ecwidOrderId?: string | null;
};

export async function createMailOrder(
  body: CreateMailOrderRequest
): Promise<{ id: number }> {
  const { data } = await http.post<{ id: number }>('/mail-order', body);
  return data;
}

export async function listMailOrders(limit = 50): Promise<MailOrderSubmission[]> {
  const { data } = await http.get<MailOrderSubmission[]>('/mail-order', {
    params: { limit },
  });
  return data;
}
