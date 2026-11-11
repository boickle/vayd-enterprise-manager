# Permissions training videos: review (Nov 9, 2026)

Scripts: `docs/training/scripts/permissions/`. There are 18 scripts: PERM-01 to PERM-07 (managing access) and ROLE-01 to ROLE-11 (what each role sees). All are for managers.

**How they were checked:**
- **Stack:** an isolated TEST stack (DB `vayd_api_test_perm`, API :3270, app :5270, fake Stripe, Redis db 14).
- **FE:** branch `training/permissions-scripts`. It was made from `training/videos`, which already holds all of `build-doctor-flow`.
- **API:** `build-doctor-flow` at 9c12db4e.
- **Logins:** demo staff from the new `cypress/training/stack/perm-seed.ts`, one login per role.
- **Probes:** `cypress/training/probes-perm/` (no voice):
  - every role's menus, Analytics, Settings, Pharmacy, Tasks, Deposits, Marketing, a client and a paid bill;
  - the PERM actions done for real (role, license, grant, offboard, audit, role editor).
- **Nothing left the stack:** no email, text or Stripe call.

The scripts' step tables were corrected to what the app actually shows. Each script ends with "Notes from the check in the app".

## Status after your answers (Nov 9, 2026)

**Answers:**
1. Yes.
2. Yes.
3. Yes, all field staff, managers and CLs (they already had it), plus both mail order roles and Executive.
4. Hide.
5. Keep the Relief Veterinarian part.
6. Not answered, so I left it alone.

**Bugs, all fixed** on `fix/rp-video` (API and web, both off `build-doctor-flow`), as RP-A11 to RP-A18 in the roles test plan:

| Bug | Fix |
|---|---|
| 1. Offboard "Works with" | RP-A11 |
| 2. "Take a payment" | RP-A12 |
| 3. "View client and patient records" | RP-A13 |
| 4. Observer booking, and read-only roles seeing booking and client buttons | RP-A14 |
| 5. Practice Manager role-definition controls | RP-A16 |
| 6. Medical Director and Staff | RP-A15 |
| 7. Access-denied wording | RP-A17 |
| 8. Analytics link for mail order | RP-A17 |
| 9. Direct link to a report opened Payments (RP-A10) | fixed the same day by another session's B2; my version gave way to theirs in the merge |

The Practice Manager now sees analytics for every doctor (RP-A18). The euthanasia consent text no longer names doctors.

**Demo data:** `perm-seed.ts` now adds a week of made-up production for Dr. Ortiz and Dr. Ruiz. The scripts are updated to the fixed screens. Re-check them in the dry run once `build-doctor-flow` (with these fixes) is merged into this branch.

## Questions for you

1. **Should the Medical Director open Settings → Staff?** D1 says the Medical Director sets licenses, but the Staff section opens only for `staff.employee.manage`, `staff.login.manage` or `staff.role.assign`. So today the Medical Director can't reach anyone's Access tab.
   - *Recommended:* also open the Staff section (Access tab only) for `staff.license.manage`. This is a small web fix in `settingsTabAccess.ts`.
2. **Should the Practice Manager see analytics for every doctor?** Only the Practice Admin and Executive hold "Analytics for every doctor". The Practice Manager (and the Medical Director) see practice totals, and doctor-level detail only for doctors linked to their login. In production the Practice Manager's login is linked to one doctor.
   - *Recommended:* yes for the Practice Manager; leave the Medical Director as is.
3. **Which roles should "View client and patient records"?** The Controlled Substances Director, Mail Order Manager, Mail Order Team and Executive don't hold it in the catalog. The client record opens for them anyway, because the check isn't enforced (see bug 3).
   - *Recommended:*
     - give it to both mail order roles (they ship to clients) and the Executive (read-only);
     - leave it off the Controlled Substances Director unless that person needs charts;
     - then enforce it.
4. **What should a read-only role (Observer, Executive) see on Home?** Today they get **+ Appointment**, **+ New Client**, **Send Room Loader**, **New Task** and **+ Forward Booking**. On a client they also get **Deactivate** and **Send Reset Password**. Booking and client edits are "Not enforced yet", so these buttons work for them.
   - *Recommended:* hide those quick actions and client buttons for roles without the matching permission, and enforce booking (RP-P1) before Observer is used.
5. **Relief Veterinarian has no holders.** Keep it in ROLE-03 as a short part 2, or cut it?
   - *Recommended:* keep it short.
6. **Rename "Executive (read only)" to match the Roles page?** The Profile tab's role checkboxes say "Executive (read only)"; the Roles page says "Executive (read-only)".
   - *Recommended:* use "Executive (read-only)" everywhere.

## Possible bugs

None are fixed. Screenshots are in `~/.vayd-training-perm/probes/cy/screenshots/` (later runs overwrite some). The text captures are in `~/.vayd-training-perm/probes/*.txt`.

1. **Offboard lists the departing vet under "Works with" themselves.** Every vet's login is linked to themselves as the doctor (all 15 in production).
   - *What I did:* opened Offboard for Dr. Riley Rivera.
   - *What happened:* "Works with Riley Rivera" lists **Riley Rivera** first, then Tess Holt. Saving with the default "Clear (works with no one)" also unlinks her own login. The audit row shows `{"userId":<her login>,"doctorId":null}`.
   - *Expected:* only other people's logins.
   - *Where:* `OffboardingService.preview` (`users.doctor_id = $1`, no `u.employee_id <> $1`).
   - *Already in a plan?* No.
   - *Evidence:* `st-practice_admin-riley-offboard-lastday.txt`, plus the API preview JSON.
2. **"Take a payment" is checked only for account-credit payments.** `POST /visit-invoices/:id/tenders` checks `payment.take` only when the method is account credit (and `gift_card.redeem` for gift cards). Cash, check, card and CareCredit tenders go through for any staff login.
   - *What happened:* an **Observer** and an **Executive** each recorded a $1 cash payment (HTTP 201).
   - *Expected:* 403 for both.
   - *Also:* the role editor doesn't tag `payment.take` "Not enforced yet", because a text search finds its one check. Managers will think switching it off works.
   - *Already in a plan?* No: not in roles-and-permissions or invoicing-and-payments.
3. **"View client and patient records" isn't checked on the client record.** `client.view` is checked only on the pay-link route and Gmail records, so the role editor wrongly treats it as enforced.
   - *What happened:* the Controlled Substances Director, Mail Order Team and Executive each opened the Chens' full record and bill.
   - *Already in a plan?* No. RP-A7 lists unenforced keys, but this one is miscounted.
4. **An Observer can book a visit.**
   - *What happened:* `POST /appointments` as the Observer returned 201. The test visit was removed afterwards, and no email went out.
   - *Already in a plan?* Covered by RP-A7/RP-P1 (`routing.book` and `calendar.book_manual` are "Not enforced yet"). It contradicts "Observer changes nothing", so it's listed here for the role tours.
5. **The Practice Manager sees role-definition controls that fail.** On Settings → Staff → Roles, the Practice Manager gets **Add**, **Name / Slug / Description**, **Is branch-specific** and **Save role**.
   - *What happened:* the API refuses them with 403 "You do not have permission to: Edit the role definitions and their permissions".
   - *Expected:* hidden or read-only without `role.definition.manage`, the way the "What can a … do?" editor already is.
   - *Already in a plan?* No.
6. **The Medical Director can't reach Settings → Staff** (see question 1).
   - *What happened:* `/schedule/settings?tab=employee-directory` as Dr. Ruiz falls back to Euthanasia consent.
   - *Already in a plan?* No. It's a gap left by RP-04/D1.
7. **Wrong advice on the "isn't part of your access" message.** It says "Ask a practice manager if you need it — they can grant it from Employee Settings."
   - *What's wrong:* only a practice admin can grant, and the screen is Settings → Staff → Access.
   - *Where:* `src/permissions/PermissionGate.tsx` (default `who`). It shows on every blocked page that uses it, for example Bank deposits for a client liaison.
   - *Already in a plan?* No.
8. **The Analytics link shows for the mail order roles, then says "You don't have access to any analytics pages."** Minor. Not in a plan.
9. **A direct link to /schedule/analytics/vsd opens Payments for the Practice Manager.** Already in the plan as RP-A10.

## Screens that may change before launch

- **Permission Audit Log, "What changed":**
  - role changes show raw data (`0: — → {"name":"Technician","slug":"technician","office":"Raleigh office",…}`);
  - the offboard row shows `worksWith: [{"userId":…}]`.
  - Readable, but it looks unfinished. PERM-05 points at the license and grant rows instead. Tidy it first if you want role rows on camera.
- **Euthanasia consent settings name real doctors** in help text: "Nina and most doctors", "Dr. Greenlaw", "Julie Greenlaw". These are on the Veterinarian's and Medical Director's Settings landing page (ROLE-02, ROLE-03). Either change the copy or keep them off camera.
- **Any screen where read-only roles see action buttons** (Executive, Observer): record ROLE-07 and ROLE-11 after questions 3 and 4 are settled.
- **Profile tab "Roles" hint:** it says "Assign roles on the Profile tab", but office roles are on Staff → Roles. PERM-02 shows both.
- **Settings menus:** these are dropdown tabs across the top (Practice ▾, Scheduling ▾, Staff ▾, Inventory ▾, Finance ▾, Communication ▾), not a left list. The scripts now say "Staff ▾ → Roles".

## Demo data each video needs

The seed `cypress/training/stack/perm-seed.ts` exists and was used. Run it after `stack-up.sh`:

```
cd "$API_DIR" && NODE_ENV=test npx tsx "$FE/cypress/training/stack/perm-seed.ts" "$TRAINING_DB" "$TRAINING_WORK/stack/perm.json"
```

`record.sh` restarts the stack after 3.5 hours, which wipes this data. Re-run the seed after any restart. The probes read the tokens from `perm.json` (`CYPRESS_PERM_WORLD`); the recording specs will need the same.

| Video | Needs | Seed exists? |
|---|---|---|
| All | One login per role, with demo names. Offices are Raleigh and Durham only; leftover test staff and offices are hidden; roles have production names and per-office settings. | Yes (perm-seed.ts) |
| PERM-01, 02, 03 | Tess Holt (Technician, Raleigh); Sam Chen with no role and not licensed | Yes |
| PERM-04 | Dr. Riley Rivera (vet at both offices) with 3 visits 7 to 9 workdays out, the Chens' primary doctor, 2 open tasks; Tess Holt works with her | Yes |
| PERM-05 | An empty audit log at the start, then the changes from PERM-02, 03 and 06 (record in that order, or seed the rows) | Partly (seed empties the log) |
| PERM-06 | Lou Bennett (Client Liaison); Dana Cole (Lead CL) | Yes |
| PERM-07 | — | Yes |
| ROLE-01, 07 | Payments in the last 7 days, for a lived-in Analytics; one draft email campaign (ROLE-07) | Payments partly (leftover test payments show $550); campaign: no |
| ROLE-03 | Production for Dr. Ortiz in the last 7 days | Yes (perm-seed.ts, made-up lines) |
| ROLE-04, 05, 08, 11 | A paid bill on the Chens ($75 cash, Office exam) | Made by hand in this check (API calls); add to the seed |
| ROLE-06 | Count items due this week at Raleigh office | No (inventory training seeds may have it) |
| ROLE-09 | Controlled-drug stock, counts and doses | No |
| ROLE-10 | A pending mail order and an auto-ship | No (check the online-store training branch) |

## Not done yet

- **Voiced dry runs.** No narration files or recording specs exist yet; the walk was done by probe specs without voice. Each video still needs `<name>.cy.ts` + `narration/<name>.json`, written when you approve recording.
- **Nothing committed.** The files are uncommitted on `training/permissions-scripts` in `~/worktrees/perm-train-fe`.
