# INV-11. Return items and refund: card first, then account credit

- **Audience:** everyone who takes payment (managers, CLs, techs and doctors can all do a return).
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V15.
- **The one thing to remember:** return the items, and Scout works out the split. The card gets back what it paid first, and the rest goes back as account credit.

## Why (opening)

"When a family returns food or medication, the money should go back the way it came: to the card first, then to their account for the credit part."

## Steps

The demo returns the two bags one at a time, so the viewer sees the card fill up and then the credit take over.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Maria Rivera, Ledger | Open the paid invoice | "Maria paid this bill with her card and some account credit." | Paid Rivera invoice of $120: 2 bags of Prescription diet, 8 lb bag at $60 (lot DIET-2611), paid $50 account credit, then $70 on a Stripe test Visa. Signed in as Robin Hale (manager) |
| 2 | Invoice | Point at the one thing to remember | "Return the items, and Scout works out where the money goes." | — |
| 3 | Invoice | Click **Return items** | "Start the return." | — |
| 4 | Return | Point at "Paid on this invoice: Visa •••• 4242 $70.00, Account credit $50.00 · $70.00 can still go back to the card" | "Scout shows how the bill was paid, and how much the card can still take." | — |
| 5 | Return | Type 1 in the quantity box (placeholder "≤ 2") | "Return one bag." | — |
| 6 | Return | Point at **Back on the shelf** (ticked, shelf "Where it was sold from": Raleigh office · Car), **Refund total: $60.00** and **Refund $60.00 to card** | "It goes back on the shelf, and the $60 fits on the card, so it all goes back to the card." | — |
| 7 | Return | Click **Refund $60.00 to card** | "Click refund." | — |
| 8 | **Return & refund?** | Point at "Return the selected items and refund $60.00 to the client's card via Stripe?" | "Scout asks once more." | — |
| 9 | **Return & refund?** | Click **Refund $60.00** | "Confirm." | Stripe test mode |
| 10 | Ledger | Point at "Returned items and refunded $60.00 via Stripe.", the **Return** row and the original invoice: still **Paid**, Due $0.00, "Refunded $60.00" | "The bill stays paid. The return is its own line." | — |
| 11 | Ledger | Click **Return items** again | "Now the other bag." | — |
| 12 | Return | Point at the quantity box (now "≤ 1") and "$10.00 can still go back to the card" | "Scout only offers what's left to return, and the card has $10 left." | — |
| 13 | Return | Type 1, then point at "More than the card can take: $10.00 to card, $50.00 back as account credit." | "That's more than the card has left, so the rest goes back as account credit." | — |
| 14 | Return | Click **Refund $60.00 ($10.00 to card, $50.00 back as account credit)** | "Click refund." | — |
| 15 | **Return & refund?** | Point at "…refund $60.00: $10.00 to card, $50.00 back as account credit. The card part goes back through Stripe." Click **Refund $60.00** | "Read the split, then confirm." | — |
| 16 | Ledger | Point at "Returned items and refunded $60.00: $10.00 to card, $50.00 back as account credit.", the original invoice (Paid, "refunded Account credit payment - $50.00; refunded Visa •••• 4242 payment - $70.00") and **CREDIT** $50.00 at the top | "Both payments show as refunded, not voided, and Maria has her $50 back as credit." | — |
| 17 | Voice-over | — | "If the family would rather keep it all as credit, use Keep as account credit instead." | — |

## What else you can do here

- **Keep $… as account credit** (instead of a card refund).
- **Cancel**.
- **Back on the shelf** can be unticked (and a different shelf chosen) when the product can't be resold.

## What other roles see

- Every role except observers has **Return items**. The same goes for **Refund** next to a card payment.
- **Void** next to a payment is more limited: managers, lead CLs, billing, and doctors on their own bills (INV-12).

## Closing

"The most common mistakes: refunding the whole amount to the card when part was paid with credit, and doing a plain refund when items came back. Use Return items, so stock and the chart are right. Remember: return the items, and Scout works out the split."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, in Stripe test mode, as manager Robin Hale. The two returns in the script were run end to end, and so was returning both bags at once.

- **The return-balance bug is fixed.**
  - The original invoice stays **Paid**, Due $0.00, after one bag and after both. The household balance stays $0.00, and the ledger says "This invoice has returns. Make a correction instead."
  - Each return is its own line: "Return #… Paid ($60.00)".
  - Return both at once: "More than the card can take: $70.00 to card, $50.00 back as account credit." and **Refund $120.00 ($70.00 to card, $50.00 back as account credit)**. Maria's credit was $50.00 afterwards.
- **The return screen offers only what's left.** After one bag, the quantity box reads "≤ 1" and the paid-on line says "$10.00 can still go back to the card". Once both are back, the line shows "All returned" (the **Return items** button is still there, with Refund total $0.00; harmless).
- **Card first, then credit.** The first return ($60) went to the card; the second went $10 to the card and $50 as credit.
- **Refunded, not voided:** the ledger row of the original invoice reads "(refunded Account credit payment - $50.00; refunded Visa •••• 4242 payment - $70.00)".
- **Minor wording left in the app:** the collapsed staff-only box on the original invoice is still headed "Staff only · voided payments (2)" and each line reads "voided by Robin Hale … Refunded $50.00: Return items". It's closed by default; don't open it on camera. Reported as an app wording bug.
- **A food line shows stock fields on the return:** **Back on the shelf** and a shelf list. The list's other offices come from the shared test database; don't open it. (The $60 procedure line of the first check had none.)
- **Permissions changed:** per the owner's Nov 6 decision, every role except observer can return items, so the old "Bug: no permission check" note no longer applies. A CL, technician and doctor each saw **Return items** and **Refund** on a paid invoice.
- **Demo data:** `cypress/training/setup/invoicing-demo.sql` adds the lot DIET-2611 and makes the prescription diet untaxed, so $60 a bag totals $120. The paid invoice is made through the API: a $50 account credit, an account-credit payment, then the test Visa.
- **Ready to record.**

## Pass 1 changes (Nov 7, 2026)

- Recorded as written. The staff-only box on the original invoice now reads "Staff only · voided and refunded payments (2)" (the wording bug is fixed); it stays closed.
- The voice doesn't quote dollar amounts on the first two returns; the screen shows them.
