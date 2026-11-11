# PERM-04. Offboard someone who's leaving

- **Audience:** managers (practice admins and practice managers).
- **Length:** 3 minutes.
- **Watch first:** PERM-02.
- **The one thing to remember:** use **Offboard**, not just Deactivate. Set their last day and hand over their visits, households and tasks.

## Why (opening)

"When someone leaves, three things matter: their login ends on time, their clients and tasks go to someone else, and their records stay exactly as they were. Offboard does all three in one step."

## Steps

Logged in as **Quinn Parker** (Practice Admin). Dr. Riley Rivera's last day is next Friday.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Settings → Staff | Pick **Riley Rivera** | "Dr. Riley Rivera is leaving us." | Riley Rivera: licensed vet at both offices |
| 2 | Staff → Riley Rivera, Profile tab | Click **Offboard** | "On her Profile tab, click Offboard." | — |
| 3 | Offboard Riley Rivera | Point at the title | "That's the one thing to remember: use Offboard, not just Deactivate. Set the last day and hand over her work." | — |
| 4 | Offboard | Set **Last day** to next Friday | "Set her last day." | — |
| 5 | Offboard | Point at the note under it: "Nothing changes until the end of their last day (midnight Eastern)…" | "Nothing changes until midnight that night. Then her login ends and she's signed out everywhere. Her records, signatures and invoices stay as they are." | — |
| 6 | Offboard | Pick **Maya Ortiz** in **Their tasks go to** ("Select a person (2 open)…") | "Her two open tasks go to Dr. Ortiz, and so will any automatic tasks meant for her." | 2 open tasks assigned to Riley |
| 7 | Offboard | Point at **3 visits still booked with them after their last day** and the list | "Three visits are still booked with her after that day." | 3 visits for Riley 7–9 workdays out (Biscuit, Maple, Biscuit) |
| 8 | Offboard | Point at "They stay booked. A Rebook … task is created … No client is emailed." | "They stay booked, and a Rebook task is made so a CL can move them. No client is emailed." | — |
| 9 | Offboard | Pick **Maya Ortiz** in **New primary doctor for 1 pet, 1 household** | "The Chens' primary doctor moves to Dr. Ortiz. No email or text goes to clients." | Chen household and Biscuit: primary doctor Riley |
| 10 | Offboard | Under **Works with Riley Rivera**, pick **Move to Maya Ortiz** for **Tess Holt** | "Tess usually rides with Dr. Rivera. Move her to Dr. Ortiz." | Tess Holt works with Riley |
| 11 | Offboard | Point at **Their own household** search (optional) | "If she's a client too, pick her household so staff pricing ends on her last day." | — |
| 12 | Offboard | Click **Offboard** | "Click Offboard." | — |
| 13 | Settings → Staff | Point at the success message ("Offboarded. Their last day is …; their login ends at midnight that night.") and the name in the staff list: "Riley Rivera · Provider · Last day 2026-11-13" | "Done. Until her last day she works as normal, and the staff list shows the date." | — |
| 14 | Voice-over | — | "After the last day she's hidden from staff lists and pickers. Show deactivated brings her back into view, labelled Deactivated. Reports keep her name for the days she worked." | — |

## What else you can do here

- **Cancel offboarding** (on her Profile tab) before the last day if plans change.
- The **Before their last day** box warns about unsigned SOAPs, controlled-drug stock still at her location, and roles she is the only holder of. These don't block the offboard.
- Reactivating someone later does not turn their login back on. An admin does that in Admin → Users.

## What other roles see

- **Practice managers** can offboard too.
- **Client liaisons** see the visits on the departed doctor's calendar in the Scheduler, labelled "(Deactivated)", and move them from the Rebook task.

## Closing

"The most common mistakes: deactivating someone without handing over their tasks, so tasks go nowhere; and emailing clients about a new doctor before the visits are moved. Remember: use Offboard. Set the last day and hand over their visits, households and tasks."

## Notes from the check in the app (Nov 9, 2026)

- Walked end to end as Quinn Parker with last day Nov 13: "Select a person (2 open)…", "3 visits still booked with them after their last day" (Nov 18–20, Biscuit / Tom Chen and Maple / Maria Rivera), "New primary doctor for 1 pet, 1 household". Offboard saved; the staff list showed "Riley Rivera · Provider · Last day 2026-11-13". The success message is a toast: check it's on screen in the dry run.
- Fixed Nov 9 (RP-A11): "Works with Riley Rivera" lists only Tess Holt. Re-check in the dry run once `build-doctor-flow` is merged in.
- The audit row for the offboard shows raw data (`worksWith: [{"userId":2010,…}]`); keep it off camera in PERM-05.
