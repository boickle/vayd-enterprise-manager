# MEM-02. Enroll a pet at the visit

- **Audience:** CLs, techs and doctors (every visit role can enroll). Filmed as Casey Morgan (client liaison).
- **Length:** about 2½ minutes.
- **Watch first:** MEM-01.
- **The one thing to remember:** Enroll charges the card today and bills it every month after, so read the amount to the owner before you click.
- **Changed Nov 9, 2026 (owner decision):** Enroll now starts Stripe billing on a card; there's no counter-invoice fee.

## Why (opening)

"When a family says yes to a membership during the visit, enroll the pet right there, so today's visit gets member prices."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's chart, **Membership** section | — | Why line (above) | Juniper (cat, 6 y), no plan. Signed in as Casey Morgan (CL). Stripe test mode |
| 2 | Same | — | "Remember: Enroll charges the card today and bills it every month after, so read the amount to the owner before you click." | — |
| 3 | **Membership** | Click **Enroll in a plan** | "On Juniper's chart, in the Membership section, click Enroll in a plan." | — |
| 4 | **Membership agreement — client must sign** | Point at the title and hint | "Hand the screen to the owner. They read the agreement first." | — |
| 5 | Agreement | Scroll the agreement text | "It covers each plan, the twelve-month commitment, and what happens if they cancel early." | — |
| 6 | Agreement | Tick **I have read and agree…** | "They tick that they agree," | — |
| 7 | Agreement | Draw in **Draw your signature** | "draw their signature," | — |
| 8 | Agreement | Type "Maria Rivera" in **Type your full legal name** | "and type their full name." | — |
| 9 | **Available membership plans** | Point at "Enrolling prices this visit at member rates. Stripe charges the first month or year today on the card below, then bills it on its own…" | "Enrolling prices today's visit at member rates, and Stripe bills the membership from then on." | — |
| 10 | **Card for the membership** | Type "Maria Rivera" (name on card) | "Next, the card for the membership. If the family has a card on file, you can use it. Maria doesn't, so type the name on her card," | Maria has no card on file (setup) |
| 11 | **Card for the membership** | Type Stripe's test Visa 4242…, 12/34, 123, 27606 | "and the card number." | Stripe test mode |
| 12 | Plan list | Point at **Membership - Feline Foundations - Monthly** (cat · $59.00/mo); only cat plans for her age are listed | "Scout only lists plans for Juniper's species and age. Pick Feline Foundations, monthly, fifty-nine dollars." | — |
| 13 | Plan list | Click **Enroll** | "Click Enroll." | — |
| 14 | **Enroll in Membership - Feline Foundations - Monthly?** | Point at "…Stripe charges $59.00 today on the card entered below, then bills it every month on its own." | "Scout confirms the amount: fifty-nine dollars today, then every month. Read it to Maria." | — |
| 15 | Dialog | Click **Enroll & charge $59.00** | "Click Enroll and charge." | — |
| 16 | **Membership** | Point at the summary (Active, "Benefits are available right away.", Visa ending 4242) | "Juniper is a member. Benefits are available right away, and the membership is billed on Maria's card." | — |
| 17 | Voice-over | — | Closing line | — |

## What else you can do here

- The plan list shows only plans for the pet's species and age (like post-visit signup and the portal).
- **Post-appointment sign-up** (MEM-03) is the other way in: it re-prices a visit the owner already paid, refunds the
  difference and starts the subscription with a card.
- With a card on file, **Card on file · Visa ending 4242** is chosen for you; **A different card** opens the card box.
- If Stripe declines the card, nothing is enrolled and the message says why; try another card.

## What other roles see

- Every visit role (doctors, techs, CLs, billing) sees **Enroll in a plan**. Inventory managers and observers don't.

## Closing

"The most common mistakes: enrolling before the owner has heard the amount, and picking a plan for the wrong pet. Remember: Enroll charges the card today and bills it every month after, so read the amount to the owner before you click."
