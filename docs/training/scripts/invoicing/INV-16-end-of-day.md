# INV-16. End of day: today's payments, and the bank deposit

- **Audience:** managers and billing, plus field staff who bring back checks or cash.
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V5.
- **The one thing to remember:** every check and cash payment goes into a deposit the same day.

## Why (opening)

"Cash and checks are the payments most likely to go missing. A same-day deposit means every one is accounted for."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Analytics, **Payments** ("Payments Analytics — Payments collected by day, method, and doctor.") | Point at the revenue card for today (it's titled **Today's Revenue** when the day shown is today) | "Start with today's payments." | Today: Chen bill paid $40 cash and $35 check (#1042); a Rivera card payment. Signed in as Robin Hale (manager), who has the Payments report |
| 2 | Payments | Point at the one thing to remember | "Every check and cash payment goes into a deposit the same day." | — |
| 3 | Payments | Click **Today's Revenue** | "Open today's list." | — |
| 4 | **Payments for <date>** | Point at the columns: Client, Invoice, Payment type, Provider, Received, and Payment (vs VSD) | "Each payment, who it was for, and how it was paid." | — |
| 5 | **Payments for <date>** | Click **Close** | "Close it." | — |
| 6 | Left menu | Click **Create deposit** | "Now the deposit." | A deposit bank account, for example "Operating account" |
| 7 | **Create deposit** | Point at "Grab undeposited cash and check payments into a posted deposit so they cannot disappear untracked." | "Every cash and check payment not yet deposited is listed here." | — |
| 8 | Create deposit | Choose the bank in **Deposit to** | "Choose the bank account." | — |
| 9 | Create deposit | Point at **Deposited on** | "The date you take it to the bank." | — |
| 10 | **Undeposited payments** | Tick the $40 cash and the $35 check | "Tick each payment going to the bank." | — |
| 11 | **Deposit slip draft** | Point at the checks list, check #1042, and **TOTAL** | "The slip lists each check, and the total should match what's in your hand." | — |
| 12 | Create deposit | Click **Create deposit** | "Create it." | — |
| 13 | **Recent deposits** | Point at the new deposit, and print the slip | "Print the slip for the bank." | — |

## What else you can do here

- Filter undeposited payments by **From**, **To** and **Provider**.
- Add a **Note (optional)**.
- **Void a deposit** (managers only): the payments go back to the undeposited list.

## What other roles see

- **Field staff** can create a deposit for the checks they carry.
- **The Payments report** needs the Payments report permission.

## Closing

"The most common mistakes: leaving checks in the car overnight, and leaving a cash payment out of the deposit. Remember: every check and cash payment goes into a deposit the same day."

## Notes from the check in the app (Nov 6, 2026)

- **Checked as the manager:**
  - The deposit page text matches steps 6 to 13. On screen the summary is headed "DEPOSIT SLIP DRAFT", with CASH, CHECKS ("None selected"), TOTAL and "0 payments".
  - The undeposited payments list reads "Filter by date and line-item provider, then check payments to include", with the columns Received, Client, Provider, Type, Check #, Invoice and Amount, and a **REFRESH** button.
  - Recent deposits reads "No deposits yet."
- **Needs a follow-up before recording.** A $40 cash and a $35 check payment, recorded today through the API on a counter invoice, did **not** appear: the list said "No undeposited payments match these filters." So steps 10 to 13 weren't walked. Check whether the list needs a provider on the line, a visit invoice, or payments taken through the screen.
- **What a tech and a CL saw:** the tech login saw the full Create deposit page. The CL login showed only the menu item; the page didn't render its form.
- **Analytics:** "Today's Revenue", the "Payments for <date>" window and its columns are from the code, not seen on screen. The page loaded with "Revenue (range)" cards.
