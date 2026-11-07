# INV-09. What the client sees in the portal

- **Audience:** CLs.
- **Length:** 2 minutes.
- **Watch first:** INV-08.
- **The one thing to remember:** the portal shows what the family owes right now. For past receipts, email one from the ledger.

## Why (opening)

"When a family calls about a bill, it helps to know exactly what they're looking at."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Client portal, signed in as Maria | Point at "Your balance: $22.50 — We appreciate your prompt payment!" | "This is Maria's portal. Her balance is near the top." | One open Rivera bill: Nail trim for Maple, $22.50. The portal login's email must match the email on Maria's record |
| 2 | Portal | Point at the one thing to remember | "The portal shows what they owe right now." | — |
| 3 | Portal | Click **Pay now** | "Pay now opens the payment form." | — |
| 4 | Portal | Click **View open invoice** | "She can open the bill." | — |
| 5 | Invoice | Point at "Invoice #542", the Nail trim line for Maple, **Total** $22.50, **Paid** $0.00 and **Due** $22.50 | "Same line, same total as our ledger." | — |
| 6 | Pay form | Point at **Have a gift card?** | "She can use a gift card here too." | — |
| 7 | Pay form | Point at **Name on card**, **Card number** and "Save my card on file to make future purchases easier" | "She types her card, and can choose to save it." | — |
| 8 | Pay form | Point at **Pay $22.50** | "Then pays the exact balance." | Stripe test card, if paying on camera |
| 9 | Voice-over | — | "When a family has credit instead, the portal says You have a credit, and offers to use it in the store." | — |

## What else you can do here

- Email or text a pay link (EMR V15).

## What other roles see

- Not applicable: this is the client's view.

## Closing

"The most common mistakes: telling a family to look for an old receipt in the portal (it only shows what's open), and a portal that shows nothing because the email on their record is different from their login. Remember: the portal shows what the family owes right now. For past receipts, email one from the ledger."

## Notes from the check in the app (Nov 6, 2026)

- **Totals agree:** the ledger (BALANCE DUE $22.50, "Sends $22.50 for the unpaid invoice"), the portal balance, the portal invoice and **Pay $22.50** all matched. The portal invoice reads "Hi Maria, here is your invoice from Vet At Your Door. The balance due is $22.50."
- **No history:** the portal has no paid-invoice or receipt history.
- **Email must match:** when the email on the client record didn't match the login, no balance card showed at all.
- **Not run:** the payment itself.
- **Gift cards in the portal:** the code says gift cards pay only Scout invoices, not eVet ones.
- **Status (Nov 7):** ready to record. The ledger's pay-link line now nets off account credit (INV-13), but this video's family has none.

## Pass 1 changes (Nov 7, 2026)

- The open bill is a $25 nail trim for Juniper (not $22.50 for Maple), so the numbers on screen are $25.00.
- Maria already has a saved Visa in the shared Stripe test account, so the pay form first shows **Card on file** (Visa 4242) and **Use a different card**. The video points at the saved card, clicks **Use a different card**, then shows **Name on card**, **Card number** and the save-my-card box.
- Added "Done closes it" as its own click after the invoice window.
