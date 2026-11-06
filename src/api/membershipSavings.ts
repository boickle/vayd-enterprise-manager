import { http } from './http';

export type MembershipSavingsLineStatus = 'covered' | 'member_price' | 'not_included';

export type MembershipSavingsLineItem = {
  name: string;
  quantity: number;
  originalPrice: number;
  memberPrice: number;
  status: MembershipSavingsLineStatus;
};

export type PetMembershipSavingsEstimate = {
  patientId: number;
  petName: string;
  source: 'room_loader' | 'previous_visit' | 'completed_visit';
  visitDate: string | null;
  planId: 'foundations' | 'golden';
  planName: string;
  visitTotal: number;
  coveredAmount: number;
  memberVisitAmount: number;
  monthlyPrice: number | null;
  annualPrice: number | null;
  annualSavingsPercent: number;
  lineItems?: MembershipSavingsLineItem[];
};

export type MembershipPlanExtras = {
  /** Plan care that was not on the compared visit, priced at regular prices. */
  includedItems: Array<{ name: string; quantity: number; regularPrice: number }>;
  includedValue: number;
  /** Member prices the plan gives on later care. */
  memberDiscounts: Array<{
    name: string;
    regularPrice: number;
    memberPrice: number;
    perYear: number;
  }>;
};

export type ClientPortalPetSavings = {
  patientId: number;
  /** Matches `Pet.id` in the portal (PIMS id when present). */
  portalPetId: string;
  petName: string;
  estimate: PetMembershipSavingsEstimate | null;
  recommendedPlanId: 'foundations' | 'golden';
  recommendedPlanName: string;
  planExtras: MembershipPlanExtras | null;
  /** Additional-pet credit toward care when enrolled; 0 for the household's first pet. */
  multiPetCredit: number;
};

export async function fetchMyMembershipSavings(): Promise<ClientPortalPetSavings[]> {
  const { data } = await http.get('/membership-savings/client/mine');
  return Array.isArray(data?.pets) ? data.pets : [];
}

export type LastMembershipEmail = {
  kind: 'membership_promotion' | 'post_appointment_membership';
  sentAt: string;
  openedAt: string | null;
};

/** Staff: the same savings breakdown the client sees, plus the last membership email sent to them. */
export async function fetchClientMembershipSavings(clientId: number | string): Promise<{
  pets: ClientPortalPetSavings[];
  lastEmail: LastMembershipEmail | null;
}> {
  const { data } = await http.get(
    `/membership-savings/client/${encodeURIComponent(String(clientId))}`
  );
  return {
    pets: Array.isArray(data?.pets) ? data.pets : [],
    lastEmail: data?.lastEmail ?? null,
  };
}
