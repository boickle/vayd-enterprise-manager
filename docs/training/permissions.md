# Permissions training videos: review (updated Nov 12, 2026)

Scripts: `docs/training/scripts/permissions/`. There are 18 scripts: PERM-01 to PERM-07 (managing access) and ROLE-01 to ROLE-11 (what each role sees). All are for managers.

## Where things stand (Nov 12)

- **All 18 videos are recorded and narrated**, in `~/Movies/VAYD Training`. None is linked from a Help topic yet.
- **Approved (file name has "FINAL"):** PERM-01 to PERM-07, ROLE-01 and ROLE-02.
- **Waiting for your review:** ROLE-03 to ROLE-11.
- **File names and Help:** "FINAL" in a file name is fine. The Help page shows the topic's own title, never the file name. A topic's `video_source:` can be just the code (for example `PERM-01`): `npm run help:videos` uploads the file whose name starts with it, and prefers the FINAL one if two share the code (API c0cc7260, Nov 12).
- **ROLE-07 (Executive) shows the old client record.** It was recorded on Nov 11 at 4:45 am, before the B7 fix, so it probably shows the editing pencils and **Save household defaults**. The Executive no longer sees those. ROLE-11 (Observer) opens only a paid bill, so it should be unaffected. Re-recording is your call.
- **Training branch:** `training/permissions-scripts` is pushed, with the 18 specs, narration, `permRecord.ts`, the probes (p01 to p08), `perm-seed.ts` and these docs. `build-doctor-flow` was last merged into it on Nov 12, after the state-license feature.
- **State licenses** are on `build-doctor-flow`: API f8bbcec3 and app 8ee2c96f (Nov 12).

## Bugs found and fixed

The first nine came from the Nov 9 check (RP-A10 to RP-A18 in `vayd-api/docs/test-plans/roles-and-permissions.md`). B1 to B7 came from recording the videos (Nov 10–11). The last two are from Nov 12.

| # | Bug | Fix | Where |
|---|---|---|---|
| 1 | Offboard listed the departing vet under "Works with" themselves, and unlinked their own login | RP-A11 | API |
| 2 | "Take a payment" was checked only for account-credit tenders; an Observer and an Executive each recorded a $1 cash payment | RP-A12 | API |
| 3 | "View client and patient records" wasn't checked on the client record | RP-A13 (every role now holds it) | API |
| 4 | An Observer could book a visit; read-only roles saw booking and client buttons | RP-A14 | API + app |
| 5 | Practice Manager saw role-definition controls that then failed | RP-A16 | app |
| 6 | The Medical Director couldn't reach Settings → Staff | RP-A15 (Access tab only) | app |
| 7 | "Isn't part of your access" message gave the wrong advice | RP-A17 | app |
| 8 | Analytics link showed for mail order, then said "no access" | RP-A17 | app |
| 9 | A direct link to a report opened Payments | RP-A10 (another session's B2) | app |
| B1 | Hovering a permission on the Access tab showed the role's code ("technician"), not its name | d482307f | API |
| B2 | "See the full Permission Audit Log" reloaded the whole app (about 3 s blank) | e98f2b61 | app |
| B3 | Audit log "What changed" showed raw data for role changes and offboards | e98f2b61 | app |
| B4 | Default office stayed on the practice default after a role was given at another office | d482307f (the role's office becomes the default office if there was none) | API + app |
| B5 | Audit log grant and license rows showed field names and a raw date | fc3216f9 ("Extra permission given: … / Ends: Nov 25, 2026", "Not licensed → Licensed technician") | app |
| B6 | Offboarding showed the last day as "2026-11-13" | fc3216f9 ("Nov 13, 2026") | app |
| B7 | Executive and Observer could edit, create, deactivate and merge clients and patients | c1aff0fe (API guard) + fc3216f9 (pencils, Save, Deactivate, Upload records hidden) | API + app |
| B8 | Executive and Observer still saw every write button on a pet's chart, and the server accepted chart notes, encounters, problems, medications, invoices, reminders, records requests, form sends, client texts, pet photos and new tasks from them | d25bb104 (API) + c28f1127 (app) | API + app |
| B9 | Rebuilding the API failed: `sharp` was missing from package.json | Already fixed by 808296b8 / 70ae8e7d (sharp 0.35.5) | API |

## Decisions

| Date | Question | Your answer |
|---|---|---|
| Nov 9 | Should the Medical Director open Settings → Staff? | Yes (Access tab only) |
| Nov 9 | Should the Practice Manager see analytics for every doctor? | Yes; Medical Director unchanged |
| Nov 9 | Who views client and patient records? | All field staff, managers and CLs, both mail order roles and Executive; the CS Director too (Nov 10) |
| Nov 9 | Buttons read-only roles can't use | Hide them |
| Nov 9 | Relief Veterinarian in ROLE-03 | Keep it, as a short part |
| Nov 10 | "Executive (read only)" vs "(read-only)" | "Executive (read-only)" everywhere (6fa4db44) |
| Nov 10 | Default office when someone gets their first office role | That office becomes their default office (B4) |
| Nov 11 | Who may edit client records? | Every role except Executive and Observer, including Inventory, Mail Order and the CS Director |
| Nov 12 | Executive and Observer on a pet's chart | Read everything, change nothing: hide every write button and refuse the writes on the server |
| Nov 12 | Doctor license numbers | A doctor can hold a license in several states. Each state's number is entered in Settings → Staff → Profile → State licenses. The Maine license prints on certificates, Rx labels and written prescriptions, and fills the **Doctor license number** template field |
| Nov 12 | DEA numbers | Not kept in Scout. They stay with controlled substances in Vet Snap. A DEA number is one federal number per doctor, so a controlled prescription gets it written by hand |

## Tests

**Probes** (`cypress/training/probes-perm/`, no voice; run one with `bash cypress/training/probes-perm/run-probe.sh <name>` on the perm stack):

| Probe | Covers | Last result |
|---|---|---|
| p01-menus | Every role's top menu and quick actions | Run Nov 9: captures, not pass/fail checks; found bugs 1–9 |
| p02-pages | Analytics, Settings, Pharmacy, Tasks, Deposits, Marketing per role | Run Nov 9: captures, not pass/fail checks; found bugs 1–9 |
| p03-settings | Settings tabs per role | Run Nov 9: captures, not pass/fail checks; found bugs 1–9 |
| p04-client | A client and a paid bill per role | Run Nov 9: captures, not pass/fail checks; found bugs 1–9 |
| p05-walk | The PERM actions done for real (role, license, grant, offboard, audit, role editor) | Run Nov 9: captures, not pass/fail checks; found bugs 1–9 |
| p06-mailorder | Mail order roles' screens | Run Nov 9: captures, not pass/fail checks; found bugs 1–9 |
| p07-exec-edit | Executive's client and pet pages show no write buttons; technician still has them; who may save a client (Executive and Observer 403; Inventory, Mail Order Team, CS Director, CL, Technician 200); 12 chart write routes refused for Executive and Observer, open to a technician, reads still 200 | 4 of 4 passed (Nov 12) |
| p08-licenses | Save and read state licenses, Maine license prints, second license in one state refused, DEA number refused ("kept in Vet Snap"), Executive and technician can't change licenses, Medical Director can; Profile tab shows the list | 2 of 2 passed (Nov 12) |

**Unit tests added:**
- API `staff-client-write.guard.spec.ts`:
  - Executive and Observer are blocked; every other role and admin logins pass;
  - reads (GET/HEAD) pass, so the guard sits on whole chart controllers.
- API `employee-license.rules.spec.ts`: one license per state; DEA refused; which number prints.
- App:
  - `SettingsPermissionAudit.test.ts`: grant, license, offboard and license-list wording;
  - `formatYmd.test.ts`;
  - `employeeLicenses.test.ts`: the Doctor license number lookup.

**Runs:**
- API permission tests 75/75.
- Controller specs 48/48.
- App tests 1368/1369 on the training branch. The one failure was a WasteAdjust test that passes alone and fails only under load.
- License tests: API 14/14, app 52/52.

## Still open

1. **ROLE-07 shows the old client record.** Re-record it or keep it (see "Where things stand").
2. **Review ROLE-03 to ROLE-11**, and add "FINAL" to each one you approve.
3. **Household default fields look editable to Executive and Observer.** They're switched off, but not greyed out. Cosmetic.
4. **The Medical Director can't type license numbers on screen.** They see only the Access tab; the State licenses section is on the Profile tab. The server would accept their save.
5. **Doctor license number template field:** checked only by a unit test, not in a real compose window.

## Test stack

- **DB:** `vayd_api_test_perm`.
- **Ports:** API :3291, app :5291, fake Stripe :4041, fake OSRM :4051, Redis db 11. These moved on Nov 12 from 3270/5270, Redis 14, because the inventory stack took those.
- **Before stack-up**, check every port with `lsof -iTCP:<port> -sTCP:LISTEN`.
- **Never run `stack-down.sh` while another session holds your ports:** it kills whatever listens on them.

Seed after every `stack-up.sh` (in the same shell, so the probes get the tokens):

```
cd "$API_DIR" && NODE_ENV=test npx tsx "$FE/cypress/training/stack/perm-seed.ts" "$TRAINING_DB" "$TRAINING_WORK/stack/perm.json"
```

- The test practice is in North Carolina (seed data). Production is Maine.
- The first page load after a fresh stack can take over 2 minutes and time Cypress out. Load the app once first, then run the probe.

## Demo data each video needs

| Video | Needs | Seed exists? |
|---|---|---|
| All | One login per role, with demo names. Offices are Raleigh and Durham only; leftover test staff and offices are hidden; roles have production names and per-office settings. | Yes (perm-seed.ts) |
| PERM-01, 02, 03 | Tess Holt (Technician, Raleigh); Sam Chen with no role and not licensed | Yes |
| PERM-04 | Dr. Riley Rivera (vet at both offices) with 3 visits 7 to 9 workdays out, the Chens' primary doctor, 2 open tasks; Tess Holt works with her | Yes |
| PERM-05 | An empty audit log at the start, then the changes from PERM-02, 03 and 06 | Partly (seed empties the log) |
| PERM-06 | Lou Bennett (Client Liaison); Dana Cole (Lead CL) | Yes |
| PERM-07 | — | Yes |
| ROLE-01, 07 | Payments in the last 7 days; one draft email campaign (ROLE-07) | Payments partly; campaign: no |
| ROLE-03 | Production for Dr. Ortiz in the last 7 days | Yes (made-up lines) |
| ROLE-04, 05, 08, 11 | A paid bill on the Chens ($75 cash, Office exam) | Made by API calls; add to the seed |
| ROLE-06 | Count items due this week at Raleigh office | No |
| ROLE-09 | Controlled-drug stock, counts and doses | No |
| ROLE-10 | A pending mail order and an auto-ship | No |
