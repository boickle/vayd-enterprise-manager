# PRC-01. Look up a price

- **Audience:** client liaisons, technicians and doctors.
- **Length:** 1 to 2 minutes.
- **Watch first:** none.
- **The one thing to remember:** Catalog shows the list price. Member prices and client discounts are applied on the bill, not here.

## Why (opening)

"When a family asks what something costs, Catalog has the answer in a few seconds, from the same price list the bill uses."

## Steps

Signed in as Casey Morgan (client liaison).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Any page | Click **Catalog** in the top bar | "Open Catalog." | — |
| 2 | Catalog | Point at "Type to search, or choose Show all to list every item." | "Search for what you need." | — |
| 3 | Catalog | Point at the one thing to remember (voice only) | "Remember: this is the list price. Discounts and memberships are applied on the bill." | — |
| 4 | Catalog | Type `Cerenia` in the search box | "Type part of the name." | Cerenia 24 mg tablet $9.50 |
| 5 | Catalog | Point at the row: Product · Cerenia 24 mg tablet · CER24 · $9.50 · tablet | "The client price, and what it's per." | — |
| 6 | Catalog | Click **Procedures** | "Filter to procedures, labs or products." | Nail trim $25, Office exam $75 |
| 7 | Catalog | Type `Nail` | "A nail trim." | — |
| 8 | Catalog | Point at Nail trim · $25.00 | "Twenty-five dollars." | — |
| 9 | Voice-over | — | "For a member or a family with a discount, add it to an estimate to see their price." | — |

## What else you can do here

- **Bundles**: package prices.
- **Show all** lists everything.

## What other roles see

- Anyone who can edit the catalog (the practice manager) sees cost, markup, fee and vendor too (PRC-02).

## Closing

"The most common mistakes are quoting the list price to a member, and quoting a medication's one-tablet price for a whole prescription. Remember: Catalog shows the list price; the bill applies discounts."

## Notes from the check in the app (Nov 9, 2026)

- Checked as Casey Morgan: columns Item, Client price, Unit, Status, Actions; no cost or markup.
- **Question Q3:** the "Client price" of Carprofen 100 mg caplet reads "$31.90 · tablet". That's the charge for one caplet once the $15 fee and the $31.90 minimum apply; the per-caplet price is $1.29. A liaison could easily quote $31.90 a tablet. **Fixed** on `fix/inventory-training` (owner, Nov 9): the price list shows the price per unit with "+ $15.00 fee per charge · $31.90 minimum charge" under it. Carprofen can be shown once the fix is merged.
- Clicking a row did nothing for a client liaison (no detail view).
