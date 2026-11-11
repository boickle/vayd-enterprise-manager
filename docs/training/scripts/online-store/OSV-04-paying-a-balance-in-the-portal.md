# OSV-04. Paying an open bill in the portal, and old eVet bills

- **Audience:** CLs.
- **Length:** about 1.5 minutes.
- **Watch first:** INV-10 (open balances, including old eVet invoices).
- **The one thing to remember:** every balance, eVet or Scout, can be paid in the portal, by phone, or with a pay link.
- **Shows the app after go-live:** recorded with eVet sync off (`EVET_SYNC_ENABLED=false` on the training API). Owner, Nov 10, 2026: re-recorded so the video matches what ships.

## Why (opening)

"Families see their balance in the client portal, and they can pay it there, old eVet bills included."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Tom Chen's portal, **Biscuit** | Point at "Good evening, Tom" | "This is Tom Chen's portal." | Tom Chen's portal login (training setup) |
| 2 | Biscuit's card | Point at **Your balance: $85.00** | "Tom owes $85, on an old eVet bill." | Old eVet invoice #48213, $85 open (training setup; the spec removes an earlier take's payment) |
| 3 | Balance | Click **Pay now** | "He clicks pay now." | — |
| 4 | Card fields | Type Stripe's test Visa 4242 | "He has no card saved, so he enters one." | No saved card for Tom |
| 5 | Balance | Click **Pay $85.00** | "Pay." | — |
| 6 | Balance | Point at the paid note | "It's paid." | — |
| 7 | Scout, Tom's **Financial** tab | Point at #48213 eVet, **Paid**, $0.00 due | "In Scout, the eVet bill shows paid, and his balance is zero." | — |
| 8 | — | — | "If a family calls instead, take the payment here, like any other bill. Or send a pay link by email or text." | — |

## What else the client can do here

- **View open invoice**.
- On a store order, choose **Pay the … balance with this order** in the cart (OSV-01).

## What other roles see

- The Billing tab shows the portal payment as a card payment with the Stripe payment number.

## Closing

"The most common mistakes: telling a family an old eVet bill can't be paid online, and taking a phone payment without recording it on the bill. Remember: every balance, eVet or Scout, can be paid in the portal, by phone, or with a pay link."

## Notes

- **Nov 10, 2026 (re-record):** walked with eVet sync off. Tom paid $85 with test card 4242; Scout showed #48213 Paid, ledger balance $0.00, payment "Card (client portal)".
- **Before go-live** (eVet sync still on) the portal holds eVet bills back with "…can't be paid online yet. Please call us to pay them." This video doesn't show that message.
- **Wording to confirm:** the card shows "We appreciate your prompt payment!" just above an unpaid balance. See the review file.
