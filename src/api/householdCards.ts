import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

/**
 * One card, everywhere (owner, Nov 13, 2026): after a card is saved in one place, offer to bill
 * the household's other places on it (the visit card on file, memberships, auto-ships).
 */
export type HouseholdCardTargetKind = 'card_on_file' | 'membership' | 'autoship';

export type HouseholdCardTarget = {
  kind: HouseholdCardTargetKind;
  id: number | null;
  label: string;
  current: { brand: string; last4: string } | null;
};

export type HouseholdCardOffer = {
  card: { paymentMethodId: string; brand: string; last4: string };
  targets: HouseholdCardTarget[];
};

export type HouseholdCardMoveResult = {
  kind: HouseholdCardTargetKind;
  id: number | null;
  label: string;
  ok: boolean;
  error: string | null;
};

export type HouseholdCardAudience = 'staff' | 'client';

/** Staff pass the client; a logged-in client gets their own household. */
export async function fetchHouseholdCardOffer(
  audience: HouseholdCardAudience,
  clientId: number | null,
  paymentMethodId?: string | null,
): Promise<HouseholdCardOffer | null> {
  const path = audience === 'staff' ? `/household-cards/client/${clientId}` : '/household-cards/mine';
  const { data } = await http.get<HouseholdCardOffer | null>(path, {
    params: { practiceId: currentPracticeId(), paymentMethodId: paymentMethodId || undefined },
  });
  return data && Array.isArray(data.targets) ? data : null;
}

export async function moveHouseholdCards(
  audience: HouseholdCardAudience,
  clientId: number | null,
  paymentMethodId: string,
  picks: Array<{ kind: HouseholdCardTargetKind; id: number | null }>,
): Promise<HouseholdCardMoveResult[]> {
  const path = audience === 'staff' ? `/household-cards/client/${clientId}` : '/household-cards/mine';
  const { data } = await http.post<HouseholdCardMoveResult[]>(path, {
    practiceId: currentPracticeId(),
    paymentMethodId,
    picks,
  });
  return Array.isArray(data) ? data : [];
}
