# INV-11. Return items and refund: the simple case

- **Audience:** everyone who takes payment (managers, CLs, techs and doctors can all do a return).
- **Length:** about 1 minute.
- **Watch first:** EMR V15.
- **The one thing to remember:** open the paid bill, click Return items, and Scout refunds the card.

This is the owner's simple version: one case, a bag of food paid by card. The card-plus-account-credit split is not in the video (the old two-return script is in git history).

## Why (opening)

"When a family returns food or medication, the money goes back the way it came. A card payment goes back to the card."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Maria Rivera, Ledger | Open the paid invoice | "Open the paid bill. Maria paid for this bag of food with her card." | Paid Rivera invoice of $60: 1 Prescription diet, 8 lb bag (lot DIET-2611), paid on a Stripe test Visa. Signed in as Robin Hale (manager) |
| 2 | Invoice | Click **Return items** | "Click Return items." | — |
| 3 | Return | Point at "Paid on this invoice" | "Scout shows how the bill was paid." | — |
| 4 | Return | Type 1 in the quantity box | "Pick the bag. Type 1." | — |
| 5 | Return | Point at **Refund total: $60.00** | "It goes back on the shelf, and the whole amount goes back to the card." | — |
| 6 | Return | Click **Refund $60.00 to card** | "Click refund." | — |
| 7 | **Return & refund?** | Point at the question | "Scout asks once more." | — |
| 8 | **Return & refund?** | Click **Refund $60.00** | "Confirm. Scout refunds the card." | Stripe test mode |
| 9 | Ledger | Point at the original invoice: still **Paid**, Due $0.00 | "The bill stays Paid, with nothing due." | — |
| 10 | Ledger | Point at "Returned items and refunded $60.00 via Stripe." | "And the refund line reads refunded." | — |
| 11 | Voice-over | — | "If they paid with account credit, that part goes back as credit." | — |

## What else you can do here

- **Keep $… as account credit** instead of a card refund.
- **Cancel**.
- **Back on the shelf** can be unticked when the product can't be resold.
- A bill paid partly by card and partly by account credit: the card gets back what it paid first, and the rest goes back as credit.

## What other roles see

- Every role except observers has **Return items** and **Refund**.
- **Void** next to a payment is more limited (INV-12).

## Closing

The last line of the video is the closing: "If they paid with account credit, that part goes back as credit."

## Notes

- Verified in the app on Nov 7, 2026: the original invoice stays **Paid**, Due $0.00, after a return, and each return is its own line.
