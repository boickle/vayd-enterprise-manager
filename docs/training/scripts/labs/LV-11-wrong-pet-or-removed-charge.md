# LV-11. A lab charged to the wrong pet

- **Audience:** techs and client liaisons.
- **Length:** 1½ to 2 minutes.
- **Watch first:** LV-01.
- **The one thing to remember:** fix the charge, not the result. **Move to another pet** moves the lab and its result onto the right pet's chart.

## Why (opening)

"In a multi-pet visit it's easy to charge a lab to the wrong pet. The result follows the charge, so fixing the charge fixes the chart."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Rivera account, **Financial** tab, the open bill | Point at the Blood glucose line under Maple | "The glucose was charged to Maple, but it was Pepper's, and the result is already in." | Rivera bill with Maple and Pepper; glucose under Maple with a completed result (312); logged in as Jordan Pike |
| 2 | Bill | Point at the one thing to remember | "Fix the charge, not the result." | — |
| 3 | Bill | Click the glucose line to open it | "Open the line." | — |
| 4 | Bill, the open line | Point at "Charged to the wrong pet?" | "Charged to the wrong pet?" | — |
| 5 | Bill | Pick **Pepper** in **Move to another pet…** | "Pick Pepper." | — |
| 6 | **Move to Pepper?** | Point at "… moves from Maple to Pepper, with its lab result. The result goes on Pepper's chart." | "Scout says what moves." | — |
| 7 | Move window | Click **Move to Pepper** | "Move to Pepper." | — |
| 8 | Pepper's chart, Timeline, **Labs** | Point at the glucose result | "The result is on Pepper's chart now," | — |
| 9 | Maple's chart, **Labs** | Point at no glucose | "and gone from Maple's." | — |
| 10 | Pepper's chart, **History** | Point at the move | "History shows the move on both pets." | — |
| 11 | Voice-over | — | "An IDEXX test already sent stays with the first pet; Scout warns you. Call IDEXX to correct the pet." | — |

## What else you can do here

- If a lab won't be run at all, remove its charge; the empty form leaves Waiting to run.

## What other roles see

- Same for doctors. On a paid or closed bill there's no Move control.

## Closing

"The most common mistake: typing the result again on the right pet and leaving the wrong one. Remember: fix the charge, not the result; Move to another pet moves both."

## Notes from the check in the app (Nov 8, 2026)

- **Owner decision (Nov 8):** add "Move to another pet", making sure the result lands on the other pet's chart. Built on build-doctor-flow (frontend e8296a1): an open lab line on the bill shows "Charged to the wrong pet?" with **Move to another pet…**; confirming moves the line and its in-house result (LAB-07). Test LAB-07-4 checks the moved result is on the new pet's chart and not the first.
- To check in the dry run: the chart steps (8 to 10).
