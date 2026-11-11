# MEM-05. Owner signed up online: refund the visit

- **Audience:** CLs. Filmed as Casey Morgan (client liaison).
- **Length:** about 1½ minutes.
- **Watch first:** MEM-03.
- **The one thing to remember:** don't enroll them again. Just refund the visit.

> **Owner review, Nov 10, 2026:** opens on the Tasks page: the staff signup email and the task "Refund Juniper's visit — owner enrolled online" are how staff know; the refund runs from the chart, never the email.

## Why (opening)

"Some families sign up online right after a visit. Their membership is already paid, but the visit they just had still needs re-pricing, and the covered part refunded."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's chart, **Membership** | — | Why line | Juniper's wellness visit 4 h ago, paid $417.98 by Maria's saved test Visa (same lines as MEM-03). Juniper then enrolled online on Feline Foundations monthly (test subscription, started now, agreement on chart). Signed in as Casey Morgan (CL). Stripe test mode |
| 2 | Same | — | "Remember: don't enroll them again. Just refund the visit." | — |
| 3 | **Membership** | Point at the plan summary (Active, Visa ending 4242) | "Maria signed Juniper up online this afternoon. The plan is active and billed to her card." | — |
| 4 | **Membership** | Click **Owner paid — refund visit** | "Click Owner paid, refund visit." | — |
| 5 | **Refund Juniper's visit?** | Point at the dialog | "Scout explains: the membership fee isn't charged again, and nothing is refunded until you confirm." | — |
| 6 | Dialog | Click **Review the refund** | "Click Review the refund." | — |
| 7 | **Post-visit membership signup**, **2. Owner already paid** | Point at "…is already in Stripe at the monthly price. The first month or year is not charged again, and a second membership is not started." | "Scout already knows the plan. It isn't charged again, and no second membership starts." | — |
| 8 | **1. Choose invoices** | Tick this morning's visit ($417.98) | "Tick this morning's visit." | — |
| 9 | **3. Check the numbers** | Click **Calculate refund** | "Click Calculate refund." | — |
| 10 | Totals | Point at "The owner will see a one-time refund of $385.96 for services they already paid that this membership covers…" | "The covered part of the visit comes back to Maria. Nothing else changes." | — |
| 11 | **Covered by Membership - Feline Foundations - Monthly** | Point at the table | "These are the lines the plan now covers." | — |
| 12 | Footer | Click **Refund $385.96** | "Click Refund." | — |
| 13 | Receipt | Point at the receipt (refunded $385.96, client emailed) | "The receipt shows the refund back to the card Maria paid with, and that she's been emailed the breakdown." | — |
| 13b | Receipt | Click **Done** | "Click Done." | — |
| 14 | Voice-over | — | Closing line | — |

## What else you can do here

- An online signup that follows a visit also creates a staff task, "Refund <pet>'s visit — owner enrolled online",
  with the expected amount. This screen is where you work it.
- **Don't issue the refund automatically** re-prices the visit without moving money, for when you'll refund by hand.

## What other roles see

- Every visit role sees **Owner paid — refund visit** on a Stripe-billed member who hasn't had a visit refund, while a
  paid visit is inside the post-visit signup window.

## Closing

"The most common mistake is enrolling the pet again, which starts a second membership and a second charge. Remember: don't enroll them again. Just refund the visit."
