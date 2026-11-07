# INV-15. Manual discounts and employer promotions

- **Audience:** managers. The promotion step (8) is for everyone at checkout.
- **Length:** 2 minutes.
- **Watch first:** INV-02.
- **The one thing to remember:** only managers can lower a price, and every discount needs a reason.

## Why (opening)

"Discounts come straight out of margin, and they show up in the reports. A reason makes each one explainable later."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Tom Chen, Ledger, open invoice | Point at a line's price | "Tom's bill needs a goodwill discount." | Open Chen bill: Office exam $75. Signed in as Robin Hale (manager) |
| 2 | Invoice | Point at the one thing to remember | "Only managers lower a price, and always with a reason." | — |
| 3 | Invoice | Click the line's price (tooltip "Edit unit price") | "Click the price to change it." | — |
| 4 | Invoice | Type the new price, 60, and press Enter | "Type the new price." | — |
| 5 | **Why is this discounted?** | Point at "This note is saved on the discounts report with your name." | "Scout asks why." | — |
| 6 | **Why is this discounted?** | Type "Professional courtesy" | "Say why." | — |
| 7 | **Why is this discounted?** | Click **Apply discount** | "Apply it." | — |
| 8 | Invoice | Point at the line: the old price struck through and the new price below it | "The family sees the regular price and their discount." | — |
| 9 | Biscuit's Checkout page | Point at the promotion line: "<label> –$… <company> · <promotion>. Pending: confirm to apply it to this invoice (once per client)." | "If a family qualifies for an employer promotion, it waits at checkout on their first visit." | Chen household with an employer promotion, first visit |
| 10 | Checkout page | Click **Confirm promotion** | "Confirm it to apply it, once per client." | — |
| 11 | Voice-over | — | "Every discount appears in Analytics, under Credits & Discounts." | — |

## What else you can do here

- **A negative-price line** asks the same question and confirms with **Add discount**.

## What other roles see

- **CLs, techs and doctors** see prices but can't edit them.

## Closing

"The most common mistakes: discounting without a clear reason, and discounting a member line the plan already covers. Remember: only managers can lower a price, and every discount needs a reason."

## Notes from the check in the app (Nov 6, 2026)

- **From the code, not walked on screen:** the discount prompt, the promotion line and the report name. The ledger probe was cut for time; dry-run these before recording.
- **The permission check is on price changes:** the app checks `invoice.price.change` for price edits. The separate `invoice.discount.manual` permission isn't checked anywhere.
