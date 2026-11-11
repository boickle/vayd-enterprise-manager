# OSV-21. Start to finish: an online order that needs the doctor

- **Audience:** Mail order team, doctors.
- **Who is on screen:** Robin, Dr. Lane.
- **Spec:** `cypress/training/osv-21-needs-the-doctor.cy.ts`; narration `cypress/training/narration/osv-21-needs-the-doctor.json` (Nova, 1.25x).
- **Demo data:** Juniper’s thyroid Rx with no refills. Stands in for any Rx with none left (e.g. Felimazole).
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `a01-why` | When a prescription has no refills left, a doctor approves the order before anyone fills it. |
| `a02-filter` | Maria ordered Juniper's thyroid tablets. It's in Needs approval. |
| `a03-order` | Open it. |
| `a04-norefills` | No refills, so it needs the doctor. |
| `a05-send-to` | Send the approval task to Juniper's doctor. |
| `a06-send` | Send task. |
| `a07-task` | Dr. Lane opens the task. |
| `a08-directions` | She checks the directions, which came from the last prescription, |
| `a09-chronic` | marks it chronic, |
| `a10-approve` | and approves it. |
| `a11-fill` | Back in the queue, it's in Fill. |
| `a11b-open` | Open it: approved. |
| `a12-same` | From here it's like any order: fill and print the labels, ship, a second check, then tell the client. |
| `a13-mistakes` | The most common mistakes: filling before the doctor approves, and asking the doctor in a text instead of sending the task. |
| `a14-remember` | Remember: no refills means the doctor approves first, on the task. |
