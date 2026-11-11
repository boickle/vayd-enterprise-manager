# ROLE-10. What the Mail Order Manager and Mail Order Team see

- **Audience:** managers.
- **Length:** 1 to 2 minutes.
- **Watch first:** none.
- **The one thing to remember:** the mail order team fills and ships online orders. The manager also settles auto-ship prices, refunds and abandoned carts. Neither has reports, catalog or settings.

## Why (opening)

"Mail order is a narrow job: fill, ship, notify. Their Scout is kept just as narrow."

## Steps

Part 1 logged in as **Jesse Ward** (Mail Order Team Member). Part 2 as **Alex Kim** (Mail Order Manager).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home (Jesse Ward) | Point at the top bar: **Home, Scheduling, Pharmacy, Labs, Tasks**, no Catalog | "This is Jesse on the mail order team." | perm-seed.ts |
| 2 | Voice-over | — | "The one thing to remember: the team fills and ships orders; the manager also settles auto-ship prices, refunds and abandoned carts." | — |
| 3 | Home | Click **Pharmacy**, then **Mail Order Queue** | "Their main screen is Pharmacy, Mail Order Queue: fill, ship, notify." | One pending mail order (none seeded yet) |
| 3b | Mail Order Queue | Point at the filters **Open, Cancel requests, Needs approval, Pending client, Needs payment, Fill** and **+ New mail order** | "Orders move through these steps. Approval decisions live on the assigned task." | — |
| 4 | Home | Point at the left panel: no **Analytics** | "There are no reports for mail order." | — |
| 5 | Pharmacy (Alex Kim) | Point at the extra **Store** tab, then open a mail order and point at **Mark paid** / auto-ship price controls | "Alex, the manager, can also mark an order paid, change an auto-ship's price or quantity, and resend abandoned carts." | A mail order and an auto-ship (none seeded yet) |

## Notes to check before recording

- **No demo data:** the stack has no mail orders or auto-ships. A seed is needed (the online-store training branch may have one).
- Fixed Nov 9 (RP-A17): the Analytics link is hidden for both roles.
- Checked Nov 9: both roles see Pharmacy tabs **Pharmacy, Move / Order, Mail Order Queue, Auto-ships**; the manager also sees **Store**. The queue is empty on the test stack.
- Owner, Nov 9 (RP-A13): both mail order roles may read client records.

## Closing

"The most common mistake is giving mail order staff a CL role to look up a client. Remember: the team fills and ships; the manager settles prices, refunds and carts."
