# Labs training videos: review (Nov 8, 2026)

## Owner answers (Nov 8, 2026)

- Possible bug 1 (Settings admin-only): fine as it is; LV-13 is recorded as an admin.
- Possible bugs 2, 4, 5, 6, 7: fixed on build-doctor-flow (owner names in the match list; no approval with "[doctor to add]"; email window wording; greeting by first name; unmatched results stay out of To review until matched, and Unmatched shows a count). Bug 3 was my probe's mistake.
- Number ranges: ignored everywhere. Chip: number-only forms say Complete; choice forms say Normal or N abnormal.
- Wrong pet: "Move to another pet" added on lab lines; the result moves to the other pet's chart (test LAB-07-4).
- Dropping an IDEXX test: teach removing the charge from the bill.
- "Added in IDEXX" tag on charges Scout added for tests added inside IDEXX.
- End-of-day lab task: stays at 8 pm.
- EMR V7: re-recorded as alerts only.
- IDEXX: recorded with IDEXX's sandbox practice (a demo, not live). The voice says IDEXX as "eye-dex".

## New possible bugs from the recordings

8. **"Added in IDEXX" appears only after a reload.** After ordering in IDEXX's page, the add-on line is on the bill but has no IDEXX chip or tag until the page is reloaded (the API already reports it). LV-04 reloads off camera. Not fixed.
10. **The client summary's edit box is narrow.** In edit mode the text box takes about a third of the result panel's width, so a doctor edits a long summary in a thin column (LV-08). Not fixed.
11. **The chart's AI case summary shows a raw citation token.** On Pepper's chart the summary read "recheck [ref:soap-58e59f5-…]" (seen in the LV-11 recording, out of the main action). Not a Labs screen; not fixed.
12. **On the client's bill, the IDEXX status chip is partly hidden** under the line's provider dropdown ("Not at IDEXX yet" is cut off at 1600 px wide; LV-10). Not fixed.
9. **Cancel order is offered on a submitted order.** Labs → IDEXX results → Ordered shows **Cancel order** on an order IDEXX already has (submitted, waiting for the sample); IDEXX refuses, and Scout then says to call IDEXX. Not fixed.


Thirteen scripts are in `docs/training/scripts/labs/` (LV-01 to LV-13, list in its README). Each was walked on a private test stack: build-doctor-flow code, test database `vayd_api_test_labs_e2e`, fake IDEXX, fake Stripe, no scheduled jobs, email captured, and the shared control database off. Each script ends with "Notes from the check in the app": what was checked, what changed, and what wasn't checked.

Nothing has been recorded. The training branch (`training/videos`) is 42 commits behind build-doctor-flow and has none of the Labs fixes, so it needs build-doctor-flow merged in before any recording. Another session is recording from that branch right now, so I didn't merge.

## Questions for you

1. **A lab charged to the wrong pet (LV-11).** Scout has no way on screen to move a charge to another pet. Staff remove the line and add it again on the right pet. If a result was already entered, it stays on the wrong pet's chart and nothing on screen can move it. The LAB-07 fix (the result follows the line) only works through the API.
   *Recommendation:* add a "Move to another pet" control on lab lines, so the result moves with it; until then, LV-11 teaches "fix the charge before anyone enters a result". Or drop LV-11 for launch.
2. **Dropping an IDEXX test (LV-05, LV-10).** There are two ways, and they behave differently. Removing the charge from the bill cancels the IDEXX order, when it's the order's only test and IDEXX doesn't have the sample. **Cancel order** on Labs → IDEXX results cancels the order but leaves the charge.
   *Recommendation:* teach one way, removing the charge from the bill, and show Cancel order only as the way to clean up an order left behind. The scripts are written that way.
3. **IDEXX sandbox on the test stack (LV-03, LV-04, LV-05, LV-06).** Scout reads the IDEXX login from the practice's settings and secret store, and the IDEXX switch from the shared control database. With the control database on, the stack would also get the real Gmail, OpenPhone and Stripe keys (that's how three test emails reached you on Nov 8). With it off, IDEXX is switched off.
   *Recommendation:* a small test-only change: when the database name contains "test", the API takes the sandbox login from `.env` (IDEXX_VCP_USERNAME, IDEXX_PIMS_ID and a password variable) and turns IDEXX on, with the control database still off. That's product code, so I haven't made it. The other way is to record IDEXX's own page (LV-04 steps 3 to 7) on its own and keep the fake for the rest.
4. **Who edits lab forms (LV-13).** Vets and lead techs are allowed to edit forms (LAB-A8), but the editor is inside Settings, which is admin-only (possible bug 1).
   *Recommendation:* open Settings → In-House Lab Forms to anyone allowed to edit forms, then record LV-13 as a doctor. Until then, record it as an admin, or wait.
5. **Marking IDEXX's add-ons on the bill (LV-10).** A test the doctor added inside IDEXX looks the same on the bill as one charged in the visit.
   *Recommendation:* leave it for launch. LV-10 says Scout charges add-ons, so staff don't add them by hand.
6. **The end-of-day lab task (LV-02).** It's made at 8 pm for whoever charged the lab ("Enter results for {lab} on {pet}"). For a tech who charged it during a home visit, that's after their day ends.
   *Recommendation:* keep 8 pm for launch and say so in LV-02. If you'd like it earlier, it's in the automation settings (no code change).
7. **Record EMR V7 again?** EMR V7 shows pre-filled lab forms (its help topic already carries a video note). LV-01 and LV-02 cover the lab half.
   *Recommendation:* keep V7 for patient alerts, and point its lab half to LV-01 and LV-02 on the Help page.

## Possible bugs

No screenshots: on the probe runs the window was narrower than the page, and the screenshots cut off the Checkout column. The text of every screen is in the scratchpad files listed at the end. None of these was fixed.

1. **Vets and lead techs can't open the lab form editor.**
   - *What I did:* signed in as a veterinarian and opened Settings → In-House Lab Forms.
   - *What happened:* "Access Denied — You need admin privileges to access settings."
   - *What I expected:* the editor, because LAB-A8 gave vets and lead techs `lab_form_template.manage`, and the API accepts their edits.
   - *In a test plan?* LAB-A8 covered the API and the form itself, not how a non-admin reaches it.
2. **Matching an IDEXX result: the pet list has no owners.**
   - *What I did:* searched "Bella Maxbella" under Which pet is this? on an unmatched result.
   - *What happened:* eight rows that all read "Bella", each with Match.
   - *What I expected:* "Bella (Maxbella)", as the code intends (`petLabel` in IdexxResultsPage.tsx); the patient search rows don't carry the owner's name.
   - *Why it matters:* staff could match to the wrong household.
   - *In a test plan?* No.
3. **Matching: searching the owner's surname alone finds nothing.**
   - *What I did:* searched "Maxbella".
   - *What happened:* no results.
   - *What I expected:* that household's pets, since the box says "Pet or owner name". A one-word search only looks at pet names.
   - *In a test plan?* No.
4. **A client summary can be approved with "[doctor to add]" still in it.**
   - *What I did:* drafted a summary, clicked Edit, then Approve wording without changing anything.
   - *What happened:* "Approved … by Labs veterinarian", and the text still ends "Next steps: [doctor to add]". Email lab results then works.
   - *What I expected:* Approve wording refused until the placeholder is replaced.
   - *In a test plan?* No; LAB-03 covers approval and currency, not the placeholder.
5. **The lab email window uses invoice wording.**
   - *What I did:* clicked Email lab results.
   - *What happened:* under "Put on these patient charts" it says "Choose every pet this invoice or receipt belongs on."
   - *What I expected:* wording about lab results.
   - *In a test plan?* No.
6. **The summary's greeting changes between drafts.**
   - *What I did:* drafted twice for the same household (first name "Labs", surname "Maxbella").
   - *What happened:* "Dear Maxbella," the first time, "Dear Labs," the second.
   - *What I expected:* the same greeting every time (the client's first name). Minor; the doctor can edit it.
   - *In a test plan?* No.
7. **Unmatched results also appear under To review, with Mark reviewed.**
   - *What I did:* let a result with no Scout order arrive.
   - *What happened:* it showed under Unmatched and under To review (no pet, no doctor), and Mark reviewed was offered.
   - *What I expected:* only under Unmatched until it's matched, so nobody marks it reviewed before it's on a chart.
   - *In a test plan?* No.

Not a bug, but it needs a data task before recording: the seeded BLOOD GLUCOSE form still has the 0–500 placeholder range, so 312 saved as **Normal**. That's LAB-06 (your data task); LV-01 must be recorded after it.

## Screens that are likely to change before launch

- **Settings → In-House Lab Forms (LV-13):** who can open it (question 4), and the forms themselves (LAB-06 ranges, LAB-09 attachments).
- **Lab lines on the bill (LV-11):** depends on question 1.
- **Lab history with eVet results (LV-12):** real eVet results only show names after your eVet export is loaded (LAB-10).
- **The client summary (LV-08):** possible bugs 4 and 6.
- **Matching (LV-09):** possible bugs 2 and 3.
- **Every IDEXX video:** the training branch needs build-doctor-flow merged (the send screen's vet fix, 0f76da3, isn't pushed yet).

## Demo data

The training stack's seed (`scheduling-e2e-seed.ts` + `demo-names.sh`) has the Riveras, the Chens and the staff, but no lab forms, lab catalog items or IDEXX data. The Labs test seed (`vayd-api/test/scripts/labs-e2e-seed.ts`) has forms, labs, IDEXX codes, a staff household and eVet history, under other names (Max, Bella, Biscuit, Clover, Waffles), and its forms copy today's placeholder ranges and defaults. A Labs training setup is needed that adds the practice's real forms to the training world (copied read-only from `vayd_api_local`, with LAB-06's ranges cleared), plus the items below.

| Video | Needs | Seed today? |
|---|---|---|
| LV-01 | Rivera visit today (Dr. Lane); BLOOD GLUCOSE (no range, no default) and Heartworm 4dx forms attached to catalog labs | Forms and labs: Labs seed only (other names, placeholder ranges). Visit: training seed |
| LV-02 | Ear Cytology (write-up) attached to a lab; Chen visit today; Maple's skin cytology waiting from yesterday; an "Enter results for …" task | No write-up form in either seed; the task must be inserted |
| LV-03, LV-04 | CBC and a urinalysis add-on in the catalog with the sandbox's IDEXX codes; Juniper with no birthdate; the IDEXX sandbox (question 3); a second unfinished order (Pepper) | Codes: no (sandbox codes unknown); sandbox: not reachable yet |
| LV-05 | Orders in each state: unfinished (Pepper), submitted with no result, partial | Sandbox only |
| LV-06, LV-07 | Final abnormal CBC for Juniper, final normal for Biscuit; review tasks for Dr. Lane | Sandbox (about 5 minutes per result) or fake results |
| LV-08 | LV-06's reviewed result; AI drafting on; Maria's example.com email | Yes, once LV-06 is set up |
| LV-09 | A result IDEXX sent under a name Scout can't match ("Biscuit (Chen-Lee)") | Fake IDEXX only; the sandbox can't send an unmatched result on demand |
| LV-10 | LV-03/04's bill; a paid Rivera bill with an "IDEXX ran UA, not charged" task | Task: no; needs the add-on on a paid bill |
| LV-11 | Glucose charged to Maple instead of Pepper, not run | Easy to add in the setup |
| LV-12 | Maple: a Scout lab, an IDEXX result, an eVet 4Dx from last year (Anaplasma POSITIVE) with form definitions | eVet rows: Labs seed (Waffles), needs moving to Maple |
| LV-13 | An admin login (Robin Hale), one archived form, a "Fecal float" catalog lab | Archived form and Fecal float: no |

## Files from the check

- Screen text, one file per step: `/private/tmp/claude-501/-Users-deirdrefrey-Documents-source-vayd-enterprise-manager/368e1718-a84d-4abc-9107-4df89891e727/scratchpad/probe/` (`p1-*` in-house labs, `p2-*` IDEXX, `p3-*` bill, chart and Settings).
- The probe specs: `~/worktrees/labs-stack-fe/cypress/probes-labs/` (not committed).
