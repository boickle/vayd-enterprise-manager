# Online Store and mail order training videos: review (Nov 7, 2026)

**Update, Nov 8: second round of fixes (fix branch `fix/osv-review-2`).**
- **B4:** the mail team's **Edit auto-ship** shows **Search catalog**, **Item** and **Qty** greyed out, with the note "Looks wrong? On the order in the queue, use Re-send… to send it to the doctor with a note (prescriptions), or Mark pending and ask a manager (other items). Only managers change the item or quantity." (frontend `0862fbc`; 2 tests). Walked live as Riley.
- **Doctor can lower the quantity (owner):** on the approval task for an online store order, **Quantity to approve** can go down, never up. Scout refunds the difference to the card (or the account credit used) and notes it on the order (vayd-api `f7edfd2e`, 3 tests; frontend `5ea5002`, `9cc49c6`). Orders from a visit or direct invoice are changed on their bill. Walked live: 1 of 3 thyroid bottles approved, $76.00 refunded in Stripe test mode.
- **B5:** **Place order** waits until the client's details have loaded, and a "fill this in" message clears itself once they arrive (frontend `bd67207`; 2 tests).
- **B6:** `demo-names.sh` gives the Riveras and the Chens 10-digit phones.
- **Q8 walked:** thyroid is lot-tracked in the demo. Riley's fill shows **Lot TH24117 · exp 2027-09-04 · QOH 6** already chosen, and **Finish filling** lists it (OSV-08 step 7).
- **Found on the way, owner answers (Nov 8):**
  - **B7 (fix):** two cart updates for the same email at the same moment made the API fail with a duplicate key on `store_cart_snapshots_open_email` (seen once during OSV-01). Now the second update updates the cart the first one saved.
  - **Tax on refunds (fix):** a rejected item, or units a doctor takes off, now refund their sales tax too, at the rate on the order's bill. Scout records the refunded units as a return on the store order's Scout bill, settled at once, so the Sales & Tax report takes the sale and its tax off the online store column in the month of the refund.
  - **Add lot on the fill screen (keep):** the mail team may create a lot with a quantity on hand.
- **Recording:** the client panel's **Recent texts** shows "Request failed…" on the training stack because it has no texting key, on purpose. Keep it out of frame.
- **Recording on a busy Mac:** when another session's Cypress uses Electron at the same time, our page loads hang. The probes ran in Chrome (`OSV_BROWSER=chrome`).

**Update, Nov 7 (late): owner answers and fixes.**
- **Fixed on `build-doctor-flow` (fix branch `fix/osv-review`; pushed once the tests below pass):**
  - **B1:** **Mail order** on a direct invoice works (frontend `511d26f`). Walked live.
  - **B2:** guests see the login rule on prescription and pet items, and are never offered auto-ship (frontend `4bbcf9c`, `c679eed`; 3 tests). Walked live.
  - **B3:** approval tasks are created, and failures are no longer hidden (vayd-api `2a2efb9f`; 2 tests). The cause was bigger than the stack: staff logins carry no office ids, so every staff-sent approval task failed the task office check. Walked live: Dr. Lane got the task.
  - **Q2:** inventory managers no longer approve prescription mail orders (vayd-api `ef3621f6`; test).
  - **Q3:** the online store doesn't tax shipping, at checkout, in the cart estimate or on the invoice line (vayd-api `a9b1856a`, frontend `c679eed`; test). Totals in OSV-01 and OSV-02 are recomputed.
  - **Q4:** checking your own fill needs a typed reason, saved on the order (vayd-api `cda4ccaa`, frontend `a179f05`; 3 tests).
- **Answered, no change:** Q1 (phone orders on a direct invoice, so OSV-06 as written), Q5 (no Mark paid video), Q6 (withdrawn: a demo-data mistake).
- **Demo setup (Q7, Q8):**
  - `online-store-billing-tasks.cjs` posts signed **test** Stripe events. Tom's auto-ship ends and Scout opens the Billing task (walked).
  - `online-store-demo.cjs` now issues the gift card with its history, makes the thyroid tablets lot-tracked with a lot in Raleigh office (not walked yet), and sets leftover test staff inactive.
  - The training API must run with `CONTROL_DB_ENABLED=false` for the webhook secret.

Scripts: `docs/training/scripts/online-store/` (15 videos: OSV-01 to 12, OSV-14 to 16).

**How they were checked:** on a training stack of its own:
- frontend `training/videos` at `13460af`, which includes the store fixes;
- API on `build-doctor-flow` at `48dc74ab`;
- database `vayd_api_test_osv`; API :3240 and app :5240; Redis database 15;
- **Stripe test mode** with Stripe's test cards, and EasyPost test key `EZTK`;
- email captured to a file; no scheduled jobs.

The checks were silent Cypress probes, run as the role each video is for, recording screenshots and the exact visible labels. `vayd_api_local` was not touched (checked read-only afterwards).

Screenshots: `~/.vayd-training-osv/shots/<probe>/` (full size) and `…/small/` (1100 px). The probes and the demo setup are local and uncommitted:
- `cypress/training/probes-osv/`
- `cypress/training/setup/online-store-demo.cjs`

## Status by video

| Video | Status |
|---|---|
| OSV-01 Shopping as a portal client | **Walked end to end.** Ready for a dry run. |
| OSV-02 Guests and gift cards | Screens walked; B2 fixed and re-walked. Guest gift card payment: do it in the dry run. |
| OSV-03 Fix an auto-ship in the portal | Walked, including the "Payment failing" banner. Stripe-calling buttons not clicked. |
| OSV-04 Paying a balance in the portal | Held eVet message walked; paying a Scout bill online not walked here. |
| OSV-05 Mail an item from the visit | **Walked at visit checkout.** Ready for a dry run. |
| OSV-06 Phone order | B1 fixed; walked through **Add to mail queue**. Payment step in the dry run. |
| OSV-07 Doctor approval | **Walked**, including Approve with a lower quantity (Nov 8). |
| OSV-08 Fill and label | **Walked** (fill, lot picking, EasyPost test label). |
| OSV-09 Second check | **Walked** (check, then contact options). See Q4. |
| OSV-10 Reject or cancel and refund | Walked to the dialog; the refund not confirmed. |
| OSV-11 Auto-ships list | List and Edit walked, B4 locked fields included; Stripe-calling buttons not clicked. |
| OSV-12 Billing tasks | Partly walked with the Q7 setup (ended auto-ship and its task). |
| OSV-14 Gift cards | List walked; Issue window not walked. See Q6. |
| OSV-15 List an item | Store items walked; the controlled-drug refusal not walked. |
| OSV-16 Coupons | **Not walked:** labels from code only. |

## 1. Questions for you (all answered Nov 7; see the update at the top)

| # | Question | Why it's unclear | My recommendation |
|---|---|---|---|
| Q1 | How should CLs take a phone order for a medicine? | CLs (and doctors) can't open the Mail Order Queue; it redirects them to Pharmacy → counts. **New mail order** is only for "ashes and other packages that are not a pharmacy fill". The only CL route is a bill → **Mail order**, which fails on the Financial tab (B1). | Fix B1. Then CLs put the item on a new bill, choose **Mail order**, and charge or text a pay link (OSV-06 as written). |
| Q2 | Should inventory managers be able to approve prescription mail orders? | The permission "Mail-order task — approve or deny fulfillment" includes `inventory_manager` (and lead techs), but D5 and Oct 30 keep inventory managers off the store and queue. | Remove `inventory_manager`; keep doctors, lead techs, practice managers and admins. |
| Q3 | Is shipping taxable? | The online store taxes the $4.99 shipping (5.5% of items + shipping). Visit checkout doesn't. | Ask your accountant about Maine's rule; then make the store and checkout agree. Scripts show what the app does today. |
| Q4 | Can the person who filled an order also do the second check? | Riley (the filler) sees **I checked Maple** enabled. There's a `mail_order.check.self_override` permission, but I didn't try it. | Block the filler unless they have the override, with a note; OSV-09 says "a second person checks". |
| Q5 | Should "Mark paid" get a video? | It's a manager-only fix-up (with a reason) after a payment recorded elsewhere. | No. Mention it in the manager notes only. |
| Q6 | Should issued (not sold) gift cards count as outstanding? | With Maria's issued $50 card active, **Amount total outstanding** is **$0.00**. | Count them, or show issued cards as their own line. |
| Q7 | May the training setup post signed **test** Stripe webhook events to make Billing tasks for OSV-12? | The stack gets no Stripe events, so those tasks never appear. | Yes: a setup step that signs test events with the stack's own webhook secret (test mode only). |
| Q8 | Show lot picking in OSV-08? | The demo items don't track lots, so the lot picker never shows. | Yes: make one demo item lot-tracked with a lot in Raleigh office. |

## 2. Possible bugs (B1 to B3 fixed Nov 7; B4 to B6 fixed Nov 8; B7 open)

| # | What I did | What happened | What I expected | Screenshot | In a test plan? |
|---|---|---|---|---|---|
| B1 | As Jordan Pike, on Maria's **Financial** tab, put Joint support chews on a bill, clicked **Mail order**, chose a pickup type, **Add to mail queue**. | "Request failed with status code 400". The API: "Provider is required on invoice line items." No mail order. Any shipping or pickup choice fails. | The order goes to the queue, as it does from visit checkout. Cause: `ClientFinancialWorkspace.tsx` adds the shipping line without `providerEmployeeId`; visit checkout passes one. | `shots/osv05-07-staff/small/osv05-04-after-send.png` | No. |
| B2 | Logged out, opened **Heartworm & flea chewable**. | "This is a prescription item. Anyone can order; we verify the record before we mail." with **Auto-ship** and **Add to cart**. The guest cart then says prescriptions and auto-ship need a login, and still offers **Auto-ship** on the dental chews. | Guests see the login rule on the product page (OS-A16: guests buy one-time, non-prescription items only). | `shots/osv02-04-client-side/small/osv02-02-guest-rx-product.png`, `osv02-03-guest-cart.png` | Related to OS-A16 (server side done); the product page copy isn't. |
| B3 | As Robin, chose Dr. Lane in **Send to** on Juniper's thyroid order and clicked **Send task**. | The API replied 201, but no task was created, and Dr. Lane's Tasks stayed at "Active (0)". `createApprovalTask` in `mail-order.service.ts` ends in `catch { /* Task is best-effort */ }`, so the failure is hidden. | A task for Dr. Lane, or an error the mail team sees. (My demo setup had just made the other offices inactive; that may be the cause here, but the silent catch is the bug.) | `shots/osv08c-stages/small/s-21-send-task.png` | No. |
| B4 | As Riley (mail team), opened **Edit** on an auto-ship. | **Item** and **Qty** are editable, but saving them is refused (D5, OS-A2). | Team members see frequency only, or a note. | `shots/osv08-16-team/small/osv11-03-edit-riley.png` | OS-A2 noted "screens not hidden". |
| B5 | As Maria, clicked **Place order** as soon as the cart opened. | "Enter the name and email for this order." The fields then filled in from her profile, but the message stayed until a second click. | The button waits for her details, or the message clears when they arrive. | `shots/osv05-07-staff/small/` (earlier failed run) | No. |
| B6 | (demo data) The training stack's demo phones are 12 digits ("919555550101"). | Every client page shows "Request failed with status code 400" in the texting panel ("Invalid phone number format"). | 10-digit phones. My setup fixes the Riveras and Chens; `demo-names.sh` should too. | `shots/osv08c-stages/small/s-02-272-after-mark-filled.png` | Training stack only. |

**Not a bug, but worth knowing:** soft-deleting a store order's Scout bill directly in the database makes the API cancel the order as an orphan. My probes did this by accident early on. Staff can't delete a paid bill that way.

## 3. Screens that look half-built or likely to change

- **Guest product page** (B2): its copy contradicts the cart and the guest rule. Fix before recording OSV-02.
- **Financial tab "Mail order"** (B1): blocks OSV-06.
- **Doctor approval task** (B3): blocks OSV-07.
- **Portal Auto-ship items page:** "every month · next bill 2026-12-07" (raw date, lower case) and "$36.00 each · qty 1 · 36.00 before tax" (no $).
- **Frequency buttons:** both **Monthly** and **every month (recommended)**, the second in lower case.
- **Product quantity:** chews show **Number of bottles**.
- **Portal balance card:** "We appreciate your prompt payment!" above an unpaid balance.
- **Held eVet bills** (OSV-04): the message changes when eVet sync is turned off at cutover.

## 4. Demo data each video needs

The setup script `cypress/training/setup/online-store-demo.cjs` (local, uncommitted) runs once, right after `stack-up.sh`. It makes:
- the demo catalog, with only those five products on the store;
- Maple's heartworm Rx (3 refills, Dr. Lane) and Juniper's thyroid Rx (0 refills);
- Tom Chen's open $85 eVet bill and his portal login;
- a $50 gift card, RVRA-GKCD-HMNP-2345;
- Riley Brooks (mail order team) with a login, and Robin Hale as mail order manager;
- the demo office's address, and 10-digit phones for the Riveras and Chens.

It also hides other seeds' offices, mail orders and auto-ships.

**Rerunning it on a used stack:** it rebuilds the products, so orders and auto-ships from earlier takes point at the old items. Rebuild the stack instead.

| Video | Needs | Seed exists? |
|---|---|---|
| OSV-01 | Demo catalog; Maria's portal login | Yes |
| OSV-02 | Gift card product; the $50 card | Yes |
| OSV-03 | Maple's heartworm auto-ship (made by buying it in the store); one auto-ship set "failing" | Made in the spec; "failing" is one SQL line |
| OSV-04 | Tom's $85 eVet bill; an open Scout bill for Maria | eVet bill yes; Scout bill made in the spec |
| OSV-05 | A visit today for Juniper with a SOAP encounter | Made in the spec (as the EMR videos do) |
| OSV-06 | Riveras; B1 fixed | Blocked |
| OSV-07 | Juniper's thyroid Rx (0 refills); Maria's store order | Rx yes; order made in the spec; B3 blocks |
| OSV-08/09 | Maria's paid store order; Raleigh office with an address; Juniper's approved thyroid order (lot-tracked, Q8) | Order made in the spec; office yes; lot TH24117 yes |
| OSV-10 | A paid order to reject; optionally a requested cancellation from a visit | Order yes; cancellation request no |
| OSV-11 | Maria's two auto-ships; one "failing" | Made in the spec |
| OSV-12 | Store Billing tasks | **No** (Q7) |
| OSV-14 | The $50 card | Yes |
| OSV-15 | Demo catalog; Gabapentin (controlled, unlisted) | Yes |
| OSV-16 | A coupon | No (made on camera) |

**Still to clean up before recording:**
- **Leftover staff:** the **Send to** list holds dozens of leftover test staff ("Inv technician" and others). Mark non-demo employees inactive in the setup.
- **Doctor picker:** a blank default option labelled "Avery Lane" appears above the real Avery Lane. Check whether that's demo data or the picker.
- **Leftover items and offices:** "Removed (115)" items and the catalog's "Shows in search at" offices are full of leftover test names.
- **Portal greeting:** while the page loads it shows the login's email; wait for "Good evening, Maria" before step 1.
- **Pickup offices:** they come from the practice's settings (Brunswick, Biddeford), while the demo addresses are in Raleigh. That's fine for training, but say "your office" in narration.
