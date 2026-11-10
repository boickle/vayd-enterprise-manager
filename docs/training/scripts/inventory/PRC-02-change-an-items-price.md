# PRC-02. Change one item's price

- **Audience:** practice manager.
- **Length:** 2 to 3 minutes.
- **Watch first:** INV-14 (reprice a bill).
- **The one thing to remember:** a new price reaches new charges only. Bills that are already open keep the old price until they're repriced.

## Why (opening)

"Prices change: a supplier raises a cost, or we decide to. One edit in Catalog updates every new invoice, estimate, Room Loader and the store."

## Steps

Signed in as Robin Hale. Dental chews go from $24 to $25.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Catalog | Type `Dental chews` in the search box | "Find the item." | Dental chews, medium (30 ct): cost $11, markup 218%, price $24, unit bag |
| 2 | Catalog | Point at the columns: Cost $11.00, Markup 218.2%, Price $24.00, Fee $0.00 | "You see cost, markup, price and fee." | — |
| 3 | Catalog | Click the item | "Open it." | — |
| 4 | Details | Point at the one thing to remember (voice only) | "Remember: a new price is for new charges. Open bills need Reprice." | — |
| 5 | Details | Point at **Cost × Markup % of cost = Price** and "$11.00 cost × 218% = $24.00 price" | "Price is cost times markup. Change one and the others follow." | — |
| 6 | Details | Type `25` in **Price** | "Type the new price." | — |
| 7 | Details | Point at "$11.00 cost × 227.27% = $25.00 price ($14.00 over cost)" | "The markup updates, so the next cost change keeps the same margin." | — |
| 8 | Details | Point at **Service fee** and **Minimum price** | "A fee is added once per line; a minimum is the least a line can cost." | — |
| 9 | Details | Click **Save catalog fields** | "Save." | — |
| 10 | Catalog | Point at "Saved" | "Saved." | — |
| 11 | Voice-over | — | "The item's History tab records who changed the price and when." | — |

## What else you can do here

- Change **Cost** or **Markup** instead; the price follows.
- **Shows in search at**: hide an item from one office.
- Scout warns when a price is below cost.

## What other roles see

- Everyone else sees the price list only (PRC-01).

## Closing

"The most common mistakes are expecting open bills to change by themselves, and typing a price below cost. Remember: a new price is for new charges; open bills need Reprice."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Robin Hale on Dental chews: the price saved as $25.00 with markup 227.27%, and Catalog said "Saved". The item window closes on save, and the list row still showed $24.00 until the search was run again (U11). Re-run the search before pointing at the new price.
- **Bug (B4): saving fails for any item whose Unit is Tablet, Capsule, mL, Gram or Package.** The screen offers those units and the units migration sets them on real items, but the API accepts only each, bottle, box, case, tube, vial, bag and other. The save shows "sellUnitType must be one of the following values: …" and nothing changes. It hit Cerenia (tablet) and the Carprofen cost review (STK-19). Most medications are affected. The video uses Dental chews (bag) until it's fixed.
- When the probe typed into the wrong box, Scout warned "Price $0.36 is below cost $3.60" (CAT-A13 works).
