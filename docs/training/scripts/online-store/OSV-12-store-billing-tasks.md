# OSV-12. Billing tasks from the store

- **Audience:** billing and managers.
- **Length:** 2 minutes.
- **Watch first:** OSV-11.
- **The one thing to remember:** every store money problem lands as a Billing task; work it the same day.

## Status

**Partly walked.** `cypress/training/setup/online-store-billing-tasks.cjs` (Q7) posts signed **test** Stripe events: Tom Chen's joint chews auto-ship for Biscuit fails for good, then Stripe ends it. Scout marked it **Ended: card failed** (walked: **Auto-ships → Payment problems**) and opened a Billing task, which sits in **Tasks → Unassigned** for the billing queue. The task screen itself wasn't opened; open it in the dry run. Rows 4 to 6 aren't set up by the script yet.

## Why (opening)

"When something goes wrong with store money, Scout doesn't stay silent. It opens a Billing task so a person follows up."

## Steps (from the code; not walked)

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Tasks** → **Unassigned**, a billing login | Point at the store task about Tom Chen | "Store problems land in the Billing queue." | Setup script: Tom's auto-ship ended |
| 2 | Tasks | Point at the one thing to remember | "Every store money problem is a Billing task. Work it the same day." | — |
| 3 | Task: auto-ship ended | Open it; then Pharmacy → Auto-ships → **Payment problems**: Tom Chen · Biscuit · Joint support chews · **Ended: card failed** | "A card kept failing and Stripe ended the auto-ship. Call the family." | Ended auto-ship (setup script) |
| 4 | Task: ignored charge refunded | Open it | "Stripe charged an auto-ship Scout had stopped. Scout refunded it. Tell the family." | Refunded charge |
| 5 | Task: auto-ship not set up | Open it | "The order went through but the auto-ship didn't start. Set it up with the family." | Not-set-up auto-ship |
| 6 | Task: cancel pending | Open it | "Stripe hasn't confirmed a cancel. Scout keeps retrying. Check it stopped." | Cancel pending |

## Closing

"The most common mistakes: leaving these tasks until the end of the week, and refunding again in Stripe when Scout already refunded. Remember: every store money problem lands as a Billing task; work it the same day."
