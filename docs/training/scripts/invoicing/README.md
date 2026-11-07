# Invoicing and payments training videos

Scripts for the Scout go-live series on invoicing and payments. Each video is 2 to 3 minutes and covers one task.
Record them with `cypress/training/README.md`.

**Demo world:**
- **Households:** the Riveras (Maria; Maple, Juniper and Pepper) and the Chens (Tom; Biscuit).
- **Staff:**
  - Dr. Avery Lane, licensed veterinarian;
  - Dr. Priya Shah, veterinarian;
  - Jordan Pike, technician;
  - Casey Morgan, client liaison;
  - Robin Hale, practice manager.
- **Stripe:** card steps run in Stripe test mode (`TRAINING_STRIPE=test`) with Stripe's test cards.

These videos are new. They build on these EMR videos, which are already recorded:
- V3, Orders, Checkout prep, the duplicate warning;
- V5, Household checkout and payment;
- V9 and V10, Euthanasia estimate, consent and Run Payment;
- V14, Weak signal;
- V15, Pay links, refunds, and why a paid invoice can't be voided.

| ID | Title | Audience | Priority |
|---|---|---|---|
| [INV-01](INV-01-charges-onto-the-invoice.md) | How charges get onto the invoice, and who does what | All | Must |
| [INV-02](INV-02-review-before-checkout.md) | Review the invoice before checkout | All | Must |
| [INV-03](INV-03-card-on-file.md) | Save a card and charge the card on file | All | Must |
| [INV-04](INV-04-split-payment.md) | Split payment: gift card, account credit, then a card | All | Must |
| [INV-05](INV-05-card-declined.md) | When a card is declined | All | Must |
| [INV-06](INV-06-make-and-send-an-estimate.md) | Make and send an estimate | Doctors, techs, CLs | Must |
| [INV-07](INV-07-estimate-to-invoice.md) | Turn an estimate into the invoice | Doctors, techs, CLs | Must |
| [INV-08](INV-08-email-invoice-receipt-ledger.md) | Email an invoice, receipt or household ledger | CLs | Must |
| [INV-09](INV-09-what-the-client-sees.md) | What the client sees in the portal | CLs | Must |
| [INV-10](INV-10-open-balances-and-evet.md) | Open balances, including old eVet invoices | CLs, billing | Must |
| [INV-11](INV-11-return-and-refund.md) | Return items and refund: card first, then account credit | Lead CLs, billing, managers | Must |
| [INV-12](INV-12-refund-void-payment-void-invoice.md) | Refund, void a payment, or void an invoice | All | Must |
| [INV-13](INV-13-account-credit.md) | Account credit: where it comes from and how it's used | Lead CLs, billing | Must |
| [INV-14](INV-14-reprice.md) | Reprice a bill after a membership signup or price change | All visit staff | Must |
| [INV-15](INV-15-manual-discounts.md) | Manual discounts and promotions | Managers | Nice |
| [INV-16](INV-16-end-of-day.md) | End of day: today's payments, and the bank deposit | Managers, billing, field staff with checks | Must |
| [INV-17](INV-17-common-money-mistakes.md) | The most common money mistakes | All | Nice |

**Status after the check in the app (Nov 6, 2026):** every script was walked or checked against the app on build-doctor-flow (including the unpushed Wave 7 change). Each script ends with "Notes from the check in the app" listing what was confirmed, what wasn't, and any bugs.
- **Don't record yet:** INV-07 (on hold, no way to attach an estimate to a visit) and INV-11 (the return balance bug).
- **Steps not yet seen on screen:** INV-12 (the Void payment step), INV-15 and INV-16 (the deposit steps and the analytics window) still have steps to dry-run.
