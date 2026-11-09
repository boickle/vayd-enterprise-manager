# LV-03. Send tests to IDEXX from the visit

- **Audience:** techs.
- **Length:** 2 minutes.
- **Watch first:** none.
- **The one thing to remember:** leave the vet on **Appointment's doctor** unless a different vet ordered the test.

## Why (opening)

"Send-out tests go to IDEXX from the bill, so the charge, the requisition and the result all stay tied together."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's SOAP, Checkout | Point at the Checkout panel | "Juniper Rivera needs a CBC sent to IDEXX." | Rivera visit today with Dr. Avery Lane; logged in as Jordan Pike; IDEXX sandbox login on the stack |
| 2 | Checkout | Type "CBC" in **Add a charge for Juniper**, pick **CBC (IDEXX)** | "Add the IDEXX test as a charge, like any lab." | Catalog lab with the sandbox's CBC code |
| 3 | Checkout, the line | Point at the **IDEXX** tag and **Not sent** | "It says Not sent." | — |
| 4 | Checkout | Point at "1 IDEXX test not sent" and click **Send to IDEXX** | "Click Send to IDEXX." | — |
| 5 | **Send to IDEXX · Juniper** | Point at the ticked **CBC** and its code | "Every IDEXX test on her bill is ticked. Untick any you aren't sending yet." | — |
| 6 | Send to IDEXX | Point at **Veterinarian**: "Appointment's doctor" | "Leave the vet on Appointment's doctor. Dr. Lane gets the result and the review task." | — |
| 7 | Send to IDEXX | Point at **Collected**, today | "Collected is today. Change it if the sample was drawn earlier." | — |
| 8 | Send to IDEXX | Point at "IDEXX needs the birthdate" and type an estimate in **Birthdate (estimate is fine)** | "If IDEXX needs something the chart doesn't have, Scout asks. An estimate is fine." | Juniper has no birthdate on the chart |
| 9 | Send to IDEXX | Point at "IDEXX's order page opens next…" | "IDEXX's order page opens next." | — |
| 10 | Send to IDEXX | Click **Send 1 test to IDEXX** | "Send." | — |
| 11 | IDEXX window | Point at "IDEXX · Juniper" and **Requisition #** | "The order is made. Finish it in IDEXX's page. That's the next video." | — |

## What else you can do here

- Pick another vet only when a different doctor ordered the test.
- **Sex** appears when the chart has none; otherwise IDEXX gets unknown.
- If the pet has no owner on file, Scout asks you to add one first.

## What other roles see

- Doctors see the same screen.

## Closing

"The most common mistakes: picking yourself as the vet, and sending again from a second tab. Scout stops the second send. Remember: leave the vet on Appointment's doctor unless a different vet ordered the test."

## Notes from the check in the app (Nov 8, 2026)

- **Checked with the fake IDEXX:** the **IDEXX** tag and **Not sent** on the line, "1 IDEXX test not sent · …" with **Send to IDEXX**, the window **Send to IDEXX · Bella** with the test and its code (#CHEM25), **Veterinarian** (Appointment's doctor, then the vets), **Collected**, the note, **Send 1 test to IDEXX** and **Cancel**, then the IDEXX window.
- **Not checked:** the birthdate prompt (the seeded pets have birthdates) and the sandbox's real CBC code. Check both in the dry run with the sandbox.
- The screen pre-picks the line's provider only if that person is a vet (fixed Nov 8, frontend 0f76da3, not yet pushed). The training branch needs build-doctor-flow merged before recording.
