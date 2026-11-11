# MEM-02. Enroll a pet at the visit

- **Audience:** CLs, techs and doctors (every visit role can enroll). Filmed as Casey Morgan (client liaison).
- **Length:** about 2½ minutes.
- **Watch first:** MEM-01.
- **The one thing to remember:** Read the amount to the owner before you enroll, then collect it at checkout with the visit.
- **Changed Nov 10, 2026 (owner decisions):** the first month (or year) goes on today's visit invoice and is paid once at checkout; Stripe bills monthly plans from next month. A new card can be kept on file at enroll (owner's yes), so checkout can use it.

## Why (opening)

"When a family says yes to a membership during the visit, enroll the pet right there. The first month goes on today's bill, so the family pays once, at checkout."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's chart, **Membership** section | — | Why line (above) | Juniper (cat, 6 y), no plan, wellness visit in progress (open invoice: wellness visit, trip fee, FVRCP, Revolution Plus). Maria has no card on file. Signed in as Casey Morgan (CL). Stripe test mode |
| 2 | Same | — | "Remember: read the amount to the owner before you enroll, then collect it at checkout with the visit." | — |
| 3 | **Membership** | Click **Enroll in a plan** | "On Juniper's chart, in the Membership section, click Enroll in a plan." | — |
| 4 | **Membership agreement — client must sign** | Point at the title | "Hand the screen to the owner. They read the agreement first." | — |
| 5 | Agreement | Scroll the agreement text | "It covers each plan, the twelve-month commitment, and what happens if they cancel early." | — |
| 6 | Agreement | Tick **I have read and agree…** | "They tick that they agree," | — |
| 7 | Agreement | Draw in **Draw your signature** | "draw their signature," | — |
| 8 | Agreement | Type "Maria Rivera" in **Type your full legal name** | "and type their full name." | — |
| 9 | **Available membership plans** | Point at "Enrolling prices this visit at member rates and adds the first month (or the year) to today's invoice…" | "Enrolling prices today's visit at member rates, and adds the first month to today's invoice." | — |
| 10 | **Card for monthly billing** | Type "Maria Rivera" (name on card), then Stripe's test Visa 4242…, 12/34, 123, 27606 | "Monthly plans need a card for the months after. Maria doesn't have one on file, so she enters her card here. It isn't charged today." | Stripe test mode |
| 11 | Same | Tick **Owner is happy for us to keep this card on file…** | "Ask whether we can keep the card on file. When she says yes, tick the box. Then checkout can use the same card today." | — |
| 12 | Plan list | Point at **Membership - Feline Foundations - Monthly** | "Scout only lists plans for Juniper's species and age. Pick Feline Foundations, monthly, fifty-nine dollars." | — |
| 13 | Plan list | Click **Enroll** | "Click Enroll." | — |
| 14 | **Enroll in Membership - Feline Foundations - Monthly?** | Point at the dialog | "Scout confirms: fifty-nine dollars goes on today's invoice, and Stripe bills her card every month, starting next month. Read it to Maria." | — |
| 15 | Dialog | Click **Enroll & add $59.00 to the invoice** | "Click Enroll and add to the invoice." | — |
| 16 | **Membership** | Point at **Awaiting payment** | "Juniper is a member, and her benefits already apply to today's visit. Until the invoice is paid, the section says Awaiting payment." | — |
| 17 | Checkout | Point at the invoice lines, then the membership line | "At checkout, the wellness visit, trip fee and vaccine are covered, and the membership is a line on the same bill." | — |
| 18 | Checkout | Click **Card on file** | "Click Card on file. It's the card Maria just gave you," | — |
| 19 | Checkout | Confirm the charge | "and charge it once, for the visit and the first month." | — |
| 20 | Juniper's chart, **Membership** | Point at the summary | "Paid. Back on Juniper's chart, Awaiting payment is gone, and Stripe starts billing next month." | — |
| 21 | Voice-over | — | Closing line | — |

## What else you can do here

- The plan list shows only plans for the pet's species and age (like post-visit signup and the portal).
- With a card already on file, **Card on file · Visa ending 4242** is chosen for you; **A different card** opens the card box.
- Annual plans need no card at enroll: the year goes on the invoice.
- Leave **keep this card on file** unticked if the owner says no. The card is still saved for the membership's monthly
  billing, but checkout will ask for a card.
- **Cancel enrollment** (while Awaiting payment) takes the fee off the invoice and puts regular prices back. If the
  invoice is still unpaid after 7 days, the staff member who enrolled gets a task.
- **Post-appointment sign-up** (MEM-03) is the other way in, for a visit the owner already paid.

## What other roles see

- Every visit role (doctors, techs, CLs, billing) sees **Enroll in a plan**. Inventory managers and observers don't.

## Closing

"The most common mistakes: enrolling before the owner has heard the amount, and picking a plan for the wrong pet. Remember: read the amount to the owner before you enroll, then collect it at checkout with the visit."
