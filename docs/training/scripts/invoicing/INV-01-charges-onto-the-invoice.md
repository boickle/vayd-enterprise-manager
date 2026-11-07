# INV-01. How charges get onto the invoice, and who does what

- **Audience:** doctors, techs and CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V1 and V3.
- **The one thing to remember:** every charge goes on from the visit's Checkout panel. The chart and the bill are separate.

## Why (opening)

"A charge that never reaches the bill is care we gave for free. Here's how charges get on, and who adds what."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's SOAP | Point at the **Checkout** panel on the right (**OPEN**, with **Reprice** and **Refills**) | "The bill builds on the right while you work." | Rivera visit today for Maple; Maple on the Adult plan (Office exam and DHPP included, 10% off the rest) |
| 2 | Checkout panel | Point at the one thing to remember | "Every charge goes on from this panel. Writing it in the plan doesn't charge it." | — |
| 3 | Checkout panel | Click into the box "Type here to add a charge…" | "To charge something, type it here." | Catalog: Office exam ($75), Nail trim ($25) |
| 4 | Checkout panel | Type "Office exam" | "Start typing the item's name." | — |
| 5 | Search list | Click **Office exam** (shown as PROCEDURE, $75.00) | "Pick it." | — |
| 6 | Checkout panel | Point at the new line: a heart and **covered** | "Maple's plan covers the exam, so it shows as covered: no charge." | — |
| 7 | Checkout panel | Point at **PRE-VISIT ACCEPTS**: "Owner already agreed on the pre-visit form. Accept to charge, or decline with a reason if you won't do it." | "Items the family agreed to on the pre-visit form wait here." | Two pre-visit items for Maple, priced at the member price (Nail trim $22.50, Dental chews $21.60) |
| 8 | Checkout panel | Click **Accept** on Nail trim | "Accept puts it on the bill." | — |
| 9 | Checkout panel | Click **Decline** on Dental chews | "If the family says no, decline it. Don't delete it." | — |
| 10 | **Decline this item?** | Type the reason in **Reason**: "Owner wants to wait until spring" | "Give a reason." | — |
| 11 | **Decline this item?** | Click **Chart the decline** ("Red declined line on the record and reminder list") | "Chart the decline puts it on the record and the reminder list, so we can offer it again. Don't chart it only takes it off today's bill." | — |
| 12 | Checkout panel | Point at the line: **DECLINED**, the reason, and **Re-add** | "It stays here as declined. Re-add brings it back if they change their mind." | — |
| 13 | Checkout panel | Point at **Declined at an earlier visit** and its **Add to invoice** button | "Things the family declined at an earlier visit show here too. Add to invoice if they want it today." | A charted decline dated before today |
| 14 | Checkout panel | Point at the DHPP line, "Record the dose given", and the line under **Checkout**: "1 item still need doses, scripts, or a lot picked." | "Vaccines need a dose. Medications need a script. Products need a lot: Pick a lot, or Existing stock. The panel tells you what's missing." | A DHPP line without a dose |
| 15 | Voice-over | — | "Who does what: the doctor writes the plan and approves scripts. Techs add charges and record doses. Whoever is with the family takes payment." | — |

## What else you can do here

- The duplicate warning, **Already entered for this pet** (EMR V3).
- **Checkout prep**, which matches plan items to charges (EMR V3).
- **Reprice** (INV-14).
- **Refills** (EMR V11).

## What other roles see

- **Doctors, techs and CLs** can all add charges. Adding through the search box applies plan coverage and member prices for anyone.
- **Removing a line** asks for a reason.

## Closing

"The most common mistakes: writing a treatment in the plan and assuming it's charged, and deleting an item the family declined instead of declining it. Remember: every charge goes on from the Checkout panel. The chart and the bill are separate."

## Notes from the check in the app (Nov 6, 2026)

- **Earlier declines** only show for a decline dated before today, and only once the visit has an invoice. Step 13 needs seeded data.
- **Bug: Accept as a tech or CL.** If a pre-visit item's price differs from today's member price, **Accept** charges it, but the price update is refused: "You do not have permission to: Change a price on the invoice". The line stays at the old price. Seed pre-visit items at the member price until this is fixed.
- **Branch list:** the Branch dropdown on the test stack lists many test branches. Before recording, set the visit's branch so the list isn't shown.
