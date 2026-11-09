# MEM-25. Membership analytics, and linking a Stripe subscription by hand

> **Dry run:** passed Nov 9, 2026 (`mem-25-analytics-and-stripe-link.cy.ts`). Change: **Link** asks for the `sub_` id copied from Stripe (or the unmatched-subscriptions task); it doesn't search Stripe itself.

- **Audience:** managers (lead CLs for the Link part). Filmed as Robin Hale.
- **Length:** about 1½ minutes.
- **Watch first:** MEM-01.
- **The one thing to remember:** fix an unlinked membership with Link, never by starting a new subscription.

## Why (opening)

"Managers track signups, and after the move from Square some memberships need their Stripe subscription linked."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Analytics → Memberships** | — | Why line | Several signups across channels (from earlier takes) |
| 2 | Same | — | Remember line | — |
| 3 | Analytics | Point at **Total memberships**, **Client households with a member**, **Memberships by type** | "Totals, households, and plans." | — |
| 4 | Analytics | Point at **Memberships over time** / **By day** and **Channel** | "Signups over time, and where they came from." | — |
| 5 | Analytics | Point at **Sign-up card conversion** (cards given, clients converted, conversion rate) | "How many families given a sign-up card joined." | — |
| 6 | A member's chart | Point at **Stripe subscription · Not linked · Link** | "On the chart, a membership that isn't linked to Stripe shows Not linked." | A member with no `sub_` id |
| 7 | Chart | Click **Link** | "Link finds its subscription in Stripe and connects it." | Matching Stripe test subscription |
| 8 | Voice-over | — | Closing line | — |

## Closing

"The most common mistake is starting a second subscription to fix a missing link, which bills the family twice. Remember: fix an unlinked membership with Link, never by starting a new subscription."
