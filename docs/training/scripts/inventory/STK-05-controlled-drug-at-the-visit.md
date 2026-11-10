# STK-05. Controlled drug at the visit: dose, bottle and "drawn up, not given"

- **Audience:** doctors (and technicians who chart doses).
- **Length:** 3 minutes.
- **Watch first:** STK-02.
- **The one thing to remember:** charge the mL you gave from the real bottle in your safe, and record the leftover as "drawn up, not given" with a disposal method.

## Why (opening)

"Every controlled dose in Scout is matched against your Vet Snap log. If the bottle or the amount is off, it shows up as a discrepancy under your name."

## Steps

Signed in as Dr. Avery Lane. Maple's visit; Buprenorphine 0.3 mg/mL injection, 0.5 mL, on the bill.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Checkout | Point at the Buprenorphine line, "Pick a lot" | "Controlled drugs need the bottle before checkout." | Buprenorphine 0.3 mg/mL injection (controlled, mL, lot # required), not marked Medication |
| 2 | Checkout | Click the line's arrow (**Enter dose / Rx details**) | "Open the line." | — |
| 3 | Line | Point at "Controlled drug, used in hospital. Given: 0.5 mL" | "The quantity on the line is the mL you gave." | — |
| 4 | Line | Point at the one thing to remember (voice only) | "Remember: the mL you gave, from the real bottle." | — |
| 5 | Line | Point at "From Dr. Lane home → Controlled safe." | "Scout looks in your own safe, not the car." | Dr. Lane's controlled drug location: Dr. Lane home · Controlled safe |
| 6 | Line | Choose **Lot BU-1101** in **Lot / expiration \*** | "Pick the bottle you drew from." | Lots BU-1101 (8.5 mL, recommended) and BU-1102 (10 mL) |
| 7 | Line | Type `0.2` in **Wasted (mL)** | "You drew up a bit more than you gave. Enter the leftover." | — |
| 8 | Line | Point at **Disposal method** ("Required for controlled drugs.") | "Controlled waste always needs a disposal method." | — |
| 9 | Line | Click **Pharmaceutical waste** | "Pick how it was disposed of." | Disposal methods as in Settings |
| 10 | Line | Choose **Jordan Pike** in **Witness (optional)** | "If someone watched, pick them. You aren't on the list." | Jordan Pike active |
| 11 | Line | Click **Record waste** | "Record it." | — |
| 12 | Line | Point at "Recorded 0.2 mL wasted in the controlled drug log." and "Given: 0.5 mL · Wasted: 0.2 mL" | "The line now shows both the dose and the waste." | — |
| 13 | Voice-over | — | "When the bill is paid, the 0.5 mL comes out of bottle BU-1101 in your safe." | — |

## What else you can do here

- **More wasted (mL)** to add to the waste.
- **Another shelf…** to take the dose from somewhere other than your safe. It's allowed, and the Controlled Drugs report flags it.
- **+ Add another lot** if the dose came from two bottles.

## What other roles see

- Anyone who can record waste sees **Wasted (mL)** and **Record waste**; others see only the dose line.
- A doctor with no controlled drug location can't be charged a controlled drug (STK-17).

## Closing

"The most common mistakes are not recording the leftover, and charging the dose under the wrong doctor. Remember: the mL you gave, from the real bottle, and the leftover as waste."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Dr. Avery Lane: all labels as written, and the waste saved with "Recorded 0.2 mL wasted in the controlled drug log."
- **Bug (B1): the waste is booked against the bill's location (the Car), not the safe the dose comes from.** The lot in the safe went down 0.2 mL, but the shelf total that dropped was the Car's (Car: −0.2 mL; safe unchanged). The lot and shelf totals no longer agree, and that's the drug Vet Snap reconciles. Don't record step 11 until this is fixed on `build-doctor-flow`.
- In the demo, Buprenorphine is not marked **Medication**, so the line doesn't ask for a sig. If a real in-clinic item is marked Medication, checkout asks for a sig; untick it in Catalog (Q4).
- The paid dose drew from the safe correctly (checked through the API in the setup: "sold 0.6 from Controlled safe").

- **B1 fixed** on `fix/inventory-training`: the waste comes off the Controlled safe (17.9 → 17.7 mL), and the waste row names the safe. **Q4 (owner, Nov 9):** no code change. In-clinic injectables and controlled doses have **Medication** unticked in Catalog, so checkout asks no sig; a dispensed version (e.g. Buprenex dispensed) keeps it and gets a label.
