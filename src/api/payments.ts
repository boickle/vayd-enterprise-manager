// src/api/payments.ts
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
