# LV-01. Run an in-house lab in the visit

- **Audience:** techs and doctors.
- **Length:** 2½ minutes.
- **Watch first:** none.
- **The one thing to remember:** type what you measured. Number rows start blank, and **Fill normal values** only fills choice rows, like Negative.

## Why (opening)

"An in-house lab started in the visit lands on the chart and on the bill together. Nothing is filled in for you, so what's charted is what you actually saw."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's SOAP | Point at the **Checkout** panel on the right | "Maple Rivera is drinking a lot. Dr. Lane wants a blood glucose and a heartworm test." | Rivera visit today with Dr. Avery Lane; Maple's SOAP open; logged in as Jordan Pike (tech) |
| 2 | SOAP | Point at the one thing to remember | "Type what you measured. Nothing is filled in for you." | — |
| 3 | Checkout | Type "glucose" in **Add a charge for Maple**, pick **Blood glucose (in-house)** | "Add the lab as a charge." | Catalog lab "Blood glucose (in-house)" attached to the BLOOD GLUCOSE form |
| 4 | Checkout, the new line | Point at the chip **Not run** | "It says Not run: ordered, but not done yet." | — |
| 5 | Checkout, the line | Click the arrow at the start of the line ("Run the lab / view results") | "Click the arrow to open the form." | — |
| 6 | The **BLOOD GLUCOSE** form | Point at the empty **Value** box | "The value is blank. It never starts at zero." | BLOOD GLUCOSE form (number row, units mg/dl) |
| 7 | The form | Type 312 in **Value** | "Type the reading." | — |
| 8 | The form | Click **Save results** | "And Save results." | — |
| 9 | Checkout, the line | Point at the chip **Complete** | "It says Complete, and it's on Maple's chart. Scout doesn't judge numbers. Dr. Lane does." | — |
| 10 | Checkout | Type "4dx" in **Add a charge for Maple**, pick **Heartworm 4Dx (in-house)**, click its arrow | "Now the 4Dx." | Catalog lab attached to the Heartworm 4dx form (five Negative/Positive rows, Negative set as normal) |
| 11 | The 4Dx form | Click **Fill normal values** | "Fill normal values sets every choice row to its normal, here Negative." | — |
| 12 | The form | Change **Heartworm** to Positive | "Maple's heartworm is positive, so change that row." | — |
| 13 | The form | Point at "1 result needs attention" and the row's **abnormal** tag | "An abnormal answer is flagged, so the doctor sees it." | — |
| 14 | The form | Click **Save results** | "Save results." | — |
| 14b | Checkout, the 4Dx line | Point at the chip **1 abnormal** | "The chip says 1 abnormal. Choice answers like Positive are judged, and a normal 4Dx would say Normal." | — |
| 15 | Voice-over | — | "On a form with numbers, like the urine dipstick, Fill normal values leaves the numbers blank. Type each one." | — |
| 16 | Voice-over | — | "If you click Save with a row still empty, Scout lists the empty rows. Type a value, or a comment like sample clotted." | — |

## What else you can do here

- **Save, finish later** keeps what you typed without charting it (LV-02).
- Each row has **Comments** for anything a value can't say.
- Write-up forms, like Ear Cytology, have one text box instead of rows.

## What other roles see

- **Client liaisons** see the form read-only, with "A tech or doctor enters results".
- Doctors see the same form as techs.

## Closing

"The most common mistakes: clicking Fill normal values on a form with numbers and saving without typing them, and leaving a lab Not run. Remember: type what you measured. Number rows start blank, and Fill normal values only fills choice rows."

## Notes from the check in the app (Nov 8, 2026)

- **Checked on the test stack (build-doctor-flow, Nov 8):** the charge search, the **Not run** chip, the arrow, the blank glucose value, **Fill normal values** (fills only choice rows), "1 result needs attention" and the **abnormal** tag, and **Save results**.
- **The visit's Checkout has no "Run lab" button.** The arrow on the line opens the form. On the client's bill (Financial tab), the line says "Results needed — expand to run the lab".
- **Owner decisions (Nov 8):** no number ranges anywhere; a number-only form's chip says **Complete**; a form with choice rows says **Normal** or **N abnormal**. Fixed on build-doctor-flow (frontend e8296a1): number rows show only their units and never flag; the 4Dx's Positive is still flagged inside the form.
- Demo forms should use the practice's real names: BLOOD GLUCOSE, Heartworm 4dx, Urine Dipstick, Ear Cytology.
