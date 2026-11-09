# MEM-14. Cancel a membership and settle paid vs used

- **Audience:** lead CLs, billing and managers (the roles that can cancel). Filmed as Robin Hale (practice manager).
- **Length:** about 1 minute (at 1.25×).
- **Watch first:** MEM-10.
- **The one thing to remember:** read the preview to the owner before you cancel. If they used more than they paid,
  the difference is charged to their card.
- **Changed Nov 9, 2026 (owner decisions):** no partial refund by default (the agreement stands); staff may refund the
  unused part as an exception with a reason; cancelling asks for confirmation; covered visit services now count.

## Why (opening)

"When a family cancels partway through the year, Scout compares what they've paid this membership year with the covered services they've used, and settles the difference."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's chart, **Membership** | — | Why line | Maple on Canine Foundations monthly (Stripe test subscription, one $69 invoice paid), nothing used yet. Signed in as Robin Hale (manager). Stripe test mode |
| 2 | Same | — | "Remember: read the preview to the owner before you click cancel. That one click charges or refunds their card." | — |
| 3 | **Membership** | Click **Cancel** | "Maria is moving out of our area, and wants to cancel Maple's plan. Click Cancel." | — |
| 4 | **Cancel Membership - Canine Foundations - Monthly** | Point at "…Under the membership agreement there is no partial refund, so the unused $69.00 is not refunded and nothing else is charged." | "First, the sentence the owner will see. Read it to her." | — |
| 5 | Totals | Point at **Paid this membership year $69.00 · Covered services used $0.00 · Unused (not refunded) $69.00** | "Paid this membership year, covered services used, and what's left unused. Under the membership agreement, the unused part isn't refunded." | — |
| 6 | Lines | Point at "Paid: Stripe membership invoice … · $69.00" | "Below that, each payment and each covered service that went into the numbers." | — |
| 7 | Exception box | Point at **Refund the unused $69.00 (exception)** | "Only if the practice decides to make an exception, tick Refund the unused part, and say why. It's recorded in the audit trail." | — |
| 8 | **Why is the owner canceling?** | Type "Moving out of the service area" | "Type why she's canceling." | — |
| 9 | Footer | Click **Cancel membership** | "Click Cancel membership." | — |
| 10 | **Cancel Membership - Canine Foundations - Monthly?** | Point at "Maple's membership ends now. Nothing is charged, and the unused $69.00 is not refunded (no partial refunds under the agreement)." | "Scout confirms what happens: the membership ends now, nothing is charged, and nothing is refunded." | — |
| 11 | Dialog | Click **Cancel membership** | "Click Cancel membership to confirm." | — |
| 12 | Maria's **Financial** tab | Point at the settlement record ("Cancellation settlement — unused $69.00 kept (no partial refund)") | "Scout opens Maria's account on the settlement record. The membership is inactive, Stripe billing stops, and she gets an email with the breakdown." | — |
| 13 | Voice-over | — | Closing line | — |

## What else you can do here

- When used is more than paid, the button reads **Cancel & charge $X** and charges the card on file.
- **Refund the unused $X (exception)** with a reason makes the button **Cancel & refund $X**; the refund goes to the
  card and the reason is in the audit trail.
- If the preview can't be worked out, you can still cancel after giving a reason ("We could not calculate the
  settlement…"); then settle by hand.
- An owner can also ask to stop at the end of the year from the renewal email (MEM-19). That has no settlement.

## What other roles see

- Only lead CLs, billing, practice managers and admins see **Cancel**. Doctors, techs and CLs don't.
- When a pet dies, everyone uses the death wrap-up instead (MEM-15).

## Closing

"The most common mistakes: cancelling in the Stripe dashboard, which Scout never hears about, and using Cancel when a pet has died. That has its own steps. Remember: read the preview to the owner before you cancel."
