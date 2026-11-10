# Inventory, Catalog and Pricing training: review for the owner (Nov 9, 2026)

The scripts are in `docs/training/scripts/inventory/` (37 videos: STK-01 to STK-26, PRC-01 to PRC-11). This file lists what needs your answer before anyone records.

## How the scripts were checked

- **Code:** frontend on `training/inventory-scripts`, cut from `training/videos` (f26747d3). Its inventory and catalog code is identical to `build-doctor-flow` 100fdc19. API on `build-doctor-flow` 17b5259a.
- **Stack:** my own training stack (DB `vayd_api_test_inv`, API :3260, app :5260, fake Stripe, Redis db 14, jobs off, email captured).
- **Walks:** every Must video's steps were run by Cypress probes with no voice, as the right role. Screenshots and captured screen text are in `~/.vayd-training-inv/shots/` and `~/.vayd-training-inv/probes/`.
- **Demo data:** `cypress/training/setup/inventory-demo.cjs`. No real client data was copied, and nothing was read from `vayd_api_local`.
- **What's not covered:** no video in this series takes a card payment, so Stripe test mode wasn't needed. Totals on invoices, emails and the portal belong to the invoicing series (INV-01 to INV-17); this series only touches them in PRC-06.

**Status:** 25 of the 28 Must scripts were walked through every step that changes something. The other three were walked to the last screen: STK-03 (one voice-over line still needs data), STK-19 (blocked by B4) and PRC-05 (the final Save price wasn't clicked). The Nice scripts were opened on screen and mostly not saved; each says so in its notes. Nothing is ready to record until the questions below are answered and B1, B3 and B4 are fixed or worked around.

## 0. Owner answers and fixes (Nov 9, 2026, later the same day)

**Answers:**
- Q1: yes, the practice manager orders too.
- Q2: yes, STK-17, STK-25, PRC-10 and PRC-11 are for admins.
- Q3: fix it.
- Q4: in-clinic injectables and controlled doses shouldn't ask for a sig. Done through the catalog: untick **Medication** on items given in the visit, and keep it on dispensed versions (for example Buprenex dispensed, which needs a label). No code change.
- Q5: A.
- Q6: show the photo. Claude reads it.
- Q7: cut the line.
- Q8: client liaisons don't count or unbox.
- Q9: yes.
- Q10: keep Sam.
- Q11: yes, plus each lot gets its own row, and blank means not counted.
- Q12: Nice videos after go-live.
- U4 to U12: fix them.
- E1 and E2: OK.

**Fixed** on branch `fix/inventory-training` in both repos (worktrees `~/worktrees/inv-fix-fe` and `~/worktrees/inv-fix-api`, cut from `build-doctor-flow`). Each fix was checked in the app on the test stack (`vayd_api_test_inv`), except where it says unit tests:
- **B1:** the checkout's "drawn up, not given" waste now uses the dose's shelf. The API also wastes a picked bottle from the shelf it sits on. Checked: the Controlled safe went from 17.9 to 17.7 mL, and the waste row names the safe.
- **B2:** Analytics waits for permissions before redirecting. Checked: `/schedule/analytics/inventory/shrink` stays on Shrink for a practice manager.
- **B3:** people whose Move Items access is "own" (technicians, doctors) move stock within one office only, and never in or out of another doctor's controlled drug location. Move Items locks their To office. Checked: the API refused Jordan's move out of Dr. Lane's safe with a 403, and the To office was locked.
- **B4:** the API accepts the units tablet, capsule, mL, gram and package. Checked: Cerenia saved at $9.95; Cost Reviews' **Save & update catalog** set Carprofen to cost $0.55, price $1.69.
- **Q1:** `inventory.po.manage` adds the practice manager (any office), and the Order List takes its buttons from that permission. Checked: Robin Hale sees **Order** and **+ Order List**.
- **Q3:** the price list shows the price per unit with a note, e.g. "$1.69, + $15.00 fee per charge · $31.90 minimum charge".
- **Q4:** no code change (an earlier Injectables-category version was removed). Checkout asks for a sig on items marked Medication. The Prescriptions Help topic now says which items should be marked.
- **Q5:** **Delete** on a received shipment is for the person who received it (the same day), the practice manager, and that office's inventory manager. The API refuses anyone else. Checked: Jordan sees no **Delete**; Robin sees it on all five.
- **Q6:** the reader was already Claude (Sonnet 5.5) when I wrote Q6; my note that it went to OpenAI was wrong. A made-up Northline invoice image read correctly: 5 of 5 lines with lot, expiration, quantity and cost, freight skipped, in about 5 seconds. OpenAI couldn't be compared, because its key in the test `.env` has expired.
- **Q8:** Pharmacy shows each Move / Order screen only to people who hold its permission. Client liaisons lose `inventory.receive`, which the API now enforces on starting and finalizing a shipment. Someone with no Move / Order screen lands on their own page. Checked: Casey Morgan opens Pharmacy on the Order List, and the menu shows only Order List.
- **Q9:** the setup adds a 0.4 mL Buprenorphine dose under Dr. Lane for Maple Rivera from Raleigh office · Car (lot BU-0990). Checked: the Controlled Drugs report shows "1 dose came off a shelf that isn't this doctor's own" and "Shelf: Car · Not this doctor's shelf".
- **Q11:** First / Annual Counts, the printed sheet and the Excel sheet list each lot already on the shelf on its own row, with its lot # and expiration. Write 0 for a lot that's gone. A blank lot row keeps its amount, except for controlled drugs, where Scout refuses a blank lot. Before saving, Scout asks to confirm if any lot with stock would go to 0 (an upload that leaves a lot out). Checked: Carprofen at Raleigh Car with lots typed 12 and 0 and one left blank read "Left blank, kept: lot CP-4520 (30)", counted 42. The confirmation is covered by unit tests.
- **U3:** Add lot's and Unbox's quantity select the starting 1 when clicked, so typing 30 gives 30.
- **U4:** "From the invoice — change these if the read was wrong" shows only on lines the invoice reader filled in (unit tests).
- **U5:** Move Items opens on your own office (your default office in Settings → Staff). Checked: Jordan opens on Raleigh office.
- **U6:** gone with Q8 (client liaisons no longer see Waste / Adjust).
- **U7:** Waste / Adjust no longer shows "Older lot … has stock" (unit tests).
- **U8:** Activity shows the item's unit ("0.2 mL"), not "units".
- **U9:** a controlled drug is on a shelf's count list only if the shelf is a doctor's controlled drug location or holds that drug. Shelves with none show "—". Checked: Raleigh Car 2 and Durham Car show "—"; Raleigh Car shows 1 of 1 (it holds BU-0990).
- **U10:** Cost Reviews' description mentions increases over 15%.
- **U11:** after **Save catalog fields**, the Catalog row reloads. Checked: Dental chews went from $24.00 to $26.50 in the row without searching again.
- **U12:** Shipments received names every office, including ones you can't receive at. Checked as Jordan: Durham office and Dr. Lane home are named.
- **E1:** `net-guard-preload.cjs` blocks Square, and `stack-up.sh` blanks the Square settings (training branch).

**Help:** `inventory-catalog.md` (Delete rights, client liaisons, the invoice reader, lot rows on counts, Move Items) and `emr-10-prescriptions.md` (which items checkout asks a sig for) are updated, with `reviewed: 2026-11-09`.

**Still open:** the Lloyd home ordering question (section 6), and unticking **Medication** on in-clinic injectables in the real catalog (Q4).

---

## 1. Questions for you (all answered Nov 9; see section 0)

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| Q1 | You said the practice manager can place orders too. Today only the office's **inventory manager** can: the API key `inventory.po.manage` lists only `inventory_manager`, and the Order List shows **Order** / **+ Order List** only for that role. Robin Hale (practice manager) sees no button. | STK-18 shows the inventory manager. Managers would have no way to order at go-live. | Fix on `build-doctor-flow`: add `practice_manager` (all offices) to `inventory.po.manage` and show the buttons for it. Small change in both repos. **Shall I make it?** |
| Q2 | Only an **admin login** opens the full Settings: Staff profile (the doctor's controlled drug location), Waste / disposal, Count alerts, Sales Tax and Client Discounts. A practice manager sees only Closed days, Memberships and Automatic Tasks. | STK-17, STK-25, PRC-10 and PRC-11 are admin-only. A new doctor can't charge controlled drugs until an admin sets their safe. | Keep it admin-only and make those four videos for admins (you). If a practice manager should set controlled drug locations, that's an app change. |
| Q3 | In Catalog's price list (client liaisons, techs, doctors), Carprofen 100 mg caplet reads **"$31.90 · tablet"**. That's one caplet's charge after the $15 fee and $31.90 minimum; the per-caplet price is $1.29. | A liaison could quote $31.90 a tablet. Items with a fee or minimum: 347 have a fee, 103 a minimum. | Show the unit price, with the fee and minimum as a note (an app change). Until then PRC-01 uses an item with no fee (Cerenia). |
| Q4 | Are controlled injectables (Buprenorphine, Ketamine, Dexdomitor, …) marked **Medication** in the real catalog? If so, checkout asks for directions (a sig) and an Rx approval on an in-hospital dose. | STK-05 assumes an in-hospital dose with no sig. I couldn't check: reading `vayd_api_local` was blocked without your OK. | Check one or two real items in Catalog → Clinical. If they're marked Medication, untick it for drugs only used in hospital, or tell me and I'll add the sig step to STK-05. |
| Q5 | **Shipments received** on Unbox lists every office's shipments, and a technician can **Delete** any of them, including the controlled drugs received at Dr. Lane home. Deleting reverses the stock. | Anyone may finalize (D3), but deleting another office's controlled-drug receipt is a bigger power. | Limit **Delete** to the person who received it (same day) and managers / that office's inventory manager. Until then, STK-06 doesn't mention Delete. |
| Q6 | Unbox can read a photo of the supplier invoice. That sends the image to OpenAI. | The video would show the fastest way to unbox, but the photo leaves the test stack. | Record STK-06 with manual entry (as written) and mention the photo option in one line. If you want it shown, I'd use a made-up invoice image, and only with your OK. |
| Q7 | STK-03's last line ("vaccines and controlled drugs always need the real lot") has nothing on screen to show it. | The README's rule: never mention what isn't on screen. | Cut the sentence; EMR V4 covers vaccine lots. |
| Q8 | Client liaisons see the whole **Move / Order** menu (Weekly Counts, Unbox, Move Items, Waste / Adjust, Transfer List, Order List). On Waste / Adjust their Office and Location lists are empty, and the screen only says "Choose item, office, and location". | Confusing for CLs, and STK-09's "what other roles see" has to explain it. | Hide the screens a role can't use (an app change), or tell CLs in STK-01 that Pharmacy is for clinical staff. Should CLs count or unbox at all? |
| Q9 | STK-14: add a dose recorded under Dr. Lane from a shelf that isn't her safe, so the "not this doctor's shelf" flag is on screen? | Today the flag is only voice-over. | Yes, add it to the setup. |
| Q10 | **Sam Ortiz** is a new demo person (technician + inventory manager, Raleigh office). The test database has no lead technician role. | Names appear on screen. | Keep Sam. |
| Q11 | **First / Annual Counts replaces every lot of an item on that shelf.** Counting one Buprenorphine bottle set the other bottle to 0. The screen warns about it. | A doctor counting only the open bottle wipes the others, and that's a controlled-drug discrepancy. | Keep the behavior (it's how a full recount should work). STK-16 and STK-21 teach "count every bottle". Consider a confirmation when a count drops a lot that had stock. |
| Q12 | Record the Nice videos (STK-16, STK-22 to STK-26, PRC-07 to PRC-11) before go-live, or after the first weeks? | They're for managers and admins, and some screens may still change (section 3). | After go-live, except STK-16 if doctors start counting safes in week one. |

---

## 2. Possible bugs (all fixed on `fix/inventory-training`; see section 0)

| # | What I did | What happened | What I expected | Evidence | In a test plan? |
|---|---|---|---|---|---|
| **B1** | As Dr. Lane, on a visit's Buprenorphine line (drawn from her Controlled safe), entered 0.2 in **Wasted (mL)**, chose a disposal method, **Record waste**. | The waste row and stock movement used the **bill's location (Raleigh office · Car)**. Lot BU-1101 in the safe dropped 0.2 mL, but the Car's shelf total dropped instead of the safe's: Car −0.2 mL, safe unchanged. Lot totals and shelf totals no longer agree, for a controlled drug. | The waste comes off the shelf the dose came from (the safe), like the sale does. | `~/.vayd-training-inv/evidence/B1-controlled-waste-recorded.png`. Database after the evidence run: shelves "Car 0.8, Controlled safe 16.9", lots "BU-1101 at Car 1, BU-1101 at safe 6.7, BU-1102 10". `ControlledDoseFields.tsx` sends `invoice.inventoryLocationId`, not the line's controlled location. | No. CAT-12 covers disposal method and witness, not the location. |
| **B2** | Opened an Analytics inventory report by link or page refresh (e.g. `/schedule/analytics/inventory/shrink`) as a practice manager. | It bounced to the first tab of the first category (Payments for a manager; VSD for a doctor) before permissions had loaded. For a manager, Payments then calls Square. | The report opens (Pharmacy's layout already waits for permissions; `Analytics.tsx` doesn't). | Every early probe of `/schedule/analytics/inventory/*` landed on Payments or VSD. | No. |
| **B3** | As Jordan Pike (technician), Move Items: 1 mL Buprenorphine from **Dr. Lane home · Controlled safe** to **Raleigh office · Car**; also 10 Carprofen from Main to Car 2. | Both moves went through ("Move of 1 Buprenorphine … (Dr. Lane home → Raleigh office)"). | The permission catalog gives technicians `inventory.transfer` "own" (their assigned vehicle). A tech moving another doctor's controlled drugs across offices should be refused. | `~/.vayd-training-inv/evidence/B3-tech-moved-controlled.png`; Activity shows "Moved · Buprenorphine … Controlled safe → Car · Jordan Pike". | Partly: INV-A10 (Oct 29) says the API should enforce `inventory.transfer`. The "own vehicle" scope isn't enforced. |
| **B4** | As Robin Hale, Catalog → Cerenia 24 mg tablet → changed Price → **Save catalog fields**. Same for Cost Reviews → **Update catalog** → **Save & update catalog** on Carprofen. | "sellUnitType must be one of the following values: each, bottle, box, case, tube, vial, bag, other". Nothing saved. | The save works. The Unit list on the screen offers Capsule, Tablet, Bottle, Package, mL, Gram, Each, Other, and migration `1793000006000-inventory-units-and-lot-rules` sets tablet / capsule / ml on real items. The API's `INVENTORY_SELL_UNIT_TYPES` (May 5) allows only each, bottle, box, case, tube, vial, bag, other. | `~/.vayd-training-inv/evidence/B4-unit-save-error.png` (Unit: Tablet; the message is above the visible part); probe text in `~/.vayd-training-inv/probes/last.txt`. Saving Dental chews (unit "bag") worked. | No. **Likely must-fix**: most medications can't have their price, cost or flags edited, and every Cost Review on a tablet or capsule item fails to apply. |

**Usability notes** (smaller; for whoever picks up the fixes):
- **U3:** Add lot's **Quantity on hand** starts at 1, so typing 30 saved 130. Unbox's quantity also starts at 1.
- **U4:** On Unbox, "From the invoice — change these if the read was wrong." shows even when lines are typed by hand.
- **U5:** Move Items starts on the first office alphabetically (Dr. Lane home), not the user's own office.
- **U6:** A CL's Waste / Adjust has empty Office and Location lists, with no explanation (Q8).
- **U7:** Waste / Adjust shows "Older lot … has stock" when wasting a newer bottle; that hint is for use, not waste.
- **U8:** Activity shows controlled amounts as "units" ("0.6 units"), not mL.
- **U9:** First / Annual Counts shows "Controlled counted 0 of 1" in red for every shelf, including cars that never hold controlled drugs.
- **U10:** Cost Reviews' description mentions only lower costs and items added while receiving, not increases over 15%.
- **U11:** After an item is saved, the Catalog row still shows the old price until the search runs again.
- **U12:** In Unbox's **Shipments received**, other offices' shipments have no office name.

**Training stack (not the app):**
- **E1:** `net-guard-preload.cjs` doesn't block Square. Opening Analytics → Payments on a training stack calls Square's real API with the Square settings from the API's `.env`. Square refused each call (401), and the calls only list payments. It happened about seven times in my early probes. I then blanked the Square settings for my stack only (in my local env file, not the shared script). **Suggested:** add Square to the net guard and blank the Square settings in `stack-up.sh`. That's a training-file change, so I'm asking first.
- **E2:** On my first start, `stack-up.sh` flushed Redis db 14, which held 458 keys from a stopped stack. No running stack was using db 14 (checked).

---

## 3. Screens that look half-built or likely to change

| Screen | Why | Affects | Record now? |
|---|---|---|---|
| Catalog item save (B4) | Fails for tablet/capsule/mL/gram/package units | PRC-02, STK-19, PRC-07 | After the fix. PRC-02 can use Dental chews now |
| Order List buttons (Q1) | Practice manager may get **Order** | STK-18 | After your answer |
| Move Items permissions (B3) | Techs may lose other offices' locations | STK-08, STK-01 | After the fix |
| Controlled waste on the checkout line (B1) | Location will change | STK-05 (step 11 onward) | After the fix |
| Unbox photo reading | OpenAI; not tried | STK-06 step 2 | Manual entry now (Q6) |
| Prices by branch | Not tested (CAT-A4); don't create any | PRC-04 (visible on the tab) | Don't show |
| Catalog **XLS** / **PDF** pills | "Export (coming soon)" | PRC-01 | Don't point at them |
| Par Review / Set par levels | Suggestions need weeks of real usage; blank in the demo | STK-24 | After go-live |
| Weekly count, Par Review, Vet Snap tasks | Come from scheduled jobs (off on the stack) | STK-11, STK-15, STK-24 | Voice-over only |
| Cost Reviews description (U10) | Outdated wording | STK-19 | Fine to record; fix the text when convenient |
| Settings for practice managers (Q2) | May open up | STK-17, STK-25, PRC-10, PRC-11 | After your answer |
| Pharmacy menu for CLs (Q8) | May be trimmed | STK-01, STK-09 | After your answer |

---

## 4. Demo data each video needs, and whether the seed makes it

`inventory-demo.cjs` runs after `stack-up.sh` (`NODE_PATH=$API_DIR/node_modules API_DIR=… node cypress/training/setup/inventory-demo.cjs <test db> <world.json> <out.json> <local api url>`). It refuses any database not named `vayd_api_test*` and any API that isn't on localhost. It writes tokens for its new logins (Sam Ortiz, an admin login) to `<out.json>`, outside the repo. Stock is received through the API, so lots, shelves and Activity agree. Running it again resets the demo stock.

It also tidies the copied test database:
- other offices, items, procedures, labs, suppliers and employees from earlier automated tests are set inactive;
- their stock history is deleted;
- demo login emails are set to `…@example.com`;
- the online store is switched on.

| Video | Needs | In the seed? |
|---|---|---|
| STK-01, STK-07 | Car pars below on-hand for 4 items; Main stock; Durham office | Yes |
| STK-02 | Carprofen lots on Car incl. one expired (CP-4390); Maple's visit with Carprofen × 20 | Lots yes; the visit and charge are made in the spec (add the charge from the catalog so the fee and minimum apply) |
| STK-03 | Apoquel lot-tracked, uncounted on Car, no lots | Yes; visit in the spec |
| STK-04 | Two Carprofen lots on Car | Yes; visit in the spec |
| STK-05 | Buprenorphine (controlled, mL, lot required, not Medication); lots in Dr. Lane's safe; her controlled drug location | Yes; visit in the spec |
| STK-06 | Supplier Northline Vet Supply; catalog costs | Yes |
| STK-08 | Main and Car 2 | Yes |
| STK-09 | Expired Amoxicillin lot AX-0921 on Main | Yes |
| STK-10 | BU-1101 and BU-1102 in the safe | Yes |
| STK-11 | Weekly list (built when the page opens) | Yes (open the page once in the spec setup) |
| STK-12 | Expired lots on Car (Rabies RB-2508, Carprofen CP-4390); Metronidazole MT-5001 expiring in about 20 days | Yes |
| STK-13 | Paid Rivera diet bill (spec); paid Chen Buprenorphine bill | Chen bill yes; Rivera bill in the spec |
| STK-14, STK-15 | A paid controlled dose under Dr. Lane | Yes; a dose from another shelf for Q9 is not built yet |
| STK-16 | Safe not yet counted, two bottles | Yes |
| STK-17 | Dr. Lane licensed; location cleared before the take | Licensed yes; clear it in the spec |
| STK-18 | Main at or below re-order point for Syringes and LRS; Sam Ortiz login | Yes |
| STK-19 | Pending Carprofen cost review (+31%) | Yes |
| STK-20, STK-21 | Pars; Car 2 uncounted | Yes |
| STK-22 | A posted count and a waste | Made by STK-09 and STK-11 (record those first, or add to the seed) |
| STK-23 | Stale DHPP and diet lots | Yes; the weekly list must not already hold DHPP |
| STK-24 | Weeks of usage history | **Not built** |
| STK-25, PRC-10, PRC-11 | Admin login; practice waste reasons; tax row; statuses EMP and SR10 | Yes |
| PRC-01 to PRC-04, PRC-06, PRC-07, PRC-09 | Demo catalog, Simparica breaks, Acepromazine hidden on invoice | Yes |
| PRC-05 | Store on, Dental chews listed at $24, 2 active auto-ships (fake Stripe ids) | Yes |
| PRC-08 | A reminder rule on Rabies | **Not built** (the screen shows "No reminders configured.") |

---

## 5. What I changed

- **New on this branch:**
  - the 37 scripts and README in `docs/training/scripts/inventory/`;
  - this file;
  - `cypress/training/setup/inventory-demo.cjs`;
  - the made-up invoice `cypress/training/setup/invoices/NL-40500.html` / `.png` for STK-06.
- **Changed on this branch:**
  - a "Superseded" note at the top of the two Nov 2 drafts (`inventory-tech-video-script.md`, `inventory-doctor-video-script.md`);
  - E1 in `cypress/training/stack/`.
- **App fixes:** on `build-doctor-flow` in both repos (section 0), merged into this branch.
- **Local only, not committed:**
  - the probes in `cypress/training/probes-inv/` (no voice);
  - `vite.sch.config.ts` (own Vite cache);
  - `~/.vayd-inv-env.sh` and `~/.vayd-inv-fix-env.sh`.

## 6. Answered: ordering for an office whose stock lives in a car (Lloyd home)

**How the Order List works today.** Each office has one main shelf (the default location) with a min and max per item. Every other shelf (a car, a safe) has a par. The Transfer List fills a short shelf from the main shelf first, then from shelves or offices with extra. The Order List orders only when the **main shelf** is at or under its min (after the planned transfers out), and it orders back up to the max.

**Where Lloyd home falls through.** Say she keeps one bottle of 100 doxycycline in her car (par 100) and none on Lloyd home's main shelf, which has no min. When the car runs low, the Transfer List shows the shortfall with no source ("From —"), and the Order List stays empty: the main shelf has no min, and even a min of 0 orders nothing without a max. Nothing tells her to order.

**How other inventory systems handle it.** Three common patterns:
1. **Each stocking point reorders for itself.** A one-shelf site (a mobile vet's truck) is its own stock: min and max on the truck, orders straight from the supplier.
2. **Hub and spoke.** A small site names the office that restocks it. Its shortfalls land on that office's transfer list, and the hub's reorder counts them as demand. This is the "replenish from" or "supplying location" setting in most multi-site systems.
3. **Order on the office total.** Reorder when everything at the office, on every shelf, is under the min.

**Options for Scout:**
- **A. Setup only, today:** if Lloyd home's only real stock is the car, make the car Lloyd home's main shelf (rename Main to "Car") and set min and max there. Scout then orders when the car hits its min.
- **B. Small app change (recommended):** a shortfall that no transfer can cover goes on that office's Order List. One rule, no new setting, and it also catches any car whose office main shelf is empty.
- **C. Bigger app change:** an office setting "Restocked from: <office>". The small office never orders; its shortfalls go to the hub office's Transfer List and Order List.

**Owner's answer (Nov 9): B.** Built on `build-doctor-flow` (web app `d9a7efd0`, `43fd6afe`, `b03e4d0b`; Help topic `3001db52` in vayd-api):
- Any counted shelf's shortfall that Main, spare shelves and other offices can't cover is added to the office's order, on its main shelf. This applies even when the main shelf has never been counted for that item, because the car's count is real.
- **Show need** names the main shelf (for example "Home: no count for this item · not covered 70 → order 70"), lists the car under **Not covered**, and says to unbox it straight to that shelf.
- Lloyd home's setup: a par on the car for each item she keeps there; no re-order point on Lloyd home's main shelf.
- Side effect in the demo: Raleigh's Gabapentin, which Car is short 20 and nobody can spare, now shows on Raleigh's Order List (qty 20). That makes STK-07's line "That one ends up on the Order List" true, and adds a row to STK-18.
- Video: **STK-27** (Dr. Shah home: doxycycline only in the car). Demo: the seed adds **Dr. Shah home** (Home, Car), Doxycycline 100 mg tablet (Car 30, par 100), and makes Dr. Priya Shah its inventory manager.

