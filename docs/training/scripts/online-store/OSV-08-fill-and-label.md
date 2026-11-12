# OSV-08. Fill an order and print its label

- **Audience:** mail order team.
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-07.
- **The one thing to remember:** fill from the office and location you actually took it from, then buy one label per order.

## Why (opening)

"Filling is where the right medicine gets into the right bag. The label comes next, and then a second person checks it."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Pharmacy → **Mail Order Queue**, Riley | Click **Fill** | "Fill shows what's ready to pack." | Maria's paid store order: Joint support chews + Dental chews for Maple; Juniper's approved thyroid order (OSV-07) for step 7 |
| 2 | Queue | Click order **#… Maria Rivera · Maple** (**✓ Approved**, **✓ Paid**, **Fill**) | "Open the order." | — |
| 3 | **Fill** | Point at "Choose where the stock comes from, then work down each item below: pick the lot and print its labels. **Mark filled** is at the bottom." | "The steps are written right here." | — |
| 4 | Fill | Choose **Raleigh office** in **Filling from office**, then **Office shelf** in **Location** (the choices are **Car (default)** and **Office shelf**) | "Where you took it from." | Demo office: Raleigh office |
| 5 | Fill | Point at the one thing to remember | "Fill from the office and location you actually took it from. That's what comes off the shelf count." | — |
| 6 | Item | Point at each item: **From our stock** (or **Ordered on another site**), **Directions**, **Print Rx + bag labels**, **Bag label only** | "For each item: where it came from, the directions, and its labels." | — |
| 7 | Juniper's thyroid order | Under **LOT / EXPIRATION \***, point at **Lot TH24117 · exp 2027-09-04 · QOH 6** (already chosen when there's one lot), then at **Finish filling: Thyroid tablets 0.4 mg (90 ct) · Lot TH24117** | "Some medicines track lots. Pick the lot you took from the shelf; it's printed on the label and comes off that lot's count." | Thyroid tablets lot-tracked, lot TH24117 (6) in Raleigh office (setup script) |
| 8 | Item | Point at **Re-send…** and **Mark pending** | "If anything looks wrong, don't fill it. A prescription goes back to the doctor with Re-send… and a note. Anything else, leave it in Fill, add a note, and ask a manager. Mark pending is only for when we're waiting on the client." | — |
| 9 | Fill | Type in **Notes for the checker** | "Anything the checker should know." | — |
| 10 | Fill | Click **Mark filled** | "Mark filled." | — |
| 11 | **Ship** | Point at **✓ Filled** | "Now it's filled." | — |
| 12 | Ship | Type 12 in **Package weight (oz)** | "Weigh the package." | — |
| 13 | Ship | Click **Get cheapest rates** | "Get rates." | EasyPost test key |
| 14 | Ship | Click **Print cheapest label** | "Print the cheapest label, once." | — |
| 15 | Order | Point at **✓ Label printed** and **Void / refund this label** | "One label per order. If it's wrong, void it; don't buy another." | — |

## What else you can do here

- **Split to new shipment** for items going separately.
- **Change address**, **Mark pending** to wait on the client, **Reject + refund + email** (OSV-10).
- **Office pickup** orders skip the label: "Office pickup — no shipping label."
- **Add lot** next to the lot picker records a lot that's on the shelf but not yet in Scout (branch, location, lot number, expiration, quantity on hand). Use it only when the bottle in your hand isn't listed.
- **Item or quantity looks wrong?** Only the doctor (prescriptions, through Re-send…) or a manager (other items) changes it. The mail team doesn't.

## What other roles see

- **Practice manager and mail order manager:** the same screen.
- **Techs, CLs and doctors:** no access to the queue.

## Closing

"The most common mistakes: filling from the wrong office, so the shelf counts drift, and buying a second label instead of voiding the first. Remember: fill from the office and location you actually took it from, then buy one label per order."

## Notes from the check in the app (Nov 7 and 8, 2026)

- **Nov 8, lots (Q8):** walked as Riley on Juniper's thyroid order. **LOT / EXPIRATION \*** had TH24117 chosen already (the only lot), and **Finish filling** listed it. **Add lot** opens a form to create a lot. Probe: `probes-osv/osv-lotcheck.cy.ts`.
- **Recording:** the client panel on the right shows "Request failed…" under **Recent texts** because the training stack has no texting key, on purpose. Keep it out of frame.

- **Walked** as Riley Brooks: Fill, **Mark filled** (the API recorded **filled**), weight 12 oz, **Get cheapest rates** (19 EasyPost test rates, each with **Print this label**), **Print cheapest label**, then **✓ Label printed**.
- **Order:** it's fill, then label, then the second check (OSV-09). **Ready for check** stays disabled until there's a label.
- **Demo data:** the office needs an address. Without one, rates fail with "Raleigh office needs a ZIP in Settings → Locations before you can quote shipping." The setup script sets 410 Glenwood Ave, Raleigh, NC 27603.
- **Lot picking:** now in step 7 (thyroid is lot-tracked in the demo setup).
- **Nov 11, 2026 (owner):** a prescription needs a licensed vet or technician on the fill or the check; a licensed person may check their own fill with a reason. The opening line no longer says the check must be a second person.
