# OSV-26. Chronic medications: refills and reordering in the portal

- **Audience:** Doctors, techs, CLs, mail team.
- **Who is on screen:** Dr. Lane, Maria (portal), Riley.
- **Spec:** `cypress/training/osv-26-chronic-meds.cy.ts`; narration `cypress/training/narration/osv-26-chronic-meds.json` (Nova, 1.25x).
- **Demo data:** Maple: heartworm Rx (chronic, 1 refill), a free-text chronic “Dental chews”; Maria’s saved test Visa.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `c01-why` | Chronic medications at the top of the chart are what families can reorder in their portal. |
| `c02-chart` | Here's Maple's chart. |
| `c03-add` | To add one, click Medication, |
| `c04-search` | search the inventory, |
| `c05-pick` | and pick the item. Pick it from inventory, not free text, so the family can reorder it. |
| `c06-catalog` | Catalog means it's linked. |
| `c07-refills` | Each one shows its refills. |
| `c08-window` | Click them to open the refills window. |
| `c09-add` | A doctor adds refills here. |
| `c09b-save` | Save refills. |
| `c10-saved` | Saved. |
| `c11-free` | This one was typed as free text, so the family can't reorder it online. |
| `c12-link` | Search the inventory, |
| `c12b-pick` | and link it. |
| `c13-linked` | Now it's linked. The SOAP's chronic medications work the same way. |
| `c14-portal` | In her portal, Maria sees them, with refills left, and Reorder. |
| `c15-reorder` | She reorders the flea and tick chewable. |
| `c16-place` | Place order. |
| `c17-queue` | With refills on file, it goes straight to Fill, with the directions from the prescription. |
| `c18-mistakes` | The most common mistakes: typing a medication we sell as free text, and leaving no refills on a medication meant to continue. |
| `c19-remember` | Remember: pick chronic medications from inventory, and keep their refills current. |
