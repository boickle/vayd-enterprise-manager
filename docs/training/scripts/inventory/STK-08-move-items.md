# STK-08. Move Items

- **Audience:** technicians and doctors.
- **Length:** 2 minutes.
- **Watch first:** STK-07.
- **The one thing to remember:** move it in Scout when you move it in your hands, and pick the bottle.

## Why (opening)

"Sometimes you hand a bottle to another car, or take something back to Main, with no Transfer List row. Move Items records it, so both shelves stay right."

## Steps

Signed in as Jordan Pike. Taking 10 Carprofen caplets from Main to Car 2 for Dr. Shah.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy | Click **Move / Order**, then **Move Items** | "Open Move Items." | — |
| 2 | Move Items | Point at "Your signed-in account and the time are logged automatically." | "Scout records who moved it and when." | — |
| 3 | Move Items | Point at the one thing to remember (voice only) | "Remember: record it when you move it." | — |
| 4 | Move Items | Type `Carprofen 100` in **Search stock item**, click **Carprofen 100 mg caplet** | "Find the item." | Carprofen on Main (CP-4520, CP-4602) |
| 5 | Move Items | Type `10` in the quantity box, click **Add** | "How many, then Add. You can add several items to one move." | — |
| 6 | From | Choose **Office**: Raleigh office, **Location**: "Main — 300 on hand" | "From: where it is now." | — |
| 7 | To | Choose **Office**: Raleigh office, **Location**: "Car 2 — 0 on hand" | "To: where it's going." | Car 2 (Dr. Shah) |
| 8 | Line | In **Lot / expiration \***, choose **Lot CP-4520** | "Pick the bottle. The lot travels with the stock." | — |
| 9 | Move Items | Point at "Carprofen 100 mg caplet · From 300 at Main → To 0 at Car 2" | "Check the summary." | — |
| 10 | Move Items | Click **Confirm move** | "Confirm." | — |
| 11 | Move Items | Point at "Move of 10 Carprofen 100 mg caplet from Main to Car 2." | "Done." | — |

## What else you can do here

- Move between offices: the button becomes **Confirm office move**.
- **Remove** a line before confirming.

## What other roles see

- Doctors can move stock on their own car.
- The practice manager and inventory managers move stock anywhere.

## Closing

"The most common mistakes are moving stock you haven't actually moved yet, and forgetting the lot. Remember: move it in Scout when you move it in your hands."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Jordan Pike; labels and messages as written. Without a lot, Scout says "Choose a lot for Carprofen 100 mg caplet before confirming the move."
- The **From** office starts on "Dr. Lane home" (the first office alphabetically), not the person's own office (U5).
- **Possible bug (B3): a technician could move stock out of any office.** Jordan moved 1 mL of Buprenorphine from Dr. Lane home's Controlled safe to the Raleigh Car ("Cross-office move … Confirm office move" worked). The permission catalog says a technician moves stock only on their own vehicle, and the test plan says the API enforces it (INV-A10). Hold this video until that's decided or fixed.

- **B3 fixed** on `fix/inventory-training`: a technician's **To** office is locked to the **From** office, and nobody but the doctor or a manager can move stock in or out of a doctor's controlled drug location. Step 7 (Raleigh office, Car 2) still works. In "What other roles see", say that technicians and doctors move within one office, and managers move between offices.
