# INV-05. When a card is declined

- **Audience:** doctors, techs and CLs.
- **Length:** 2 minutes.
- **Watch first:** EMR V5 and V14.
- **The one thing to remember:** don't retry again and again. Check the invoice, then ask for another card.

## Why (opening)

"Declines happen. How you handle them decides whether the family leaves confused, or charged twice."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Biscuit's Checkout page | Point at **Card on file**, tooltip "Visa •••• 0341" | "Tom Chen's saved card is on file." | Chen bill: Office exam $75. Tom's saved card is Stripe's test card that declines (…0341), with consent recorded. Use a Chen email only this video uses |
| 2 | Checkout | Point at the one thing to remember | "If a card is declined, don't keep trying it." | — |
| 3 | Checkout | Click **Card on file** | "Charge the card on file." | — |
| 3b | Checkout | Click the confirm button **Charge $75.00 to Visa •0341** | "Scout shows the amount and the card first. Click Charge to confirm." | — |
| 4 | Checkout | Point at the red message "Your card was declined." | "Scout says the card was declined." | — |
| 5 | Checkout | Point at **Total** $75.00, with nothing paid | "Check the bill: nothing is paid." | — |
| 6 | Voice-over | — | "Tell Tom kindly, and ask for another card." | — |
| 7a | Checkout | Point at **Tap to Pay** (no click) | "In the field, you'll usually take a new card with Tap to Pay on the Stripe reader." | — |
| 7b | Checkout | (nothing to click) | "This demo has no reader connected, so we'll type the card in instead." | — |
| 7 | Checkout | Click **Type card manually** | "Take the new card." | — |
| 8 | **Type card manually** | Type "Tom Chen" in **Name on card** | "The name on the card." | — |
| 9 | **Type card manually** | Type 4242 4242 4242 4242, 12/34, 123 and the ZIP | "And the card." | Stripe test card |
| 10 | **Type card manually** | Click **Charge $75.00** | "Charge once." | — |
| 11 | Checkout | Point at "Card charged — invoice marked paid." and **Paid** $75.00 | "Paid. Done." | — |
| 12 | Checkout | Shown on screen (see Pass 1 note): Tom's first typed card (4000 0000 0000 0002) is declined: "That card could not be used — check the number and try again". Click **Cancel**, reopen **Type card manually** and type the good card. | "If a card you type in is declined, the message is: That card could not be used — check the number and try again. Check the number once. If it's declined again, ask for another card." | — |
| 13 | Voice-over | — | "If the family can't pay today, leave the bill open and send a pay link. That's in the pay links video." | — |

## What else you can do here

- Weak signal: "Not charged — check the connection and try again…" (EMR V14).
- Pay links (EMR V15).

## What other roles see

- Same for every role.

## Closing

"The most common mistakes: trying the same card again and again, and taking a second card before checking the first wasn't charged. Remember: don't retry again and again. Check the invoice, then ask for another card."

## Notes from the check in the app (Nov 6, 2026)

- **Checked in Stripe test mode:**
  - Saved card declined: "Your card was declined."
  - Typed card declined (4000 0000 0000 0002): "That card could not be used — check the number and try again"
  - Good card: paid.
- **Bug: the decline message stays after the bill is paid (fixed Nov 6, frontend f4dbbe5).** A successful payment now clears the earlier "Your card was declined." I did not re-walk it on Nov 7 (it needs the consent-stamped declining card): check it in the dry run. If the red text is still there, cut between steps 10 and 11 or reload.
- **Setup:** the declining saved card has to be stored on the client with consent (`stripeCustomerId`, `savedPaymentMethodId`, and a `cardOnFileConsentAgreementVersion` of '2026-10-07'). Without the consent, Scout refuses with the re-consent message instead.
- **Status (Nov 7):** ready to record; confirm the decline message clears in the dry run.

## Pass 1 dry run (Nov 7, 2026)

- **Script changes:** steps 8 to 12 now show a typed-card decline instead of only describing it: Tom's first typed card declines (4000 0000 0000 0002), the message shows, then **Cancel**, reopen **Type card manually** and a good card pays. Narration says he misread a digit.
- **Checked:** the red "Your card was declined." on Card on file; the total stays $75.00 with nothing paid; after the good card pays, the decline message is gone (the Nov 6 fix works).
- **Stack note:** Tom's saved card is a Stripe test card that always declines (`pm_card_chargeCustomerFail`) with consent recorded, under a fresh Chen email.
- Spec: `cypress/training/inv-05-card-declined.cy.ts`.
