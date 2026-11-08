# OSV-03. Help a client change, pause or fix an auto-ship in the portal

- **Audience:** CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-01.
- **The one thing to remember:** "Payment failing" means the client updates the card in the portal; nothing else fixes it.

## Why (opening)

"Auto-ships keep pets on their medicine without a phone call. When a family calls about one, you'll walk them through the same window they see."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maria's portal, **Maple** | Point at **Medications**: "Heartworm & flea chewable, 22-44 lb (6 doses)", with the **Auto-ship** tag | "Maple's heartworm chewable is on auto-ship." | Maria's heartworm auto-ship for Maple, made at checkout (OSV-01 style) |
| 2 | Medications | Click **Manage** | "Manage opens it." | — |
| 3 | **Auto-ship** window | Point at "Next shipment Friday, May 7" and "1 × Heartworm & flea chewable … · every 6 months · $89.00 each" | "When it ships next, and what it costs." | — |
| 4 | Auto-ship | Point at **How often** (Every 6 months) | "She can change how often." | — |
| 5 | Auto-ship | Point at **Quantity per shipment** with **−** / **+** | "Or how many per shipment." | — |
| 6 | Auto-ship | Point at **Next shipment**, **Move date**, and "We bill and pack on this day, so it needs to be at least two days out." | "Or move the next date, at least two days out." | — |
| 7 | Auto-ship | Point at **Pause for a while** and **Cancel auto-ship** | "She can pause it, or cancel it." | — |
| 8 | Auto-ship | Point at **Order an extra now** | "Or order one extra right now." | — |
| 9 | Auto-ship | Click **Done** | "Done closes it." | — |
| 10 | Same window, card declined | Point at the red banner "Payment failing: update your card." with **Update card** | "If her card is declined, she sees this banner." | The auto-ship marked "failing" (training setup) |
| 11 | Auto-ship | Point at the one thing to remember | "Payment failing means one thing: update the card here. Nothing else fixes it." | — |
| 12 | Auto-ship | Click **Update card** | "Update card opens her card on file for this auto-ship." | — |
| 13 | Store top bar | Click **Auto-ship** | "She can also see all of her auto-ships here." | — |
| 14 | **Auto-ship items** | Point at each item: **Qty**, **Frequency**, **Pause**, **Cancel** | "Each one can be changed here too." | — |

## What else the client can do here

- **See all your auto-ship items** from the Auto-ship window.
- **Resume auto-ship** on a paused one.

## What other roles see

- Staff see the same auto-ship on **Pharmacy → Auto-ships**, with **Payment failing** under the **Payment problems** filter (OSV-11).
- When the card fails, the client also gets one email with a link to update the card.

## Closing

"The most common mistakes: cancelling an auto-ship when the card failed, and taking the new card number over the phone instead of having the client update it. Remember: Payment failing means the client updates the card in the portal; nothing else fixes it."

## Notes from the check in the app (Nov 7, 2026)

- **Walked:** Maria bought the heartworm chewable for Maple on auto-ship with her saved card. The portal's **Manage** window showed every label above. With the row set to "failing", the banner "Payment failing: update your card." and **Update card** appeared.
- **Not clicked:** **Update card**, **Pause for a while**, **Cancel auto-ship** and **Order an extra now**, which call Stripe. Do them once in the dry run.
- **Setting "failing" for the video:** set `online_store_subscriptions."paymentStatus"='failing'` on the auto-ship in the training database before step 10, and back to null after. (In real use the Stripe card-failed event sets it.)
- **Wording to confirm:** the **Auto-ship items** page shows the raw next-bill date (for example "next bill 2027-05-07") and "36.00 before tax" with no $. See the review file.
