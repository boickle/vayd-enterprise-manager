# OSV-22. Start to finish: a mail order from a visit

- **Audience:** Mail order team.
- **Who is on screen:** Riley, Robin.
- **Spec:** `cypress/training/osv-22-visit-start-to-finish.cy.ts`; narration `cypress/training/narration/osv-22-visit-start-to-finish.json` (Nova, 1.25x).
- **Demo data:** Dr. Lane sends Juniper’s heartworm chewable to the queue from today’s visit (as in OSV-05). The bill is paid in cash behind the scenes mid-video.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `v01-why` | Items sent home by mail from a visit land in the same queue. Here's one from start to finish. |
| `v02-filter` | This one came from Juniper's visit today. |
| `v03-order` | The doctor approved the directions on the bill, so there's no approval task. |
| `v04-payment` | It waits in Needs payment until the visit bill is paid. |
| `v04b-wait` | A bill from the last hour may be a visit still going. Give it an hour before sending the client a pay link. |
| `v05-paid` | Once the bill is paid, it moves to Fill. |
| `v06-office` | Fill it from the office you took it from, |
| `v06b-location` | and the location, |
| `v07-filled` | print the labels, and mark it filled. |
| `v08-ship` | Then ship it: weigh the package, |
| `v09-rates` | get rates, |
| `v10-label` | and print the cheapest label. |
| `v11-checked` | Robin, a licensed technician, checks it. |
| `v12-tell` | Last, tell the client it's on the way. |
| `v12b-email` | Click Email client, |
| `v12c-send` | and send it. |
| `v13-done` | Done. |
| `v14-mistakes` | The most common mistakes: filling a visit order before the bill is paid, and sending it to the doctor again when it was already approved on the bill. |
| `v15-remember` | Remember: visit orders are approved on the bill. They wait for payment, then fill, ship, check, and tell the client like any order. |
