# OSV-09. Second check, then tell the client

- **Audience:** mail order team.
- **Length:** 2 minutes.
- **Watch first:** OSV-08.
- **The one thing to remember:** a second person checks each pet's items against the label before it leaves.

## Why (opening)

"The second check catches the wrong pet, the wrong strength or the wrong count before it reaches the family."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Mail Order Queue**, Robin | Click **Check**, then the order (**✓ Filled**, **✓ Label printed**) | "Robin wasn't the filler, so Robin checks." | The order Riley filled and labelled in OSV-08 |
| 2 | Order | Point at the one thing to remember | "A second person checks each pet's items against the label." | — |
| 3 | Order | Click **Print check slip** | "Print the check slip if you want it on paper." | — |
| 4 | Order | Click **I checked Maple** | "Check Maple's items, then click I checked Maple." | — |
| 5 | Order | Point at **✓ Checked** | "Checked." | — |
| 6 | Order | Point at **Email client**, **Text client**, **Do not contact client** | "Then tell Maria it's on the way." | — |
| 7 | Order | Click **Email client** | "Email her." | Email captured on the training stack |

## What else you can do here

- **Check all remaining** for an order with several pets.
- **Void / refund this label** if the check finds a problem.

## What other roles see

- **Riley, who filled it,** clicks **I checked Maple** and gets "You filled this order — A second person should check…". Only a licensed vet or tech can override, and since Nov 7 they must type **Why are you checking your own fill? (required)**; the reason is saved on the order with their name (Q4, vayd-api `cda4ccaa`, frontend `a179f05`).

## Closing

"The most common mistakes: checking your own fill, and telling the client before the check. Remember: a second person checks each pet's items against the label before it leaves."

## Notes from the check in the app (Nov 7, 2026)

- **Walked** as Robin Hale: **I checked Maple** → **✓ Checked** → **Email client** / **Text client** / **Do not contact client**. The database showed `second_check`.
- **Not clicked:** **Email client**. On the stack it goes to the capture file; the message has a "Send for real (non-prod)" switch that should stay off.
- **Q4:** Scout already blocks the filler (server and screen); the override now needs a typed reason. The reason box wasn't walked live (the demo has no licensed tech who fills); its tests pass.
