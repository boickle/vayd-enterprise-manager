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
| [INV-16](INV-16-end-of-day.md) | End of day: today's payments, and the bank deposit | Techs, doctors, managers, billing, lead CLs (not plain CLs) | Must |
| [INV-17](INV-17-common-money-mistakes.md) | The most common money mistakes | All | Nice |
| [INV-18](INV-18-appointment-deposits.md) | Appointment deposits: ask by text or email, then use it at checkout | All who book (CLs mainly) | Must |
| [INV-19](INV-19-mark-deposit-required.md) | Mark a client "Deposit required" | Managers, billing, lead CLs | Must |
| [INV-20](INV-20-replace-or-remove-a-card.md) | Replace or remove a card on file, and an expired card | CLs, techs | Must |

**Status (Nov 7, 2026):** checked in the app on build-doctor-flow (frontend 5a13205, API 221ea76a) in Stripe test mode. Each script ends with "Notes from the check in the app" listing what was confirmed and any bugs.

| Script | Status |
|---|---|
| INV-01 | Ready to record. Do the Accept and earlier-decline checks in the dry run (Accept bug fixed Nov 6; not re-walked). |
| INV-02, INV-03, INV-14 | Ready to record. |
| INV-04 | Ready to record. Step 16 re-walked: wait for Card on file before choosing Cash. |
| INV-05 | Ready to record. Confirm in the dry run that the decline message clears after a good card (fixed Nov 6; not re-walked). |
| INV-06 | Ready to record. Use Juniper (no plan): estimates still ignore the member discount (app bug). Email steps need the Info or Field inbox. |
| INV-07 | Ready to record (rewritten around Find estimate and "Which visit is this for?"; every step walked). |
| INV-08 | Ready to record on a stack where the demo login has the Info or Field inbox. |
| INV-09, INV-10, INV-17 | Ready to record. |
| INV-11 | Ready to record (return-balance bug fixed; every step walked). |
| INV-12 | Ready to record (Void payment dialog and role views walked). |
| INV-13 | Ready to record, reloading the ledger after Add credit (app bug: the pay-link line is stale until reload). |
| INV-15 | Ready to record (manager's pencil, the discount window and the promotion walked). The Credits & Discounts report is admin-only, so it's not shown. |
| INV-16 | **Deposit steps ready; the "Today's payments" lists are not.** The deposit steps (Create deposit, slip, Recent deposits) were walked on a fresh seed. The **All payments** and **View payments** windows fail for a practice manager and list only old eVet payments, so the script no longer opens them (app bug, to fix on build-doctor-flow). |
| INV-18, INV-19 | **Recorded Nov 13, 2026 (Nova, 1.25×).** INV-18: 108 s, 6 clicks in sync. INV-19: 58 s, 2 clicks in sync. Shows D7 option 3 (deposit held for its visit) and the tidied deposit window. Specs `inv-18-appointment-deposits.cy.ts`, `inv-19-mark-deposit-required.cy.ts` reset Tom Chen themselves. |

**App bugs found Nov 7 (not fixed here; fixes go on build-doctor-flow):**
- Analytics, Payments: **All payments** and **View payments** call an admin-only endpoint that reads only old eVet payments (INV-16).
- Ledger: the pay-link line doesn't refresh after **Add credit** (INV-13).
- Ledger: an invoice's collapsed staff-only box still says "voided payments" and "voided by" for payments that were refunded in full (INV-11).
- Estimates still ignore the member discount (INV-06).
- eVet invoice **Void** shows for every role (INV-10).

**Demo data:** `cypress/training/setup/invoicing-demo.sql` (apply it to the test database after `demo-names.sh`, safe to run twice) adds the catalog items (DHPP vaccine, Dental chews, Prescription diet with lot DIET-2611, Nail trim, Dental cleaning, Dental X-rays, Biohazard disposal), Maple's plan, the Cash and Check payment types, the Operating account bank, today's Chen cash ($40) and check #1042 ($35) and Rivera card ($25) payments, Tom Chen's employer promotion, and his old eVet invoice #48213. Everything else (bills, estimates, credit, visits) is made by each video's spec.

## Saved cards changes (Nov 12, 2026, `build-doctor-flow` Wave 9)

The saved-cards fixes (PAY-C0 to PAY-C8 in vayd-api `docs/test-plans/invoicing-and-payments.md`) changed some screens these videos show. Re-recording is the owner's call.

| Video | What changed | Re-record? |
|---|---|---|
| [INV-03](INV-03-card-on-file.md) | The consent box at checkout (steps 2 and 12) now reads "Owner agrees we may keep this card on file and charge it for visits, refills, memberships and online store orders. Ask before you tap. Tick this box when they say yes." The **Card over the phone** box (step 6) uses the same staff sentence. The note "Stripe finds saved cards by email" is no longer true (PAY-C1): the spec's fresh-email workaround is harmless but no longer needed. | Yes: the old box text is on screen and narrated ("Untick it if they say no"; the box now starts unticked and you tick it on yes) |
| [INV-09](INV-09-what-the-client-sees.md) | The portal pay form's save box (step 7) now reads "Keep this card on file. Vet At Your Door may charge it for visits, refills, memberships and online store orders. You can ask us to remove it at any time." The saved-card list puts the card on file first (PAY-C4). | Yes, if step 7's box text is readable in the take; otherwise optional |
| [INV-17](INV-17-common-money-mistakes.md) | Step 6 points at the consent box, now the new staff wording. Narration ("saving a card without asking") is still right. | Optional |
| INV-04, INV-05 | No visible change. A saved card that has **expired** is now shown as "Expired, ending …" and can't be charged (PAY-C5), which these takes don't show. | No |
| All INV specs that call `giveSavedCard` (INV-04, INV-05, INV-11, INV-12, INV-17) | `invKit.ts` records the card under agreement `2026-10-07`. After `build-doctor-flow` is merged into this branch, that version is older than the current one (`2026-11-12`) and charging the card fails with "The client must re-consent…". **Change it to `2026-11-12` in the same merge.** The membership series' `memKit.ts` (and `mem-14`, `mem-19`) has the same string. | Spec fix, not a re-record |
| INV-03, INV-04, INV-05, INV-17 | **Card over phone** is now **Type card manually** (owner, Nov 12), with the note "Typed-in cards cost us a higher card fee than Tap to Pay. Use this when the reader isn't working, the card won't tap, or the owner isn't with you." Specs and narration updated on `training/invoicing-cards`. The euthanasia hold's "Take card over the phone" (EMR V9) is unchanged. | INV-03 and INV-05: yes. INV-04, INV-17: optional |
| New: [INV-20](INV-20-replace-or-remove-a-card.md) | Replace or remove a card on file, and an expired card. Covers one practice-wide card, Remove taking a card away everywhere, and the membership note. | New video |

Membership videos to check with the same changes: MEM-02 (the enrol box wording), MEM-06 (the portal signup now offers "Use Visa ending 1234"; its Help topic already has a `video_note`) and MEM-14 (cancel settlement now charges the card on file, PAY-C8).
