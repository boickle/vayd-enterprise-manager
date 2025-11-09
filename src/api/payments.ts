// src/api/payments.ts
import { http } from './http';

export type PaymentPoint = {
  date: string; // "YYYY-MM-DD"
  revenue: number; // daily total
  count: number; // number of payments
};

export type PaymentProviderType = 'square';

export enum PaymentIntent {
  ONE_TIME = 'ONE_TIME',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

export interface PaymentRequest {
  provider?: PaymentProviderType;
  idempotencyKey: string;
  sourceId: string;
  amount: number;
  currency?: string;
  locationId?: string;
  note?: string;
  intent?: PaymentIntent;
  subscriptionPlanId?: string;
  subscriptionStartDate?: string;
  customerId?: string;
  customerEmail?: string;
  customerName?: string;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  success: boolean;
  providerResponse: Record<string, any>;
  providerPaymentId?: string;
  status?: string;
}

/**
 * Fetch daily payments analytics between start/end (inclusive).
 * Matches backend controller: GET /analytics/payments?start=YYYY-MM-DD&end=YYYY-MM-DD[&practiceId=...]
 */
export async function fetchPaymentsAnalytics(params: {
  start: string;
  end: string;
  practiceId?: string | number;
}): Promise<PaymentPoint[]> {
  const { data } = await http.get('/analytics/payments', { params });

  // Ensure we always return the normalized shape with numbers
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);
  return rows.map((r) => ({
    date: String(r.date),
    revenue: Number(r.revenue ?? 0),
    count: Number(r.count ?? 0),
  }));
}

export async function createPayment(payload: PaymentRequest): Promise<PaymentResponse> {
  const { data } = await http.post('/payment-processing/payments', payload);
  return data;
}

export async function listPaymentProviders(): Promise<string[]> {
  const { data } = await http.get('/payment-processing/providers');
  return data;
}
