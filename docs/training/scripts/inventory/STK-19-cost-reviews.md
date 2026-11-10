# STK-19. Cost Reviews

- **Audience:** practice manager.
- **Length:** 2 to 3 minutes.
- **Watch first:** STK-06, PRC-02.
- **The one thing to remember:** a cost increase over 15% waits here, and client prices don't change until you decide.

## Why (opening)

"When a delivery costs much more than usual, Scout doesn't change what clients pay on its own. A typo, or a bottle price entered as a tablet price, would reach every bill and auto-ship."

## Steps

Signed in as Robin Hale. Sam unboxed 100 Carprofen caplets at $0.55 each; the catalog cost is $0.42 (+31%).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy | Point at **Manage** with its red badge "1" | "The badge means a cost review is waiting." | Pending cost review: Carprofen, invoice NL-40415 |
| 2 | Pharmacy | Click **Manage**, then **Cost Reviews** | "Open Cost Reviews." | — |
| 3 | Cost reviews | Point at the one thing to remember (voice only) | "Remember: nothing changes for clients until you decide." | — |
| 4 | Cost reviews | Point at "Carprofen 100 mg caplet · CARP100 · Large increase, held" and "Raleigh office · Invoice NL-40415 · Qty 100" | "Here's the item, the invoice and who received it." | — |
| 5 | Cost reviews | Point at Catalog cost $0.4200, Invoice cost / unit $0.5500, Difference +$0.1300 (+31.0%) | "The new cost is 31% higher." | — |
| 6 | Cost reviews | Point at "Catalog price → suggested $1.29 → $1.69" | "Scout suggests a new price from the item's markup." | — |
| 7 | Voice-over | — | "First, check the invoice. If the cost was typed wrong, choose Keep current." | — |
| 8 | Cost reviews | Click **Update catalog** | "If it's right, Update catalog." | — |
| 9 | Item | Point at "Cost review — not saved yet · Cost $0.4200 → $0.5500 · Price $1.29 → $1.69" | "The item opens with the new cost and price filled in. You can still change them." | — |
| 10 | Item | Click **Save & update catalog** | "Save." | — |
| 11 | Voice-over | — | "New charges use the new price. Open bills keep the old one until they're repriced." | — |

## What else you can do here

- **Office only**: change the price for one office.
- **Keep current**: leave prices alone.
- **Edit**: change the cost before applying it.
- **Status** filter: Applied to catalog, Applied to office, Dismissed, All.

## What other roles see

- Only the practice manager (and admin logins). Technicians and inventory managers don't see Cost Reviews.

## Closing

"The most common mistakes are applying an increase without checking the invoice, and forgetting that store auto-ships follow the new price. Remember: nothing changes for clients until you decide."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Robin Hale. **Save & update catalog failed** with "sellUnitType must be one of the following values: each, bottle, box, case, tube, vial, bag, other" (bug B4: Carprofen's unit is Tablet). The cost and price stayed $0.42 and $1.29. This video can't be recorded until B4 is fixed, or it uses an item whose unit is each, bottle or bag.
- The page's description still says "When a received invoice cost is lower than catalog cost, or an item was added while receiving…". It doesn't mention increases over 15%, though they're here too (wording, U10).
- Item history keeps every change (PRC-02).
- **B4 fixed** on `fix/inventory-training`: Save & update catalog set Carprofen to cost $0.55, price $1.69. Record once the fix is merged.
- U10 fixed: the description now mentions increases over 15%.
