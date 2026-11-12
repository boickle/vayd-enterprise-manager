# OSV-17. The Mail Order Queue at a glance

- **Audience:** Mail order team.
- **Who is on screen:** Riley (mail team).
- **Spec:** `cypress/training/osv-17-queue-at-a-glance.cy.ts`; narration `cypress/training/narration/osv-17-queue-at-a-glance.json` (Nova, 1.25x).
- **Demo data:** Three orders from Maria: Maple’s heartworm chewable (refills on file, so in Fill), Juniper’s thyroid tablets (no refills, so Needs approval), dental chews marked Pending client.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `q01-why` | The Mail Order Queue is the mail team's to-do list. Every order moves through the same steps until it's done. |
| `q02-open` | Open shows every order still in progress. |
| `q03-steps` | Each order shows its steps: approval, payment, fill, ship or pickup, check, and contacting the client. |
| `q04-cancel` | Start each day with cancel requests. Someone asked to stop an order the team already started. |
| `q05-approval` | Needs approval is waiting on a doctor. The doctor decides on their task, not here. |
| `q06-pending` | Pending client means the ball is in the client's court. We asked them something, and we're waiting on their answer. |
| `q07-payment` | Needs payment is waiting on the client to pay. |
| `q08-fill` | Fill, ship or pickup, and check are the mail team's work. Oldest first. |
| `q09-check` | Check is a second look. Every prescription needs a licensed vet or technician on the fill or the check. If you're licensed and no one else is here, you can check your own fill, with a reason. |
| `q10-contacted` | Contacted is the last step: tell the client it's on the way, or ready to pick up. |
| `q11-search` | Search finds any order by number, client, pet or medicine. |
| `q12-mistakes` | The most common mistakes: marking an order pending while waiting on a doctor or manager, and leaving cancel requests waiting. |
| `q13-remember` | Remember: cancel requests first, then fill, ship and check, oldest first. Pending is only for the client. |
