# INV-04. Split payment: gift card, account credit, then a card

- **Audience:** doctors, techs and CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V5 and INV-03.
- **The one thing to remember:** apply the gift card and credit first. The card takes only what's left.

## Why (opening)

"When a family has a gift card or credit with us, they shouldn't pay the whole bill by card. Use what they have first."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's Checkout page | Point at **Total** $162.00 | "The Riveras owe $162 today." | Rivera bill: Dental X-rays at the member price ($162) |
| 2 | Checkout | Point at the one thing to remember | "Gift card and credit first. The card takes what's left." | — |
| 3 | Checkout | Click **Gift card** | "Start with the gift card." | A $50 gift card |
| 4 | Gift card form | Type the code in **Gift card code** | "Type the 16-letter code from the card." | — |
| 5 | Gift card form | Click **Check balance** | "Check the balance." | — |
| 6 | Gift card form | Point at "••••PUX8 has $50.00" and **Use $** | "It has $50. Use all of it, or type a smaller amount." | — |
| 7 | Gift card form | Click **Apply gift card** | "Apply it." | — |
| 8 | Checkout | Point at "Took $50.00 from gift card ••••PUX8. $0.00 left on the card." and **Paid** $50.00 | "Scout says how much it took and what's left on the card." | — |
| 9 | Checkout | Click **Account credit** | "Next, their account credit." | Maria has $30 account credit |
| 10 | Account credit form | Point at "Account credit: $30.00 available" and **Use $** | "Scout fills in what they have, up to what's owed." | — |
| 11 | Account credit form | Click **Apply credit** | "Apply it." | — |
| 12 | Checkout | Point at "Used $30.00 of account credit. $0.00 credit left." and **Paid** $80.00 | "The credit is used, and the balance drops." | — |
| 13 | Checkout | Click **Card on file** | "The card takes only what's left: $82." | Maria's saved card (INV-03) |
| 14 | Checkout | Point at "Charged the card on file." and **Paid** $162.00 | "Three payments, one bill, all paid." | — |
| 15 | Clients, Maria Rivera, Ledger | Point at the invoice row: "Gift Card, Account credit, Visa •••• 4242" | "The ledger shows all three." | — |
| 16 | Ledger, an open invoice | Wait for **Card on file** to appear in **Method**, choose **Cash**, and point at **Amount** and **Cash received** | "To take part of a bill in cash or by check, use the ledger. Pick the method and type the amount. Card payments always take the whole balance." | A second open Rivera bill |

## What else you can do here

- **Cash** and **Check** (EMR V5).
- Pay links for the rest (EMR V15). A pay link asks only for what is left after the family's account credit (INV-13).

## What other roles see

- **Gift cards:** anyone who can take payment can redeem one.
- **Issuing a gift card** without an online purchase: managers, lead CLs and billing only.

## Closing

"The most common mistakes: charging the full bill to the card when the family has credit, and forgetting a gift card they brought. Remember: apply the gift card and credit first. The card takes only what's left."

## Notes from the check in the app (Nov 7, 2026; steps first checked Nov 6)

- **Pay-link change (Nov 6) checked:** it doesn't change any step here. The checkout takes credit with **Account credit**, as in step 9. Only the ledger's pay-link line changed (INV-13).
- **Checked:** steps 1 to 15 were run in Stripe test mode. The payments came out as $50 gift card, $30 account credit and $82 card.
- **Step 16 checked on screen:** the ledger's **Method** list reads "Card on file · Visa •••• 4242 · exp 11/27", "Card over the phone (virtual terminal)", Cash, Check, Gift card and Account credit.
  - Cash and Check come from the practice's payment types, which the demo seed now has (`invoicing-demo.sql`). With no payment types set up, the list would also offer CareCredit and Other instead.
  - Choosing **Cash** shows **Amount**, **Cash received** and **Record Cash**. (Choosing a card shows "Charges Visa •••• 4242 · exp 11/27 for $60.00." and **Charge card on file**.)
  - **Timing:** the saved card loads a moment after the ledger opens. If Cash is picked before **Card on file** has appeared in the list, the screen flips back to the card. The recording waits for it. A small rough edge in the app; reported.
- **Gift card code:** staff can see a gift card's code only through Gift cards, then reveal (managers and billing). The demo needs the code ready.
- **Ready to record.**

## Pass 1 dry run (Nov 7, 2026)

- **Script changes:** none to the steps. Bill is Maple's Dental X-rays at the member price ($162). Maria's saved Visa is made in Stripe test mode before the take; the gift card is issued through the API and its code is read from the test database.
- **Checked:** gift card $50, account credit $30, card on file $82, the ledger row "Gift Card, Account credit, Visa •••• 4242" and the Method list with **Cash**, **Amount** and **Cash received**.
- **Ledger look:** Maria's ledger also lists the demo $25 card invoice (#498) and the $30 credit row. That is the demo data; it is on screen but not narrated.
- Spec: `cypress/training/inv-04-split-payment.cy.ts`.
