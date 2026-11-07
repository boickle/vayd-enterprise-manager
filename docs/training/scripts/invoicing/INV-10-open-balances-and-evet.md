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
| 6 | Ledger | Point at **Text pay link**: "Sends $140.00 for 2 unpaid invoices" | "Or send one pay link for everything, eVet included." | The Chens have no account credit, so the line shows the full $140.00 |
| 7 | Voice-over | — | "Gift cards only pay Scout bills, not eVet ones." | — |
| 8 | Voice-over | — | "Very old balances: talk to billing. Writing a balance off is a billing decision, not a button." | — |

## What else you can do here

- **Email invoice** on the eVet invoice.
- **Email Ledger** (INV-08).

## What other roles see

- **Edit in Scout** and **Return items** follow the owner's Nov 6 decision: every role except observers can take over an eVet invoice, so a plain CL sees **Edit in Scout**.
- **Void** shows on an eVet invoice to every role (see the notes).
- If the family has account credit, the pay-link line adds "(… account credit comes off first)" and asks for less; if the credit covers everything, the pay-link buttons are replaced by "Use Account credit on the bill instead of a pay link." (INV-13).

## Closing

"The most common mistakes: telling a family their old eVet balance is gone, and using a gift card on an eVet bill. Remember: eVet balances came across. Collect them in Scout like any open invoice."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, as a CL.

- **Steps 1 to 6 match the screen.** With a $60 Scout bill and the old eVet invoice, the ledger read **BALANCE DUE** with the row "Jun 10, 2025 · #48213 · eVet · Open · $80.00 · Due $80.00" and "Sends $140.00 for 2 unpaid invoices". Opening the row shows "eVet invoice #48213", **Email invoice**, "Imported from eVet. The first edit, return, or void is handled in Scout from then on — eVet will not overwrite it.", the line "Annual wellness exam, 1, $80.00", **Edit in Scout** and **Void**.
- **Pay links take over eVet invoices:** sending a pay link takes over every unpaid eVet invoice into Scout first (in the app's code).
- **Pay links and credit:** the pay-link line now takes the family's account credit off first. See INV-13. It doesn't change this video, because the Chens have no credit.
- **Possible bug: Void on an eVet invoice** isn't tied to the void permission: the button shows for every role (the code only hides **Edit in Scout** and **Return items** by permission). I didn't press it.
- **Demo data:** `invoicing-demo.sql` now adds the eVet invoice #48213 with its line (the first check had none). The $60 Scout bill is made in the spec.
- **Ready to record.**

## Pass 1 changes (Nov 7, 2026)

- The Scout bill is Biscuit's $75 Office exam, so the ledger reads $155.00 (not $140.00) and the pay-link line reads "Sends $155.00 for 2 unpaid invoices". The voice doesn't quote totals.
- **Void on an eVet invoice is fixed:** as a client liaison, only **Edit in Scout** shows; no **Void**. Update "What other roles see" and remove the old note.
