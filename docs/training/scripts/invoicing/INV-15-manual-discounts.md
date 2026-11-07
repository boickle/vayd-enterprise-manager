# INV-15. Manual discounts and employer promotions

- **Audience:** managers. The promotion steps (9 to 11) is for everyone at checkout.
- **Length:** 2 minutes.
- **Watch first:** INV-02.
- **The one thing to remember:** only managers can lower a price, and every discount needs a reason.

## Why (opening)

"Discounts come straight out of margin, and they show up in the reports. A reason makes each one explainable later."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Tom Chen, Ledger, open invoice | Point at a line's price | "Tom's bill needs a goodwill discount." | Open Chen bill: Office exam $75, added from the catalog on the screen (so the regular price is kept for the strike-through). Signed in as Robin Hale (manager) |
| 2 | Invoice | Point at the one thing to remember | "Only managers lower a price, and always with a reason." | — |
| 3 | Invoice | Click the line's price (tooltip "Edit unit price") | "Click the price to change it." | — |
| 4 | Invoice | Type the new price, 60, and press Enter | "Type the new price." | — |
| 5 | **Why is this discounted?** | Point at "This note is saved on the discounts report with your name." | "Scout asks why." | — |
| 6 | **Why is this discounted?** | Type "Professional courtesy" | "Say why." | — |
| 7 | **Why is this discounted?** | Click **Apply discount** | "Apply it." | — |
| 8 | Invoice | Point at the line: the old price struck through and the new price below it | "The family sees the regular price and their discount." | — |
| 9 | Biscuit's Checkout page | Point at the promotion line: "Employer promotion –$20.00 · Northside Hospital · Employee welcome offer. Pending: confirm to apply it to this invoice (once per client)." | "If a family qualifies for an employer promotion, it waits at checkout on their first visit." | Chen household, first visit today, with the employer promotion in `invoicing-demo.sql`. Open bill: Office exam $75 |
| 10 | Checkout page | Click **Confirm promotion** | "Confirm it to apply it, once per client." | — |
| 11 | Checkout page | Point at the new line "Employer promotion – Northside Hospital" ($-20.00) and **Total** $55.00 | "The $20 comes off the total." | — |

## What else you can do here

- **A negative-price line** asks the same question and confirms with **Add discount**.

## What other roles see

- **CLs, techs and doctors** see prices but can't edit them: no pencil next to the price.
- **Confirm promotion** is for whoever is at checkout, not just managers.
- The **Credits & Discounts** report in Analytics (every discount, with its reason and who gave it) is for admin logins. The practice manager's Analytics doesn't list it, so this video doesn't show it.

## Closing

"The most common mistakes: discounting without a clear reason, and discounting a member line the plan already covers. Remember: only managers can lower a price, and every discount needs a reason."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, as the manager, CL, technician and doctor.

- **Steps 1 to 8 match the screen.**
  - Clicking the pencil (tooltip "Edit unit price"), typing 60 and pressing Enter opens **Why is this discounted?** with "This note is saved on the discounts report with your name.", **Cancel** and **Apply discount**.
  - After applying, the line shows $75.00 struck through with $60.00 under it; the invoice total is $60.00. (A line added through a script instead of the screen has no regular price, so nothing is struck through. The demo adds the line on the screen.)
- **Steps 9 to 11 match the screen.** The promotion reads "Employer promotion –$20.00 / Northside Hospital · Employee welcome offer. Pending: confirm to apply it to this invoice (once per client)." After **Confirm promotion**, the pending box is gone and the bill has an "Employer promotion – Northside Hospital" line of $-20.00: $75.00 became $55.00. The new line shows "Pick a provider" in its provider box; don't point at it.
- **Only the manager sees the pencil.** CL, technician and doctor logins showed none.
- **Old step 11 removed:** the Credits & Discounts report is limited to admin logins in the code (`role: ADMIN` in the Analytics tab list). The practice manager login doesn't see the tab, and the demo has no admin login to show it on screen.
- **The permission check is on price changes:** the app checks `invoice.price.change` for price edits. The separate `invoice.discount.manual` permission isn't used.
- **From the code, not walked:** a negative-price line asks the same question and confirms with **Add discount**.
- **Demo data:** the promotion is in `cypress/training/setup/invoicing-demo.sql`. It only shows on a client's first visit, so Tom Chen must have no earlier visit.
- **Ready to record.**
