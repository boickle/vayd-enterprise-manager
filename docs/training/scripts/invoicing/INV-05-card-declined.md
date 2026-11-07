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
| 4 | Checkout | Point at the red message "Your card was declined." | "Scout says the card was declined." | — |
| 5 | Checkout | Point at **Total** $75.00, with nothing paid | "Check the bill: nothing is paid." | — |
| 6 | Voice-over | — | "Tell Tom kindly, and ask for another card." | — |
| 7 | Checkout | Click **Card over phone** | "Take the new card." | — |
| 8 | **Card over the phone** | Type "Tom Chen" in **Name on card** | "The name on the card." | — |
| 9 | **Card over the phone** | Type 4242 4242 4242 4242, 12/34, 123 and the ZIP | "And the card." | Stripe test card |
| 10 | **Card over the phone** | Click **Charge $75.00** | "Charge once." | — |
| 11 | Checkout | Point at "Card charged over the phone — invoice marked paid." and **Paid** $75.00 | "Paid. Done." | — |
| 12 | Voice-over | — | "If a card you type in is declined, the message is: That card could not be used — check the number and try again. Check the number once. If it's declined again, ask for another card." | — |
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
