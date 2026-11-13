# INV-19. Mark a client "Deposit required"

- **Audience:** managers, billing and lead CLs (video name: CL, Manager; lead CLs file under CL, as for the membership videos). Plain CLs and doctors can't set it.
- **Length:** 1 minute.
- **Watch next:** INV-18.
- **The one thing to remember:** mark the client once, with a reason, and every booking reminds the CL to collect a deposit.

## Why (opening)

"When a client hasn't paid in the past, we ask for a deposit before each visit. Marking the client tells everyone who books."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Tom Chen | — | "When a client hasn't paid in the past, we ask for a deposit before each visit. Marking the client tells everyone who books." | Signed in as Robin Hale (manager). Tom Chen not marked yet. Biscuit's wellness visit on the next weekday |
| 2 | Client page | Point at **+ Mark deposit required** (under the client alerts) | "Mark the client once, with a reason. It's here on the client page, under the client alerts." | — |
| 3 | Client page | Click **+ Mark deposit required** | "Click Mark deposit required." | — |
| 4 | **Deposit required** window | Point at "CLs will see this when booking and collect a deposit for each visit. Why? (optional)" | "Scout asks why, so the team knows." | — |
| 5 | Deposit required window | Type "Two unpaid visits" | "For example, two unpaid visits." | — |
| 6 | Deposit required window | Click **Mark deposit required** | "Then click Mark deposit required." | — |
| 7 | Client page | Point at the **Deposit required** box: "Collect a deposit before each visit (right-click the appointment → Client → Appointment Deposit). Two unpaid visits — Robin H." | "Now it's on the client, with the reason and your name, and it says how to collect the deposit." | — |
| 8 | Client page | Point at **Clear** in the box | "When the client is back in good standing, click Clear to take it off." | — |
| 9 | Schedule (Day view, the visit day) | Hover Biscuit's visit | "On the schedule, anyone who opens one of his visits" | — |
| 10 | Visit pop-up | Point at **Client alerts**: "DEPOSIT REQUIRED (Two unpaid visits): collect a deposit for this visit…" | "sees Deposit required at the top of the client alerts, with what to do." | — |
| 11 | Voice-over | — | "Managers, billing and lead client liaisons can mark or clear it. Everyone else sees it, but can't change it." | — |
| 12 | Closing | — | "The most common mistake is marking a client without a reason, so nobody knows when to clear it. Remember: mark the client once, with a reason, and every booking reminds the team to collect a deposit." | — |

## What other roles see

- **+ Mark deposit required** and **Clear** show only for managers, admin, billing and lead CLs.
- Everyone else sees the **Deposit required** box and the booking alert, but not the buttons. A CL or doctor who tries it through the system gets "not allowed".

## Closing

"The most common mistake is marking a client without a reason, so nobody knows when to clear it. Remember: mark the client once, with a reason, and every booking reminds the team to collect a deposit."

## Notes (Nov 12, 2026): Pass 1 dry run

Dry run clean (Mac voice); spec and narration written; questions and fixes are in `docs/training/review-pass1.md` (Batch D). Final take waits on the owner's answers and on build-doctor-flow (with the deposit-hold change) being merged into this branch. Record INV-19 before INV-18 (INV-18's setup marks Tom Chen itself, so either order works on a fresh seed).
