> **Superseded (Nov 9, 2026)** by the checked series in `docs/training/scripts/inventory/` (STK-01 to STK-26). Kept for reference only; don't record from this file.

# Inventory training videos: VAYD technicians

Seven short videos, 2 to 4 minutes each, one task per video. Written from the code on Nov 2, 2026 (screen names and button text come from the app source). Do a dry run on the demo database first; places that need a visual check on the first take are marked **[check on screen]**.

**Who this is for:** a VAYD technician (plain `technician` role). Lead technicians get a separate series later.

**What a technician can and can't do** (so you never promise more than the role has):

| Can | Can't |
|---|---|
| Unbox shipments (cost is required for you), Move Items (own truck), Waste / Adjust (own truck), Weekly Counts, read the Transfer List and do the transfers, see the Expiring report for their own office, request an item be ordered | Place orders, edit par levels, First / Annual Counts, Cost Reviews, Suppliers, Shrink and Count Report, Stale lots, the Activity log, the Controlled Drugs report |

**Overlap with the doctor series** (keep the steps identical, only the narration audience changes):

| Tech video | Doctor video |
|---|---|
| T3 Using stock at a visit | D1 Charging at checkout |
| T4 Weekly count | D3 Weekly count when you are covering |
| T2 Transfer List, T5 Move Items | D4 Moving stock on your truck |
| T7 Expiring report | D5 Expiring check |

**How to get to every screen:** click your name (top right), then **Pharmacy**. The tabs are **Move / Order** (Weekly Counts, Unbox, Move Items, Waste / Adjust, Transfer List, Order List), **Store**, and so on. You will only see tabs your role allows. On a phone, the **Inventory** menu has Unbox, Transfer List and Move.

**Demo logins:** `Tess Demo` (technician). Demo trucks and offices are listed in each video's demo data. All names are fictional.

---

## T1. Unbox a shipment (3 to 4 min)

Goal: stock the shelf from a supplier delivery, with lot numbers and expiry dates.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Your name, then **Pharmacy**, then **Move / Order**, then **Unbox** | The **Unbox Shipment** page. Top card says **Upload invoice** | "When a delivery arrives, we unbox it here. This is what puts new stock on the shelf and gives it a lot number and an expiry date." |
| 2 | Click **Upload photo**, then **Use camera** (phone) or **Choose from photos**. A PDF works too | The invoice thumbnails appear. A **Reading…** message, then **Reading invoice…** and "Extracting supplier, office, and line items" | "Take a clear photo of the packing slip or invoice, one photo per page. The app reads it and fills in the lines for you. It takes a few seconds." |
| 3 | Look at the card **Invoice lines to approve** | A list of lines. Each says **Matched**, or **Needs a match or ignore** | "Check every line. Green and matched is good. If a line says Needs a match, click **Match** and search for the item. If it isn't something we stock, click **Ignore**." |
| 4 | Set **Destination office \*** and **Default location \*** | Two dropdowns above the lines | "Choose the office and the shelf this is going to. For the main delivery that is usually the office's Main shelf, not a truck." |
| 5 | For each line that tracks lots, type the **Lot #** and the **Exp date \*** | The lot and expiration boxes on each line. A message "Enter a lot # or choose an existing bottle" if it is blank | "Read the lot number and expiry date right off the box. If the bottle already exists on our shelf, pick it from the list and the new ones will be added to that lot." |
| 6 | Check quantities and cost on each line | Quantity, **Total cost** / **Cost / unit** | "Check the quantity matches what is actually in the box. Cost is required for technicians. If the invoice read it wrong, fix it here." |
| 7 | Click **Add approved lines to shipment** | The lines move down into the shipment | "When every line looks right, add them to the shipment." |
| 8 | No invoice? Use the manual form: pick **Supplier \***, type **Invoice / packing slip # \***, search **Search item \***, fill **Location \***, lot, expiry and cost, click **Add to shipment** | The manual receive form | "No photo? You can type it in yourself. The supplier and invoice number come first." |
| 9 | Click **Finalize shipment** | Toast naming what was received. Below, **Shipments received** lists it with your name and the time | "Finalize is the moment stock actually goes on the shelf. Scout records that it was you and when. Until you click it, nothing has changed." |
| 10 | Point at a line that shows a price warning | A note such as "Will update price" or "Over 15%" and a message that a price increase is waiting in Cost Reviews | "If a cost is much higher than usual, the app holds the price change for a manager to review. You don't need to do anything. Just make sure the number you typed is right." |

**Common mistakes**
- **Lot or expiry wrong or blank.** Without them you can't finalize a lot-tracked item. Read it off the box, don't guess.
- **Receiving to the wrong shelf.** Check the **Default location** before you add lines. Stock lands where you say.
- **Entering the bottle price as the per-tablet price** (or the reverse). Check **Total cost** vs **Cost / unit**. A big jump goes to a manager, but a small slip goes straight in.
- **Finalizing twice, or leaving a half-finished draft.** If you see "Picked up your in-progress receive", finish it or click **Discard draft**.
- **Duplicate invoice.** The screen warns "Invoice … was already unpacked". Stop and ask. Don't unbox it again.

**Demo data needed**
- Fictional supplier **Demo Vet Supply**, and a sample invoice image or PDF (a made-up invoice, no real vendor or prices).
- Office **Demo Office** with **Main** shelf, and a truck.
- Three stock items on the invoice: one with an existing lot (to show "add to this lot"), one lot-tracked with no lot yet, one with a cost 20% higher than the catalog cost (to show the price hold).
- A second, already received invoice number (to show the duplicate warning).

---

## T2. The Transfer List (3 min)

Goal: see what your truck needs after a day of use, and fill it.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Your name, then **Pharmacy**, then **Move / Order**, then **Transfer List** | **Transfer List** with a paragraph explaining the rules. Office and Location filters at the top | "The Transfer List shows what each truck is short of. It builds itself from what was used today at checkout." |
| 2 | Choose your **Office**, then your truck under **Location** | The list narrows to your truck. Columns: **Item**, **From**, **To**, **Qty** | "Pick your office and your truck. Each row is one item, where it comes from, where it goes, and how many." |
| 3 | Point at **To** and **From** on one row | **To** is your truck. **From** shows a shelf and how many are on hand, e.g. "Main · 12" | "To is your truck. From is where the app suggests taking it. Usually that's Main." |
| 4 | Point at a row where **From** shows **—** | A row with no source | "A dash means nobody has spare stock for that. Ask the inventory manager. It will end up on the Order List." |
| 5 | Click **Other stock** on a row | A panel of the item's stock at other offices and shelves | "Want to see where else it is? **Other stock** shows every other shelf and office." |
| 6 | Click **Transfer** on a row | A window: **From office**, **From location**, **To office**, **To location**, **Quantity** | "When you have the stock in your hands, click Transfer. Check the quantity against what you actually took." |
| 7 | Click **Move now** | A toast, **Transfer complete**. The row disappears | "Move now moves the stock right away. There is no waiting step. It is on your truck now." |
| 8 | Show a warning, if one appears: **More than the source shows on hand** or **Source office is under par** | A yellow warning with **Move anyway** / **Transfer anyway** | "If the app warns that the source is short, check the shelf. If you have the stock, continue. If not, stop and tell the inventory manager." |

**How the list is built (one slide or voice-over, plain language):** "Every truck has a par level, the amount it should carry. When checkout uses stock, the truck falls below par. The list asks for just enough to get back to par. It takes from Main first, then other shelves that have extra, then other offices. Anything it can't cover shows with no source, and the inventory manager orders it."

**Common mistakes**
- **Moving a different quantity than you physically took.** The system's on-hand then drifts from the shelf.
- **Treating a row as a command.** It is a suggestion. If the shelf is empty, don't click **Transfer**. Ask.
- **Expecting it to update by itself.** The list refreshes when somebody opens it or changes the filters. Re-open it before you restock.
- **Looking at the wrong office or truck.** Check the **Office** and **Location** filters first.

**Demo data needed**
- Truck **Demo Car A** with 4 items below par (e.g. par 10, on hand 3), so the list generates 4 rows.
- **Main** with enough stock to cover 3 of them; the 4th has no spare stock anywhere (shows **—**).
- One row where **From** is another shelf above par (shows the order of sources).
- Another office with spare stock of one item (to show **Other stock**).
- One item where Main's stock is lower than the request (to show the warning).

---

## T3. Using stock at a visit: checkout location and lot (3 to 4 min)

Goal: make sure the right truck and the right bottle come off the shelf. **Overlaps with doctor video D1: keep the steps identical.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open the visit, scroll to **Checkout** | The invoice with the visit's charges. At the top, **Branch** and **Location \*** | "Adding things to the visit doesn't touch the shelf yet. Stock comes off when the invoice is paid or the visit is completed." |
| 2 | Look at **Branch** and **Location \*** | Your default office and truck already filled in | "Your default truck is filled in for you. Change it only if you're covering a different truck for this visit." |
| 3 | On a vaccine or medication line, click the lot box (**Select a lot…**) | A list of lots: lot number, expiry, quantity on hand | "Pick the bottle you actually used. The one that expires first is listed on top, with a note to use it first." |
| 4 | Point at an expired lot | The lot is greyed out, labelled **Expired** and a date | "Expired bottles are blocked. You can't pick them. If one is still on your truck, tell the inventory manager and log it on Waste / Adjust." |
| 5 | Item shows no lot? Choose **Existing stock — shelf not counted yet**, or click **Add lot** | The Add lot window: **Branch**, **Location**, **Lot #**, **Expiration \***, **Quantity on hand** | "Some shelves haven't been counted yet. If your bottle isn't listed, use Add lot and copy the lot and expiry off the vial. Vaccines and controlled drugs always need a real lot." |
| 6 | Take payment or complete the visit | Invoice locks; charges post to the chart | "When the invoice closes, those items come off your truck's stock. That is also what feeds the Transfer List." |
| 7 | If a message says some stock wasn't taken off | A task titled "Stock not taken off for invoice #…" appears | "If the app couldn't take something off the shelf, you'll get a task. It never stops you from getting paid. Just fix what the task says." |

**Common mistakes**
- **Picking the wrong lot** (the one in your hand matters, not the first on the list). The next count will show a gap.
- **Leaving the wrong truck selected** after covering for someone. Check **Location** on every invoice.
- **Skipping Add lot** and picking a random lot. Add the real one.
- **Expecting stock to move when you add the charge.** It moves when the invoice closes.

**Demo data needed**
- A visit for fictional client **Maple Demo** with patient **Biscuit** (dog), ready to check out, assigned to Tess Demo.
- Charges: one vaccine (two lots, the sooner-expiring one first), one medication, one item whose newest lot is expired, one item on an uncounted shelf.
- Tess's default truck is **Demo Car A**; one other truck exists to show switching.

---

## T4. Weekly count (3 to 4 min)

Goal: count the items on this week's list. **Overlaps with doctor video D3: keep the steps identical.** Usually the tech does this. A doctor may help if the tech is out.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Pharmacy**, **Move / Order**, **Weekly Counts** | The count page, with **Office** at the top and the **Weekly count list** | "Every Monday the app builds a short list of items to count at your office. A reminder goes out on Thursday for anything not done." |
| 2 | Open the **How it works** note | A few lines of instructions | "It's a blind count. You'll see lot numbers and expiry dates, but not what the computer thinks is there. That keeps the count honest." |
| 3 | Use **Find item** to jump to an item (name, code or lot) | The item row with **Location**, **Lot**, **Exp**, **Count** columns | "Go shelf by shelf. Count what you can see, one location at a time." |
| 4 | Type your number in **Count** for each lot at each location, then click **Save** | The row turns green once every location has a number | "Type how many you see. If there are none, type 0. Don't leave a location empty unless you didn't check it. Save any time to keep your place." |
| 5 | A bottle isn't on the list? Type its lot in **Lot # (optional)** and add the expiry | A new lot row | "If you find a bottle that isn't on the list, add its lot number and expiry." |
| 6 | Click **Submit** on a finished item, or **Submit** at the top for all of them | **Posted to inventory** | "Submit posts your count to the system. It corrects the on-hand. Items you left blank stay unchanged." |
| 7 | Tick **Show posted** | Finished items | "Everything posted is checked off. When the list says 'Everything on this list is posted', you're done." |

**Doctor note (say once, in the doctor version):** "Normally the technician does this. If you're covering, the steps are exactly the same."

**Controlled drugs in a count** (shown in the doctor version, and a short mention here): controlled liquids are counted in **mL**; bottles are counted by lot. A mismatch sends a task to the manager and the controlled drugs director.

**Common mistakes**
- **Entering the number from memory** or from the label. Count what's physically there.
- **Leaving a location blank instead of 0.** Blank means "didn't check".
- **Counting while stock is moving** (the truck is out). Count when nothing is being used.
- **Submitting an item before all of its locations are in.** The Submit button stays locked until they are.
- **Using the wrong office.** Check **Office**.

**Demo data needed**
- An open weekly count for **Demo Office** with 6 items: 3 on the truck, 3 on Main, one with two lots, one controlled liquid (mL), one with a count that differs from on-hand.
- One already posted item (to show **Show posted**).

---

## T5. Move Items (2 to 3 min)

Goal: move stock between shelves, trucks or offices when there is no Transfer List row. **Overlaps with doctor video D4.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Pharmacy**, **Move / Order**, **Move Items** | **Move Items**. A search box and **From** / **To** panels | "Use Move Items when you're moving stock on your own, for example to hand a bottle to a colleague's truck." |
| 2 | Type in **Search stock item**, click the item, set quantity, click **Add** | The item is added to the list below | "Search for the item and add it. You can add several items to one move." |
| 3 | Under **From**, set **Office** and **Location** | Each location shows how many are on hand, e.g. "Demo Car A — 7 on hand" | "From is where the stock is now." |
| 4 | Under **To**, set **Office** and **Location** | Same | "To is where it's going." |
| 5 | If the item tracks lots, choose the lot on each line | A lot dropdown on the line | "Pick the bottle. The lot travels with the stock." |
| 6 | Click **Confirm move** (or **Confirm office move** when the offices differ) | A confirmation toast | "Confirm, and it's moved. If anything is wrong with any line, nothing is moved." |

**Common mistakes**
- **From and To the same.** The app refuses.
- **Forgetting the lot** on a lot-tracked item.
- **Moving without having the stock in hand.** Move it when you physically move it.
- **Moving from someone else's truck** without telling them.

**Demo data needed**
- Two trucks (**Demo Car A**, **Demo Car B**) and **Main**, each with a few items; one lot-tracked item with two lots on Demo Car A.

---

## T6. Waste / Adjust (3 min)

Goal: take stock out for a real reason (expired, broken, spilled), and keep the record clean.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Pharmacy**, **Move / Order**, **Waste / Adjust** | **Waste / Adjust** form: **Item**, **Office**, **Location**, **Qty**, **Reason** | "Anything that leaves the shelf without a sale is logged here. Broken, expired, spilled, lost." |
| 2 | Search the item under **Item** (**Search item**), choose **Office** and **Location** (your truck) | The item and shelf | "Pick the item and the shelf it came off." |
| 3 | If the item tracks lots, pick the lot | Lot dropdown | "Choose the bottle." |
| 4 | Enter **Qty** and choose a **Reason**: **Expired**, **Damaged**, **Broken**, **Lost**, **Leakage**, **Other Correction** | The reason list | "Pick the honest reason. 'Other Correction' needs a short explanation." |
| 5 | Choose **Disposal method** when asked (e.g. **Pharmaceutical waste**, **Sharps container**, **Normal trash**) | A disposal dropdown ("Required for controlled drugs") | "Expired drugs and all controlled drugs need a disposal method." |
| 6 | Add **Notes**, then click **Record adjustment** | Toast **Adjustment recorded** | "Add a note if it helps. Your name and the time are recorded automatically." |
| 7 | Controlled drug: also choose a **Witness (optional)** | A witness dropdown that leaves you out | "For controlled drugs a second person should watch. Pick them here. You can't witness your own." |

**Common mistakes**
- **Using Waste / Adjust to fix a miscount.** That belongs in the count.
- **Reason "Other Correction" with no note.**
- **Wasting a controlled drug without a disposal method.** The app won't allow it.
- **Wasting a different amount than actually lost.** For controlled drugs this ends up in the Vet Snap reconciliation.
- **Logging stock that was sold.** Sales come off at checkout. Don't remove them twice.

**Demo data needed**
- An expired lot on Demo Car A (for the "Expired" example) and an unopened broken item.
- A controlled liquid with 2 lots on Demo Car A, plus a second staff member to be the witness.
- Waste reasons and disposal methods configured as in the live practice.

---

## T7. Expiring report and "use first" (2 min)

Goal: know what's about to expire on your truck and office. **Overlaps with doctor video D5.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Your name, **Analytics**, **Inventory**, **Expiring** | The Expiring report | "Open this once a week. It shows what's about to expire at your office." |
| 2 | Set **Office**, **Location** and **Within** (how many days) | Dropdowns. Your office only | "You'll only see your own office. Narrow it to your truck if you like." |
| 3 | Point at the red **Expired on shelf** section | A list with **Lot**, **Expired**, **Where**, **Qty** and the text **Log them on Waste / Adjust** | "Anything in red has already expired. Don't use it. Take it off the shelf and log it on Waste / Adjust with the reason Expired." |
| 4 | Click **Expand** on an item | Its lots with **Expires** and **QOH** | "Expand shows each lot and where it is." |
| 5 | Back at checkout, show the lot picker | Soonest-expiring lot on top with a note | "At checkout, the list puts the soonest expiring lot first. Use that one first." |

**Common mistakes**
- **Ignoring the red section.** Expired stock can't be sold or charged anyway. It just takes up room and hides real counts.
- **Moving stock instead of wasting it.** Expired stock gets logged as waste.
- **Choosing a later lot while an older one has stock.** A small note appears. Follow it unless there's a reason.

**Demo data needed**
- Demo Office stock with: one expired lot with stock, one lot expiring in 20 days, one in 90 days, one lot with a later date, and a second office with expiring stock the tech shouldn't see.
