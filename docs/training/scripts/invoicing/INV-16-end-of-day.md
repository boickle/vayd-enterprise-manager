# INV-16. End of day: today's payments, and the bank deposit

- **Audience:** every CL, tech and doctor who takes cash or checks, plus managers and billing.
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V5.
- **The one thing to remember:** every check and cash payment goes into a deposit the same day.

## Why (opening)

"If you take any cash or check payment, you must deposit it this way, every day."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home, **Quick actions** | Point at **Create deposit** | "If you take any cash or check payment, you must deposit it this way, every day." | Today: Chen bill (Office exam $75) paid $40 cash and $35 check |
| 2 | Home | Point at the one thing to remember | "Keep the day's cash and checks together as one deposit, with the printed deposit slip, for the bank." | — |
| 3 | Quick actions | Click **Create deposit** | "Click Create deposit, under Quick actions." | Two deposit banks, "Skowhegan Savings" and "Bath Savings Institution" (made-up account numbers) |
| 4 | **Create deposit** | Point at "Grab undeposited cash and check payments into a posted deposit so they cannot disappear untracked." | "Every cash and check payment not yet deposited is listed here." | — |
| 5 | Create deposit | Open **Deposit to** and choose "Skowhegan Savings" | "Choose Skowhegan Savings or Bath Savings, whichever is closer to you." | — |
| 6 | Create deposit | Point at **Deposited on** (today's date is filled in) | "The date you take it to the bank." | — |
| 7 | **Undeposited payments** | Point at the two rows (Tom Chen, Avery Lane, Cash $40.00; Tom Chen, Check #1042, $35.00) and the columns Received, Client, Provider, Type, Check #, Invoice and Amount | "Each cash and check payment, and who it was for." | — |
| 8 | **Undeposited payments** | Tick the $40 cash and the $35 check | "Tick each payment going to the bank." | — |
| 9 | **Deposit slip draft** | Point at **CASH** $40.00, **CHECKS (1)** with #1042, and **TOTAL** $75.00 · 2 payments | "The slip lists each check, and the total should match what's in your hand." | — |
| 10 | Create deposit | Click **Create deposit** | "Create it." | — |
| 11 | **Deposit slip** | Point at "Deposit posted to Skowhegan Savings for $75.00 (2 payments)." and the slip: Bank, Account, CASH $40.00, CHECKS (1) #1042 Tom Chen $35.00, **TOTAL DEPOSIT** $75.00 | "Scout posts the deposit and shows the slip." | — |
| 12 | **Deposit slip** | Click **Print deposit slip** (then **Close**) | "Click Print deposit slip. Either bank accepts this printed slip, or even a slip of paper with our account number and the total you're depositing." | — |
| 13 | **Recent deposits** | Point at the new row: Nov 7, Skowhegan Savings, $75.00, 2 lines, posted, Robin Hale | "It's listed under Recent deposits, and the payments are gone from the undeposited list." | — |

**Deposit rules (owner, Nov 9, 2026).** Any cash or check payment must be deposited through **Create deposit**, every day, and kept together as one deposit with the printed slip. Choose Skowhegan Savings or Bath Savings, whichever branch is closer. Either bank accepts the printed slip, or a slip of paper with the account number and the total. The deposit must be created in Scout even when the printed slip isn't used. The closing line says this: "Even if you don't print the slip and use your own piece of paper, you must still create the deposit in Scout. Every cash and check payment goes into a deposit the same day."

**Deposits only (owner, Nov 8, 2026).** The video doesn't open Analytics. Its **All payments** and **View payments** lists are only for billing, practice managers, admins and the observer, so most staff won't see them.

## What else you can do here

- Filter undeposited payments by **From**, **To** and **Provider**, then **Refresh**.
- Add a **Note (optional)**.
- Reorder the checks on the slip with the up and down arrows.
- **Slip** on a deposit row reopens the slip.
- **Void** a deposit (managers only): the payments go back to the undeposited list.

## What other roles see

- **Create deposit** is for every CL, tech and doctor, plus managers and billing (owner, Nov 9, 2026). Anyone who takes cash or checks makes the deposit.
- **Void** on a deposit shows to managers only: a technician and a doctor saw the page with no Void.
- **The Payments report** needs the Payments report permission.

## Closing

"The most common mistakes: leaving checks in the car overnight, and leaving a cash payment out of the deposit. Remember: every check and cash payment goes into a deposit the same day."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, on a fresh copy of the test database with `cypress/training/setup/invoicing-demo.sql` applied.

- **Step 1 matches the screen:** on the fresh copy the card read Practice revenue $100.00 (the $75 cash and check plus the $25 card) and Total $100.00.
- **Deposit steps 3 to 13 match the screen.**
  - With the demo payments, the Undeposited payments list showed exactly the $40 Cash and the $35 Check (#1042), and ticking both gave CASH $40.00, CHECKS (1) #1042, TOTAL $75.00, 2 payments.
  - **Create deposit** gave "Deposit posted to Skowhegan Savings for $75.00 (2 payments)." and opened the deposit slip with **Print deposit slip** and **Close**. The list was empty afterwards, and the deposit showed under Recent deposits with **Lines**, **Slip** and **Void**.
  - **Why the first check found nothing:** the list only includes payment types marked "gets deposited". The demo had no Cash or Check payment types, so nothing was listed. `invoicing-demo.sql` now adds Cash and Check types (both deposited), the two deposit banks (Skowhegan Savings and Bath Savings Institution; earlier an "Operating account"), and today's Chen cash and check payments and Rivera card payment. It also sets aside old cash payments with no client left in the shared test database.
- **Roles:** the CL login no longer sees **Create deposit** (the menu item now follows the deposit permission). Technician and doctor saw the page. Void on a deposit was on the manager only.
- **Bug: the "Today's payments" lists don't work.**
  - On the Payments report, **All payments** shows "Failed to load payments for this day." and **View payments** (the "Payments for <date>" window) has no rows. The Square card on the same page shows "Request failed with status code 403".
  - Cause: both windows call `GET /analytics/payments/reconciliation`, which only admin logins may call (403 for the practice manager), and for an admin it lists only old eVet payments. Cash, Check and card payments taken in Scout aren't in it. (An admin login got an empty list with today's payments in place.)
  - The old steps 3 to 5 (open the list, read its columns, close it) are removed until this is fixed on build-doctor-flow. The **Today's Revenue** card's own totals do include Scout payments.
- **Also on that page:** the **Stripe Received Today** card totals every payment in the Stripe test account, which isn't just this demo. Crop it out or don't scroll to it.
- **Ready to record the deposit part (steps 1 to 13).** The "Today's payments" lists are blocked by the bug above.
