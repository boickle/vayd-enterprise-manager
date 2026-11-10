# STK-27. A home office that keeps its stock in the car: when it gets ordered

- **Audience:** doctors with a home office, their inventory manager, and the practice manager.
- **Length:** about 2 minutes.
- **Watch first:** STK-07, STK-18.
- **The one thing to remember:** when nothing can be transferred to your car, it goes on the Order List.

## Why (opening)

"Some doctors keep an item only in their car, with none at home. Here's how Scout knows when to order it."

## Steps

Signed in as Dr. Priya Shah, inventory manager of **Dr. Shah home** (Home, Car). Her doxycycline lives in the car: 30 tablets against a car par of 100. Home has none and no re-order point. No other office has spare doxycycline.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy | — | "Some doctors keep an item only in their car, with none at home. Here's how Scout knows when to order it." | Dr. Shah home: Doxycycline 100 mg tablet, Car 30 / par 100, Home none |
| 2 | Pharmacy | Click **Move / Order**, then **Transfer List** | "Open the Transfer List." | — |
| 3 | Transfer List | Choose **Office**: Dr. Shah home | "Pick your office." | — |
| 4 | Transfer List | Point at **To** "Dr. Shah home · Car 30 on hand / 100 · short 70" | "Dr. Shah's car is 70 doxycycline short." | — |
| 5 | Transfer List | Point at **From** "—" | "The dash means no shelf or office has any to spare." | — |
| 6 | Transfer List | Voice only | "Remember: when nothing can be transferred, it goes on the Order List." | — |
| 7 | Pharmacy | Click **Move / Order**, then **Order List** | "So open the Order List." | — |
| 8 | Order List | Choose **Office**: Dr. Shah home | "Pick the same office." | — |
| 9 | Order List | Point at the row: Doxycycline 100 mg tablet · Home · 70 | "There it is: 70 doxycycline." | — |
| 10 | Order List | Click **Show need** | "Show need explains the number." | — |
| 11 | Order List | Point at "Home: no count for this item · not covered 70 → order 70" and "No shelf or office has spare for Car (short 70)…" | "Home keeps none, and nobody can cover the car's 70. So it orders 70." | — |
| 12 | Order List | Click **Order** | "To order, click Order." | — |
| 13 | **Place order** | Point at **Distributor** Northline Vet Supply and "Home · need 70" | "Check the distributor and the quantity." | Supplier Northline Vet Supply |
| 14 | Place order | Click **Record order** | "Record it." | — |
| 15 | Order List | Point at **Orders placed**: "Northline Vet Supply · Dr. Shah home · Ordered by Priya Shah" | "Now everyone can see it's on order, and it won't be ordered twice." | — |
| 16 | Voice-over | — | "When the box comes, unbox it straight into the car. The car is back to par, and it drops off both lists." | — |

## What else you can do here

- The car needs a **par** for any of this to work (Pharmacy → Setup → Par Levels, practice manager). Home doesn't need a re-order point.
- If another office has spare, Scout suggests a transfer from it first and orders nothing.
- On **Unbox**, set **Default location** to the car, so the delivery goes straight there.

## What other roles see

- Everyone can view the Order List. Only the office's inventory manager and the practice manager see **Order** and **+ Order List**.

## Closing

"The most common mistakes are no par on the car, and unboxing to Home instead of the car. Remember: when nothing can be transferred, it goes on the Order List."

## Notes from the check in the app (Nov 9, 2026)

- Built on `build-doctor-flow` (option B, owner, Nov 9): a counted shelf's shortfall that no transfer covers is ordered for the office, even when the main shelf has never been counted for that item.
- Walked as Priya Shah by a probe (no voice): Transfer List row with **From** "—", Order List row "Home · 70", Show need and **Record order** as written. After recording, the row left the list and the order showed under **Orders placed**.
