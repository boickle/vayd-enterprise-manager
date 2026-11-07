# INV-13. Account credit: where it comes from and how it's used

- **Audience:** lead CLs, billing and managers.
- **Length:** 2 minutes.
- **Watch first:** INV-04.
- **The one thing to remember:** credit pays at checkout. That includes credit from eVet, but only once eVet sync is off.

## Why (opening)

"Account credit is the family's money. They should see it used, not forgotten."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Maria Rivera, Ledger | Point at **BALANCE** | "This is the household balance. Credit counts against what they owe." | Signed in as Robin Hale (manager) |
| 2 | Ledger | Point at the one thing to remember | "Credit pays at checkout, including credit from eVet." | — |
| 3 | Ledger | Click **Add credit** (tooltip "Add a credit on this account") | "To add credit by hand, use Add credit." | — |
| 4 | **Account credit** window | Point at "Adds credit to this client's account balance." | "This adds money to the family's account." | — |
| 5 | **Account credit** window | Type 30 in **Amount** | "The amount." | — |
| 6 | **Account credit** window | Type the reason, for example "Goodwill for the late arrival" | "And why. It's saved with your name on the account ledger." | — |
| 7 | **Account credit** window | Click **Add credit** | "Add it." | — |
| 8 | Ledger | Reload the page off camera, then point at the new row: "Direct invoice · Scout", **Credit**, ($30.00), and the line under the pay-link buttons | "The credit shows on the ledger as a negative line. A pay link now asks only for what's left after the credit." | The reload matters: see the notes |
| 9 | Rivera Checkout page | Click **Account credit** | "At checkout, use it with Account credit." | An open Rivera bill |
| 10 | Account credit form | Point at "Account credit: $30.00 available" | "Scout shows what's available." | — |
| 11 | Account credit form | Click **Apply credit** | "Apply it." | — |
| 12 | Checkout | Point at "Used $30.00 of account credit. $0.00 credit left." | "And shows what's left." | — |
| 13 | Voice-over | — | "Credit also comes from returns, overpayments and eVet. Credit from eVet can only be spent once eVet sync is turned off. And if the credit covers the whole bill, Scout tells you to use Account credit instead of sending a pay link." | — |

## What else you can do here

- Return items to credit (INV-11).

## What other roles see

- **Add credit:** CLs and techs don't see the button. It's for managers, lead CLs and billing.
- **Using credit at checkout:** any visit role.

## Closing

"The most common mistakes: charging the card when the family has credit, and adding credit without a clear reason. Remember: credit pays at checkout, including credit from eVet, but only once eVet sync is off."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, as the manager.

- **Add credit still matches:** the window reads "Adds credit to this client's account balance.", with **Amount**, **Reason** and "Saved with your name on the account ledger." The app shows "Added $30.00 account credit." and the ledger gets a **Credit** row of ($30.00). The household balance is net of credit; for example, a $100 bill and $30 credit read **BALANCE DUE** $70.00. The **Account credit** button was hidden for the CL and tech logins on Nov 6.
- **Pay links changed (Nov 6 change, now checked):** the pay-link line under the buttons nets off the family's credit.
  - $30 credit and a $75 bill: "Sends $45.00 for the unpaid invoice ($30.00 account credit comes off first)". The text message offered "pay $45.00".
  - Credit covers the whole bill: the line reads "Their account credit covers this balance. Use Account credit on the bill instead of a pay link." and the **Email pay link** and **Text pay link** buttons are gone.
  - This replaces the Nov 6 note "pay links ignore credit".
- **Bug: the pay-link line is stale right after Add credit.** With $30 just added, the header said BALANCE DUE $70.00 but the line still read "Sends $100.00 for the unpaid invoice" until the page was reloaded (the credit is looked up only when the page loads or the unpaid total changes). The script reloads off camera before step 8. Reported; the fix goes on build-doctor-flow.
- **Not checked:** what staff see while eVet sync holds eVet credit, because the test practice has eVet sync off. Step 13 is narration only.
- **Ready to record,** with the reload in step 8.
