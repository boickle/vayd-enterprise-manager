# SR-17. When a pet dies or is made inactive: what closes on the schedule

- **Audience:** CLs and doctors.
- **Length:** 2 minutes.
- **Watch first:** SR-01. For a euthanasia visit, EMR V10.
- **The one thing to remember:** inactivate the pet from the chart and read the list before you accept. It closes the future visits, follow-ups, text offers and waitlist entries, so nobody contacts the family about that pet again.

## Why (opening)

"Nothing hurts a grieving family more than a cheerful reminder or a booking text for a pet who has died. One step closes everything."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home | Right-click Juniper's visit, **Patient → View Chart** | "Maria called: Juniper has passed away. Open Juniper's chart." | Juniper Rivera: a future Wellness visit, a pending follow-up (Recheck), a Rabies reminder. Signed in as Casey Morgan (CL) |
| 2 | Chart | Point at the one thing to remember | "Inactivate from the chart, and read the list before you accept." | — |
| 3 | Chart | Click **Deactivate** | "Click Deactivate." | — |
| 4 | **Inactivating this patient** | Point at "If you inactivate Juniper, Accept will cancel the items below." | "Scout lists everything still open for Juniper." | — |
| 5 | Inactivating | Choose **Passed away** in **Reason for inactivating** | "Choose the reason." | — |
| 6 | Inactivating | Point at **Removing the following reminders**: "Rabies vaccine" | "Her reminders stop." | — |
| 7 | Inactivating | Point at **Removing 1 follow-up**: "Recheck … Taken off the follow-up queue" | "Follow-ups waiting for a CL are removed." | — |
| 8 | Inactivating | Point at **Text offers** and **Waitlist entries** | "Any open text offers expire, and waitlist entries are removed." | — |
| 9 | Inactivating | Point at **Cancelling the following appointments**: "Wellness · Monday, Nov 9 · 1:30 PM" | "Her future visits are cancelled." | — |
| 10 | Inactivating | Point at **Memberships**, **Auto-ships**, **Prescription refills**, **Pharmacy orders** | "Memberships, auto-ships, refills and pharmacy orders too." | — |
| 11 | Inactivating | Click **Accept and inactivate** | "Accept." | — |
| 12 | Voice-over | — | "Maple and Pepper's visits and reminders aren't touched. Only Juniper's." | — |

## What else you can do here

- **Inform DVM of death** (right-click → **On Visit Day**) tells the doctor.
- **Cancel** closes the window without changing anything.
- **Reactivate** on the chart if it was done by mistake.

## What other roles see

- **Doctors** see the same window. After a euthanasia visit, the wrap-up runs from the visit (EMR V10).

## Closing

"The most common mistakes: removing only the next visit and leaving reminders and follow-ups running, and accepting without reading the list. Remember: inactivate the pet from the chart and read the list before you accept."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL:** the window and every group, with a visit, a follow-up and a reminder for Juniper.
- **Not walked:** **Accept and inactivate**. The test plan's SCH-08 end-to-end test covers what happens next.
- **The button is labelled Accept and inactivate only after a reason is chosen.** Before that the window says "Choose a reason to continue."
