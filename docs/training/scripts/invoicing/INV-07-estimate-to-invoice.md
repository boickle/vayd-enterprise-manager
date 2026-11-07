# INV-07. Turn an estimate into the invoice: ON HOLD

**Don't record this video yet.** In the app as checked on Nov 6, 2026, an estimate made from the client's
ledger can't be turned into an invoice:
- **Convert to invoice** says "This estimate is not attached to a visit yet."
- No screen attaches a ledger estimate to a visit.
- The checkout's **Add estimate items to the invoice** only shows for an estimate that's already attached to that
  visit, and only the euthanasia flow creates one.

The planned script is kept below for when attaching exists.

- **Audience:** doctors, techs and CLs.
- **Length:** 2 minutes.
- **Watch first:** INV-06. For euthanasia, EMR V9 and V10.
- **The one thing to remember:** carry the estimate onto the bill, so you don't re-enter the lines.

## Why (opening)

"The family approved these prices. Carrying the estimate onto the bill keeps them exactly as approved."

## Steps (planned, as the code is written)

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's Checkout page | Point at **Estimate given to the family** $630.00: "For information only: no card is held for this estimate. Take payment at checkout as usual." | "Juniper's dental estimate is right here at checkout." | An estimate attached to today's visit |
| 2 | Checkout | Point at the one thing to remember | "Don't type the lines again." | — |
| 3 | Checkout | Click **Add estimate items to the invoice** | "This puts every estimate line on the bill." | — |
| 4 | Checkout panel | Point at the new lines | "Same items, same prices. Add anything that came up during the procedure." | — |
| 5 | Voice-over | — | "From the client's estimates list, Convert to invoice does the same, once the estimate is attached to a visit." | — |

## Closing

"The most common mistake: retyping the estimate on the bill. Remember: carry the estimate onto the bill, so you don't re-enter the lines."

## Messages in the code

- **Convert to invoice** is refused with:
  - "This estimate is not attached to a visit yet."
  - "A declined estimate cannot be converted."
  - "Add at least one charge first."
  - "Add a charge with a total before converting."
- After converting, **Open invoice**.
