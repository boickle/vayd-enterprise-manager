# MEM-21. Membership staff tasks

> **Dry run:** pending (shared recording queue). Scripted from `membership-renewal-task.service.ts`,
> `online-signup-membership.service.ts` and `post-visit-signup.service.ts`. These tasks come from scheduled jobs and
> Stripe webhooks, which are off on the test stack, so the spec creates matching tasks through the tasks API.

- **Audience:** lead CLs (practice managers watch the same tasks). Filmed as Robin Hale (manager); the demo world has
  no lead CL login.
- **Length:** about 1½ minutes.
- **Watch first:** MEM-17, MEM-19.
- **The one thing to remember:** membership problems come to the Lead Client Liaison queue as tasks. Work them every
  day.

## Why (opening)

"When something goes wrong with a membership (a failed payment, an email that didn't send, Stripe and Scout disagreeing), Scout doesn't stay silent. It opens a task."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Tasks** | — | Why line | Three tasks on the Lead Client Liaison queue, linked to the pet and client: "Follow up on Maple's failed membership payment by <date>"; "Tell Juniper's owner about the renewal: email not delivered"; "Refund Juniper's visit — owner enrolled online" |
| 2 | Same | — | Remember line | — |
| 3 | **Tasks** | Point at the list | "Membership tasks land on the lead client liaison queue. Managers watch them too." | — |
| 4 | Task | Open the failed-payment task | "A failed payment: the task gives the deadline." | — |
| 5 | Task | Click the linked pet | "The link goes straight to Maple's chart, where you change the card (MEM-17)." | — |
| 6 | Task | Open the email-not-delivered task | "A renewal email bounced: call or text the owner." | — |
| 7 | Task | Open the online-refund task | "An owner joined online after a visit: refund the visit (MEM-05)." | — |
| 8 | Task | Mark done | "When it's handled, close the task." | — |
| 9 | Voice-over | — | Closing line | — |

## What else you can do here

The other membership tasks Scout opens:
- "Choose <pet>'s renewal plan: <plan> is archived".
- "<pet> renewed on <plan> with no plan chosen".
- "Fix Stripe for <pet>: renewal price not updated".
- "<client> is inactive but <pet>'s membership is still active".
- "Stripe and Scout disagree on <pet>'s membership".
- "Match N Stripe membership subscriptions by hand".
- "Visit refund of $X failed for <pet>".
- An emailed signup agreement not signed 2 hours before its link expires.

## What other roles see

- CLs, techs and doctors don't get these unless a lead CL assigns one to them.

## Closing

"The most common mistake is leaving these for the end of the week, after a family's benefits have been paused for days. Remember: membership problems come to the Lead Client Liaison queue as tasks. Work them every day."
