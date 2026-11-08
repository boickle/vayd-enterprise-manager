# Online Store and mail orders training videos

Scripts for the Scout go-live series on the online store, auto-ships and the mail order queue. Each video is 2 to 3 minutes and covers one task. Record them with `cypress/training/README.md`.

**Demo world**
- **Households:** the Riveras (Maria; Maple, Juniper and Pepper) and the Chens (Tom; Biscuit).
- **Staff:**
  - Dr. Avery Lane, licensed veterinarian;
  - Dr. Priya Shah, veterinarian;
  - Jordan Pike, technician;
  - Casey Morgan, client liaison;
  - Robin Hale, practice manager (also mail order manager);
  - Riley Brooks, mail order team.
- **Store catalog (invented):**
  - Dental chews, medium (30 ct), $24.99;
  - Joint support chews (60 ct), $36, monthly;
  - Heartworm & flea chewable, 22-44 lb (6 doses), $89, Rx;
  - Thyroid tablets 0.4 mg (90 ct), $38, Rx;
  - Gift card;
  - Gabapentin 100 mg capsules, controlled, never listed.
- **Setup:** run `cypress/training/setup/online-store-demo.cjs` once, right after `stack-up.sh` (see the review file, section 4).
- **Stripe:** card steps run in Stripe test mode (`TRAINING_STRIPE=test`) with Stripe's test cards.

These videos build on the invoicing series (INV-01, INV-03, INV-09, INV-10) and EMR V5.

| ID | Title | Audience | Priority |
|---|---|---|---|
| [OSV-01](OSV-01-shopping-as-a-portal-client.md) | Shopping the store as a portal client | CLs | Must |
| [OSV-02](OSV-02-guests-and-gift-cards.md) | Guests: gift cards and items without a login | CLs | Must |
| [OSV-03](OSV-03-fix-an-auto-ship-in-the-portal.md) | Help a client change, pause or fix an auto-ship | CLs | Must |
| [OSV-04](OSV-04-paying-a-balance-in-the-portal.md) | Paying an open bill in the portal, and old eVet bills | CLs | Must |
| [OSV-05](OSV-05-mail-an-item-from-the-visit.md) | Send an item by mail from the visit checkout | Doctors, techs | Must |
| [OSV-06](OSV-06-phone-order.md) | Take a phone order | CLs, mail team | Must |
| [OSV-07](OSV-07-doctor-approval.md) | Approve, send back or decline a prescription mail order | Doctors | Must |
| [OSV-08](OSV-08-fill-and-label.md) | Fill an order and print its label | Mail order team | Must |
| [OSV-09](OSV-09-second-check-and-ship.md) | Second check, then tell the client | Mail order team | Must |
| [OSV-10](OSV-10-reject-or-cancel-and-refund.md) | Reject or cancel an order, and refund | Mail order manager, lead CLs | Must |
| [OSV-11](OSV-11-auto-ships-list.md) | The Auto-ships list: payment problems, pause, edit | Mail team, billing | Must |
| [OSV-12](OSV-12-store-billing-tasks.md) | Billing tasks from the store | Billing, managers | Must |
| [OSV-14](OSV-14-gift-cards.md) | Gift cards: issue, check, outstanding | Managers, lead CLs | Nice |
| [OSV-15](OSV-15-list-an-item.md) | List an item in the store | Managers | Must |
| [OSV-16](OSV-16-coupons.md) | Coupons | Managers | Nice |

OSV-13 (abandoned carts), OSV-17 (Ecwid move) and OSV-18 (common mistakes) were cut by the owner on Nov 7, 2026.

**Status (Nov 7, 2026):** each script ends with "Notes from the check in the app". The full review, with questions, bugs and demo data, is in `docs/training/online-store.md`.
