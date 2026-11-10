# STK-04. Two bottles for one charge

- **Audience:** technicians and doctors.
- **Length:** 2 minutes.
- **Watch first:** STK-02.
- **The one thing to remember:** when one charge used two bottles, split the lots on the same line. Never add a second line.

## Why (opening)

"Twenty caplets might come from the end of one bottle and the start of the next. A second line would charge the family the fee and the minimum twice. One line with two lots keeps the price right and both bottles' counts right."

## Steps

Signed in as Jordan Pike. Maple's visit, Carprofen 100 mg caplet × 20.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Carprofen line | Point at the line amount | "Twenty caplets is one charge, with one service fee." | Carprofen added from the catalog: $1.29 each, $15 fee, $31.90 minimum, so $40.80 |
| 2 | Carprofen drawer | Point at the one thing to remember (voice only) | "Remember: two bottles, one line." | — |
| 3 | Carprofen drawer | Click **+ Add another lot** | "Click Add another lot." | Lots on Car: CP-4471 (12), CP-4520 (30) |
| 4 | Lot rows | In **Lot 1**, choose **Lot CP-4471** | "The first bottle." | — |
| 5 | Lot rows | Type `12` in **Quantity** | "Twelve came from it." | — |
| 6 | Lot rows | In **Lot 2**, choose **Lot CP-4520** | "The second bottle." | — |
| 7 | Lot rows | Type `8` in **Quantity** | "Eight from this one." | — |
| 8 | Lot rows | Point at the running total "12 + 8 of 20" | "The two must add up to the line's quantity." | — |
| 9 | Lot rows | Click **Save lots** | "Save." | — |
| 10 | Carprofen line | Point at the amount, still $40.80 | "Still one charge, at the same price." | — |
| 11 | Voice-over | — | "When the bill is paid, twelve come off one bottle and eight off the other." | — |

## What else you can do here

- **Remove** a lot row, or **Use one lot** to go back to a single bottle.
- If you change the line's quantity afterwards, the lots are cleared and Scout asks you to pick them again.

## What other roles see

- The same on the client's ledger at the counter.

## Closing

"The most common mistakes are adding a second line for the second bottle, and putting the whole quantity on one bottle that didn't hold it. Remember: two bottles, one line."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Jordan Pike up to step 3: **+ Add another lot** shows Lot 1 and Lot 2, each with its own lot list, **Quantity** and **Remove**, a running total ("? + ? of 20"), **+ Add another lot**, **Save lots** and **Use one lot**.
- Steps 4 to 9 walked: the running total reads "12 + 8 of 20", and after **Save lots** the line holds CP-4471 × 12 and CP-4520 × 8 (checked in the database).
- After saving, the two lot rows stay open on screen; there's no separate "saved" message. The spec should point at the total rather than wait for a message.
- The probe's line showed $25.80 because the order was added with a unit price (see STK-02 notes). Add the charge from the catalog in the spec so the fee and minimum apply.
