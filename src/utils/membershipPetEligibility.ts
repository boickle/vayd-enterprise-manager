import {
  fetchWellnessPlansForPatient,
  type Pet,
  type WellnessPlan,
} from '../api/clientPortal';
import { listMembershipTransactions } from '../api/membershipTransactions';

export type PetWithMembershipContext = Pet & {
  membershipStatus?: string | null;
  membershipPlanName?: string | null;
  membershipUpdatedAt?: string | null;
};

function planIsActive(plan: Pick<WellnessPlan, 'isActive' | 'status'> | null | undefined): boolean {
  if (!plan) return false;

  const isDeleted = (plan as { isDeleted?: unknown }).isDeleted;
  if (isDeleted === true || String(isDeleted).toLowerCase() === 'true') return false;

  const expirationDate = (plan as { expirationDate?: string }).expirationDate;
  if (expirationDate) {
    const expDate = new Date(expirationDate);
    if (!Number.isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) return false;
  }

  const direct =
    plan.isActive === true ||
    String(plan.isActive).toLowerCase() === 'true' ||
    String(plan.isActive) === '1';
  if (direct) return true;

  const activeField = (plan as { active?: boolean | string }).active;
  if (typeof activeField === 'boolean' && activeField) return true;
  if (typeof activeField === 'string') {
    const activeStr = activeField.toLowerCase();
    if (activeStr === 'true' || activeStr === '1' || activeStr === 'active') return true;
  }

  const status = typeof plan.status === 'string' ? plan.status.toLowerCase() : undefined;
  return status === 'active';
}

/** Matches ClientPortal “Explore membership” visibility (`showMembershipButton`). */
export function petCanEnrollInMembership(pet: PetWithMembershipContext): boolean {
  const subStatus = pet.subscription?.status;
  if (subStatus === 'active' || subStatus === 'pending') return false;

  const activeWellnessPlans = (pet.wellnessPlans || []).filter(planIsActive);
  const hasActiveWellnessPlan = activeWellnessPlans.length > 0;
  const hasMembership = pet.membershipPlanName != null;
  const hasWellnessPlans = (pet.wellnessPlans || []).length > 0;
  const membershipUpdatedAt = pet.membershipUpdatedAt;
  const membershipIsRecent = membershipUpdatedAt
    ? (Date.now() - new Date(membershipUpdatedAt).getTime()) / (1000 * 60 * 60 * 24) <= 7
    : false;

  return (
    !hasActiveWellnessPlan &&
    (!hasMembership ||
      (hasMembership && hasWellnessPlans && !hasActiveWellnessPlan && !membershipIsRecent))
  );
}

async function latestMembershipForPet(
  pet: Pet,
  clientId?: string | number,
): Promise<{
  membershipStatus: string | null;
  membershipPlanName: string | null;
  membershipUpdatedAt: string | null;
}> {
  const patientIdentifier = pet.dbId ?? pet.id;
  if (!patientIdentifier) {
    return { membershipStatus: null, membershipPlanName: null, membershipUpdatedAt: null };
  }
  const patientNumeric = Number(patientIdentifier);
  if (!Number.isFinite(patientNumeric)) {
    return { membershipStatus: null, membershipPlanName: null, membershipUpdatedAt: null };
  }

  try {
    const queryClientId = clientId ?? pet.clientId ?? undefined;
    const txns = await listMembershipTransactions({
      patientId: patientNumeric,
      clientId: queryClientId,
    });
    if (!Array.isArray(txns) || txns.length === 0) {
      return { membershipStatus: null, membershipPlanName: null, membershipUpdatedAt: null };
    }
    const sorted = txns.slice().sort((a, b) => {
      const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '');
      const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '');
      if (Number.isFinite(bTime) && Number.isFinite(aTime)) return bTime - aTime;
      return (b.id ?? 0) - (a.id ?? 0);
    });
    const latest = sorted[0];
    const plansSelected = (latest as { plansSelected?: unknown[] }).plansSelected;
    const pricingFromPlansSelected =
      Array.isArray(plansSelected) && plansSelected.length > 0
        ? (plansSelected[0] as { pricingOption?: string })?.pricingOption
        : null;
    return {
      membershipStatus: latest.status ?? latest.metadata?.status ?? null,
      membershipPlanName:
        latest.planName ?? latest.metadata?.planName ?? null,
      membershipUpdatedAt: latest.updatedAt ?? latest.createdAt ?? null,
    };
  } catch {
    return { membershipStatus: null, membershipPlanName: null, membershipUpdatedAt: null };
  }
}

export async function enrichPetWithMembershipContext(
  pet: Pet,
  clientId?: string | number,
): Promise<PetWithMembershipContext> {
  const dbId = pet.dbId;
  let wellnessPlans = pet.wellnessPlans;
  if (dbId) {
    try {
      wellnessPlans = await fetchWellnessPlansForPatient(dbId);
    } catch {
      wellnessPlans = pet.wellnessPlans ?? [];
    }
  }

  const membership = await latestMembershipForPet(pet, clientId);

  return {
    ...pet,
    wellnessPlans: wellnessPlans ?? pet.wellnessPlans,
    membershipStatus: membership.membershipStatus,
    membershipPlanName: membership.membershipPlanName,
    membershipUpdatedAt: membership.membershipUpdatedAt,
  };
}

export async function filterPetsEligibleForMembershipSignup(
  pets: Pet[],
  clientId?: string | number,
): Promise<PetWithMembershipContext[]> {
  const enriched = await Promise.all(pets.map((p) => enrichPetWithMembershipContext(p, clientId)));
  return enriched.filter(petCanEnrollInMembership);
}

export const ALL_PETS_ALREADY_MEMBERS_MESSAGE =
  'All pets on your account already have an active membership or one in progress. Return to the client portal to view your memberships.';
