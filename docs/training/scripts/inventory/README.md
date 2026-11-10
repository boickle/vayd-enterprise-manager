# Inventory, Catalog and Pricing training videos

Scripts for the Scout go-live series on stock (Pharmacy), the catalog and pricing. Each video is 2 to 3 minutes and covers one task.
Record them with `cypress/training/README.md`. The open questions, possible bugs and demo data are in `docs/training/inventory.md`.

This series replaces the two older drafts, `docs/training/inventory-tech-video-script.md` and `docs/training/inventory-doctor-video-script.md` (Nov 2, never checked in the app).

**Demo world** (`cypress/training/setup/inventory-demo.cjs`, run after `stack-up.sh`; safe to run again, it resets the demo stock):
- **Households:** the Riveras (Maria; Maple, Juniper and Pepper) and the Chens (Tom; Biscuit).
- **Staff:**
  - Jordan Pike, technician (default location: Raleigh office · Car);
  - Dr. Avery Lane, licensed veterinarian, inventory manager of **Dr. Lane home**, whose **Controlled safe** is her controlled drug location;
  - Dr. Priya Shah, veterinarian (Car 2), inventory manager of **Dr. Shah home**;
  - Sam Ortiz, technician and inventory manager of the Raleigh office;
  - Casey Morgan, client liaison;
  - Robin Hale, practice manager (plus an admin login for the admin-only Settings screens).
- **Offices:** Raleigh office (Main, Car, Car 2), Durham office (Main, Car), Dr. Lane home (Controlled safe), Dr. Shah home (Home, Car; its doxycycline lives only in the car, for STK-27).
- **Supplier:** Northline Vet Supply (made up).
- **Stripe:** the stack's fake Stripe. No video in this series takes a card payment.

**Where things are:** the top bar has **Catalog** (what we charge) and **Pharmacy** (stock). Pharmacy opens on Weekly Counts. Its menus depend on the role:
- clinical staff: **Move / Order** (Weekly Counts, Unbox, Move Items, Waste / Adjust, Transfer List, Order List);
- client liaisons: **Move / Order** shows only Order List (they don't count or unbox);
- doctors and inventory managers: **Setup** → First / Annual Counts;
- practice manager: also **Store**, **Mail Order Queue**, **Auto-ships**, **Manage** (Par Review, Cost Reviews, Reports) and **Setup** (Par Levels, First / Annual Counts, imports).

Reports are under **Analytics & Reports → Inventory**. A practice manager should go there through **Pharmacy → Manage → Reports**, not a saved link (see the review file, B2).

These videos build on videos already recorded:
- EMR V4, recording vaccine doses (the vaccine lot is picked in the dose, not at checkout);
- EMR V5, household checkout and payment;
- INV-01, how charges get onto the invoice;
- INV-11, return items and refund;
- INV-14, reprice a bill;
- OSV-08, fill a mail order (the mail-order lot picker);
- OSV-15, list an item in the store.

| ID | Title | Audience | Priority |
|---|---|---|---|
| [STK-01](STK-01-your-inventory-day-and-week.md) | Your inventory day and week | Tech, DVM | Must |
| [STK-02](STK-02-right-car-right-bottle.md) | The right car and the right bottle at checkout | Tech, DVM | Must |
| [STK-03](STK-03-bottle-not-listed.md) | The bottle isn't listed: Add lot, or "shelf not counted yet" | Tech, DVM | Must |
| [STK-04](STK-04-two-bottles-one-charge.md) | Two bottles for one charge | Tech, DVM | Must |
| [STK-05](STK-05-controlled-drug-at-the-visit.md) | Controlled drug at the visit: dose, bottle and "drawn up, not given" | DVM, Tech | Must |
| [STK-06](STK-06-unbox-a-shipment.md) | Unbox a shipment | Tech (anyone may) | Must |
| [STK-07](STK-07-transfer-list.md) | Restock your car from the Transfer List | Tech, DVM | Must |
| [STK-08](STK-08-move-items.md) | Move Items | Tech, DVM | Must |
| [STK-09](STK-09-waste-adjust.md) | Waste / Adjust: expired, broken or lost | Tech, DVM | Must |
| [STK-10](STK-10-waste-a-controlled-drug.md) | Waste a controlled drug | DVM, Tech | Must |
| [STK-11](STK-11-weekly-count.md) | Weekly count | Tech (DVM when covering) | Must |
| [STK-12](STK-12-expiring-report.md) | Expiring report and expired bottles | Tech, DVM | Must |
| [STK-13](STK-13-return-not-back-on-shelf.md) | A return that can't go back on the shelf, and controlled returns | CL, Tech, DVM | Must |
| [STK-14](STK-14-controlled-drugs-report.md) | Controlled Drugs report: match your doses to Vet Snap | DVM, CSD, Manager | Must |
| [STK-15](STK-15-vet-snap-patient-file.md) | The Vet Snap patient file every Thursday | DVM, Manager | Must |
| [STK-16](STK-16-count-your-controlled-safe.md) | Count your controlled safe (First / Annual Counts) | DVM, Manager | Nice |
| [STK-17](STK-17-controlled-drug-location.md) | Set a doctor's controlled drug location | Admin | Must |
| [STK-18](STK-18-order-list.md) | Order List: place and record an order | Inventory manager | Must |
| [STK-19](STK-19-cost-reviews.md) | Cost Reviews | Manager | Must |
| [STK-20](STK-20-par-levels.md) | Par levels | Manager | Must |
| [STK-21](STK-21-first-count-of-a-shelf.md) | First count of an uncounted shelf | Manager, Inventory manager | Must |
| [STK-22](STK-22-shrink-counts-activity.md) | Shrink, Count Report and Activity: who did what | Manager, CSD | Nice |
| [STK-23](STK-23-stale-lots.md) | Stale lots | Manager | Nice |
| [STK-24](STK-24-par-review-and-set-par-levels.md) | Par Review and Set par levels | Manager | Nice |
| [STK-25](STK-25-waste-and-count-alert-settings.md) | Settings: waste reasons, disposal methods, count alerts | Admin | Nice |
| [STK-26](STK-26-common-inventory-mistakes.md) | The most common inventory mistakes | All | Nice |
| [STK-27](STK-27-home-office-car-stock-ordering.md) | A home office that keeps its stock in the car: when it gets ordered | DVM, Manager | Must |
| [PRC-01](PRC-01-look-up-a-price.md) | Look up a price | CL, Tech, DVM | Must |
| [PRC-02](PRC-02-change-an-items-price.md) | Change one item's price | Manager | Must |
| [PRC-03](PRC-03-add-a-new-item.md) | Add a new item, lab or procedure | Manager | Must |
| [PRC-04](PRC-04-quantity-price-breaks.md) | Quantity price breaks | Manager | Must |
| [PRC-05](PRC-05-store-price-and-auto-ships.md) | Store price and auto-ships | Manager, store editors | Must |
| [PRC-06](PRC-06-hide-on-invoice-discounts-tax.md) | Hide on invoice, Exclude percentage discounts and tax level | Manager | Must |
| [PRC-07](PRC-07-bulk-price-change.md) | Bulk price change | Manager | Nice |
| [PRC-08](PRC-08-tagalongs-and-reminder-rules.md) | Tagalongs and reminder rules | Manager, DVM, Lead CL | Nice |
| [PRC-09](PRC-09-archive-an-item.md) | Archive or restore an item | Manager | Nice |
| [PRC-10](PRC-10-sales-tax-setting.md) | Sales tax setting | Admin | Nice |
| [PRC-11](PRC-11-client-discounts.md) | Client discount statuses and staff pricing | Admin | Nice |

**Status (Nov 9, 2026):** walked in the app on `training/inventory-scripts` (frontend from `training/videos` f26747d3, the same inventory code as `build-doctor-flow` 100fdc19) with the API on `build-doctor-flow` 17b5259a, against `vayd_api_test_inv`, by Cypress probes with no voice. Each script ends with "Notes from the check in the app".

**Owner answers (Nov 9):** every question in `docs/training/inventory.md` is answered, and the bugs and usability notes are fixed on `build-doctor-flow` (section 0 there). Merge `build-doctor-flow` into this branch before recording. Scripts rewritten for the fixes and not walked again yet: STK-06 (invoice photo), STK-14 (car dose), STK-16 and STK-21 (lot rows on counts). Walk them in the dry run.

**When to record (Q12):** the Must videos before go-live. The Nice videos (STK-16, STK-22 to STK-26, PRC-07 to PRC-11) after the first weeks of go-live, except STK-16 if doctors count their safes in week one.

**Before STK-05:** in-clinic injectables and controlled doses should have **Dispensed / prescribed (sent home with a label)** unticked in Catalog (the box was called Medication before Nov 10), or checkout asks for a sig (Q4). The demo's Buprenorphine already has it unticked.
