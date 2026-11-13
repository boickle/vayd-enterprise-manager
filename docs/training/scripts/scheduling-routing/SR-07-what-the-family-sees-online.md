# SR-07. What the family sees when they book online

**B6 is fixed** (vayd-api `aad845c8`). Signed-in clients are offered times again.

- **Audience:** CLs.
- **Length:** 2 minutes.
- **Watch first:** SR-06.
- **The one thing to remember:** the online form only offers times routing would offer. If none suit, the family asks for a call, and that request comes to us.

## Why (opening)

"When a family calls about their online request, it helps to know exactly what they saw."

## Steps (checked up to the point B6 blocks)

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Client portal → **Request an appointment**, signed in as Maria | Point at the prefilled phone and address | "Signed-in families start with their details filled in." | Maria's portal login (login email = record email). A real, geocodable Raleigh address. Visit types flagged for the request form |
| 2 | Form | Point at the one thing to remember | "The form only offers times routing would offer." | — |
| 3 | Form | Answer **Is this the place we are doing the visit?** Yes, and **Is your mailing address the same as this location?** | "They confirm where the visit is." | — |
| 4 | Form | Tick **Maple**, pick the not-feeling-well reason, type "Limping on the left hind leg since yesterday" | "They pick the pet and tell us why." | — |
| 5 | Form | Point at **How soon do you need to be seen?**: Emergent – today, Urgent – within 24–48 hours, Soon – sometime this week, Flexible, I'm not sure | "Then how soon." | — |
| 6 | Form | Point at **Pick a Date & Time**: "Select a doctor, then choose a day and time that works for you.", **Choose a doctor** (Dr. Avery Lane, Dr. Priya Shah, each **Book Online**), and the calendar ("Tap a highlighted date to see available times") | "If routing has times that fit, they pick a doctor, a day and a time. It books straight away and shows up in Auto-Booked." | — |
| 7 | Form | Point at **Preferred days/times or anything we should know about scheduling** | "Otherwise they tell us what works, and a CL calls them." | — |
| 8 | Form | Click **Submit** | "Submit." | — |
| 9 | **Thank You!** | Point at "We are working on booking your appointment and will be in touch shortly." and **Review & Join Membership Now** | "They see this, with an offer to look at membership." | — |
| 10 | Voice-over | — | "They also get an email: We Received Your Appointment Request. If the time they picked was taken while they were on the page, Scout doesn't book it. It tells them our team will call soon to find another time." | — |

## What other roles see

- Not applicable: this is the family's view.

## Closing

"The most common mistakes: telling a family their online request is booked when it's in New, and not knowing that a picked time can be taken while they're on the page. Remember: the online form only offers times routing would offer. If none suit, the family asks for a call, and that request comes to us."

## Notes from the check in the app (Nov 7, 2026)

- **Checked:** steps 1 to 5 and 7 to 9, as Maria. Submitting saved the request, and the CL saw it in **New** (SR-06).
- **Captured email:** "[TEST] We Received Your Appointment Request - Vet At Your Door", redirected to deirdre@vetatyourdoor.com on the test stack.
- **Checked after the B6 fix:** **Pick a Date & Time** with both doctors and the calendar.
- **Not checked:** picking a time and submitting it (it should land in **Auto-Booked**), the slot-taken message (owner decision D2), and the new-client form (not signed in). Dry-run them before recording.
