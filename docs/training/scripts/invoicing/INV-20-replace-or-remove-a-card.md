# INV-20. Replace or remove a card on file, and an expired card

- **Audience:** CLs and techs (every role except Observer can replace or remove a card: `card_on_file.manage`).
- **File name:** `INV-20 - CL, Tech - Replace or remove a card on file.mp4`
- **Length:** 2 to 3 minutes.
- **Watch first:** INV-03 (save a card and charge the card on file).
- **The one thing to remember:** one card on file for the whole practice. Ask before you save one, and Remove takes it away everywhere.

## Why (opening)

"Each family has one card on file for the whole practice: visits, refills, memberships and the online store all use it. Here's how to change it, remove it, and what an expired card looks like."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients → Maria Rivera → **Financial** tab | Point at the **Card on file** section: "Visa ending 4242, expires 12/34" | "The Riveras' card on file is here, on the Financial tab." | Maria has a saved Visa 4242 (test card) with consent recorded under the current agreement (`2026-11-12`), saved by staff |
| 2 | Card on file | Point at the line "Owner agreed Nov 12, 2026 (Tap to Pay at a visit, agreement 2026-11-12)." | "Scout keeps when and where Maria said yes." | — |
| 3 | Voice-over over step 2 | — | "A card can be saved at a visit, in the online store, or when the family signs up for a membership. If they have no card yet, that card becomes the card on file." | — |
| 4 | Card on file | Click **Replace card** | "Maria has a new card. Click Replace card." | — |
| 5 | Replace card | Name on card is already filled in (Maria Rivera). Type 5555 5555 5555 4444, 12/34, 123 and the ZIP in the card box | "Type the new card. Nothing is charged." | Stripe test Mastercard |
| 6 | Replace card | Point at the box "Owner agrees we may keep this card on file and charge it for visits, refills, memberships and online store orders. Ask first. Tick this box when they say yes." and tick it | "Ask first. When Maria says yes, tick the box." | — |
| 7 | Replace card | Click **Save card**; point at "New card saved. Nothing was charged." and the card now reading "Mastercard ending 4444" | "Saved. The next visit, refill or store order uses the new card." | — |
| 8 | Card on file | Point at "Maple's membership is billed on a different card." and **Open Maple's membership** | "A membership keeps the card it's billed on. To move it to the new card, open the membership and use Update card." | Maple's membership is billed in Stripe test mode on the old Visa 4242 |
| 9 | Card on file | Click **Remove card** | "If the family asks us to remove a card, click Remove card." | — |
| 10 | Remove card | Point at "Removes the card everywhere: visits, the online store and portal bill pay. The reason is kept in the financial audit log." | "Remove takes it away everywhere: visits, the online store and the portal." | — |
| 11 | Remove card | Type "Owner asked us to remove it" in **Why is the card being removed?** and click **Remove card**; point at "Card removed." and "No card on file" | "Say why, then remove it." | — |
| 12 | Voice-over | — | "If a membership or auto-ship is still billed on that card, the window names it first. The card is kept for that one only, so it keeps billing." | — |
| 13 | Clients → Tom Chen → **Financial** tab | Point at "Visa: **Expired, ending 0341**. Ask the owner for a new card." | "This card has expired. Scout keeps it on the record, but won't charge it." | Tom has a saved card that expired last month, consent recorded |
| 14 | Biscuit's Checkout page | Point at the greyed-out **Card on file** showing "Expired, ending 0341" | "At checkout it's greyed out. Take a new card with Tap to Pay or Type card manually, and ask to save it." | Chen bill: Office exam $75 |

## What else you can do here

- **Add card** when the family has no card: the same window as Replace card.
- Move a membership to another card: **Update card** on the pet's membership (MEM videos).
- Change an auto-ship's card: the auto-ship's card panel (store videos). If the family has no card on file, that card becomes it.

## What other roles see

- Observer sees the card and how the owner agreed, but no **Replace card** or **Remove card**.

## Closing

"One card on file for the whole practice. Ask before you save one, and Remove takes it away everywhere."

## Notes (Nov 12, 2026, written from the code, not yet walked in the app)

- **Screens:** `src/components/pims/ClientCardOnFileSection.tsx` (Financial tab), checkout `VisitCheckoutPanel.tsx`. Wording from `src/utils/cardOnFileWording.ts` (PAY-C3).
- **Where cards come from (D9, Nov 12):** one practice-wide set of saved cards. Visit checkout, Replace card, the store, auto-ship card changes and membership signups all save under one wording and agreement version `2026-11-12`. A membership signup, a membership Update card or an auto-ship card change fills the card on file only when the family has none (PAY-C0, PAY-C6). A store card saved with the box ticked becomes the card on file.
- **Remove (D8, PAY-C2):** detaches the card in Stripe unless a membership or auto-ship is billed on it; then the window says "Still used by … The card is kept for it only, so it keeps billing. It won't be used for visits or shown in the online store." and after removing: "Card removed. Kept only for …". Step 12 is voice-over only so the demo needn't show both cases; if the dry run shows the "Still used by" note clearly, consider pointing at it instead (it needs Maple's membership billed on the card being removed, so do Remove before Replace, or skip step 8).
- **Expired (PAY-C5):** shown as "Visa: Expired, ending 0341. Ask the owner for a new card." Charging it is refused with "The card on file has expired. Ask the owner for a new card."
- **Demo setup:** `giveSavedCard` in `cypress/training/invKit.ts` must record agreement `2026-11-12` (see the README's "Saved cards changes"). Step 13 needs an expired test card on Tom: Stripe's test cards can't be created expired, so set the stored card's expiry through the stack's fake or seed (check in the dry run how `getPaymentMethod` is answered in Stripe test mode; if it can't be faked, cut steps 13 and 14 and narrate them over step 1).
- **Before recording:** merge `build-doctor-flow` into the training branch (AGENTS.md), and record through `~/.vayd-recording/turn.sh`.
- **Multiple saved cards (PAY-C9)** are not built yet (after go-live). When they are, this video needs a new take: several cards, choosing the default, and the card picker at checkout.
