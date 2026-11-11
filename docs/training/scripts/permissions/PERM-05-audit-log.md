# PERM-05. Check who changed what: the Permission Audit Log

- **Audience:** managers (practice admins and practice managers).
- **Length:** 2 minutes.
- **Watch first:** PERM-02.
- **The one thing to remember:** every role, license and permission change is logged with who made it, for whom, and the before and after.

## Why (opening)

"If someone can suddenly do something they shouldn't, or can't do something they should, the log tells you what changed, when and who did it."

## Steps

Logged in as **Quinn Parker** (Practice Admin), after PERM-02 and PERM-03 (Sam Chen made a Technician and a licensed technician).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Settings → Staff | Pick **Sam Chen**, click **Access** | "Start on the person." | Changes from PERM-02 and PERM-03 |
| 2 | Access | Point at **Recent changes** at the bottom | "Recent changes shows their latest role, license and permission changes." | — |
| 3 | Voice-over | — | "The one thing to remember: every role, license and permission change is logged with who made it, for whom, and the before and after." | — |
| 4 | Access | Click **See the full Permission Audit Log** | "For everything, open the full log." | — |
| 5 | Permission Audit Log | Point at the newest rows: who, whom, what changed | "Each row says who made the change, who it was for, and what changed." | — |
| 6 | Permission Audit Log | Point at a role row showing the roles before and after, with office | "Role changes show before and after, including the office." | — |
| 7 | Settings → Staff ▾ → Roles | Click **Technician**, scroll to **Recent changes to Technician** | "Each role also shows its recent changes, at the bottom of the role." | — |
| 8 | Voice-over | — | "Skim the log once a week for the first month after go-live." | — |

## What other roles see

- Practice admins and practice managers see the log. Nobody else has Settings → Staff.

## Closing

"The most common mistake is fixing a missing permission without checking the log first: often someone's role was just changed. Remember: every role, license and permission change is logged with who made it, for whom, and the before and after."

## Notes from the check in the app (Nov 9, 2026)

- Rows read: "Quinn Parker · Assign practice roles to staff · Staff member: Sam Chen", "Set whether an employee is licensed", "Grant an individual permission to one employee · Covering while manager is away", "Deactivate or delete an employee record · Offboard Riley Rivera, last day …".
- **What changed** for role and offboard rows is raw data (`0: — → {"name":"Technician","slug":"technician","office":"Raleigh office",…}`, `worksWith: [{"userId":2010,…}]`). Readable, but it looks unfinished on camera. Point at the license or grant rows instead, or tidy the display first.
- The test database holds hundreds of old rows from earlier tests; the seed clears them before recording (see Demo data).
- **Done by** lists every staff member.
