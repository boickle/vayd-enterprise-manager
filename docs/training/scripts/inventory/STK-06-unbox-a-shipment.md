# STK-06. Unbox a shipment

- **Audience:** technicians (anyone may unbox).
- **Length:** 3 minutes.
- **Watch first:** STK-01.
- **The one thing to remember:** nothing is on the shelf until you click **Finalize shipment**, and the lot, expiry and cost come off the box and the invoice, not from memory.

## Why (opening)

"Unboxing is how new stock gets a lot number, an expiry and a cost in Scout. A wrong cost can change what clients pay, and a missing lot makes the next count wrong."

## Steps

Signed in as Jordan Pike. A Northline Vet Supply delivery for the Raleigh office, invoice NL-40500: 100 Carprofen 100 mg caplets (new lot CP-4700, $0.42) and 20 Cerenia 24 mg tablets (lot CE-2291, $4.50), plus freight. The invoice is a made-up image, `cypress/training/setup/invoices/NL-40500.png`.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy | Click **Move / Order**, then **Unbox** | "Open Unbox." | `inventory-demo.cjs` |
| 2 | Unbox Shipment | Point at the one thing to remember (voice only) | "Remember: nothing is on the shelf until you finalize." | — |
| 3 | Unbox Shipment | Click **Upload photo**, choose the invoice photo, click **Go** | "Take a photo of the invoice and tap Go. Scout reads it for you." | `NL-40500.png` |
| 4 | Unbox Shipment | Point at **Invoice / packing slip #** NL-40500, **Supplier** Northline Vet Supply, **Destination office** Raleigh office | "It fills in the invoice number, the supplier and the office." | Supplier Northline Vet Supply |
| 5 | Unbox Shipment | Choose **Default location \***: Main | "Deliveries usually go to Main, not a car." | — |
| 6 | Line | Point at Carprofen 100 mg caplet: 100, lot CP-4700, exp 6/30/2028, $0.42 | "Check each line against the invoice: count, lot, expiry and cost." | — |
| 7 | Line | Point at "From the invoice — change these if the read was wrong." | "If Scout read something wrong, fix it here." | — |
| 8 | Line | Point at the Cerenia line and "Over 15% (+25%) above the catalog cost — goes to Cost Reviews, prices unchanged" | "This cost is a lot higher than usual. Scout holds the price change for a manager. Just make sure it matches the invoice." | Cerenia catalog cost $3.60 |
| 9 | Shipment | Click **Finalize shipment** | "Now it goes on the shelf." | — |
| 10 | Unbox Shipment | Point at "Shipment finalized — stock updated. … 1 price increase is waiting in Cost Reviews — prices stay the same until a manager applies them." | "Done. The price increase is waiting for a manager." | — |
| 11 | Shipments received | Point at "NL-40500 · Northline Vet Supply · Raleigh office · Received by Jordan Pike" | "Scout recorded that you received it, and when." | — |

## What else you can do here

- **Upload invoice** for a PDF. A line Scout can't match gets **Match** (pick the item; Scout remembers it for that supplier) or **Ignore**.
- Type the lines instead: **Search item**, quantity, **New lot…** with lot # and expiry, **Cost / unit**, then **Add to Unboxed Shipments**.
- **Add new supplier** if the supplier isn't listed.
- **Edit** or **Remove** a line before you finalize.
- **Delete** a received shipment to reverse it: you, the same day, or the practice manager or the office's inventory manager any time.

## What other roles see

- Clinical staff and managers can unbox (owner decision D3); client liaisons don't see Unbox (owner, Nov 9). Technicians must enter a cost; managers and inventory managers can receive without one.

## Closing

"The most common mistakes are entering a bottle's price as a per-tablet cost, and leaving the expiry blank. Remember: nothing is on the shelf until you finalize, and the lot, expiry and cost come off the box."

## Notes from the check in the app (Nov 9, 2026)

- Walked end to end as Jordan Pike; every label and message is as written. Activity and the Cost Review showed the result.
- Quantity starts at 1 (as on Add lot); the spec must clear it.
- The typed version was walked end to end. **The steps above were rewritten for the photo after the owner's answer to Q6 and haven't been walked yet.** Walk them in the dry run, and check: whether the first read of Northline's descriptions needs **Match** (if it does, have the setup map them first), the exact names of the read lines, and how the freight line shows. Claude reads the invoice (Sonnet 5.5). The same image style read 5 of 5 lines correctly in a test.
- U4 fixed: "From the invoice — change these if the read was wrong." now shows only on lines the reader filled in.
- Q5 fixed: **Delete** shows only for the person who received the shipment (same day), the practice manager and that office's inventory manager. U12 fixed: every shipment names its office.
