/**
 * PAY-C3 (D9, Nov 12, 2026): one practice-wide set of saved cards, one wording. Every screen that
 * saves a card says this, and the server records the card under the matching agreement version
 * (CARD_ON_FILE_AGREEMENT_VERSION '2026-11-12' in vayd-api). Change the wording here and bump that version.
 */

/** Shown to clients (store checkout, auto-ship card change, portal bill pay). */
export const CARD_ON_FILE_CLIENT_WORDING =
  'Keep this card on file. Vet At Your Door may charge it for visits, refills, memberships and online store orders. You can ask us to remove it at any time.';

/** Shown to staff, who ask the owner before ticking the box (visit checkout, Replace card, terminal). */
export const CARD_ON_FILE_STAFF_WORDING =
  'Owner agrees we may keep this card on file and charge it for visits, refills, memberships and online store orders.';

/** The staff sentence plus the instruction at visit checkout. */
export const CARD_ON_FILE_STAFF_ASK = `${CARD_ON_FILE_STAFF_WORDING} Ask before you tap. Tick this box when they say yes.`;
