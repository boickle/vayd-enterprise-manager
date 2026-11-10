# STK-02. The right car and the right bottle at checkout

- **Audience:** technicians and doctors.
- **Length:** 2 to 3 minutes.
- **Watch first:** INV-01, EMR V4 (vaccine lots are picked in the dose), EMR V5.
- **The one thing to remember:** check the Location on the bill, then pick the lot of the bottle in your hand. Expired lots can't be picked.

## Why (opening)

"When the bill is paid, Scout takes the stock off the car and the bottle you chose. Pick the wrong one and the counts drift, and a recall points at the wrong bottle."

## Steps

Signed in as Jordan Pike. Maple Rivera's visit today with Dr. Avery Lane; Carprofen 100 mg caplet × 20 is on the bill.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | SOAP, Checkout | Point at **Branch: Raleigh office** and **Location \*: Car** | "Before anything else, check the branch and location. That's where the stock comes off." | Visit for Maple today; bill on Raleigh office · Car (Jordan's default location) |
| 2 | Checkout | Point at the one thing to remember (voice only) | "Remember: the right car, then the right bottle." | — |
| 3 | Checkout | Point at the Carprofen line's red hint ("Approve the sig") and the open drawer | "This line is a medication, so it opens with its details." | Carprofen 100 mg caplet, qty 20 |
| 4 | Carprofen drawer | Point at **Location: Car** | "The line uses the bill's car unless you change it here." | — |
| 5 | Carprofen drawer | Open **Lot / expiration \*** ("Choose the soonest-exp lot…") | "Now the bottle. Open the lot list." | Lots on Car: CP-4390 expired Nov 1 (4), CP-4471 exp 2027-01-08 (12), CP-4520 exp 2027-12-14 (30) |
| 6 | Lot list | Point at "Lot CP-4390 · Expired Nov 1 · QOH 4", greyed | "An expired bottle is greyed out. You can't pick it." | — |
| 7 | Lot list | Point at "Lot CP-4471 · exp 2027-01-08 · QOH 12 (recommended)" | "The soonest expiration is listed first and marked recommended." | — |
| 8 | Lot list | Choose **Lot CP-4520** | "Say the bottle in your hand is the newer one." | — |
| 9 | Carprofen drawer | Point at "Older lot CP-4471 has stock" | "Scout reminds you that an older bottle has stock. It doesn't stop you." | — |
| 10 | Carprofen drawer | Point at "Expired lots can't be used. Log them on Waste / Adjust as Expired." | "And it tells you what to do with the expired one." | — |
| 11 | Lot list | Choose **Lot CP-4471** | "Use the older bottle first when you can." | — |
| 12 | Checkout | Point at the bottom line, "… still need doses, scripts, or a lot picked." | "Checkout won't collect until every line has what it needs." | — |
| 13 | Voice-over | — | "Vaccines are the exception: you pick their lot when you record the dose, in the Plan." | — |

## What else you can do here

- **Add lot** next to the lot list, for a bottle that isn't listed (STK-03).
- **+ Add another lot** when one charge used two bottles (STK-04).
- **Location** on the line, to take one item from a different shelf than the rest of the bill.

## What other roles see

- Client liaisons check out at the counter on the client's ledger. The lot list is the same there.

## Closing

"The most common mistakes are leaving the wrong car on the bill after covering for someone, and picking the first lot instead of the bottle in your hand. Remember: the right car, then the right bottle."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Jordan Pike on Maple's visit. All labels as written.
- The lot list is a browser drop-down. In a recording it may not show open, so the spec should point at the chosen value and say the options; check the first take.
- The recommended lot is labelled "(recommended)", not "Use first" as the test plan says.
- A vaccine line shows "Record the dose given"; its lot is picked in the dose record (EMR V4), so this video uses Carprofen.
- In the probe the line price was $25.80 (20 × $1.29) because the probe added the order with a unit price. A charge added from the catalog gets the $15 fee and $31.90 minimum ($40.80). The spec should add the charge the way the doctor does.
