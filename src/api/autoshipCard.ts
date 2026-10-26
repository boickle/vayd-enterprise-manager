// See and change the card an auto-ship charges (client portal and staff).
import { http } from './http';

export type AutoshipCard = {
  paymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  /** The card the auto-ship charges now. */
  current: boolean;
};

export type AutoshipCards = {
  /** Stripe subscription status, e.g. active, trialing, past_due. */
  status: string;
  cards: AutoshipCard[];
};

export type AutoshipCardResult = AutoshipCards & {
  /** A past-due charge retried on the new card. */
  retried: 'paid' | 'failed' | null;
};

/** Client portal: the signed-in client's own auto-ship. */
export async function listMyAutoshipCards(practiceId: number, id: number) {
  const { data } = await http.get<AutoshipCards>(`/store/autoship/${id}/cards`, { params: { practiceId } });
  return data;
}

export async function setMyAutoshipCard(practiceId: number, id: number, paymentMethodId: string) {
  const { data } = await http.post<AutoshipCardResult>(
    `/store/autoship/${id}/card`,
    { paymentMethodId },
    { params: { practiceId } },
  );
  return data;
}

/** Staff: any auto-ship in the practice. */
export async function listStaffAutoshipCards(practiceId: number, id: number) {
  const { data } = await http.get<AutoshipCards>(`/practice/${practiceId}/online-store/subscriptions/${id}/cards`);
  return data;
}

export async function setStaffAutoshipCard(practiceId: number, id: number, paymentMethodId: string) {
  const { data } = await http.post<AutoshipCardResult>(
    `/practice/${practiceId}/online-store/subscriptions/${id}/card`,
    { paymentMethodId },
  );
  return data;
}
