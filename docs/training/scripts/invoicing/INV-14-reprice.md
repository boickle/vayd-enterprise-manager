# INV-14. Reprice a bill after a membership signup or price change

- **Audience:** every visit role. Reprice is open to anyone who can edit the invoice; the check used a CL login.
- **Length:** 2 minutes.
- **Watch first:** INV-02.
- **The one thing to remember:** Reprice before you take payment. Check the preview, then apply.

## Why (opening)

"When a family joins a plan during the visit, the bill should drop to member prices. Reprice does it in one step."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's SOAP, Checkout panel | Point at the lines at full price: Office exam $75.00, Nail trim $25.00, Dental chews $24.00. **Total** $125.32 | "Maria just signed Juniper up for a plan, but the bill still shows full prices." | Juniper's bill at full price; Juniper enrolled on the Adult plan after the lines were added. Signed in as Casey Morgan (CL) |
| 2 | Checkout panel | Point at the one thing to remember | "Reprice before you take payment." | — |
| 3 | Checkout panel | Click **Reprice** (tooltip "Apply today's membership and discount prices to this bill") | "Reprice applies today's membership and discount prices." | — |
| 4 | **Reprice this bill** | Point at "Today's membership and discount prices for each line. Price drops are ticked; raises aren't, so tick them if you mean to." | "Scout lists each line that would change. Drops are ticked for you." | — |
| 5 | **Reprice this bill** | Point at Office exam: "Covered by Membership - Adult - Annual", $75.00 → covered | "The exam is now covered by the plan." | — |
| 6 | **Reprice this bill** | Point at Nail trim: "Membership - Adult - Annual member discount", $25.00 → $22.50 | "Other items get the member discount." | — |
| 7 | **Reprice this bill** | Point at "Bill $125.32 → $45.29" | "Here's the new total before you apply it." | — |
| 8 | **Reprice this bill** | Click **Reprice 3 lines** | "Apply it." | — |
| 9 | Checkout panel | Point at the heart and **covered**, **Member 10%**, **Membership covered** −$75.00, and **Total** $45.29 | "Member prices, and the plan savings shown in the totals." | — |
| 10 | Voice-over | — | "If every line is already right, Scout says: Every line is already at today's price. A line someone priced by hand is marked Priced by hand — kept." | — |

## What else you can do here

- Reprice also sits on the invoice in the client's ledger.
- **Cancel** closes the preview without changing anything.

## What other roles see

- Anyone who can edit the invoice sees **Reprice**. The check used a CL login.

## Closing

"The most common mistakes: keying member prices by hand instead of repricing, and taking payment before repricing. Remember: Reprice before you take payment. Check the preview, then apply."

## Notes from the check in the app (Nov 6, 2026)

- **Checked:** steps 1 to 9 as a CL. A "Staff audit · 1" line appears on the bill afterwards.
- **From the code only:** "Priced by hand — kept" and "Every line is already at today's price." weren't seen on screen.
- **Not checked:** Reprice on a paid invoice.
