# SR-05. Move or reschedule a visit

- **Audience:** CLs; doctors and techs for their own visits.
- **Length:** 2 to 3 minutes.
- **Watch first:** SR-03.
- **The one thing to remember:** reschedule through routing, and give the family the new arrival window.

## Why (opening)

"A moved visit changes the doctor's whole day. Rescheduling through routing keeps the day efficient and keeps the visit's history."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home, Dr. Lane's day | Point at Biscuit's 11:00 recheck | "Tom Chen needs to move Biscuit's visit." | Biscuit Chen, Recheck, 11:00 with Dr. Lane, "Ear recheck". Maple Rivera 9:00 the same day. Signed in as Casey Morgan (CL) |
| 2 | Home | Point at the one thing to remember | "Reschedule through routing, and give the family the new arrival window." | — |
| 3 | Visit card | Right-click Biscuit's visit, hover **Scheduling**, click **Reschedule** | "Right-click, Scheduling, Reschedule." | — |
| 4 | **Get Best Route**, RESCHEDULING | Point at "Moving Biscuit (Tom Chen)" and the filled-in doctor, type and client | "Routing opens with the visit already filled in." | — |
| 4a | Voice-over, the Riveras' day | Right-click Maple's 3:00 visit, **Reschedule**, point at **Reschedule which visits?**: "Maria Rivera has 2 visits on Mon, Nov 9. Move only Maple's visit, or all of them together?" with **Only Maple** and **All 2 visits** | "When the family has other visits that day, Scout asks first: just this pet, or everyone." | Riveras: Juniper 1:30 Wellness and Maple 3:00 Recheck the same day |
| 5 | Get Best Route | Click **Get Best Route** | "Search." | — |
| 6 | **Results** | Point at "Original booking score" and the first card's **Arrival Window** | "Each option is compared with the current time. Lower scores are better." | — |
| 7 | Results | Click **View Placement** on the time the family wants | "Pick the time Tom wants, and View Placement." | — |
| 8 | **Reschedule preview** | Point at **WAS** and **NOW** | "WAS is the old time. NOW is the new arrival window." | — |
| 9 | Reschedule preview | Click **Reschedule** | "Reschedule." | — |
| 10 | **Reschedule appointment** | Point at Biscuit's section: "Was Monday, Nov 9, 2026 · 11:00 AM – 11:45 AM", type and description | "Check the pet, the type and the description carried over." | — |
| 11 | Reschedule appointment | Click **Reschedule appointment** | "Confirm." | — |
| 12 | Calendar | Point at Biscuit's card at the new time | "Moved. Tell Tom the new arrival window." | — |
| 13 | Voice-over, right-click → **Scheduling → Explore alternatives** | Point at "ALTERNATIVES … keeping current appointment" | "If the family isn't sure yet, Explore alternatives searches without moving anything. The current visit stays until you book another time." | — |
| 14 | Voice-over, right-click → **Scheduling → Edit Appointment** | Point at "Date and primary provider can only be changed by rescheduling." | "Edit Appointment is for the same day: change the time, and Scout shows the new placement before saving. A new day or doctor always goes through Reschedule." | — |

## What else you can do here

- **Call client** and **Text client** in the preview.
- **Add to waitlist** if they want sooner but will keep this time (SR-09).
- **Edit Appointment** also changes the type, description and staff notes.

## What other roles see

- **CLs** can reschedule any visit.
- **Doctors and techs** are meant to reschedule their own visits only (see the review, Q2).
- **Started visits:** a visit whose chart has started can only have its time changed on the same day.

## Closing

"The most common mistakes: removing a visit and booking a new one instead of rescheduling, which loses the visit's history, and telling the family the old time. Remember: reschedule through routing, and give the family the new arrival window."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL**, end to end, on a household with one visit that day: Biscuit moved from 11:00 to the time picked.
- **Fixed Nov 7 (frontend `f329460`):** when the household has other visits that day, Reschedule asks **Reschedule which visits?** (**Only <pet>** / **All N visits**). **Only Maple** opened routing as "Moving Maple (Maria Rivera)", and the Reschedule window showed only the 3:00 visit (B1 fixed).
- **Edit Appointment:** after a time change, **Save** becomes **View Placement**.
- **The rescheduling hint is out of date:** "Run routing, open My Week, then confirm the new time." Don't point at it.
- **Not checked:** whether the family is texted or emailed about the move. The demo clients are set not to receive messages on the test stack.
