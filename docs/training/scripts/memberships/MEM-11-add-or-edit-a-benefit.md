# MEM-11. Add or edit a benefit for one pet

> **Dry run:** passed Nov 9, 2026 (`cypress/training/mem-11-add-or-edit-a-benefit.cy.ts`; its narration file is the final wording). Changes from this draft: the catalog pick is its own line; demo item is Ear cytology (the test catalog has no nail trim).

- **Audience:** lead CLs and managers (medical director and billing for their own patients). Filmed as Robin Hale.
- **Length:** about 1¼ minutes.
- **Watch first:** MEM-10.
- **The one thing to remember:** it changes this pet only, never the plan.

## Why (opening)

"Sometimes one pet needs something extra, as a goodwill gesture or to fix a mistake. You can add or change a benefit for that pet alone."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's chart, **Membership** | — | Why line | Maple on Canine Foundations; signed in as Robin Hale (manager) |
| 2 | Same | — | Remember line | — |
| 3 | **Membership** | Click **Add benefit** | "Click Add benefit." | — |
| 4 | **Add a benefit to this pet only** | Point at "This adds the line to Maple's membership alone — the plan template is untouched — and records who added it." | "It's added to Maple only. The plan stays as it is." | — |
| 5 | Form | Search **Catalog item** (e.g. a nail trim procedure) | "Find the item." | A catalog item not on the plan |
| 6 | Form | **Allowance** Limited, 1 | "Choose how many," | — |
| 7 | Form | **Coverage** → **Included — no charge** (or Copay, or Percent off catalog price) | "and how it's covered." | — |
| 8 | Form | Type a **Note** ("Goodwill: missed appointment") | "Say why." | — |
| 9 | Form | Click **Add benefit** | "Click Add benefit." | — |
| 10 | **What Maple can use** | Point at the new row; the summary shows "1 added for this pet" | "It's on Maple's list, marked as added for her." | — |
| 11 | **Benefit details & edits** | Open, then click **Edit** on a benefit | "To change an existing benefit, open Benefit details and click Edit. You can't set it below what's already used." | — |
| 12 | Voice-over | — | Closing line | — |

## What else you can do here

- **Remove** (the × on a benefit) hides it from this pet and asks for a reason. It's soft-removed and shows as
  **Removed**.
- **Attach to a group** makes the new benefit share an existing allowance.

## What other roles see

- Doctors, techs and CLs see **Benefit details** read-only, with no **Add benefit**.

## Closing

"The most common mistake is changing the plan in Settings to fix one pet, which changes it for everyone. Remember: it changes this pet only, never the plan."
