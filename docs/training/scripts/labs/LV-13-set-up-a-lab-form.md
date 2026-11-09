# LV-13. Set up a lab form

- **Audience:** whoever manages lab forms (today: admins; see the review file).
- **Length:** 3 minutes.
- **Watch first:** LV-01.
- **The one thing to remember:** attach every form to the labs or procedures that use it, so ordering the test opens the form.

## Why (opening)

"Lab forms decide what staff fill in for each in-house test. Attached to a test, the form opens by itself when the test is charged."

> **Waiting on a fix or an answer** (review file, possible bug 1): Settings is admin-only, so vets and lead techs can't reach this screen, though they're allowed to edit forms.

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Settings | Click **In-House Lab Forms** | "Open Settings, In-House Lab Forms." | Logged in as an admin (Robin Hale) |
| 2 | In-house lab forms | Point at **Active** and **Archived** with their counts | "Active forms are in use. Archived ones are kept, out of the way." | One archived form |
| 3 | In-house lab forms | Click **New lab form** | "Click New lab form." | — |
| 4 | Form | Type "Fecal float" in **Form name** | "Name it." | — |
| 5 | Form | Pick **Table of values** in **Result style** | "Table of values, for rows of results. Written summary is for write-ups like cytology." | — |
| 6 | Form | Type "Parasite ova" in the first row's name | "Name the first row." | — |
| 7 | Form | Pick **Choices** for the row | "Choices, for answers like Negative or Positive." | — |
| 8 | Form | Type "Negative, Positive" in "Choices, comma separated" | "List the choices." | — |
| 9 | Form | Pick Positive in "Which choices are abnormal" | "Mark Positive abnormal, so it's flagged." | — |
| 10 | Form | Point at the one thing to remember | "Now the important part." | — |
| 11 | Form | Type "Fecal" in **Show this form for** and pick the lab | "Attach it to the catalog lab." | Catalog lab "Fecal float" |
| 12 | Form | Click **Save lab form** | "Save lab form." | — |
| 13 | In-house lab forms | Click **Archive** on an unused form and confirm | "Retire a form with Archive. Results already charted stay readable." | — |
| 14 | **Archived** | Point at **Restore** | "Restore brings it back." | — |

## What else you can do here

- Number rows have units, and a minimum and maximum. Leave the minimum and maximum empty for now (owner decision D4).
- **Add missing standard forms** adds the usual set without touching forms you've changed.
- **Internal note**: only staff see it.

## What other roles see

- Techs and client liaisons: no Settings.

## Closing

"The most common mistakes: saving a form without attaching it, and putting ranges on number rows. Remember: attach every form to the labs or procedures that use it."

## Notes from the check in the app (Nov 8, 2026)

- **Checked as an admin:** **In-house lab forms**, **New lab form**, **Add missing standard forms**, **Active** / **Archived** with counts; the editor's **Form name**, **Category**, **Result style** (**Table of values** / **Written summary**), **Internal note**, **Rows** with **Add row** and a type (**Number**, **Text**, **Choices**), **Show this form for** ("In-house cytology, FNA, Schirmer tear test, and fluorescein stain are procedures, not labs."), **Cancel** / **Save lab form**.
- An unattached form says "Not attached to any test yet — staff can still pick it by hand", so the first draft's "it never opens" was wrong.
- **As a veterinarian, Settings showed "Access Denied — You need admin privileges to access settings."** (possible bug 1).
- **Not checked:** saving, archiving and restoring a form (covered by the LAB-A15 tests).
