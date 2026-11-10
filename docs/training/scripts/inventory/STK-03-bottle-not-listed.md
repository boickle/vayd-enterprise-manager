# STK-03. The bottle isn't listed: Add lot, or "shelf not counted yet"

- **Audience:** technicians and doctors.
- **Length:** 2 minutes.
- **Watch first:** STK-02.
- **The one thing to remember:** if the bottle isn't listed, copy the lot and expiry off the vial with **Add lot**. Use "shelf not counted yet" only when you can't.

## Why (opening)

"At go-live most shelves haven't been counted yet, so the bottle in your hand often won't be in Scout. It takes ten seconds to add it, and then the next count is right."

## Steps

Signed in as Jordan Pike. Maple's visit, Apoquel 16 mg tablet × 30 on the bill, Raleigh office · Car.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Checkout, Apoquel line | Point at **Lot / expiration \***: "No lots at this location — receive here or pick another location" | "Scout has no Apoquel bottles on this car yet." | Apoquel 16 mg tablet, lot-tracked, lot # not required; no lots on Car; Car shelf for Apoquel never counted |
| 2 | Apoquel line | Point at the one thing to remember (voice only) | "Remember: copy the lot and expiry off the vial." | — |
| 3 | Apoquel line | Click **Add lot** | "Click Add lot." | — |
| 4 | **Add lot** window | Point at **Branch** and **Location** | "It's for your office and your car." | — |
| 5 | Add lot | Type the lot in **Lot number (optional)**: `AP-7710` | "Type the lot number from the bottle." | — |
| 6 | Add lot | Type **Expiration \***: `08/31/2027` | "And the expiry. That one is required." | — |
| 7 | Add lot | Select the 1 in **Quantity on hand** and type `30` | "How many are in it now. Replace the 1 that's already there." | — |
| 8 | Add lot | Click **Add lot** | "Add it." | — |
| 9 | Apoquel line | Point at the lot now chosen on the line | "Now the charge comes off that bottle." | — |
| 10 | Apoquel line | Open the lot list and point at **Existing stock — shelf not counted yet** | "If you really can't read the label, this option uses the shelf's uncounted stock." | — |

## What else you can do here

- **Location** on the line: take this item from another shelf.
- **Another shelf…** on a controlled line: take a dose from somewhere other than the doctor's safe (it's flagged on the Controlled Drugs report).

## What other roles see

- The same for everyone who checks out a visit.

## Closing

"The most common mistakes are choosing 'shelf not counted yet' every time out of habit, and guessing an expiry. Remember: copy the lot and expiry off the vial with Add lot."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Jordan Pike: the lot list offers only "No lots at this location — receive here or pick another location" and "Existing stock — shelf not counted yet"; the **Add lot** window has Branch, Location, Lot number (optional), Expiration \*, Quantity on hand, Cancel and Add lot.
- Steps 3 to 9 walked: the new lot saved with stock and the line picked it up ("Lot AP-7710 · exp 2027-08-31").
- **Quantity on hand starts at 1.** Typing 30 without clearing it saved 130. The spec must clear the box first, and the narration says so. Reported as a usability issue (U3).
- The old step 11 ("Vaccines and controlled drugs … always need the real lot") was cut (owner, Q7): nothing on screen showed it.
