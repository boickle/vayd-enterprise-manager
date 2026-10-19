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

export type ClientPortalPetSavings = {
  patientId: number;
  /** Matches `Pet.id` in the portal (PIMS id when present). */
  portalPetId: string;
  petName: string;
  estimate: PetMembershipSavingsEstimate | null;
};

export async function fetchMyMembershipSavings(): Promise<ClientPortalPetSavings[]> {
  const { data } = await http.get('/membership-savings/client/mine');
  return Array.isArray(data?.pets) ? data.pets : [];
}
