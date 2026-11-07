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
| 1 | Clients, Maria Rivera, Ledger, paid invoice | Point at **PAYMENTS** | "Here are the payments on this bill." | Rivera bill ($60) paid by card on file. Signed in as Robin Hale (manager) |
| 2 | Invoice | Point at the one thing to remember | "Refund gives money back. Void payment fixes a mistake. And refund before you void a bill." | — |
| 3 | Invoice | Click **Refund** next to the card payment | "Refund sends money back to the card through Stripe." | — |
| 4 | **Refund payment** | Point at the amount (partial or full) and the reason (e.g. Client request) | "Partial is fine. Give a reason." | — |
| 5 | **Refund payment** | Click **Cancel** | "We won't refund now." | — |
| 6 | Invoice | Point at **Void payment** | "Void payment is for a payment recorded by mistake, like cash typed on the wrong bill. It needs a reason." | A mistaken cash payment on the bill |
| 7 | Invoice | Click **Void invoice**, type a reason, and click **Void** | "Now try to void the whole bill." | — |
| 8 | Message | Point at "…Refund the card payment first, then void the invoice." | "Scout won't void a bill that's paid by card. Refund first." | — |
| 9 | Voice-over | — | "A voided bill shows its items as voided on the pet's chart. Reopen it to bill them again." | — |

## What else you can do here

- **Return items** when products come back (INV-11).

## What other roles see

- **Refund a card payment:** every visit role. A CL saw **Refund** next to the card payment.
- **Void payment:** managers, lead CLs, billing, and doctors on their own.
- **Void invoice:** managers, billing, and lead CLs on their own.
- **On a paid invoice, a CL saw:** Return items, Print, Email receipt and Refund. No **Void payment** and no **Void invoice**.

## Closing

"The most common mistakes: voiding a paid bill instead of refunding, and using refund to fix a payment that was recorded wrong. Remember: refund to give money back, void a payment to fix a recording mistake, and refund before you void a bill."

## Notes from the check in the app (Nov 6, 2026)

- **Checked:**
  - The CL's view of a paid invoice (Return items, Print, Email receipt, Refund).
  - The **Refund payment** panel and the void-invoice refusal: these are the same screens EMR V15 recorded on Nov 6.
- **Not seen on screen:**
  - The **Void payment** dialog and the manager, tech and doctor views of this bill: the probe for them timed out loading the invoice.
  - Which payments offer **Void payment**: the code shows it per payment for roles with `payment.void`.
- **Dry-run step 6 as the manager before recording.**
- **Message wording:** the void-invoice message is "This bill was paid by card ($… still taken). Refund the card payment first, then void the invoice." (from V15).
