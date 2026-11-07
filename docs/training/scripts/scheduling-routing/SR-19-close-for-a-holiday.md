# SR-19. Close the practice for a holiday

- **Audience:** practice managers and the medical director.
- **Length:** 1 to 2 minutes.
- **Watch first:** SR-18.
- **The one thing to remember:** add every holiday as a closed day, or online booking will offer it. Do Thanksgiving (Nov 26), Christmas and New Year's Day now.

## Why (opening)

"Families can book online at any hour. Unless a day is marked closed, they'll be offered times on Thanksgiving."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Settings** | Point at **Closed days** | "Closed days are in Settings. For admins they're at the bottom of Appointment Types." | No closed days yet. Signed in as Robin Hale (practice manager) |
| 2 | Closed days | Point at the one thing to remember | "Add every holiday as a closed day, or online booking will offer it." | — |
| 3 | Closed days | Point at "Online booking offers no times on these dates (holidays). Staff can still book and route by hand." | "A closed day stops online booking. Staff can still book by hand if we need to." | — |
| 4 | Closed days | Pick Nov 26, 2026 in **Closed day to add** | "Pick the date." | — |
| 5 | Closed days | Click **Add closed day** | "Add closed day." | — |
| 6 | Closed days | Point at the message "… closed for online booking." and the new row with **Remove** | "It's listed. Remove reopens it." | — |
| 7 | Voice-over | — | "Do the same for Christmas and New Year's Day. Then check each doctor's calendar for visits already booked on those days." | — |

## What else you can do here

- The rest of **Appointment Types**: visit lengths, arrival windows, and which types are online (SR-20).
- The pre-meds arrival window setting, just above.

## What other roles see

- **Practice managers and the medical director** (`appointment_type.manage`) see **Closed days** at the top of their Settings page (frontend `33469aa`). Admins see it under **Appointment Types**.

## Closing

"The most common mistakes: forgetting a holiday until a family books it, and assuming a doctor's day off closes the practice. It only closes that doctor's calendar. Remember: add every holiday as a closed day. Do Thanksgiving, Christmas and New Year's Day now."

## Notes from the check in the app (Nov 7, 2026)

- **Checked with an admin login:** the **Closed days** section, its help text, "No closed days." and **Add closed day**.
- **Checked as a practice manager (not admin):** added Thu, Nov 26, 2026. It showed "Thu, Nov 26, 2026 closed for online booking." and a row with **Remove**. That was on the test stack only; production still needs it.
- **Urgent:** Thanksgiving is Nov 26. The test plan's checklist says to block it for every doctor; closed days now do it practice-wide.
