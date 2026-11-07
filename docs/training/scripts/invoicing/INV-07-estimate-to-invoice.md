# INV-07. Turn an estimate into the invoice

- **Audience:** doctors, techs and CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** INV-06. For euthanasia, EMR V9 and V10.
- **The one thing to remember:** carry the estimate onto the bill with **Find estimate**, so you don't re-enter the lines.

## Why (opening)

"The family approved these prices. Carrying the estimate onto the bill keeps them exactly as approved, and saves typing it all again."

## Steps

Part 1 is at the bill, which is where most people do it. Part 2 is from the estimate itself.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's Checkout page, Checkout panel | Point at the bill (Office exam $75) and the **Find estimate** button | "Juniper's dental estimate was approved. Her bill has the exam on it so far." | Juniper has a visit today, with an open bill holding the Office exam. Estimate #1 "Dental" (Dental cleaning $450, Dental X-rays $180, total $630) is Sent |
| 2 | Checkout panel | Point at the one thing to remember | "Don't type the lines again. Find the estimate." | — |
| 3 | Checkout panel | Click **Find estimate** | "Click Find estimate." | — |
| 4 | Open estimates list | Point at the row "Estimate #1 · Dental · Nov 7 · Juniper" and its total, $630.00 | "Scout lists this family's open estimates, newest first. Declined, converted and expired ones don't show." | — |
| 5 | Open estimates list | Click the row to expand it | "Open it to check what's inside." | — |
| 6 | Expanded row | Point at the lines (Juniper, Dental cleaning $450.00; Juniper, Dental X-rays $180.00) and "Adds every line at the estimate's prices." | "Every pet, every line, at the prices the family approved." | — |
| 7 | Expanded row | Click **Convert** | "Convert adds the whole estimate to this bill." | — |
| 8 | Checkout panel | Point at "Added estimate #1 to this bill. Remove any line that wasn't done." and the new lines; **Total** $705.00 | "The lines are on the bill. If something wasn't done, remove that line. Add anything that came up during the procedure." | — |
| 9 | Clients, Maria Rivera, Estimates | Point at a second estimate in the list | "You can also start from the estimate. Open it on the client's Estimates list." | A second Sent estimate for Juniper, and a visit for her today or coming up |
| 10 | Estimate window | Click **Convert to invoice** | "Click Convert to invoice." | — |
| 11 | Estimate window | Point at **Which visit is this for?** and the visit "Sat, Nov 7, 9:30 AM · Juniper · Wellness · Avery Lane" (selected when it's the only one) | "An estimate made on the ledger isn't tied to a visit yet, so Scout asks which one. It lists the family's visit today and any coming up." | — |
| 12 | Estimate window | Click **Convert to this visit** | "Pick the visit and convert." | — |
| 13 | Ledger | Point at the new open invoice and the estimate, now **Converted** | "The bill is open on that visit, and the estimate shows Converted." | — |

## What else you can do here

- **Reprice** the bill if prices changed since the estimate (INV-14).
- **Open invoice** on a converted estimate takes you to its bill.
- **Save estimate** keeps an estimate without converting it.

## What other roles see

- Doctors, techs, CLs and managers all see **Find estimate**, on an open bill only (from the code: once the bill is paid or voided, the button is gone).
- Only euthanasia estimates hold a card (EMR V9 and V10). Their checkout has its own button, **Run Payment**.

## Messages in the code

- If the family has no visit today or coming up, the window says: "No visit today or coming up for this family. Book the visit first, then convert."
- **Convert** is refused with:
  - "A declined estimate cannot be converted."
  - "Add at least one charge first."
  - "Add a charge with a total before converting."
- With nothing open, **Find estimate** says "No open estimates for this family."

## Closing

"The most common mistake: retyping the estimate on the bill. Remember: carry the estimate onto the bill with Find estimate, so you don't re-enter the lines."

## Notes from the check in the app (Nov 7, 2026)

Checked on build-doctor-flow 5a13205 with API 221ea76a, in Stripe test mode, as doctor, technician, CL and manager.

- **Steps 1 to 8 match the screen.** Converting Estimate #1 added Dental cleaning $450.00 and Dental X-rays $180.00 for Juniper. The bill went from $75.00 to $705.00, the lines took the provider A. Lane, and the list then read "No open estimates for this family." Technician, CL, manager and doctor all saw **Find estimate**.
- **Steps 9 to 13 match the screen.** With one visit, it's already selected. The estimate showed **Converted** and the new invoice #500 opened with Dental cleaning and Dental X-rays, $630.00. With no visit, the window said "No visit today or coming up for this family. Book the visit first, then convert." (don't show that case; mention it in the voice-over at most).
- **Prices come from the estimate.** The estimate's prices are copied as they are; use **Reprice** afterwards if a member price should apply.
- **Demo setup:** the world has no estimates, so the spec makes the estimate through the API (Dental cleaning and Dental X-rays are in `cypress/training/setup/invoicing-demo.sql`) and then marks it Sent.
- **Ready to record.**
