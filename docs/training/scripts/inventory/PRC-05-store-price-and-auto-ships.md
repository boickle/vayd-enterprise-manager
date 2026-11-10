# PRC-05. Store price and auto-ships

- **Audience:** practice manager and anyone who edits store prices.
- **Length:** 2 minutes.
- **Watch first:** OSV-15, PRC-02.
- **The one thing to remember:** read the auto-ship warning before you save. Those clients are repriced in Stripe and emailed within the hour.

## Why (opening)

"A store price change also changes every active auto-ship for that item, and each client gets an email about it. A typo here reaches clients' inboxes."

## Steps

Signed in as Robin Hale. Dental chews are on the store at $24 with two active monthly auto-ships (Maria Rivera and Tom Chen).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Catalog | Open **Dental chews, medium (30 ct)**, tab **Online Store** | "Open the item's Online Store tab." | Store on for the practice; Dental chews listed at $24; 2 active auto-ships |
| 2 | Online Store | Point at **Online store price** "Leave blank to use the catalog price." | "The store can have its own price." | — |
| 3 | Online Store | Point at the one thing to remember (voice only) | "Remember: read the auto-ship warning before saving." | — |
| 4 | Online Store | Type `26` in **Online store price** | "Say it goes to $26." | — |
| 5 | Online Store | Click **Save online store details** | "Save." | — |
| 6 | **Reprice auto-ships?** | Point at "2 auto-ships will be repriced and those clients emailed within the hour." | "Scout tells you exactly who's affected." | — |
| 7 | Reprice auto-ships? | Point at **Cancel** | "If that's not what you meant, cancel." | — |
| 8 | Reprice auto-ships? | Click **Save price** | "If it is, save." | — |
| 9 | Voice-over | — | "Within the hour, both auto-ships are repriced and the families are emailed." | — |

## What else you can do here

- **Listed on online store**, **Feature on the store home page**, description, category, picture, **Store availability**.

## What other roles see

- People with store listing access see this tab; others don't.

## Closing

"The most common mistakes are changing a price to test something, and not reading the warning. Remember: read the auto-ship warning before you save."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Robin Hale up to the warning, which reads exactly as written (CAT-05 works). **Save price** wasn't clicked.
- Scheduled jobs are off on the training stack, so no reprice or email happens there. Step 9 is voice-over.
- The training database had the online store switched off; the setup turns it on (`inventory.onlineStoreImplemented`).
