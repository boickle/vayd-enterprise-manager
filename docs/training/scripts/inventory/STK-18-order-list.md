# STK-18. Order List: place and record an order

- **Audience:** the office's inventory manager and the practice manager.
- **Length:** 2 minutes.
- **Watch first:** STK-06, STK-20.
- **The one thing to remember:** recording an order doesn't add stock. Unboxing the delivery does.

## Why (opening)

"The Order List works out what Main needs from the re-order point and the max you set. Recording what you actually ordered stops two people ordering the same thing."

## Steps

Signed in as Sam Ortiz (inventory manager, Raleigh office). Main is low on syringes and fluids.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy | Click **Move / Order**, then **Order List** | "Open the Order List." | — |
| 2 | Order List | Choose **Office**: Raleigh office | "Pick the office." | Main: Syringes 1 (re-order 2, max 6), Lactated Ringer's 4 (re-order 6, max 24); Gabapentin: Car short 20, nobody has spare |
| 3 | Order List | Point at the rows: Syringes 3 mL, box of 100, qty 1; Lactated Ringer's 1 L bag, qty 2; Gabapentin 100 mg capsule, qty 20 | "Each row is what Main needs to get back to its max, or what a car is short that nobody can transfer." | — |
| 4 | Order List | Click **Show need** on the syringes row | "Show need explains the number." | — |
| 5 | Order List | Point at "Main: 1 on hand · effective 1 · re-order 2 · max — → order 1" | "It's at or below the re-order point, so it orders back up." | — |
| 6 | Order List | Point at the one thing to remember (voice only) | "Remember: recording an order doesn't change what's on the shelf." | — |
| 7 | Order List | Click **Order** | "Click Order." | — |
| 8 | **Place order** | Point at "This only records the purchase — it does not update on-hand or par counts." | "This only records what you bought." | — |
| 9 | Place order | Check **Distributor**: Northline Vet Supply, and the **Qty actually ordered** for each line | "Enter what you actually ordered." | Supplier Northline Vet Supply |
| 10 | Place order | Click **Record order** | "Record it." | — |
| 11 | Order List | Point at **Orders placed**: "Northline Vet Supply · Raleigh office · Ordered by Sam Ortiz · … · 2 items" | "Now everyone can see it's on order." | — |

## What else you can do here

- **+ Order List** to add a line by hand.
- **Office supplies & unlisted items** for things that aren't in inventory, like paper towels.

## What other roles see

- The practice manager has **Order** and **+ Order List** at every office (owner, Nov 9, 2026; fix on `fix/inventory-training`).
- Everyone else can view the list.

## Closing

"The most common mistakes are ordering without recording it, and expecting the stock to show up before you unbox it. Remember: recording an order doesn't add stock."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Sam Ortiz end to end; text as written. The order shows with today's date at 12:00:00 PM (the order date has no time).
- As Robin Hale (practice manager) the same list had no **Order** or **+ Order List** (Q1). Fixed on `fix/inventory-training`: Robin now sees both buttons. Record once the fix is on `build-doctor-flow` and merged into the training branch.
- The list only orders on shelves that have been counted (INV-A15): the demo's Main shelf is marked counted.
- **Nov 9, option B:** the Order List now also orders a car's shortfall that no transfer can cover, so Raleigh's list gains Gabapentin 100 mg capsule, qty 20 (Car short 20; Main has none and Durham has no spare). Steps 2 and 3 updated; not walked again yet. STK-27 shows this for a home office.
