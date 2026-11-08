# OSV-14. Gift cards: issue one, check a balance, see what's outstanding

- **Audience:** managers and lead CLs.
- **Length:** 2 minutes.
- **Watch first:** OSV-02.
- **The one thing to remember:** a gift card is money the practice owes until it's spent; issue one only with a reason.

## Why (opening)

"Gift cards are sold online and given out by the clinic. They're all on one page, with what's still owed on them."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy → **Store** → **Gift cards** (**Sold gift cards**), Robin | Point at the list: **Card**, **Status**, **Balance**, **Value**, **Paid**, **Bought by**, **For**, **Created** | "Every card, sold or issued." | The $50 card issued to Maria Rivera |
| 2 | Sold gift cards | Point at **Amount purchased**, **Amount used**, **Amount total outstanding** | "What was bought, what's been used, and what's still owed." | — |
| 3 | Sold gift cards | Point at the one thing to remember | "A gift card is money we owe until it's spent. Issue one only with a reason." | — |
| 4 | Sold gift cards | Type "Rivera" in **Last 4 or full code, name, email** | "Find a card by code, name or email." | — |
| 5 | Sold gift cards | Click **Issue gift card** | "To give one, for a service recovery or a raffle, click Issue gift card." | — |
| 6 | Issue | Fill **Amount**, **Recipient name**, **Recipient email**, **Message**, **Reason \*** ("Service recovery, raffle donation, …") | "The amount, who it's for, and the reason. The reason shows on the bookkeeping report." | — |
| 7 | Issue | Click **Issue gift card** | "Issue it." | — |
| 8 | Card | Point at **Adjust**, **Void card**, **Refund buyer**, **Email card**, **Print** | "From a card you can adjust, void, refund, email or print it." | — |

## What other roles see

- **Lead CLs** can issue an existing coupon but not create gift cards (check in the dry run).

## Closing

"The most common mistakes: issuing a card with no reason, and voiding a card the client already used. Remember: a gift card is money the practice owes until it's spent; issue one only with a reason."

## Notes from the check in the app (Nov 7, 2026)

- **Walked:** the **Sold gift cards** page as Robin (filters **All / Active / Scheduled / Used up / Void**, **Year**, the three totals, the list).
- **Not walked:** the **Issue gift card** window and the card's actions. The labels come from the code; walk them in the dry run.
- **Q6 withdrawn:** the totals come from each card's history. A card issued through **Issue gift card** counts as outstanding; the demo card showed $0.00 only because the first demo setup skipped its history. The setup now writes the "issued" entry.
