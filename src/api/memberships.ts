import axios from 'axios';
import { getToken, http } from './http';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';

/**
 * Resolved per call rather than at module load: the token is not present until
 * sign-in, and a staff member whose JWT practice differs from `VITE_PRACTICE_ID`
 * must not read or write another practice's plans. Falls back to the env var.
 */
function currentPracticeId(): number {
  return resolvePracticeIdFromToken(getToken());
}

/** Catalog tables a plan line can point at. */
export type MembershipItemType = 'lab' | 'procedure' | 'inventory';

/**
 * `membership` plans bill on a subscription and are managed under Settings.
 * `bundle` rows are sold once and live in the catalog. Same store underneath.
 */
export type BundleKind = 'bundle' | 'membership';

/**
 * `all` — every item is included on its own allowance.
 * `choice` — the items are alternatives sharing one allowance ("this OR that").
 */
export type GroupSelectionMode = 'all' | 'choice';

/** What a member pays for a line still inside its allowance. */
export type ItemCoverage = 'included' | 'copay' | 'percent_off';

export type MembershipBillingInterval = 'monthly' | 'annual';

/* ------------------------------------------------------------------- types */

export type BundleItem = {
  id: number;
  itemType: MembershipItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  catalogPrice: number | null;
  quantity: number;
  coverage: ItemCoverage;
  copayPrice: number | null;
  percentOff: number | null;
  sortOrder: number;
  note: string | null;
};

export type BundleGroup = {
  id: number;
  name: string;
  description: string | null;
  selectionMode: GroupSelectionMode;
  allowedQuantity: number;
  sortOrder: number;
  items: BundleItem[];
};

export type Bundle = {
  id: number;
  practiceId: number;
  kind: BundleKind;
  name: string;
  code: string | null;
  description: string | null;
  marketingSummary: string | null;
  species: string | null;
  tier: string | null;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  termMonths: number | null;
  /** Default plan at each renewal while the member still fits the age window. */
  renewalSuccessorPackageId: number | null;
  renewalSuccessorPackageName: string | null;
  /** Plan at renewal when the pet has passed maxAgeMonths. */
  ageLimitSuccessorPackageId: number | null;
  ageLimitSuccessorPackageName: string | null;
  price: number | null;
  priceMonthly: number | null;
  priceAnnual: number | null;
  outOfPlanDiscount: number | null;
  renewalMonths: number | null;
  isAutoRenew: boolean;
  stripeProductId: string | null;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  portalSlug: string | null;
  sortOrder: number;
  isActive: boolean;
  isArchived: boolean;
  /** True while Scout edits shield this plan from the eVet import. */
  isScoutManaged: boolean;
  activeMemberCount: number;
  groups: BundleGroup[];
};

export type BundleItemInput = {
  id?: number;
  itemType: MembershipItemType;
  catalogItemId: number;
  quantity?: number;
  coverage?: ItemCoverage;
  copayPrice?: number | null;
  percentOff?: number | null;
  sortOrder?: number;
  note?: string | null;
};

export type BundleGroupInput = {
  id?: number;
  name: string;
  description?: string | null;
  selectionMode: GroupSelectionMode;
  allowedQuantity?: number;
  sortOrder?: number;
  items: BundleItemInput[];
};

export type BundleFields = {
  name?: string;
  code?: string | null;
  description?: string | null;
  marketingSummary?: string | null;
  species?: string | null;
  tier?: string | null;
  minAgeMonths?: number | null;
  maxAgeMonths?: number | null;
  termMonths?: number | null;
  renewalSuccessorPackageId?: number | null;
  ageLimitSuccessorPackageId?: number | null;
  price?: number | null;
  priceMonthly?: number | null;
  priceAnnual?: number | null;
  outOfPlanDiscount?: number | null;
  renewalMonths?: number | null;
  isAutoRenew?: boolean;
  stripeProductId?: string | null;
  stripeMonthlyPriceId?: string | null;
  stripeAnnualPriceId?: string | null;
  portalSlug?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  isArchived?: boolean;
};

export type PropagationResult = {
  membershipsUpdated: number;
  benefitsAdded: number;
  benefitsUpdated: number;
  benefitsRemoved: number;
  groupsSynced: number;
};

export type MembershipBenefit = {
  id: number;
  itemType: MembershipItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  catalogPrice: number | null;
  includedQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  coverage: ItemCoverage;
  price: number | null;
  percentOff: number | null;
  /** Added for this patient alone rather than coming from the plan template. */
  isCustom: boolean;
  isRemoved: boolean;
  note: string | null;
  addedByEmployeeId: number | null;
  addedAt: string | null;
  removedByEmployeeId: number | null;
  removedAt: string | null;
};

export type MembershipGroup = {
  id: number;
  name: string;
  selectionMode: GroupSelectionMode;
  allowedQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  sortOrder: number;
  benefits: MembershipBenefit[];
};

export type PatientMembership = {
  id: number;
  practiceId: number;
  patientId: number;
  patientName: string | null;
  packageId: number;
  planName: string;
  planTier: string | null;
  status: 'active' | 'inactive';
  startDate: string | null;
  expirationDate: string | null;
  billingInterval: string | null;
  price: number | null;
  outOfPlanDiscount: number | null;
  stripeSubscriptionId: string | null;
  notes: string | null;
  createdByEmployeeId: number | null;
  isScoutManaged: boolean;
  groups: MembershipGroup[];
};

export type MembershipAuditEntry = {
  id: number;
  action: string;
  summary: string;
  employeeId: number | null;
  employeeName: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string | null;
};

/* ----------------------------------------------------------------- bundles */

export async function listBundles(opts?: {
  kind?: BundleKind;
  includeArchived?: boolean;
  q?: string;
}): Promise<Bundle[]> {
  const { data } = await http.get<Bundle[]>('/memberships/bundles', {
    params: {
      practiceId: currentPracticeId(),
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.includeArchived ? { includeArchived: true } : {}),
      ...(opts?.q?.trim() ? { q: opts.q.trim() } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function getBundle(id: number): Promise<Bundle> {
  const { data } = await http.get<Bundle>(
    `/memberships/bundles/${encodeURIComponent(id)}`,
    { params: { practiceId: currentPracticeId() } },
  );
  return data;
}

export async function createBundle(
  kind: BundleKind,
  fields: BundleFields & { name: string },
  groups?: BundleGroupInput[],
): Promise<Bundle> {
  const { data } = await http.post<Bundle>('/memberships/bundles', {
    practiceId: currentPracticeId(),
    kind,
    ...fields,
    ...(groups ? { groups } : {}),
  });
  return data;
}

export async function updateBundle(
  id: number,
  fields: BundleFields,
  opts?: {
    groups?: BundleGroupInput[];
    /** "Apply this to all current {{plan}} memberships." */
    applyToExistingMemberships?: boolean;
    removeBenefitsDroppedFromPlan?: boolean;
    /** `future` = new enrollments and renewals; `current` = also update live Stripe subscriptions. */
    priceApplyTo?: 'future' | 'current';
  },
): Promise<Bundle & { propagation?: PropagationResult }> {
  const { data } = await http.patch<Bundle & { propagation?: PropagationResult }>(
    `/memberships/bundles/${encodeURIComponent(id)}`,
    {
      practiceId: currentPracticeId(),
      ...fields,
      ...(opts?.groups ? { groups: opts.groups } : {}),
      ...(opts?.applyToExistingMemberships
        ? { applyToExistingMemberships: true }
        : {}),
      ...(opts?.removeBenefitsDroppedFromPlan
        ? { removeBenefitsDroppedFromPlan: true }
        : {}),
      ...(opts?.priceApplyTo ? { priceApplyTo: opts.priceApplyTo } : {}),
    },
  );
  return data;
}

/** Pushes the saved plan onto existing memberships without other edits. */
export async function applyBundleToExistingMemberships(
  id: number,
  opts?: { removeBenefitsDroppedFromPlan?: boolean },
): Promise<PropagationResult> {
  const { data } = await http.post<PropagationResult>(
    `/memberships/bundles/${encodeURIComponent(id)}/apply-to-existing`,
    {
      practiceId: currentPracticeId(),
      ...(opts?.removeBenefitsDroppedFromPlan
        ? { removeBenefitsDroppedFromPlan: true }
        : {}),
    },
  );
  return data;
}

export async function archiveBundle(id: number): Promise<void> {
  await http.delete(`/memberships/bundles/${encodeURIComponent(id)}`, {
    params: { practiceId: currentPracticeId() },
  });
}

export async function getBundleAudit(
  id: number,
): Promise<MembershipAuditEntry[]> {
  const { data } = await http.get<MembershipAuditEntry[]>(
    `/memberships/bundles/${encodeURIComponent(id)}/audit`,
    { params: { practiceId: currentPracticeId() } },
  );
  return Array.isArray(data) ? data : [];
}

/* ----------------------------------------------------- patient memberships */

export async function listPatientMemberships(opts?: {
  patientId?: number;
  clientId?: number;
  includeInactive?: boolean;
}): Promise<PatientMembership[]> {
  const { data } = await http.get<PatientMembership[]>(
    '/memberships/patient-memberships',
    {
      params: {
        practiceId: currentPracticeId(),
        ...(opts?.patientId ? { patientId: opts.patientId } : {}),
        ...(opts?.clientId ? { clientId: opts.clientId } : {}),
        ...(opts?.includeInactive ? { includeInactive: true } : {}),
      },
    },
  );
  return Array.isArray(data) ? data : [];
}

export async function getPatientMembership(
  id: number,
): Promise<PatientMembership> {
  const { data } = await http.get<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(id)}`,
    { params: { practiceId: currentPracticeId() } },
  );
  return data;
}

export async function getPatientMembershipAudit(
  id: number,
): Promise<MembershipAuditEntry[]> {
  const { data } = await http.get<MembershipAuditEntry[]>(
    `/memberships/patient-memberships/${encodeURIComponent(id)}/audit`,
    { params: { practiceId: currentPracticeId() } },
  );
  return Array.isArray(data) ? data : [];
}

export async function createPatientMembership(input: {
  patientId: number;
  packageId: number;
  billingInterval?: MembershipBillingInterval;
  startDate?: string;
  price?: number | null;
  stripeSubscriptionId?: string | null;
  membershipTransactionId?: number | null;
  notes?: string | null;
}): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    '/memberships/patient-memberships',
    { practiceId: currentPracticeId(), ...input },
  );
  return data;
}

/** Adds a benefit to this patient's membership only; the template is untouched. */
export async function addMembershipItem(
  membershipId: number,
  input: {
    itemType: MembershipItemType;
    catalogItemId: number;
    includedQuantity?: number;
    coverage?: ItemCoverage;
    price?: number | null;
    percentOff?: number | null;
    groupId?: number | null;
    note?: string | null;
  },
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/items`,
    { practiceId: currentPracticeId(), ...input },
  );
  return data;
}

export async function updateMembershipItem(
  membershipId: number,
  itemId: number,
  input: {
    includedQuantity?: number;
    coverage?: ItemCoverage;
    price?: number | null;
    percentOff?: number | null;
    note?: string | null;
  },
): Promise<PatientMembership> {
  const { data } = await http.patch<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/items/${encodeURIComponent(itemId)}`,
    { practiceId: currentPracticeId(), ...input },
  );
  return data;
}

export async function removeMembershipItem(
  membershipId: number,
  itemId: number,
  reason?: string,
): Promise<void> {
  await http.delete(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/items/${encodeURIComponent(itemId)}`,
    {
      params: {
        practiceId: currentPracticeId(),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    },
  );
}

/** Foundations -> Foundations Puppy/Kitten in one call, no Stripe dashboard. */
export async function changeMembershipPlan(
  membershipId: number,
  input: {
    packageId: number;
    billingInterval?: MembershipBillingInterval;
    carryOverUsage?: boolean;
    keepCustomItems?: boolean;
    reason?: string | null;
  },
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/change-plan`,
    { practiceId: currentPracticeId(), ...input },
  );
  return data;
}

export async function cancelMembership(
  membershipId: number,
  reason?: string,
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/cancel`,
    { practiceId: currentPracticeId(), ...(reason ? { reason } : {}) },
  );
  return data;
}

/* ------------------------------------------------- post-visit membership signup */

export type PostVisitSignupLine = {
  visitInvoiceLineId: string;
  description: string;
  itemType: MembershipItemType | null;
  catalogItemId: number | null;
  qty: number;
  listUnitPrice: number;
  currentAmount: number;
  newAmount: number;
  coveredByMembership: boolean;
  /** Human-readable and safe to show to staff in the line table. */
  coverageReason: string;
};

export type PostVisitSignupBenefit = {
  visitInvoiceLineId: string;
  description: string;
  itemType: MembershipItemType;
  catalogItemId: number;
  quantity: number;
  amountCovered: number;
};

export type PostVisitSignupPreview = {
  invoice: {
    id: string;
    status: 'open' | 'finalized' | 'paid' | 'void';
    total: number;
    amountPaid: number;
    lineCount: number;
    patientId: number | null;
    clientId: number | null;
    visitAt: string | null;
    visitAgeHours: number | null;
  };
  lines: PostVisitSignupLine[];
  newSubtotal: number;
  newTaxTotal: number;
  newTotal: number;
  /** Negative: the total reduction membership pricing applies to this bill. */
  membershipAdjustments: number;
  amountAlreadyPaid: number;
  refundDue: number;
  balanceDue: number;
  benefitsToCredit: PostVisitSignupBenefit[];
  planName: string;
  planPrice: number | null;
  warnings: string[];
};

export type PostVisitSignupResult = {
  membershipId: number;
  planName: string;
  planPrice: number | null;
  refundStatus: 'issued' | 'skipped' | 'not_needed' | 'failed';
  refundAmount: number;
  refundReference: string | null;
  refundError: string | null;
  invoice: {
    id: string;
    status: 'open' | 'finalized' | 'paid' | 'void';
    subtotal: number;
    taxTotal: number;
    total: number;
    membershipAdjustments: number;
    amountPaid: number;
    balanceDue: number;
  };
  benefitsCredited: PostVisitSignupBenefit[];
  emailSent: boolean;
  warnings: string[];
};

/** Dry run: what the refund and re-priced bill would be. Writes nothing. */
export async function previewPostVisitSignup(input: {
  visitInvoiceId: string;
  packageId: number;
  billingInterval?: MembershipBillingInterval;
}): Promise<PostVisitSignupPreview> {
  const { data } = await http.post<PostVisitSignupPreview>(
    '/memberships/post-visit-signup/preview',
    { practiceId: currentPracticeId(), ...input },
  );
  return data;
}

/**
 * Enrols the patient, re-prices the visit, credits the services they already
 * received, refunds the difference, and emails the client.
 *
 * `confirmRefundAmount` is the figure staff were shown; the API rejects the call
 * if the bill moved underneath them.
 */
export async function executePostVisitSignup(input: {
  visitInvoiceId: string;
  packageId: number;
  billingInterval?: MembershipBillingInterval;
  confirmRefundAmount?: number;
  skipRefund?: boolean;
  note?: string;
}): Promise<PostVisitSignupResult> {
  const { data } = await http.post<PostVisitSignupResult>(
    '/memberships/post-visit-signup/execute',
    { practiceId: currentPracticeId(), ...input },
  );
  return data;
}

export type MembershipRenewalPreview = {
  petName: string;
  clientFirstName: string;
  currentPlanName: string;
  nextPlanName: string;
  billingInterval: MembershipBillingInterval | null;
  nextPrice: number | null;
  termEnd: string;
  reason: 'aged_out' | 'successor' | 'same';
  alreadyCanceling: boolean;
  cancelPhrase: string;
};

/** No JWT — the review token is in the query string. */
const publicMembershipClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  withCredentials: false,
});

export async function fetchMembershipRenewalPreview(
  token: string,
): Promise<MembershipRenewalPreview> {
  const { data } = await publicMembershipClient.get<MembershipRenewalPreview>(
    '/public/membership-renewal',
    { params: { token } },
  );
  return data;
}

export async function requestMembershipRenewalCancel(
  token: string,
  body: { petName: string; phrase: string; reason: string; acknowledge: boolean },
): Promise<{ ok: true; termEnd: string }> {
  const { data } = await publicMembershipClient.post<{ ok: true; termEnd: string }>(
    '/public/membership-renewal/cancel',
    body,
    { params: { token } },
  );
  return data;
}
