# INV-06. Make and send an estimate

- **Audience:** doctors, techs and CLs.
- **Length:** 2 minutes.
- **Watch first:** none.
- **The one thing to remember:** an estimate is a quote, not a bill. Nothing is charged or held, and the family pays at checkout.

## Why (opening)

"Before a dental or a big workup, families want to know the cost. An estimate tells them in writing."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Clients, Maria Rivera | Scroll to **Estimates**: "No estimates yet. Quotes live here, not on the ledger." | "Estimates live on the client, under the ledger." | Rivera household, no estimates |
| 2 | Estimates | Point at the one thing to remember | "An estimate is a quote. Nothing is charged or held." | — |
| 3 | Estimates | Click **New estimate** | "Start a new estimate." | — |
| 4 | Estimate editor | Point at "Estimate #1 — Lines save as you add them. This is a quote, not a bill." | "It saves as you go." | — |
| 5 | Estimate editor | In **Charge to**, choose **Juniper** | "Pick the pet." | — |
| 6 | Estimate editor | Type "Dental cleaning" in "Search services, packages, or products…" and pick it | "Add each item, just like on a bill." | Catalog: Dental cleaning $450, Dental X-rays $180 |
| 7 | Estimate editor | Add **Dental X-rays** the same way | "And the next one." | — |
| 8 | Estimate editor | Point at **Total** $630.00 | "The total updates as you add." | — |
| 9 | Estimate editor | Click **Email estimate** | "Email it to Maria." | — |
| 10 | **Email estimate** window | Point at "Review and edit the email before sending to Maria Rivera." | "Read it over, then send." | Your login needs access to the Info or Field inbox |
| 11 | **Email estimate** window | Click **Send email** | "Send it." | — |
| 12 | Estimates list | Point at the row: **Estimate #1**, its status, and the total | "It's listed here with its status: Draft, Sent, Accepted, Declined, Converted or Expired." | — |

## What else you can do here

- **Save estimate**.
- Each line has its own pet, so one estimate can cover the whole household.
- Euthanasia estimates, which do hold a card (EMR V9).

## What other roles see

- Every visit role can create and email estimates, and so can billing.

## Closing

"The most common mistakes: telling a family their card is held for an estimate (only euthanasia estimates hold a card), and quoting from memory instead of making an estimate. Remember: an estimate is a quote, not a bill. Nothing is charged or held, and the family pays at checkout."

## Notes from the check in the app (Nov 6, 2026)

- **Card holds removed from the script:** only euthanasia estimates take a card hold. **Authorize now**, **Take card** and **Family declined** appear only on the euthanasia checkout box.
- **Sending email:** this needs the Info or Field shared inbox. Without one, the window says "No shared practice inbox is available. You need access to Info or Field to email clients from Scout." The test stack has no Gmail access, so sending and the email itself weren't checked. Record this on a stack where the demo login has the inbox.
- **Bug: estimates ignore the member discount.** Juniper is on a plan with 10% off items it doesn't cover. The estimate charged the full $450 and $180, while the same items on her bill are 10% off. Until it's fixed, use a pet with no plan, or don't show the plan.
- **Possible bug:** **Charge to** also lists Pepper, an inactive pet.
- **Still open (checked Nov 7): estimates ignore the member discount.** A $180 Dental X-rays estimate for Maple (on the plan) shows $180.00, while her bill gets the member price. Use Juniper (no plan) for the recording, as the script does.
- **Pepper** appears in **Charge to** because the demo makes her active; that is demo data, not the old inactive-pet bug (fixed in f1b504f).
- **Status (Nov 7):** ready to record, on a stack where the demo login has the Info or Field inbox for the email steps.

## Pass 1 dry run (Nov 7, 2026)

- **Script changes:** the video now ends by closing the estimate (**Save estimate**) and pointing at the list row with its status. The email window is the real one, but the test stack has no Gmail, so the spec stubs the shared Info inbox and the send inside the browser. Nothing is emailed.
- **Checked:** New estimate, Charge to Juniper, two items, total $630.00, Email estimate window ("Review and edit the email before sending to Maria Rivera", From info@, the estimate table in the message), Send email. The History box on the client page doesn't show the new "Estimate email" line until reload.
- **Not true to life:** with the stubbed send the estimate stays **Draft** in the list. A real send may change it to Sent; check on a stack with a real inbox before the final take.
- Spec: `cypress/training/inv-06-make-and-send-estimate.cy.ts`.
