# INV-11. Return items and refund: card first, then account credit

**Don't record until the balance bug is fixed.** After a return, the original invoice goes back to **Open** with
the returned amount still due. The household balance and the pay link then ask the family to pay for what they
returned. See the notes at the end.

- **Audience:** lead CLs, billing and managers.
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V15.
- **The one thing to remember:** return the items, and Scout works out the split. The card gets back what it paid, and the rest goes back as account credit.

## Why (opening)

"When a family returns food or medication, the money should go back the way it came: to the card for the card part, and to their account for the credit part."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Maria Rivera, Ledger | Open the paid invoice | "Maria paid this bill with her card and some account credit." | Paid Rivera invoice of $120: two items at $60 (for example, two bags of prescription diet, each with its lot set to Existing stock). Paid $50 account credit, then $70 card on file. Signed in as Robin Hale (manager) |
| 2 | Invoice | Point at the one thing to remember | "Return the items, and Scout works out where the money goes." | — |
| 3 | Invoice | Click **Return items** | "Start the return." | — |
| 4 | Return | Point at "Paid on this invoice: Visa •••• 4242 $70.00, Account credit $50.00 · $70.00 can still go back to the card" | "Scout shows how the bill was paid." | — |
| 5 | Return | Type 1 in the quantity box (≤ 2) | "Return one." | — |
| 6 | Return | Point at **Refund total: $60.00** and **Refund $60.00 to card** | "That fits on the card, so it all goes back to the card." | — |
| 7 | Return | Change it to 2 | "Now both." | — |
| 8 | Return | Point at "More than the card can take: $70.00 to card, $50.00 back as account credit." | "That's more than the card paid, so the rest goes back as account credit." | — |
| 9 | Return | Click **Refund $120.00 ($70.00 to card, $50.00 back as account credit)** | "Click refund." | — |
| 10 | **Return & refund?** | Point at "Return the selected items and refund $120.00: $70.00 to card, $50.00 back as account credit. The card part goes back through Stripe." | "Read the split one more time." | — |
| 11 | **Return & refund?** | Click **Refund $120.00** | "Confirm." | Stripe test mode |
| 12 | Ledger | Point at "Returned items and refunded $120.00: $70.00 to card, $50.00 back as account credit." and the **Return** row | "Done: the card refund and the credit are both recorded." | — |
| 13 | Voice-over | — | "If the family would rather keep it all as credit, use Keep as account credit instead." | — |

## What else you can do here

- **Keep $… as account credit**.
- **Cancel**.

## What other roles see

- **Intended:** only managers, lead CLs and billing do returns.
- **Bug:** today a plain Client Liaison also sees **Return items** and can complete a return. The demo CL completed a $60 card refund.

## Closing

"The most common mistakes: refunding the whole amount to the card when part was paid with credit, and doing a plain refund when items came back. Use Return items, so stock and the chart are right. Remember: return the items, and Scout works out the split."

## Notes from the check in the app (Nov 6, 2026)

- **Steps 3 to 12 match the screen exactly**, including Stripe test mode. Afterwards the client had $50 of account credit.
- **Bug: the balance after a return is wrong.**
  - What I did: a $120 invoice, paid $50 account credit and $70 card; return both items.
  - What happened: the original invoice showed **Open, Due $120.00**, with "voided Account credit payment - $50.00; voided Visa •••• 4242 payment - $70.00". The return showed as a separate "Return #… Paid ($120.00)". The household read **BALANCE DUE $70.00**, and **Text pay link** offered "Sends $120.00 for the unpaid invoice".
  - With one of two returned, the original read Open, Due $60.00, and the balance due was $60.00.
- **Bug: a second return isn't limited.** After one of two was returned, **Return items** still allowed 2. The button read "Refund $120.00 to card" while the screen said only "$10.00 can still go back to the card", so the split note didn't appear.
- **Bug: no permission check on returns.** The `invoice.return` permission isn't checked anywhere, in the app or the API.
- **Products need a lot:** the check used a $60 procedure line. A food line needs its lot picked (or Existing stock) before the bill can be paid.
