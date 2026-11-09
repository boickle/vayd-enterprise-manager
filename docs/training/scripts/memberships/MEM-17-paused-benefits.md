# MEM-17. Paused benefits: failed payments and card disputes

- **Audience:** CLs (spot it, change the card); managers (resume). Filmed as Casey Morgan (CL), then Robin Hale
  (manager) for **Resume benefits**.
- **Length:** about 1 minute (at 1.25×).
- **Watch first:** MEM-01.
- **The one thing to remember:** while benefits are paused, charge regular prices.
- Includes the old MEM-18 (card disputes).

## Why (opening)

"If a member's payment fails, or they dispute a charge with their bank, Scout pauses the pet's benefits until it's settled."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's chart, **Membership** | — | Why line | Maple on Canine Foundations, benefits paused 2 days ago "Membership payment past due". Juniper on Feline Foundations, paused 5 days ago "Card dispute". Both Stripe test subscriptions. The pause is set in setup the way Stripe's webhook sets it. Signed in as Casey Morgan (CL) |
| 2 | Same | — | "Remember: while benefits are paused, charge regular prices." | — |
| 3 | **Membership** header | Point at **BENEFITS PAUSED** | "On Maple's chart, the Membership section says Benefits paused." | — |
| 4 | Pause box | Point at "Benefits paused since Nov 6, 2026. Membership payment past due. Charge this pet at regular prices until this is settled." | "It says since when, and why: the membership payment is past due. Charge regular prices until it's settled." | — |
| 5 | **Billing card** | Click **Change card** | "Maria's card expired. She gives you a new one. Click Change card." | — |
| 6 | Card form | Type "Maria Rivera" in **Name on card**, then Stripe's test Mastercard 5555 5555 5555 4444, 12/30, 123, 27606 | "Type the name on the card, and the new card number," | Stripe test mode |
| 7 | Card form | Click **Use this card for the membership** | "and click Use this card for the membership." | — |
| 8 | **Billing card** | Point at "Saved. Membership payments now go on this card." (card now Mastercard ending 4444) | "Saved. Membership payments now go on this card. When Stripe collects the missed payment, the benefits come back by themselves." | — |
| 9 | Pause box (as Robin Hale, manager) | Point at **Resume benefits** | "If Maria paid the missed month another way, a manager can turn benefits back on with Resume benefits." | — |
| 10 | Juniper's chart, pause box | Point at "Benefits paused since Nov 3, 2026. Card dispute… Resume benefits after you have settled the dispute… If the practice wins the dispute, Scout turns benefits back on by itself." | "Juniper's benefits are paused for a different reason: a card dispute. Settle it with the owner first. If the practice wins the dispute, benefits come back on their own." | — |
| 11 | Voice-over | — | Closing line | — |

## What else you can do here

- When a payment fails, Scout also emails the owner (with a 3-business-day deadline) and gives the lead CL queue a
  task. The owner can change the card themselves in the portal (MEM-20). These come from Stripe webhooks, which the
  test stack can't receive, so they aren't filmed.
- Adding a covered charge for a paused pet is refused: "This pet's membership benefits are paused… Charge this at
  the regular price."
- For a member still billed through Square, the button reads **Enter a card**: Stripe charges it today and Scout
  cancels Square.

## What other roles see

- Every visit role and billing can **Change card**. Only practice managers and admins see **Resume benefits**.

## Closing

"The most common mistake is giving a paused pet member prices anyway. Remember: while benefits are paused, charge regular prices."
