# INV-02. Review the invoice before checkout

- **Audience:** doctors, techs and CLs.
- **Length:** 2 minutes.
- **Watch first:** INV-01.
- **The one thing to remember:** check that member pets show their plan prices, then read the total before you charge.

## Why (opening)

"Member families pay their plan price, and they notice when they don't. Thirty seconds of checking saves a refund and an apology."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's SOAP, Checkout panel | Point at the lines | "Before you take payment, read the bill top to bottom." | Maple on the Adult plan. Lines: Office exam, DHPP vaccine, Dental chews (taxable), Biohazard disposal (hidden on invoice, $8), Nail trim |
| 2 | Checkout panel | Point at the one thing to remember | "Check the plan prices, then read the total out loud." | — |
| 3 | Checkout panel | Point at **Office exam** and **DHPP vaccine**: a heart and **covered** | "A heart and covered means the plan pays for it." | — |
| 4 | Checkout panel | Point at **Nail trim**: $22.50, **Member 10%** | "Member 10% means the plan's discount on things it doesn't cover." | — |
| 5 | Checkout panel | Point at **Biohazard disposal**, tagged "Normally hidden: shown to client because it has a charge" | "Some items are normally hidden from the family. If one has a charge, they will see it, and Scout tags it so you know." | — |
| 6 | Checkout panel | Point at **Dental chews**: "Pick a lot" | "Products need a lot before checkout: pick one, or Existing stock." | — |
| 7 | Totals | Point at **Subtotal** $51.30 and **Sales tax** $1.19 | "Only taxable items, like the chews, are taxed." | — |
| 8 | Totals | Point at **Total** $52.49 | "Read this total to the family before you charge." | — |
| 9 | Voice-over | — | "If a member's lines are at full price, for example because they joined today, use Reprice. It has its own video." | — |

## What else you can do here

- **Reprice** (INV-14).
- Declining an item (INV-01).
- Payment (EMR V5, INV-03 and INV-04).

## What other roles see

- **Changing a price by hand:** only managers see the control (INV-15). Doctors, techs and CLs don't.

## Closing

"The most common mistakes: charging a member full price, and missing a hidden line that has a charge. Remember: check that member pets show their plan prices, then read the total before you charge."

## Notes from the check in the app (Nov 6, 2026)

- **Coverage choice:** there's no per-line control to choose coverage, so that step was removed. Coverage is applied when the item is added.
- **"Membership covered" totals row:** this row only appears after a Reprice. Covered lines added normally are $0 and don't make it appear, so it was taken out of this video. It's shown in INV-14.
- **Tax:** shown only as the **Sales tax** total, at 5.5% on the demo stack.
- **Totals:** checked on screen and in the database.
- **Status (Nov 7):** ready to record. None of the Nov 6 to 7 commits changes these screens; not re-walked on Nov 7.

## Pass 1 dry run (Nov 7, 2026)

- **Script changes:** none to the steps. The bill is built through the visit's orders (Office exam and DHPP covered; chews $21.60; Biohazard disposal $7.20 at the member price; Nail trim $22.50). The **Subtotal** row shows only when it differs from the total, and here it does ($51.30, tax $1.19, total $52.49), as the script says.
- **Checked:** the "Normally hidden: shown to client because it has a charge" tag, **Pick a lot** on the chews and "Record the dose given" on the vaccine all show. Because the vaccine and chews still need a dose and a lot, the panel says "2 items still need doses, scripts, or a lot picked" under the total.
- Spec: `cypress/training/inv-02-review-before-checkout.cy.ts`. No clicks in this video (only pointing); it runs about 70 seconds with a free voice, under the 2 minutes planned.
