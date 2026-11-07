# INV-10. Open balances, including old eVet invoices

- **Audience:** CLs and billing.
- **Length:** 2 minutes.
- **Watch first:** EMR V15.
- **The one thing to remember:** eVet balances came across. Collect them in Scout like any open invoice.

## Why (opening)

"Some families owed us money in eVet. Those bills came across to Scout, and collecting them is part of our everyday work."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Tom Chen, Ledger | Point at **BALANCE DUE** $140.00 | "Tom Chen's balance counts every open bill, Scout and eVet." | Chen household: one open Scout bill ($60) and one unpaid eVet invoice #48213 from Jun 10, 2025 ($80) |
| 2 | Ledger | Point at the one thing to remember | "eVet balances came across. Collect them like any open bill." | — |
| 3 | Ledger | Point at the row "#48213 · eVet · Open · $80.00 · Due $80.00" | "This one came from eVet." | — |
| 4 | Ledger | Click the eVet row | "Open it to see what it was for." | — |
| 5 | eVet invoice | Point at **Edit in Scout** | "To work on it in Scout, use Edit in Scout. Then take payment like any bill." | — |
| 6 | Ledger | Point at **Text pay link**: "Sends $140.00 for 2 unpaid invoices" | "Or send one pay link for everything, eVet included." | — |
| 7 | Voice-over | — | "Gift cards only pay Scout bills, not eVet ones." | — |
| 8 | Voice-over | — | "Very old balances: talk to billing. Writing a balance off is a billing decision, not a button." | — |

## What else you can do here

- **Email invoice** on the eVet invoice.
- **Email Ledger** (INV-08).

## What other roles see

- **Intended:** taking over or editing an eVet invoice is for managers and billing, and lead CLs on their own.
- **Today:** a plain CL also sees **Edit in Scout** and **Void** on an eVet invoice (see the notes).

## Closing

"The most common mistakes: telling a family their old eVet balance is gone, and using a gift card on an eVet bill. Remember: eVet balances came across. Collect them in Scout like any open invoice."

## Notes from the check in the app (Nov 6, 2026)

- **Checked as a CL:** steps 1 to 6. The eVet invoice offered **Email invoice**, **Edit in Scout** and **Void**.
- **Pay links take over eVet invoices:** sending a pay link takes over every unpaid eVet invoice into Scout first (in the app's code).
- **Permission not checked:** `invoice.legacy.adopt` isn't checked in the app or the API.
- **Demo data:** the eVet invoice was seeded with no line items. A real recording should give it lines so step 4 shows what it was for.
