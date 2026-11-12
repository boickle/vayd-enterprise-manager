# OSV-11. The Auto-ships list: payment problems, pause, edit

- **Audience:** mail order team and billing.
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-03.
- **The one thing to remember:** check **Payment problems** every week; only managers change an auto-ship's price, quantity or item.

## Why (opening)

"Every auto-ship in the practice is on one list. A failing card shows up here before a pet runs out."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy → **Auto-ships**, Riley | Point at the rows: order, client, pet, item, price, frequency, **Active** | "Every auto-ship, with who it's for and how often." | Maria's two auto-ships (joint chews monthly; heartworm every 6 months) |
| 2 | Auto-ships | Point at the one thing to remember | "Check Payment problems every week. Only managers change price, quantity or item." | — |
| 3 | Auto-ships | Click **Payment problems** | "Payment problems shows failing cards, auto-ships Stripe ended, and cancels Stripe hasn't confirmed." | One auto-ship marked failing |
| 4 | Row | Point at **Payment failing** (others: **Ended: card failed**, **Cancel pending: Stripe not confirmed**) | "Payment failing: the card needs updating. Call the client. They can update it in the portal, or read you a new card." | — |
| 4a | Row | Click **Card**; type the card the client reads out; click **Use this new card** | "To enter it for them, click Card. Type in the new card. Saving it retries the missed charge right away." | Stripe test card 4242 |
| 4b | **Card for …** | Point at "Card updated to Visa ending 4242…" | "The card is updated." | — |
| 5 | Auto-ships | Click **Active**, then **Pause** on the joint chews | "Pause holds it, for a trip for example." | — |
| 6 | Pause | Point at **Resume on** | "Pick when it starts again." | — |
| 7 | Row | Click **Edit**, Riley | "Riley can change how often it ships." | — |
| 8 | **Edit auto-ship**, Riley | Point at **Item** and **Qty** (greyed out) and the note: "Looks wrong? On the order in the queue, use Re-send… to send it to the doctor with a note (prescriptions), or Mark pending and ask a manager (other items). Only managers change the item or quantity." | "Item and quantity are locked for the team. If they look wrong, don't ship it as is: send a prescription back to the doctor, or ask a manager." | — |
| 9 | Row | Click **Edit**, Robin | "Robin, a manager, can edit it." | Robin Hale |
| 10 | **Edit auto-ship**, Robin | Point at **Item**, **Qty**, **Frequency** and "Price differences charge the card on file, refund via Stripe, or add an account credit — and update Financials." | "A change in price charges or refunds the difference." | — |
| 11 | Edit | Click **Cancel** | "Close without changing." | — |
| 12 | Row | Point at **Cancel** | "Cancel stops an auto-ship for good." | — |

## What else you can do here

- Search by item, client or pet.
- **Paused**, **Cancelled** and **All** filters, and **Refresh**.

## What other roles see

- **Mail order team** (Riley): **Edit** opens the same window with **Item**, **Search catalog** and **Qty** greyed out and the note shown in step 8 (B4). Frequency and pause work.
- **When a pet dies**, its auto-ships stop by themselves at the death wrap-up. No email goes to the family.

## Closing

"The most common mistakes: cancelling when the card failed, instead of updating the card, and changing a price as a team member. Remember: check Payment problems every week; only managers change an auto-ship's price, quantity or item."

## Notes from the check in the app (Nov 7, 2026)

- **Walked:** the list as Riley (**Active / Paused / Cancelled / Payment problems / All**; **Edit / Pause / Card / Cancel**) and the **Edit auto-ship** window as Robin.
- **Not clicked:** **Pause**, **Card** and **Save changes**, which call Stripe. Do them in the dry run.
- **Nov 10, 2026:** owner: staff may take a new card by phone and enter it with **Card**; saving retries the missed charge (Stripe). Walked as a CL: Card updated to Visa ending 4242. The training stack gets no Stripe events, so the spec clears "Payment failing" itself after the save.
- **B4 fixed (owner, Nov 7):** walked live on Nov 8 as Riley: Item and Qty greyed out, with the note. Ships with the next push to build-doctor-flow.
- **Demo data:** mark one auto-ship "failing" for step 3 (`"paymentStatus"='failing'`).
- **Nov 11, 2026 (owner):** the Auto-ships tab shows a red count of auto-ships with a payment problem (card failing, cancel not confirmed, or ended by Stripe in the last 30 days); new line `s01b-badge` points at it.
