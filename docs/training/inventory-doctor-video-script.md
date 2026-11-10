> **Superseded (Nov 9, 2026)** by the checked series in `docs/training/scripts/inventory/` (STK-01 to STK-26). Kept for reference only; don't record from this file.

# Inventory training videos: VAYD doctors

Six short videos, 1 to 4 minutes each. Doctors only need to know what touches their own day: charging stock at checkout, controlled drugs, their truck, and helping with the weekly count when the tech is out. Written from the code on Nov 2, 2026; places needing a visual check on the first take are marked **[check on screen]**.

**Who this is for:** a VAYD veterinarian who is also the inventory manager of their **home branch**, where their controlled drugs are kept (`veterinarian` + `inventory_manager` at that branch). Controlled drugs have **no par levels or orders** at the home branch, so they never appear on the Transfer List or Order List; D6 covers the home-branch manager tasks that do apply. Par levels, placing orders for the ordinary stock and Cost Reviews are not covered here.

**What a doctor can and can't do**

| Can | Can't |
|---|---|
| Pick the shelf and lot at checkout, record controlled doses and "drawn up, not given" waste, Move Items and Waste / Adjust on their own truck, read and use the Transfer List, Weekly Counts when covering, Expiring report for their own office, Controlled Drugs report for their own doses, controlled-drug activity | Cost Reviews (practice manager only), Suppliers, Shrink and Count Report, other doctors' controlled-drug doses. At their home branch, as inventory manager, they can also receive and count controlled drugs and see that office's Activity log (D6) |

**Overlap with the tech series** (the steps are the same; only the narration changes):

| Doctor video | Tech video |
|---|---|
| D1 Charging at checkout | T3 Using stock at a visit |
| D3 Weekly count when you are covering | T4 Weekly count |
| D4 Moving stock on your truck | T2 Transfer List, T5 Move Items |
| D5 Expiring check | T7 Expiring report |
| D2 Controlled drugs | (tech: Waste / Adjust, T6) |
| D6 Home-branch controlled drugs | none (doctor only) |

**Getting to the screens:** click your name, then **Pharmacy** for Move / Order. Reports are under your name, **Analytics**, **Inventory**.

**Demo login:** `Dr. Dana Demo` (veterinarian). Default location **Demo Car A** (your real trucks have names like "AM Sienna"). All names are fictional.

---

## D1. Charging at checkout (3 min)

Goal: make sure the right truck and the right bottle come off the shelf. **Same steps as tech video T3.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open the visit and add charges in the plan as usual | Charges appear on the invoice under **Checkout** | "Adding a charge doesn't change inventory. Stock comes off when the invoice is paid or the visit is completed." |
| 2 | Look at **Branch** and **Location \*** in **Checkout** | Your default truck is already selected | "Your own truck is filled in for you. Change it only if you're covering someone else's." |
| 3 | On a lot-tracked line, click **Select a lot…** | The lot list: lot number, expiry, quantity | "Pick the bottle you used. The soonest expiring lot is on top, so use that one first." |
| 4 | Point at an expired lot | It's greyed out and marked **Expired** | "Expired bottles can't be charged. Tell the tech, and don't use it." |
| 5 | Not listed? Click **Add lot**, or choose **Existing stock — shelf not counted yet** | The Add lot window: **Lot #**, **Expiration \***, **Quantity on hand** | "If your bottle isn't on the list, add it with the lot number and expiry from the vial. Vaccines and controlled drugs always need a real lot." |
| 6 | Take payment or complete the visit | Invoice locks | "When the invoice closes, the stock comes off your truck. That's what builds the tech's Transfer List for tomorrow." |

**Common mistakes**
- **Wrong lot.** Match the bottle in your hand.
- **Wrong truck** after covering for someone. Check **Location** on each invoice.
- **Adding the charge but never closing the invoice.** Stock only moves when it closes.
- **Charging a controlled drug without a lot.** The invoice won't close.

**Demo data needed**
- Visit for client **Maple Demo**, patient **Biscuit**, with Dr. Dana Demo as provider and **Demo Car A** as her default location.
- Charges: one vaccine with two lots, one routine medication, one controlled drug (see D2).

---

## D2. Controlled drugs: charging, waste and your report (3 to 4 min)

Goal: record controlled doses so the numbers match Vet Snap.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | On the controlled drug line at checkout, choose the **lot** | The lot of the actual bottle. A message if you try to close without one | "Controlled drugs always need the real bottle. Pick the lot." |
| 2 | Read the line: **Controlled drug, used in hospital. Given: x mL** | The mL given equals the quantity charged | "Enter the amount you actually gave, in mL. That's what comes off the bottle." |
| 3 | Drew up more than you gave? Enter **Wasted (mL)** | A small panel under the line | "If you drew up more than you gave, enter the leftover here. It goes in the controlled log under this charge." |
| 4 | Choose a **Disposal method**, optionally a **Witness (optional)**, then click **Record waste** | Message "Recorded … wasted in the controlled drug log." The line now shows **Wasted** | "Pick how you disposed of it. A witness is optional here, but pick the person who watched. You can't pick yourself." |
| 5 | Your name, **Analytics**, **Inventory**, **Controlled Drugs** | The report: **Date**, **Quantity**, **Patient (ID)**, **Doctor/Provider**, **Invoice #**, **Shelf**, **Waste** | "This is your own list of controlled doses, so you can match it to your Vet Snap log." |
| 6 | Use the **Controlled waste** and **Doctor** filters, **Print log** or **Download CSV** | Filtered list | "Filter to waste if you want. Print it if you need to." |
| 7 | Point at a row that says it isn't your shelf | "Not this doctor's shelf — check the doctor on the charge" | "If a dose appears from a shelf that isn't yours, check the doctor on the charge." |

**Common mistakes**
- **Not recording the leftover** when you draw up more than you give. The bottle total will be off.
- **Wrong lot or wrong doctor on the charge.** The dose shows under the wrong person.
- **Mixing units.** Controlled liquids are in mL at launch.
- **Skipping the disposal method.** It is required for controlled waste.

**Demo data needed**
- A controlled liquid (e.g. a demo opioid, mL) with 2 lots on Demo Car A, and a second staff member for the witness.
- A checked-out visit that already has one controlled dose, so the report has rows, plus one dose under another doctor to show it does not appear.

---

## D3. Weekly count when you're covering (2 to 3 min)

Goal: do the weekly count if the tech is out. **Same steps as tech video T4.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Pharmacy**, **Move / Order**, **Weekly Counts** | The week's list for your office | "Usually the technician does this. If they're out, you can. The steps are the same." |
| 2 | Open **How it works** | Short instructions | "It's a blind count, so you can't see what the computer expects." |
| 3 | Find each item (**Find item**) and type the number you see in **Count** for each lot and location | Rows turn green when every location has a number | "Count what's on the shelf, lot by lot. Zero if none." |
| 4 | Controlled liquids: enter the mL for each bottle | mL boxes per lot | "For controlled liquids, count the mL in each bottle. These are the numbers that must match Vet Snap." |
| 5 | Click **Save**, then **Submit** | **Posted to inventory** | "Submit when an item is finished. It posts straight to the system." |

**Common mistakes**
- **Counting before you look.** Count what's there, not what you remember.
- **Leaving locations blank.** Blank means you did not check; enter 0.
- **Skipping controlled drugs.** They need an accurate count.

**Demo data needed**
- Same open weekly count as T4, with the controlled liquid on the list.

---

## D4. Moving stock on your truck (2 min)

Goal: restock your truck from the Transfer List or Move Items. **Same steps as tech videos T2 and T5; keep it brief.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Pharmacy**, **Move / Order**, **Transfer List**; set **Office** and **Location** to your truck | Rows with **From**, **To**, **Qty** | "After a day of visits, this list shows what your truck is short of." |
| 2 | Click **Transfer** on a row, check the numbers, click **Move now** | **Transfer complete** | "When you've taken the stock, confirm. It moves immediately." |
| 3 | Or: **Move Items**, search the item, set **From** and **To**, **Confirm move** | Move form | "For anything else, use Move Items." |

**Common mistakes**
- **Confirming a quantity you didn't take.**
- **Moving from another doctor's truck** without telling them.

**Demo data needed**
- Same as T2: Demo Car A with 4 items below par.

---

## D5. Expiring check (1 to 2 min)

Goal: check your office for expiring or expired stock. **Same as tech video T7.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Your name, **Analytics**, **Inventory**, **Expiring** | The report for your office | "Take a quick look now and then. You'll only see your own office." |
| 2 | Point at **Expired on shelf** and **Log them on Waste / Adjust** | The red list | "Anything in red is expired. Don't use it. Tell the tech to log it." |

**Common mistakes**
- **Using a bottle you know is close to expiry** when an older one is on the shelf. Use the soonest first.

**Demo data needed**
- Same as T7.

---

## D6. Your home branch: receiving and counting controlled drugs (3 to 4 min)

Goal: put new controlled drugs on your home-branch Controlled shelf and keep their count right. Doctor only. There are no par levels or orders for these items, so they never show on the Transfer List or Order List.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Your name, **Pharmacy**, **Move / Order**, **Unbox** | **Unbox Shipment** | "When controlled drugs arrive, you receive them like any other delivery." |
| 2 | Set **Destination office \*** to your home branch and **Default location \*** to the **Controlled** shelf | The two dropdowns | "Choose your home branch and the controlled shelf, not Main." |
| 3 | Add the line with **Lot #**, **Exp date \*** and the quantity in mL, then **Add to shipment**, then **Finalize shipment** | **Shipments received** shows your name | "Controlled drugs need the real lot number. Use the number on the bottle." |
| 4 | **Pharmacy**, **Setup** (only **First / Annual Counts** shows for you), pick **Office** and **Location**, tick **Controlled substances** | The count sheet with **Code, Item, Unit, Count, Weight · bottles, Lot #, Exp** and **Controlled counted** | "Use this for a full count of the controlled shelf. Print the sheet, count, and enter or upload the numbers. Counts are in mL. Use the bottle weights only if you want a cross-check." |
| 5 | If a message says **Weight and count disagree**, choose **Post the counted mL** or **Recount** | A warning on that item | "If the weight and your count don't match, recount first. Only post the mL you trust." |
| 6 | Your name, **Analytics**, **Inventory**, **Activity** | **Controlled Drug Activity**: item, office, location, action | "This is your history: every controlled drug received, moved, wasted or adjusted, who did it and when." |
| 7 | Tick **Controlled waste** | Only waste rows | "Filter to waste when you reconcile with Vet Snap." |

**Common mistakes**
- **Receiving into Main** instead of the Controlled shelf.
- **Guessing the lot number.** Use the label.
- **Posting a count you aren't sure of.** Recount when weight and count disagree.
- **Looking for par levels or orders.** Controlled drugs deliberately have none.

**Demo data needed**
- Demo Office is Dr. Dana Demo's home branch, with a **Controlled** shelf holding a demo controlled liquid (2 lots), and a shipment ready to unbox that contains a controlled item.
- A prior controlled count sheet with one weight/count mismatch to show **Weight and count disagree**.
