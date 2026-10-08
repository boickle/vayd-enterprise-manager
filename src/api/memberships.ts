import axios from 'axios';
import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

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
 * `any` — sell-once only: staff may check any subset (including none) at invoice time.
 */
export type GroupSelectionMode = 'all' | 'choice' | 'any';

/** What a member pays for a line still inside its allowance. */
export type ItemCoverage = 'included' | 'copay' | 'percent_off';

/**
 * How doctor production is valued for a membership / package line.
 * - `full_price` — catalog list price
 * - `membership_price` — what the member is charged for the line
 * - `custom` — fixed amount in `productionOverride`
 */
export type ItemProductionBasis = 'full_price' | 'membership_price' | 'custom';

/** Sentinel for unlimited allowance — every matching visit gets member pricing. */
export const UNLIMITED_ALLOWANCE = -1;

export type MembershipBillingInterval = 'monthly' | 'annual';

/* ------------------------------------------------------------------- types */

export type BundleItem = {
  id: number;
  itemType: MembershipItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  catalogPrice: number | null;
  /** -1 means unlimited (every matching visit gets member pricing). */
  quantity: number;
  coverage: ItemCoverage;
  copayPrice: number | null;
  percentOff: number | null;
  productionBasis: ItemProductionBasis;
  productionOverride: number | null;
  sortOrder: number;
  note: string | null;
};

export type BundleGroup = {
  id: number;
  name: string;
  description: string | null;
  selectionMode: GroupSelectionMode;
  /** -1 means unlimited shared OR picks. */
  allowedQuantity: number;
  /**
   * Sell-once `choice`: when true (default), staff must satisfy the pick count.
   * When false, they may skip. Always treated as optional for `any`.
   */
  isRequired: boolean;
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
  /** Line under the plan name on the signup card. */
  cardTagLine: string | null;
  /** "Includes" bullets on the signup card; savings lines come from the discounts. */
  cardBullets: string[] | null;
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
  onlineStoreDiscount: number | null;
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
  productionBasis?: ItemProductionBasis;
  productionOverride?: number | null;
  sortOrder?: number;
  note?: string | null;
};

export type BundleGroupInput = {
  id?: number;
  name: string;
  description?: string | null;
  selectionMode: GroupSelectionMode;
  allowedQuantity?: number;
  isRequired?: boolean;
  sortOrder?: number;
  items: BundleItemInput[];
};

export type BundleFields = {
  name?: string;
  code?: string | null;
  description?: string | null;
  marketingSummary?: string | null;
  cardTagLine?: string | null;
  cardBullets?: string[] | null;
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
  onlineStoreDiscount?: number | null;
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
  /** -1 means unlimited. */
  includedQuantity: number;
  usedQuantity: number;
  /** -1 means unlimited remaining. */
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
  /** Set after a staff plan change: what happened to billing. */
  billingNote?: string;
  id: number;
  practiceId: number;
  patientId: number;
  patientName: string | null;
  packageId: number;
  planName: string;
  planTier: string | null;
  /** 'expired': never cancelled, but past its end date (e.g. a held renewal). */
  status: 'active' | 'inactive' | 'expired';
  /** Set on enrolment only: species or age mismatches staff should check. */
  warnings?: string[];
  startDate: string | null;
  expirationDate: string | null;
  billingInterval: string | null;
  price: number | null;
  outOfPlanDiscount: number | null;
  onlineStoreDiscount: number | null;
  stripeSubscriptionId: string | null;
  notes: string | null;
  createdByEmployeeId: number | null;
  isScoutManaged: boolean;
  /** Set while a card dispute is open: no member pricing or covered services. */
  benefitsPaused: { since: string; reason: string | null } | null;
  /** Set when the pet changed owners while this membership was active, until staff mark it handled. */
  ownerChange: MembershipOwnerChange | null;
  groups: MembershipGroup[];
};

export type MembershipOwnerRef = { id: number; name: string };

export type MembershipOwnerChange = {
  since: string;
  /** Owners before the first change staff haven't handled yet. */
  previous: MembershipOwnerRef[];
  current: MembershipOwnerRef[];
  /** Stripe customer on the membership, else whoever made the latest membership payment. */
  payer: MembershipOwnerRef | null;
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

/** A plan whose members would renew onto an archived plan. */
export type RenewalGap = {
  packageId: number;
  name: string;
  isArchived: boolean;
  activeMemberCount: number;
  problem: 'no_next_plan' | 'next_plan_archived' | 'age_out_plan_archived';
  archivedPlanName: string;
};

export async function listRenewalGaps(): Promise<RenewalGap[]> {
  const { data } = await http.get<RenewalGap[]>('/memberships/bundles/renewal-gaps', {
    params: { practiceId: currentPracticeId() },
  });
  return Array.isArray(data) ? data : [];
}

export async function getBundle(id: number): Promise<Bundle> {
  const { data } = await http.get<Bundle>(`/memberships/bundles/${encodeURIComponent(id)}`, {
    params: { practiceId: currentPracticeId() },
  });
  return data;
}

/** One catalog line after expanding a sell-once bundle (post OR picks). */
export type BundleSaleLine = {
  packageItemId: number;
  groupId: number | null;
  itemType: MembershipItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  quantity: number;
  unitPrice: number;
  listUnitPrice: number;
  note: string | null;
};

export type BundleSaleResolution = {
  bundleId: number;
  bundleName: string;
  bundlePrice: number | null;
  lines: BundleSaleLine[];
};

export type BundleSaleGroupSelection = {
  groupId: number;
  packageItemIds: number[];
};

/**
 * Expand a catalog bundle for an invoice / SOAP charge. `all` groups always
 * expand; `choice` (OR) groups need staff picks in `selections`.
 */
export async function resolveBundleForSale(
  id: number,
  selections: BundleSaleGroupSelection[] = []
): Promise<BundleSaleResolution> {
  const { data } = await http.post<BundleSaleResolution>(
    `/memberships/bundles/${encodeURIComponent(id)}/resolve-for-sale`,
    {
      practiceId: currentPracticeId(),
      selections,
    }
  );
  return data;
}

export async function createBundle(
  kind: BundleKind,
  fields: BundleFields & { name: string },
  groups?: BundleGroupInput[]
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
  }
): Promise<Bundle & { propagation?: PropagationResult }> {
  const { data } = await http.patch<Bundle & { propagation?: PropagationResult }>(
    `/memberships/bundles/${encodeURIComponent(id)}`,
    {
      practiceId: currentPracticeId(),
      ...fields,
      ...(opts?.groups ? { groups: opts.groups } : {}),
      ...(opts?.applyToExistingMemberships ? { applyToExistingMemberships: true } : {}),
      ...(opts?.removeBenefitsDroppedFromPlan ? { removeBenefitsDroppedFromPlan: true } : {}),
      ...(opts?.priceApplyTo ? { priceApplyTo: opts.priceApplyTo } : {}),
    }
  );
  return data;
}

/** Pushes the saved plan onto existing memberships without other edits. */
export async function applyBundleToExistingMemberships(
  id: number,
  opts?: {
    removeBenefitsDroppedFromPlan?: boolean;
    packageItemIds?: number[];
    removePackageItemIds?: number[];
  }
): Promise<PropagationResult> {
  const { data } = await http.post<PropagationResult>(
    `/memberships/bundles/${encodeURIComponent(id)}/apply-to-existing`,
    {
      practiceId: currentPracticeId(),
      ...(opts?.removeBenefitsDroppedFromPlan ? { removeBenefitsDroppedFromPlan: true } : {}),
      ...(opts?.packageItemIds?.length ? { packageItemIds: opts.packageItemIds } : {}),
      ...(opts?.removePackageItemIds?.length
        ? { removePackageItemIds: opts.removePackageItemIds }
        : {}),
    }
  );
  return data;
}

export async function archiveBundle(id: number): Promise<void> {
  await http.delete(`/memberships/bundles/${encodeURIComponent(id)}`, {
    params: { practiceId: currentPracticeId() },
  });
}

export async function getBundleAudit(id: number): Promise<MembershipAuditEntry[]> {
  const { data } = await http.get<MembershipAuditEntry[]>(
    `/memberships/bundles/${encodeURIComponent(id)}/audit`,
    { params: { practiceId: currentPracticeId() } }
  );
  return Array.isArray(data) ? data : [];
}

/* ----------------------------------------------------- patient memberships */

export async function listPatientMemberships(opts?: {
  patientId?: number;
  clientId?: number;
  includeInactive?: boolean;
}): Promise<PatientMembership[]> {
  const { data } = await http.get<PatientMembership[]>('/memberships/patient-memberships', {
    params: {
      practiceId: currentPracticeId(),
      ...(opts?.patientId ? { patientId: opts.patientId } : {}),
      ...(opts?.clientId ? { clientId: opts.clientId } : {}),
      ...(opts?.includeInactive ? { includeInactive: true } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

/** Client portal: the logged-in client's own pets' memberships, with benefit usage. */
export async function listMyPatientMemberships(opts?: {
  patientId?: number;
}): Promise<PatientMembership[]> {
  const { data } = await http.get<PatientMembership[]>('/memberships/patient-memberships/mine', {
    params: {
      practiceId: currentPracticeId(),
      ...(opts?.patientId ? { patientId: opts.patientId } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function getPatientMembership(id: number): Promise<PatientMembership> {
  const { data } = await http.get<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(id)}`,
    { params: { practiceId: currentPracticeId() } }
  );
  return data;
}

export async function getPatientMembershipAudit(id: number): Promise<MembershipAuditEntry[]> {
  const { data } = await http.get<MembershipAuditEntry[]>(
    `/memberships/patient-memberships/${encodeURIComponent(id)}/audit`,
    { params: { practiceId: currentPracticeId() } }
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
  agreementAccepted?: boolean;
  agreementSignature?: string;
  agreementSignatureData?: string;
  agreementSignedAt?: string;
  agreementText?: string;
}): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>('/memberships/patient-memberships', {
    practiceId: currentPracticeId(),
    ...input,
  });
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
  }
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/items`,
    { practiceId: currentPracticeId(), ...input }
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
  }
): Promise<PatientMembership> {
  const { data } = await http.patch<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/items/${encodeURIComponent(itemId)}`,
    { practiceId: currentPracticeId(), ...input }
  );
  return data;
}

export async function removeMembershipItem(
  membershipId: number,
  itemId: number,
  reason?: string
): Promise<void> {
  await http.delete(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/items/${encodeURIComponent(itemId)}`,
    {
      params: {
        practiceId: currentPracticeId(),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    }
  );
}

/** Staff fix for a wrong plan; Stripe billing follows (Square is changed by hand). */
export async function changeMembershipPlan(
  membershipId: number,
  input: {
    packageId: number;
    billingInterval?: MembershipBillingInterval;
    carryOverUsage?: boolean;
    keepCustomItems?: boolean;
    reason?: string | null;
  }
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/change-plan`,
    { practiceId: currentPracticeId(), ...input }
  );
  return data;
}

export type MembershipBillingCard = {
  card: { brand: string; last4: string; expMonth: number | null; expYear: number | null } | null;
  canUpdate: boolean;
  reason: string | null;
};

function membershipCardPath(membershipId: number, mine: boolean) {
  return `/memberships/patient-memberships/${mine ? 'mine/' : ''}${encodeURIComponent(membershipId)}/card`;
}

/** The card a membership is billed on. `mine` is the client portal. */
export async function getMembershipCard(
  membershipId: number,
  opts?: { mine?: boolean }
): Promise<MembershipBillingCard> {
  const { data } = await http.get<MembershipBillingCard>(
    membershipCardPath(membershipId, opts?.mine === true),
    { params: { practiceId: currentPracticeId() } }
  );
  return data;
}

export async function updateMembershipCard(
  membershipId: number,
  paymentMethodId: string,
  opts?: { mine?: boolean }
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    membershipCardPath(membershipId, opts?.mine === true),
    { practiceId: currentPracticeId(), paymentMethodId }
  );
  return data;
}

export async function resumeMembershipBenefits(
  membershipId: number,
  note?: string | null
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/resume-benefits`,
    { practiceId: currentPracticeId(), note: note || undefined }
  );
  return data;
}

export async function markMembershipOwnerChangeHandled(
  membershipId: number,
  note?: string | null
): Promise<PatientMembership> {
  const { data } = await http.post<PatientMembership>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/owner-change/handled`,
    { practiceId: currentPracticeId(), note: note || undefined }
  );
  return data;
}

export type MembershipCancelLine = {
  description: string;
  amount: number;
};

export type MembershipCancelPreview = {
  membershipId: number;
  planName: string;
  petName: string;
  billingInterval: 'monthly' | 'annual';
  termStart: string;
  termLabel: string;
  paidThisTerm: number;
  usedThisTerm: number;
  chargeAmount: number;
  refundAmount: number;
  hasCard: boolean;
  coveredLines: MembershipCancelLine[];
  paidLines: MembershipCancelLine[];
  ownerWillSee: string;
};

export type MembershipCancelResult = {
  membership: PatientMembership;
  invoiceId?: string | null;
  paidThisTerm: number;
  usedThisTerm: number;
  chargeAmount: number;
  refundAmount: number;
  chargeIssued?: boolean;
  refundIssued?: boolean;
  chargeByHand?: boolean;
  refundByHand?: boolean;
  stripeCanceled?: boolean;
  emailSent?: boolean;
  moneyError?: string | null;
  ownerWillSee?: string;
};

export async function previewMembershipCancel(
  membershipId: number
): Promise<MembershipCancelPreview> {
  const { data } = await http.get<MembershipCancelPreview>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/cancel-preview`,
    { params: { practiceId: currentPracticeId() } }
  );
  return data;
}

export async function cancelMembership(
  membershipId: number,
  reason: string,
  confirm?: { chargeAmount?: number; refundAmount?: number; skipMoney?: boolean }
): Promise<MembershipCancelResult> {
  const { data } = await http.post<MembershipCancelResult>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/cancel`,
    {
      practiceId: currentPracticeId(),
      reason,
      ...(confirm?.chargeAmount != null ? { confirmChargeAmount: confirm.chargeAmount } : {}),
      ...(confirm?.refundAmount != null ? { confirmRefundAmount: confirm.refundAmount } : {}),
      ...(confirm?.skipMoney ? { skipMoney: true } : {}),
    }
  );
  return data;
}

/* ------------------------------------------------- post-visit membership signup */

export type PostVisitSignupLine = {
  visitInvoiceId?: string;
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
  /** When not covered, plan benefit this line would map to. */
  recommendedBenefitName?: string | null;
};

export type PostVisitSignupBenefit = {
  visitInvoiceId?: string;
  visitInvoiceLineId: string;
  description: string;
  itemType: MembershipItemType;
  catalogItemId: number;
  quantity: number;
  amountCovered: number;
};

export type PostVisitSignupInvoiceSummary = {
  id: string;
  status: 'open' | 'finalized' | 'paid' | 'void';
  total: number;
  amountPaid: number;
  lineCount: number;
  patientId: number | null;
  clientId: number | null;
  visitAt: string | null;
  visitAgeHours: number | null;
  newTotal?: number;
  refundDue?: number;
  balanceDue?: number;
};

export type PostVisitSignupPreview = {
  invoice: PostVisitSignupInvoiceSummary;
  invoices?: PostVisitSignupInvoiceSummary[];
  lines: PostVisitSignupLine[];
  newSubtotal: number;
  newTaxTotal: number;
  newTotal: number;
  /** Negative: the total reduction membership pricing applies to this bill. */
  membershipAdjustments: number;
  amountAlreadyPaid: number;
  refundDue: number;
  balanceDue: number;
  /** First Stripe subscription invoice collected today. Zero when there is no card. */
  subscriptionAmount?: number;
  benefitsToCredit: PostVisitSignupBenefit[];
  planName: string;
  planPrice: number | null;
  windowHours?: number;
  outsideWindow?: boolean;
  oldestInvoiceAgeHours?: number | null;
  warnings: string[];
  /** Paid in eVet, not Stripe — refund or collect the balance by hand. */
  manualSettlement?: boolean;
  /** Owner already paid in Stripe. Refund the covered visit only. */
  ownerAlreadyPaid?: boolean;
  /** Enter a card — the visit payment cannot start the subscription. */
  needsCard?: boolean;
  paidInStripe?: boolean;
};

export type PostVisitSignupResult = {
  membershipId: number;
  planName: string;
  planPrice: number | null;
  refundStatus: 'issued' | 'skipped' | 'not_needed' | 'failed';
  refundAmount: number;
  refundReference: string | null;
  refundError: string | null;
  chargeStatus?: 'issued' | 'skipped' | 'not_needed' | 'failed';
  chargeAmount?: number;
  chargeReference?: string | null;
  chargeError?: string | null;
  subscriptionStatus?: 'issued' | 'skipped' | 'not_needed' | 'failed';
  subscriptionAmount?: number;
  subscriptionId?: string | null;
  subscriptionError?: string | null;
  ownerAlreadyPaid?: boolean;
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
  invoices?: Array<{
    id: string;
    status: 'open' | 'finalized' | 'paid' | 'void';
    subtotal: number;
    taxTotal: number;
    total: number;
    membershipAdjustments: number;
    amountPaid: number;
    balanceDue: number;
    refundStatus: 'issued' | 'skipped' | 'not_needed' | 'failed';
    refundAmount: number;
  }>;
  benefitsCredited: PostVisitSignupBenefit[];
  emailSent: boolean;
  windowOverridden?: boolean;
  warnings: string[];
};

/** Dry run: what the refund and re-priced bill would be. Writes nothing. */
export type PostVisitLineSubstitution = {
  visitInvoiceLineId: string;
  itemType: MembershipItemType;
  catalogItemId: number;
};

export async function previewPostVisitSignup(input: {
  visitInvoiceId?: string;
  visitInvoiceIds?: string[];
  packageId: number;
  billingInterval?: MembershipBillingInterval;
  patientId?: number;
  substitutions?: PostVisitLineSubstitution[];
  paymentMethodId?: string;
}): Promise<PostVisitSignupPreview> {
  const { data } = await http.post<PostVisitSignupPreview>(
    '/memberships/post-visit-signup/preview',
    { practiceId: currentPracticeId(), ...input }
  );
  return data;
}

/**
 * Enrolls the patient, re-prices the visit, credits the services they already
 * received, refunds the difference, and emails the client.
 *
 * `confirmRefundAmount` is the figure staff were shown; the API rejects the call
 * if the bill moved underneath them.
 */
export async function executePostVisitSignup(input: {
  visitInvoiceId?: string;
  visitInvoiceIds?: string[];
  packageId: number;
  billingInterval?: MembershipBillingInterval;
  patientId?: number;
  substitutions?: PostVisitLineSubstitution[];
  confirmRefundAmount?: number;
  confirmChargeAmount?: number;
  confirmSubscriptionAmount?: number;
  skipRefund?: boolean;
  note?: string;
  overrideWindow?: boolean;
  overrideWindowReason?: string;
  paymentMethodId?: string;
  agreementAccepted?: boolean;
  agreementSignature?: string;
  agreementSignatureData?: string;
  agreementSignedAt?: string;
  agreementText?: string;
}): Promise<PostVisitSignupResult> {
  const { data } = await http.post<PostVisitSignupResult>(
    '/memberships/post-visit-signup/execute',
    { practiceId: currentPracticeId(), ...input }
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
  reason: 'aged_out' | 'successor' | 'same' | 'chosen';
  alreadyCanceling: boolean;
  cancelPhrase: string;
  /** Still billed through the old (Square) system: ask for a card and plan. */
  needsCard: boolean;
  planOptions: MembershipRenewalPlanOption[];
  recommendedPackageId: number;
  /** What renews: the owner's choice if any, else the recommended plan. */
  nextPackageId: number;
  /** Set when the plan changes at renewal (for example Foundations to Golden). */
  comparison: MembershipRenewalComparison | null;
};

export type MembershipRenewalComparison = {
  fromPlanName: string;
  toPlanName: string;
  billingInterval: MembershipBillingInterval;
  fromPrice: number | null;
  toPrice: number | null;
  priceDifference: number | null;
  added: string[];
  why: string | null;
  canStay: boolean;
};

export type UpcomingMembershipRenewal = MembershipRenewalPreview & {
  wellnessPlanId: number;
  patientId: number | null;
  reviewToken: string;
};

/** Client portal: the logged-in client's pets whose membership renews soon. */
export async function listMyUpcomingRenewals(): Promise<UpcomingMembershipRenewal[]> {
  const { data } = await http.get<UpcomingMembershipRenewal[]>(
    '/memberships/patient-memberships/mine/upcoming-renewals',
    { params: { practiceId: currentPracticeId() } },
  );
  return data;
}

export type MembershipRenewalPlanOption = {
  packageId: number;
  name: string;
  summary: string | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  monthlyAvailable: boolean;
  annualAvailable: boolean;
  recommended: boolean;
};

export type MembershipRenewalCardResult = {
  ok: true;
  planName: string;
  billingInterval: MembershipBillingInterval;
  price: number | null;
  firstChargeDate: string;
};

/** No JWT — the review token is in the query string. */
const publicMembershipClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  withCredentials: false,
});

export async function fetchMembershipRenewalPreview(
  token: string
): Promise<MembershipRenewalPreview> {
  const { data } = await publicMembershipClient.get<MembershipRenewalPreview>(
    '/public/membership-renewal',
    { params: { token } }
  );
  return data;
}

export async function requestMembershipRenewalCancel(
  token: string,
  body: { petName: string; phrase: string; reason: string; acknowledge: boolean }
): Promise<{ ok: true; termEnd: string }> {
  const { data } = await publicMembershipClient.post<{ ok: true; termEnd: string }>(
    '/public/membership-renewal/cancel',
    body,
    { params: { token } }
  );
  return data;
}

export async function saveMembershipRenewalCard(
  token: string,
  body: {
    packageId: number;
    billingInterval: MembershipBillingInterval;
    paymentMethodId: string;
  }
): Promise<MembershipRenewalCardResult> {
  const { data } = await publicMembershipClient.post<MembershipRenewalCardResult>(
    '/public/membership-renewal/payment-card',
    body,
    { params: { token } }
  );
  return data;
}

export async function chooseMembershipRenewalPlan(
  token: string,
  body: { packageId: number; billingInterval: MembershipBillingInterval },
): Promise<{
  ok: true;
  planName: string;
  billingInterval: MembershipBillingInterval;
  price: number | null;
}> {
  const { data } = await publicMembershipClient.post(
    '/public/membership-renewal/plan-choice',
    body,
    { params: { token } },
  );
  return data;
}
