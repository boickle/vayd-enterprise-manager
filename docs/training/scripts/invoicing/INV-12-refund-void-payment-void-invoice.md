# INV-12. Refund, void a payment, or void an invoice: which one, and who

- **Audience:** everyone (a short explainer).
- **Length:** 2 minutes.
- **Watch first:** EMR V15.
- **The one thing to remember:** refund to give money back, void a payment to fix a recording mistake, and refund before you void a bill.

## Why (opening)

"Three buttons sound alike but do very different things. Picking the wrong one leaves money taken with nothing given back."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Maria Rivera, Ledger, the invoice | Point at **PAYMENTS** | "Here are the payments on this bill." | Rivera bill, an Office exam of $75: $55 on the card on file (Stripe test Visa) and $20 cash that was recorded on the wrong bill. Signed in as Robin Hale (manager) |
| 2 | Invoice | Point at the one thing to remember | "Refund gives money back. Void fixes a mistake. And refund before you void a bill." | — |
| 3 | Invoice | Click **Refund** next to the Visa payment | "Refund sends money back to the card through Stripe." | — |
| 4 | **Refund payment** | Point at "Refunds the client's card via Stripe.", **Amount (partial or full)** and **Reason (optional)** | "Partial is fine. A reason is optional here, but it's a good habit." | — |
| 5 | **Refund payment** | Click **Cancel** | "We won't refund now." | — |
| 6 | Invoice | Click **Void** next to the Cash payment | "Void is for a payment recorded by mistake, like cash typed on the wrong bill." | — |
| 7 | **Void payment** | Point at "Reason for voiding this payment?" | "It needs a reason." | — |
| 8 | **Void payment** | Click **Cancel** | "We'll leave it for now." | — |
| 9 | Invoice | Click **Void invoice**, point at the **Void invoice?** window, type a reason and click **Void** | "Now try to void the whole bill." | — |
| 10 | Invoice | Point at "This bill was paid by card ($55.00 still taken). Refund the card payment first, then void the invoice." | "Scout won't void a bill that's paid by card. Refund first." | — |
| 11 | Voice-over | — | "A voided bill shows its items as voided on the pet's chart. Reopen it to bill them again." | — |

Note: the card payment has **Refund** and no **Void**. Void is only offered on payments that didn't go through Stripe (cash, check, account credit).

## What else you can do here

- **Return items** when products come back (INV-11).
- **Edit** next to a payment (managers and billing) to correct its date or type.

## What other roles see

Checked on the same paid invoice as each login:

| Login | Refund (card) | Void (payment) | Void invoice | Return items |
|---|---|---|---|---|
| Practice manager (Robin Hale) | yes | yes | yes | yes |
| Doctor (on their own bill) | yes | yes | no | yes |
| Technician | yes | no | no | yes |
| Client liaison | yes | no | no | yes |

- By the permission list: **Void** (payment) is for managers, lead CLs, billing, and doctors on their own bills. **Void invoice** is for managers, billing and lead CLs on their own.
- **Refund** is open to every visit role on purpose: signing a family up for a plan after the visit re-rates a paid bill.
- Everyone sees Print and Email receipt.

## Closing

"The most common mistakes: voiding a paid bill instead of refunding, and using refund to fix a payment that was recorded wrong. Remember: refund to give money back, void a payment to fix a recording mistake, and refund before you void a bill."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, in Stripe test mode.

- **As the manager:**
  - The paid invoice shows **Refund** and **Edit** next to the Visa payment, and **Edit** and **Void** next to the cash payment.
  - **Refund payment** reads "Refunds the client's card via Stripe.", with **Amount (partial or full)**, **Reason (optional)**, "The bill comes down by the refund, so the client won't owe it again.", "They'll pay this another way (wrong card): keep it owed", **Full for this invoice**, **Process refund** and **Cancel**.
  - **Void** opens a **Void payment** window: "Reason for voiding this payment?", **Cancel** and **Void**. Voiding the $20 cash gave "Payment voided." and the bill showed Paid $55.00, Due $20.00.
  - **Void invoice** opens **Void invoice?** ("Enter a reason for voiding this invoice. Card payments must be refunded first; other payments on it will be voided too. Its items will stay on the pet's chart marked voided, and any membership benefits it used will be returned."). With the card payment still on it, the bill says "This bill was paid by card ($55.00 still taken). Refund the card payment first, then void the invoice."
- **Which roles see what** is in the table above, from each login's own view.
- **Wording:** the button is **Void**; the window is titled **Void payment**. The script says "Void" for the click.
- **Ready to record.**
