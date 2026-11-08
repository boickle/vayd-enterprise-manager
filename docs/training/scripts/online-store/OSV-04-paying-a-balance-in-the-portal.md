# OSV-04. Paying an open bill in the portal, and old eVet bills

- **Audience:** CLs.
- **Length:** 2 minutes.
- **Watch first:** INV-10 (open balances, including old eVet invoices).
- **The one thing to remember:** old eVet bills can't be paid online yet; take those payments by phone.

## Why (opening)

"Families see their balance on their pet's page in the portal. Some old bills from eVet can't be paid there yet, and the portal says so."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Tom Chen's portal, **Biscuit** | Point at "Good evening, Tom" and Biscuit's card | "This is Tom Chen's portal." | Tom Chen's portal login (training setup) |
| 2 | Biscuit's card | Point at **Your balance: $85.00** | "Tom owes $85." | Old eVet invoice #48213, $85 open (training setup) |
| 3 | Balance | Point at "$85.00 is on older bills from our previous system, which can't be paid online yet. Please call us to pay them." | "All of it is on an old eVet bill. The portal tells him to call." | — |
| 4 | Balance | Point at the one thing to remember | "Old eVet bills can't be paid online yet. Take those payments by phone." | — |
| 5 | Scout, Tom's client page | Click **Financial**, then the open eVet bill | "On our side, the bill is here." | — |
| 6 | Billing | Take the payment the usual way (INV-10) | "Take it here, like any other bill." | — |
| 7 | Maria's portal | Point at her balance and **Pay now** with **Card on file** | "A Scout bill, like Maria's, can be paid online with her saved card." | A Scout bill for Maria (open) |

## What else the client can do here

- **View open invoice**.
- On a store order, choose **Pay the … balance with this order** in the cart (OSV-01).

## What other roles see

- The Billing tab shows the portal payment as a card payment with the Stripe payment number.

## Closing

"The most common mistakes: telling a family to pay an old eVet bill online, and taking a phone payment without recording it on the bill. Remember: old eVet bills can't be paid online yet; take those payments by phone."

## Notes from the check in the app (Nov 7, 2026)

- **Walked:** Tom's portal showed "Your balance: $85.00" and the held-bill message word for word. This is OS-06's behaviour while eVet sync is on.
- **Not walked:** step 7 (Maria paying a Scout bill online). The OS-06 Cypress run on Nov 7 covered it. Walk it in the dry run with test card 4242.
- **After eVet sync is turned off** at cutover, old eVet bills become payable online and step 3's message goes away. Re-record then, or cut steps 2 to 6.
- **Wording to confirm:** the card shows "We appreciate your prompt payment!" just above an unpaid balance. See the review file.
