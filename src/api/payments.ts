// src/api/payments.ts
import dayjs from 'dayjs';
import { paymentProcessingApiBasePath } from '../config/paymentProvider';
import { http } from './http';

export type PaymentPoint = {
  date: string; // "YYYY-MM-DD"
  revenue: number; // daily total (typically practice + online pharmacy)
  count: number; // number of payments
  subscriptionRevenue?: number; // daily subscription revenue
  onlinePharmacyRevenue?: number;
  practiceRevenue?: number;
};

export type PaymentProviderType = 'square' | 'stripe';

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

/** Stripe catalog envelope from GET …/stripe/payment-processing/subscription-plan-catalog */
export type StripeSubscriptionPlanCatalogResponse = {
  provider?: string;
  configured?: boolean;
  /** Square-shaped map, or an array of plan rows (see normalizer). */
  items?: SubscriptionPlanCatalog | unknown[];
};

const CATALOG_PLAN_SLUG_KEYS = [
  'foundations',
  'golden',
  'comfort-care',
  'plus-addon',
  'starter-addon',
] as const;

function catalogFromSquareLikeRoot(obj: Record<string, unknown>): SubscriptionPlanCatalog | null {
  const out: SubscriptionPlanCatalog = {};
  for (const k of CATALOG_PLAN_SLUG_KEYS) {
    const v = obj[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      (out as Record<string, SubscriptionPlanSpecies>)[k] = v as SubscriptionPlanSpecies;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

type StripeCatalogCombo = 'base' | 'plus' | 'starter' | 'plusStarter';

function stripeCadenceFromLabel(label: string): 'monthly' | 'annual' | null {
  const u = label.trim().toUpperCase();
  if (u.includes('MONTH')) return 'monthly';
  if (u.includes('YEAR') || u.includes('ANNUAL')) return 'annual';
  return null;
}

/**
 * Stripe `subscription-plan-catalog` returns `items` as flat price rows (`productName`, `priceId`, …).
 * Membership UI expects the same nested tree as Square (`foundations.cat.monthly.base`, etc.).
 */
function stripeFlatCatalogItemsToSubscriptionPlanCatalog(rows: unknown[]): SubscriptionPlanCatalog {
  const out: SubscriptionPlanCatalog = {};

  const entry = (productId: string, priceId: string): SubscriptionPlanEntry => ({
    planId: productId,
    planVariationId: priceId,
  });

  const setComfort = (cadence: 'monthly' | 'annual', combo: 'base' | 'plus', productId: string, priceId: string) => {
    const key = 'comfort-care';
    if (!out[key]) out[key] = {} as SubscriptionPlanSpecies;
    const plan = out[key]!;
    const general = ((plan as Record<string, unknown>).general ??= {}) as Record<string, SubscriptionPlanCombination>;
    const cad = (general[cadence] ??= {}) as SubscriptionPlanCombination;
    (cad as Record<string, SubscriptionPlanEntry>)[combo] = entry(productId, priceId);
  };

  const setSpecies = (
    planKey: 'foundations' | 'golden',
    species: 'cat' | 'dog',
    cadence: 'monthly' | 'annual',
    combo: StripeCatalogCombo,
    productId: string,
    priceId: string,
  ) => {
    if (!out[planKey]) out[planKey] = {} as SubscriptionPlanSpecies;
    const plan = out[planKey]!;
    const specNode = ((plan as Record<string, unknown>)[species] ??= {}) as SubscriptionPlanCadence;
    const cad = (specNode[cadence] ??= {}) as SubscriptionPlanCombination;
    (cad as Record<string, SubscriptionPlanEntry>)[combo] = entry(productId, priceId);
  };

  const setAddon = (
    planKey: 'plus-addon' | 'starter-addon',
    cadence: 'monthly' | 'annual',
    productId: string,
    priceId: string,
  ) => {
    if (!out[planKey]) out[planKey] = {} as SubscriptionPlanSpecies;
    const plan = out[planKey]!;
    const cad = ((plan as Record<string, unknown>)[cadence] ??= {}) as SubscriptionPlanCombination;
    (cad as Record<string, SubscriptionPlanEntry>).base = entry(productId, priceId);
  };

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const productId = String(r.productId ?? r.product_id ?? '');
    const priceId = String(r.priceId ?? r.price_id ?? '');
    if (!productId || !priceId) continue;

    const nameRaw = String(r.productName ?? r.product_name ?? r.priceNickname ?? '').toLowerCase();
    const cadence = stripeCadenceFromLabel(String(r.cadenceLabel ?? r.cadence_label ?? ''));
    if (!cadence) continue;

    if (nameRaw.includes('plus add-on') || nameRaw.includes('plus add on')) {
      setAddon('plus-addon', cadence, productId, priceId);
      continue;
    }
    if (
      (nameRaw.includes('puppy') || nameRaw.includes('kitten')) &&
      (nameRaw.includes('add-on') || nameRaw.includes('add on'))
    ) {
      setAddon('starter-addon', cadence, productId, priceId);
      continue;
    }

    if (nameRaw.includes('comfort care')) {
      const isPlus = nameRaw.includes('comfort care plus');
      setComfort(cadence, isPlus ? 'plus' : 'base', productId, priceId);
      continue;
    }

    const planKey: 'foundations' | 'golden' = nameRaw.includes('golden') ? 'golden' : 'foundations';

    let species: 'cat' | 'dog' | null = null;
    if (/\bcat\b/i.test(nameRaw)) species = 'cat';
    else if (/\bdog\b/i.test(nameRaw)) species = 'dog';
    if (!species) continue;

    let combo: StripeCatalogCombo = 'base';
    if (nameRaw.includes('starter wellness plus')) combo = 'plusStarter';
    else if (nameRaw.includes('starter wellness')) combo = 'starter';
    else if (/\bplus\s*-\s*(cat|dog)/i.test(nameRaw)) combo = 'plus';
    else if (nameRaw.includes(' only')) combo = 'base';

    setSpecies(planKey, species, cadence, combo, productId, priceId);
  }

  return out;
}

/**
 * Stripe may return `items` as the same object map as Square, as an array of rows, or omit `items`
 * and place plan trees next to `provider` at the root.
 */
function normalizeSubscriptionPlanCatalogResponse(data: unknown): SubscriptionPlanCatalog {
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  const provider = String(d.provider ?? '').toLowerCase();

  if (provider === 'stripe') {
    if (d.configured === false) return {};

    const items = d.items;

    if (items && typeof items === 'object' && !Array.isArray(items)) {
      return items as SubscriptionPlanCatalog;
    }

    if (Array.isArray(items) && items.length > 0) {
      const fromStripeFlat = stripeFlatCatalogItemsToSubscriptionPlanCatalog(items);
      if (Object.keys(fromStripeFlat).length > 0) return fromStripeFlat;

      const fromArray: SubscriptionPlanCatalog = {};
      for (const row of items) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const slug =
          (typeof r.slug === 'string' && r.slug) ||
          (typeof r.planKey === 'string' && r.planKey) ||
          (typeof r.key === 'string' && r.key) ||
          (typeof r.id === 'string' && r.id);
        const tree = (r.catalog ?? r.plan ?? r.data ?? r.planSpec ?? r.spec) as unknown;
        if (slug && tree && typeof tree === 'object' && !Array.isArray(tree)) {
          (fromArray as Record<string, SubscriptionPlanSpecies>)[slug] = tree as SubscriptionPlanSpecies;
        }
      }
      if (Object.keys(fromArray).length > 0) return fromArray;
    }

    const fromRoot = catalogFromSquareLikeRoot(d);
    if (fromRoot) return fromRoot;

    return {};
  }

  return data as SubscriptionPlanCatalog;
}

// =========================
// Stripe membership subscription discounts (promotion codes + opaque links)
// =========================

export type MembershipDiscountDuration = 'once' | 'repeating' | 'forever';

/** Resolved at checkout from ?promo= token or staff-entered code. */
export type MembershipCheckoutDiscount = {
  /** Opaque link token (may be absent when resolved via code). */
  token?: string;
  /** Human-readable code, e.g. VAYDH7K2MQ (may be absent when resolved via token). */
  code?: string;
  stripePromotionCodeId: string;
  displayLabel: string;
  percentOff?: number;
  amountOffCents?: number;
  duration?: MembershipDiscountDuration;
};

export type MembershipDiscountRecord = {
  id: string;
  name: string;
  displayLabel: string;
  percentOff?: number;
  amountOffCents?: number;
  duration: MembershipDiscountDuration;
  maxRedemptions?: number | null;
  timesRedeemed?: number;
  expiresAt?: string | null;
  active: boolean;
  archived?: boolean;
  createdAt?: string;
  /** Latest opaque link token for sharing (if generated). */
  linkToken?: string | null;
  /** Human-readable promo code auto-generated at creation, e.g. VAYDH7K2MQ. */
  code?: string | null;
};

export type CreateMembershipDiscountRequest = {
  name: string;
  displayLabel?: string;
  percentOff?: number;
  amountOffCents?: number;
  duration: MembershipDiscountDuration;
  durationInMonths?: number;
  maxRedemptions?: number;
  expiresAt?: string;
  /** When true, also create an opaque share link token. */
  createLink?: boolean;
  /** Custom code (letters/digits/dashes, 3–64 chars). Omit for link-only promotions. */
  code?: string;
  /** When true and no code is provided, auto-generate a readable unambiguous code. */
  generateCode?: boolean;
};

export type UpdateMembershipDiscountRequest = Partial<{
  name: string;
  displayLabel: string;
  active: boolean;
  archived: boolean;
  /** Pass empty string to clear an existing code (makes it link-only again). */
  code: string;
  /** When true, generate and assign a fresh code. */
  generateCode: boolean;
}>;

export type CreateMembershipDiscountLinkRequest = {
  discountId: string;
  /** Optional expiry for this link only (ISO date). */
  linkExpiresAt?: string;
};

export type CreateMembershipDiscountLinkResponse = {
  token: string;
  url?: string;
};

export type ResolveMembershipDiscountResponse = {
  valid: boolean;
  discount?: MembershipCheckoutDiscount;
  message?: string;
};

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
  /** Opaque promo link token; backend re-validates and applies Stripe promotion code on subscription. */
  membershipDiscountToken?: string;
  /** Human-readable promo code entered by the client, e.g. VAYDH7K2MQ. Takes effect when no token is present. */
  membershipDiscountCode?: string;
  /** Stripe promotion code id (promo_…); optional if token is sent. */
  stripePromotionCodeId?: string;
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
  const path = `${paymentProcessingApiBasePath()}/payments`;
  const { data } = await http.post(path, payload);
  return data;
}

export async function fetchSubscriptionPlanCatalog(): Promise<SubscriptionPlanCatalog> {
  const { data } = await http.get(`${paymentProcessingApiBasePath()}/subscription-plan-catalog`);
  return normalizeSubscriptionPlanCatalogResponse(data);
}

export async function listPaymentProviders(): Promise<string[]> {
  const { data } = await http.get(`${paymentProcessingApiBasePath()}/providers`);
  return data;
}

const stripeMembershipDiscountsBase = () =>
  `${paymentProcessingApiBasePath()}/membership-discounts`;

export async function fetchMembershipDiscounts(
  params?: { archived?: boolean },
): Promise<MembershipDiscountRecord[]> {
  const { data } = await http.get(stripeMembershipDiscountsBase(), {
    params: params?.archived === true ? { archived: true } : undefined,
  });
  const rows = Array.isArray(data) ? data : (data?.items ?? data?.discounts ?? []);
  return rows as MembershipDiscountRecord[];
}

export async function createMembershipDiscount(
  payload: CreateMembershipDiscountRequest,
): Promise<MembershipDiscountRecord> {
  const { data } = await http.post(stripeMembershipDiscountsBase(), payload);
  return data as MembershipDiscountRecord;
}

export async function updateMembershipDiscount(
  id: string,
  payload: UpdateMembershipDiscountRequest,
): Promise<MembershipDiscountRecord> {
  const { data } = await http.patch(`${stripeMembershipDiscountsBase()}/${encodeURIComponent(id)}`, payload);
  return data as MembershipDiscountRecord;
}

export async function deleteMembershipDiscount(id: string): Promise<void> {
  await http.delete(`${stripeMembershipDiscountsBase()}/${encodeURIComponent(id)}`);
}

export async function createMembershipDiscountLink(
  payload: CreateMembershipDiscountLinkRequest,
): Promise<CreateMembershipDiscountLinkResponse> {
  const { data } = await http.post(`${stripeMembershipDiscountsBase()}/links`, payload);
  return data as CreateMembershipDiscountLinkResponse;
}

/**
 * Resolve opaque ?promo= token for membership checkout (no Stripe code exposed).
 * Backend should allow unauthenticated access for public signup flows.
 */
export async function resolveMembershipDiscountToken(
  token: string,
): Promise<ResolveMembershipDiscountResponse> {
  const { data } = await http.get(`${stripeMembershipDiscountsBase()}/resolve`, {
    params: { token },
  });
  return data as ResolveMembershipDiscountResponse;
}

/**
 * Resolve a human-readable promo code entered by the client at checkout.
 * GET /stripe/payment-processing/membership-discounts/resolve-by-code?code=<code>
 * Matching is case-insensitive on the backend; normalise to uppercase before display.
 */
export async function resolveMembershipDiscountByCode(
  code: string,
): Promise<ResolveMembershipDiscountResponse> {
  const { data } = await http.get(`${stripeMembershipDiscountsBase()}/resolve-by-code`, {
    params: { code: code.trim().toUpperCase() },
  });
  return data as ResolveMembershipDiscountResponse;
}

// =========================
// Formatted subscription plans (Square or Stripe path via paymentProcessingApiBasePath)
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

/**
 * Maps API plan rows (Square or Stripe) into `FormattedSubscriptionPlan` for catalog-driven UI.
 */
function normalizeFormattedSubscriptionPlansResponse(data: unknown): FormattedSubscriptionPlan[] {
  if (!Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => {
    const variationsIn = Array.isArray(row.variations) ? row.variations : [];
    const variations: SubscriptionPlanVariation[] = variationsIn.map((v: Record<string, unknown>) => {
      const priceId = v.priceId != null ? String(v.priceId) : '';
      const variationId =
        v.variationId != null ? String(v.variationId) : priceId ? priceId : '';
      const unitAmount =
        typeof v.unitAmount === 'number'
          ? v.unitAmount
          : v.price && typeof (v.price as { amount?: unknown }).amount === 'number'
            ? (v.price as { amount: number }).amount
            : undefined;
      const currency =
        (typeof v.currency === 'string' && v.currency) ||
        (v.price && typeof (v.price as { currency?: string }).currency === 'string'
          ? (v.price as { currency: string }).currency
          : 'USD');
      const cadenceLabel = (v.cadenceLabel ?? v.name ?? '').toString().toLowerCase();
      let phases = Array.isArray(v.phases) ? (v.phases as SubscriptionPlanVariation['phases']) : undefined;
      if ((!phases || phases.length === 0) && unitAmount != null) {
        const isAnnual =
          cadenceLabel.includes('annual') ||
          cadenceLabel.includes('year') ||
          cadenceLabel.includes('yr');
        const isMonthly = cadenceLabel.includes('month') || cadenceLabel.includes('mo');
        if (isAnnual || isMonthly) {
          phases = [
            {
              cadence: isAnnual ? 'ANNUAL' : 'MONTHLY',
              pricing: { type: 'FIXED', amount: unitAmount, currency },
            },
          ];
        }
      }
      const name = (v.nickname ?? v.name ?? v.cadenceLabel ?? '').toString();
      return {
        variationId,
        name,
        price: unitAmount != null ? { amount: unitAmount, currency } : undefined,
        phases,
      };
    });
    return {
      planId: String(row.planId ?? ''),
      planName: String(row.planName ?? ''),
      variations,
    };
  });
}

export async function fetchFormattedSubscriptionPlans(): Promise<FormattedSubscriptionPlan[]> {
  const { data } = await http.get(`${paymentProcessingApiBasePath()}/subscription-plans/formatted`);
  return normalizeFormattedSubscriptionPlansResponse(data);
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
// Stripe revenue analytics
// =========================

export type StripeRevenueDay = {
  date: string; // "YYYY-MM-DD"
  revenue: number;
  count: number;
};

export type StripeRevenueResponse = {
  start: string;
  end: string;
  totalRevenue: number;
  totalCount: number;
  byDay: StripeRevenueDay[];
};

/**
 * Fetch Stripe revenue between start/end (inclusive).
 * GET /analytics/payments/stripe?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export async function fetchStripeRevenue(params: {
  start: string;
  end: string;
}): Promise<StripeRevenueResponse> {
  const { data } = await http.get('/analytics/payments/stripe', { params });
  const byDay: any[] = Array.isArray(data?.byDay) ? data.byDay : [];
  return {
    start: String(data?.start ?? params.start),
    end: String(data?.end ?? params.end),
    totalRevenue: Number(data?.totalRevenue ?? 0),
    totalCount: Number(data?.totalCount ?? 0),
    byDay: byDay.map((r) => ({
      date: String(r.date),
      revenue: Number(r.revenue ?? 0),
      count: Number(r.count ?? 0),
    })),
  };
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
