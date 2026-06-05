// src/api/payments.ts
import dayjs from 'dayjs';
import { http } from './http';

export type PaymentPoint = {
  date: string; // "YYYY-MM-DD"
  revenue: number; // daily total (typically practice + online pharmacy)
  count: number; // number of payments
  subscriptionRevenue?: number; // daily subscription revenue
  onlinePharmacyRevenue?: number;
  practiceRevenue?: number;
};

export type PaymentProviderType = 'square';

export enum PaymentIntent {
  ONE_TIME = 'ONE_TIME',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

export type BillingPreference = 'monthly' | 'annual';

export interface MembershipTransactionAddOn {
  id: string;
  name: string;
  price: number;
  pricingOption: BillingPreference;
}

export interface MembershipTransactionPlanSelection {
  planId: string;
  planName: string;
  pricingOption: BillingPreference;
  price: number;
  quantity: number;
  addOns?: MembershipTransactionAddOn[];
}

/** Where the membership checkout was started (sent on payment `membershipTransaction` for analytics / ops). */
export const MEMBERSHIP_PAYMENT_REQUEST_ORIGINS = ['client-portal', 'appointment-form', 'room-loader'] as const;
export type MembershipPaymentRequestOrigin = (typeof MEMBERSHIP_PAYMENT_REQUEST_ORIGINS)[number];

export interface MembershipTransactionPayload {
  clientId?: number | string;
  patientId?: number | string;
  practiceId?: number | string;
  /** Origin of the membership transaction (e.g. client portal vs public forms). */
  requestOrigin?: MembershipPaymentRequestOrigin;
  agreementSignedAt?: string;
  agreementText?: string;
  plansSelected?: MembershipTransactionPlanSelection[];
  metadata?: Record<string, any>;
}

export type SubscriptionPlanEntry = {
  planId: string;
  planVariationId: string;
};

export type SubscriptionPlanCombination = {
  base?: SubscriptionPlanEntry;
  plus?: SubscriptionPlanEntry;
  starter?: SubscriptionPlanEntry;
  plusStarter?: SubscriptionPlanEntry;
};

export type SubscriptionPlanCadence = {
  monthly?: SubscriptionPlanCombination;
  annual?: SubscriptionPlanCombination;
};

export type SubscriptionPlanSpecies = SubscriptionPlanCadence & {
  cat?: SubscriptionPlanCadence;
  dog?: SubscriptionPlanCadence;
};

export type SubscriptionPlanCatalog = Record<string, SubscriptionPlanSpecies>;

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
  subscriptionPlanVariationId?: string;
  subscriptionStartDate?: string;
  customerId?: string;
  customerEmail?: string;
  customerName?: string;
  metadata?: Record<string, any>;
  membershipTransaction?: MembershipTransactionPayload;
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
    subscriptionRevenue: Number(r.subscriptionRevenue ?? 0),
    onlinePharmacyRevenue: Number(r.onlinePharmacyRevenue ?? 0),
    practiceRevenue: Number(r.practiceRevenue ?? 0),
  }));
}

export async function createPayment(payload: PaymentRequest): Promise<PaymentResponse> {
  const { data } = await http.post('/payment-processing/payments', payload);
  return data;
}

export async function fetchSubscriptionPlanCatalog(): Promise<SubscriptionPlanCatalog> {
  const { data } = await http.get('/payment-processing/subscription-plan-catalog');
  if (data && typeof data === 'object') {
    return data as SubscriptionPlanCatalog;
  }
  return {};
}

export async function listPaymentProviders(): Promise<string[]> {
  const { data } = await http.get('/payment-processing/providers');
  return data;
}

// =========================
// Formatted Subscription Plans (from Square)
// =========================

export type SubscriptionPlanPhase = {
  cadence: 'MONTHLY' | 'ANNUAL';
  periods?: number | null;
  pricing?: {
    type: string;
    amount?: number;
    currency?: string;
  };
};

export type SubscriptionPlanVariation = {
  variationId: string;
  name: string;
  price?: {
    amount: number; // in cents
    currency: string;
  };
  phases?: SubscriptionPlanPhase[];
};

export type FormattedSubscriptionPlan = {
  planId: string;
  planName: string;
  variations: SubscriptionPlanVariation[];
};

export async function fetchFormattedSubscriptionPlans(): Promise<FormattedSubscriptionPlan[]> {
  const { data } = await http.get('/payment-processing/subscription-plans/formatted');
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}

export interface MembershipUpgradeRequest {
  patientId: number | string;
  newPlansSelected: Array<{
    planId: string;
    planName: string;
    pricingOption: 'monthly' | 'annual';
    price: number;
  }>;
  sourceId: string;
  customerEmail: string;
  // Prorated calculation fields
  proratedRefundAmount?: number; // in dollars
  proratedChargeAmount?: number; // in dollars
  upgradeDate?: string; // ISO date string
  nextBillingDate?: string; // ISO date string
  currentMembershipId?: number; // ID of the membership being upgraded
}

export interface MembershipUpgradeResponse {
  success: boolean;
  message?: string;
  [key: string]: any;
}

export async function upgradeMembership(payload: MembershipUpgradeRequest): Promise<MembershipUpgradeResponse> {
  const { data } = await http.post('/payment-processing/membership/upgrade', payload);
  return data;
}

// =========================
// Payments Reconciliation (Square)
// =========================

export type ReconciliationClient = {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
};

export type ReconciliationPaymentOurs = {
  id: number;
  amount: number;
  date: string;
  depositDate?: string;
  client?: ReconciliationClient;
  paymentTypeName?: string;
};

export type ReconciliationPaymentSquare = {
  id: string;
  amountCents: number;
  created_at: string;
  cardholderName?: string;
  buyerEmail?: string;
};

export type ReconciliationMatch = {
  ours: ReconciliationPaymentOurs;
  square: ReconciliationPaymentSquare;
  matchMethod?: string;
};

export type PaymentsReconciliationResponse = {
  start: string;
  end: string;
  practiceId: string | number | null;
  byPaymentType?: Record<string, ReconciliationPaymentOurs[]>;
  creditCardReconciliation: {
    matched: ReconciliationMatch[];
    unmatchedInOurs: ReconciliationPaymentOurs[];
    unmatchedInSquare: ReconciliationPaymentSquare[];
  };
};

/**
 * Fetch payments reconciliation data between start/end.
 * GET /analytics/payments/reconciliation?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export async function fetchPaymentsReconciliation(params: {
  start: string;
  end: string;
  practiceId?: string | number;
}): Promise<PaymentsReconciliationResponse> {
  const { data } = await http.get('/analytics/payments/reconciliation', { params });
  return data;
}

/** Payment row with type label when flattened from reconciliation `byPaymentType`. */
export type PaymentDayRow = ReconciliationPaymentOurs & {
  paymentTypeName?: string;
};

/** Flatten `byPaymentType` into one list (preserves per-row `paymentTypeName` when present). */
export function flattenPaymentsByType(
  byPaymentType?: Record<string, ReconciliationPaymentOurs[]>
): PaymentDayRow[] {
  if (!byPaymentType) return [];
  const rows: PaymentDayRow[] = [];
  for (const [typeName, list] of Object.entries(byPaymentType)) {
    for (const p of list ?? []) {
      rows.push({
        ...p,
        paymentTypeName: p.paymentTypeName ?? typeName,
      });
    }
  }
  return rows;
}

/** Sum credit card payments in our system for a single calendar day. */
export function sumCreditCardPaymentsForDay(
  res: PaymentsReconciliationResponse,
  dayKey: string
): { total: number; count: number } {
  const filtered = filterCreditCardReconciliationForDay(res, dayKey);
  const payments = [
    ...filtered.matched.map((m) => m.ours),
    ...filtered.unmatchedInOurs,
  ];
  return {
    total: payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
    count: payments.length,
  };
}

/** Restrict credit card reconciliation rows to a single calendar day. */
export function filterCreditCardReconciliationForDay(
  res: PaymentsReconciliationResponse,
  dayKey: string
): PaymentsReconciliationResponse['creditCardReconciliation'] {
  const key = dayKey.slice(0, 10);
  const onOursDay = (p: ReconciliationPaymentOurs) => String(p.date).slice(0, 10) === key;
  const onSquareDay = (p: ReconciliationPaymentSquare) =>
    dayjs(p.created_at).format('YYYY-MM-DD') === key;

  const matched = res.creditCardReconciliation.matched.filter((m) => onOursDay(m.ours));
  const unmatchedInOurs = res.creditCardReconciliation.unmatchedInOurs.filter(onOursDay);
  const unmatchedInSquare = res.creditCardReconciliation.unmatchedInSquare.filter(onSquareDay);

  return { matched, unmatchedInOurs, unmatchedInSquare };
}

/** Keep only Square payments whose `createdAt` falls on the given calendar day (local). */
export function filterSquarePaymentsForDay(
  payments: SquarePayment[],
  dayKey: string
): SquarePayment[] {
  const key = dayKey.slice(0, 10);
  return payments.filter((p) => dayjs(p.createdAt).format('YYYY-MM-DD') === key);
}

export function sumSquarePayments(payments: SquarePayment[]): { total: number; count: number } {
  return {
    total: payments.reduce((sum, p) => sum + (p.amount ?? p.amountCents / 100), 0),
    count: payments.length,
  };
}

/**
 * All practice payments on a single calendar day (from reconciliation).
 * Filters rows whose `date` matches `date` (YYYY-MM-DD).
 */
export async function fetchPaymentsForDay(date: string): Promise<PaymentDayRow[]> {
  const res = await fetchPaymentsReconciliation({ start: date, end: date });
  const dayKey = date.slice(0, 10);
  return flattenPaymentsByType(res.byPaymentType).filter(
    (p) => String(p.date).slice(0, 10) === dayKey
  );
}

// =========================
// Square payments listing
// =========================

export type SquarePayment = {
  id: string;
  createdAt: string;
  status: string;
  sourceType: string;
  amountCents: number;
  amount: number;
  currency: string;
  buyerEmail?: string;
  cardholderName?: string;
  squareProduct?: string;
};

export type SquarePaymentsResponse = {
  start: string;
  end: string;
  count: number;
  payments: SquarePayment[];
};

/**
 * List Square payments in a date range.
 * GET /payment-processing/square/payments?start=...&end=...[&cardOnly=true][&completedOnly=true]
 */
export async function fetchSquarePayments(params: {
  start: string;
  end: string;
  cardOnly?: boolean;
  completedOnly?: boolean;
}): Promise<SquarePaymentsResponse> {
  const { data } = await http.get('/payment-processing/square/payments', { params });
  return {
    start: String(data.start),
    end: String(data.end),
    count: Number(data.count ?? 0),
    payments: Array.isArray(data.payments) ? data.payments : [],
  };
}
