# PRC-04. Quantity price breaks

- **Audience:** practice manager.
- **Length:** 2 minutes.
- **Watch first:** PRC-02.
- **The one thing to remember:** the ranges must meet end to end, with no gaps and no overlaps.

## Why (opening)

"Families who buy six months of a preventive at once get a better price per dose. Price breaks do that at checkout automatically. eVet's breaks weren't imported, so they're entered here by hand."

## Steps

Signed in as Robin Hale. Simparica Trio already has breaks; adding them to Cerenia.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Catalog | Open **Simparica Trio chewable, 22-44 lb**, tab **Pricing** | "Here's an item with breaks." | Simparica breaks 1-2 $28, 3-5 $26.50, 6-11 $25, 12-999 $23.50 |
| 2 | Pricing | Point at **Quantity price breaks (practice)**: Low Qty, High Qty, Price | "One to two at $28, three to five at $26.50, and so on." | — |
| 3 | Pricing | Point at the one thing to remember (voice only) | "Remember: the ranges meet end to end." | — |
| 4 | Pricing | Point at 2 → 3, 5 → 6, 11 → 12 | "Each range starts right after the last one ends." | — |
| 5 | Catalog | Open **Cerenia 24 mg tablet**, tab **Pricing** | "Now a new one." | — |
| 6 | Pricing | Click **Add price break** | "Add price break." | — |
| 7 | New price break | Type `1` in **Low quantity**, `9` in **High quantity**, `9.50` in **Price** | "One to nine at the regular price." | — |
| 8 | New price break | Click **Create price break** | "Create it." | — |
| 9 | Pricing | Click **Add price break**, type `10`, `999`, `8.75`, **Create price break** | "Ten and up at $8.75." | — |
| 10 | Voice-over | — | "At checkout, ten or more tablets on one line get the lower price." | — |

## What else you can do here

- **Edit**, **Delete** and **Active** on each break.
- **Markup, % of cost (optional)** instead of a fixed price.

## What other roles see

- Only people who can edit the catalog.

## Closing

"The most common mistakes are leaving a gap between ranges, and typing the total for the pack instead of the price per unit. Remember: the ranges meet end to end."

## Notes from the check in the app (Nov 9, 2026)

- Checked as Robin Hale: the Simparica table and the **New price break** form (Low quantity, High quantity, Price, Markup, % of cost (optional), Active, **Create price break**, Cancel) are as written. Creating a break wasn't clicked.
- The editor refuses overlapping or inverted ranges (CAT-A1/A2); try one in the dry run to see the message, if you want to show it.
- The Pricing tab also shows **Prices by branch**. Don't touch it: branch prices aren't tested yet (CAT-A4).
