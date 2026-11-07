# Scheduling and Routing training videos: review (Nov 7, 2026)

**Update, Nov 7 afternoon: owner answers and fixes.**
- **B6 fixed:** signed-in clients see online times again. vayd-api `aad845c8`, 4 unit and 3 integration tests; checked on the stack.
- **Q12 done:** practice managers (anyone with `appointment_type.manage`) see **Closed days** in Settings. Frontend `33469aa`; checked on the stack, where a manager login added Nov 26.
- **Q1 and B1 fixed:** Reschedule and Explore alternatives now ask "Reschedule which visits?" (**Only <pet>** or **All N visits**) when the household has other visits that day, and the visit that was right-clicked is the one moved. Frontend `f329460`, 3 unit tests (2 fail without the fix); full frontend suite passed (853 tests); checked on the stack.
- **Q2 answered:** techs and other doctors may remove or move any visit. B2 is intended, not a bug.
- **Q3 answered:** `main`'s changes are minor and don't block recording.
- **Q5:** the owner will set each role's hand-booking types before launch (in-office visits, notes to staff, and others).
- **Q13 done:** a fictional record, `cypress/training/setup/maplewood-biscuit-records.pdf` (Maplewood Animal Hospital, Biscuit Chen; typed; vaccines with due dates; behavior caution).
- **Q14 done:** the training stack scripts read `stack/stack-env.sh` (database, ports, Redis database, work folder). Text capture is optional (`TRAINING_SMS_CAPTURE=1`), and `demo-names.sh` applies the demo-data fixes in section 4.
- **Committed and merged:** all three code fixes are on `build-doctor-flow` and merged into `training/videos` (`44da890`). Not pushed.


Scripts: `docs/training/scripts/scheduling-routing/`. Checked on a training stack of its own:
- database `vayd_api_test_sched`;
- API :3220 and app :5220;
- fake Stripe and fake routing (every drive is 15 minutes);
- email and texts captured to a file;
- no scheduled jobs.

The frontend was `training/videos` with `build-doctor-flow` merged in (5a13205). The API was `build-doctor-flow` (221ea76a).

Screenshots and text captures: `/private/tmp/claude-501/-Users-deirdrefrey-Documents-source-vayd-enterprise-manager/a1c1fd8f-8d80-499f-938f-62df35f250af/scratchpad/shots/` and `…/scratchpad/text/`. Both are temporary; copy them before the session ends if you want them kept.

**Gmail on the training stack:** the API logs `[GmailUsage] … threads.list` lines, but there are no stored tokens and no service account. Every call fails with "No OAuth token stored", so the stack can't read or send real practice mail. It also means Email client, Gmail labels and Go to Gmail thread can't be shown on it.

## 1. Questions for you

| # | Question | Where | My recommendation |
|---|---|---|---|
| Q1 | When a CL reschedules one pet's visit, should every visit the household has that day move with it? Today, Reschedule on Juniper's 1:30 visit also picks up Maple's 9:00 visit ("Moving Juniper, Maple"), and the **Reschedule appointment** window has no way to leave a pet out. | SR-05 | Move only the visit that was right-clicked. Offer "also move Maple's 9:00 visit?" as a choice, unticked. |
| Q2 | What should "own visits" mean for doctors and techs cancelling or moving visits? The permission list gives doctors and techs "own" scope for **Remove** and **Reschedule**. In the app, a tech and a second doctor could both remove Dr. Lane's visit. | SR-02, SR-05 | "Own" = visits where they are the primary provider or an added provider. Enforce it on the server, or change the permission list to "all" if that's what you want. |
| Q3 | Merge `main` (7 commits) and the open Cursor fix branches into `build-doctor-flow` before recording? Several change screens in this series: the online request form checks record uploads before earlier dates; text offers sign with the CL's name; reminders use the type's arrival window; requests require weight and the previous vet. | SR-06, 07, 08, 21, 24–26 | Yes, before recording those videos. I'll re-check them after the merge. |
| Q4 | How many active doctors in production have no eVet ID? The read-only check on `vayd_api_local` was blocked. Any such doctor shows as "Doctor <number>" in Get Best Route results (bug B3). | SR-03, SR-05 | Run a quick count. If any, fix B3 before launch. |
| Q5 | Which visit types may each role book by hand (**Settings → Roles**, manual booking types)? On the test stack no role had any, so the hand-booking window offered no types. | SR-04 | CLs and lead CLs: Medical Visit, Recheck, Wellness, Pre-Meds. Doctors: the same, on their own calendar. Euthanasia and QOL through routing only. Check production before recording. |
| Q6 | Should doctors have a **My Day** page? `/schedule/my-day` exists (List and Visual views, Day Metrics, Google Maps, Create PDF), but nothing in the menus opens it. **My Week** is switched off in the code in favour of the practice calendar. | SR-15 | Keep the calendar as the doctor's view for launch (SR-15 is written that way). Either link My Day from the calendar or remove the page later. |
| Q7 | Is the On My Way wording right? It reads "Hi it's your VAYD team with Vet At Your Door. I wanted to let you know we are 15 minutes away!" | SR-16 | "Hi, it's Dr. Lane's team from Vet At Your Door. We're about 15 minutes away!" (uses the doctor's name) |
| Q8 | In Start / End Visit, is a follow-up plan required when saving the end time? The window says both "Follow-up is required when you save end time" and "Optional here — checkout asks this…". | SR-16 | Optional when the visit goes through checkout. Change the first line to say so. |
| Q9 | How does a family hear their visit time when a CL books their online request? Booking from **Appointments → Book** sent no email to the family (only "We Received Your Appointment Request" at submit). | SR-06 | Send the normal booking confirmation (email and text) when a request is booked. Until then, CLs call or text the time. |
| Q10 | Should Care outreach list pets with no assigned provider, and reminders due soon? A rabies reminder due in 10 days for Juniper (no assigned provider) didn't appear under **Due in next 21 days (0)**. A past-due exam for Biscuit did. | SR-12 | List them, under "Unassigned provider", so nothing is missed. |
| Q11 | Should follow-up targets skip days the practice is closed? A 2-week follow-up and a care-outreach route both targeted a Saturday. | SR-10, SR-12 | Yes, move to the next working day. Low priority. |
| Q12 | Who should manage closed days, staff hours and zones, visit types and roles on screen? **Settings** shows its full page only to admin logins (`isAdmin` in `pages/Settings.tsx`). A practice manager without an admin login sees only "Settings: Memberships", although the permission list gives managers `staff_schedule.manage`, `appointment_type.manage` and `schedule_override.manage`. | SR-18, SR-19, SR-04 (roles) | Show each Settings section to anyone with its permission. Until then, give practice managers admin logins. |
| Q13 | The sample record for SR-26. Please send one that's anonymized or made up, renamed to a Rivera or Chen pet, typed (not scanned), with vaccines and due dates. On the test stack its text goes to OpenAI for the summary, and the file may go to the dev storage bucket. | SR-26 | Made-up record, "Maplewood Animal Hospital", Biscuit Chen. |
| Q14 | Should the training stack scripts (`cypress/training/stack/*`) take a database name, ports, Redis database and work folder, so two training sessions can run at once? Today they're fixed, and a second session would wipe the first one's database. I used a scratchpad copy. | All | Yes. A small change to training files on `training/videos`; I'd do it once you approve. |

## 2. Possible bugs

| # | What I did | What happened | What I expected | In a test plan? | Evidence |
|---|---|---|---|---|---|
| **B6 (launch blocker) — FIXED** | Signed into the portal as Maria Rivera (existing client), opened **Request an appointment**, picked Maple, a reason and **Flexible** | "We'll handle scheduling for you. Online self-booking isn't available for this visit." No times offered, for any pet or reason. | Times offered, as on `main` today | No. The SCH-04/05/06/14 Cypress specs replace `/employees/veterinarians` with a fixture, so they can't catch it | Cause: `GET /employees/veterinarians` passes client logins through `clientSafeEmployees` (`vayd-api src/auth/client-safe-views.ts`, added Oct 29 in c90726b0). `appointmentTypes` isn't in `PUBLIC_EMPLOYEE_FIELDS`, so the form sees no online-bookable types (`utils/onlineBooking.ts` `canBookOnline`). A staff login gets 7 types for the same doctor; a client login gets 0. Not on `main`. The anonymous new-client form uses `/public/appointments/veterinarians`, which still includes the types. `text/sr07-howsoon-Maple.txt` |
| B7 | Signed into the portal as Maria (login email different from the email on her client record) and submitted a request | The server created a **second** "Maria Rivera" household and saved the request against it. **Book** from the queue then failed: "Patient is not linked to this client". | The request uses the signed-in client's own household | No | The household is matched by email (`ensureScoutHouseholdFromRequest`), not by the logged-in `clientId`. On the test stack the mismatch came from demo data. In production it would hit any family whose login email differs from their record. `shots/sr06-queue.cy.ts/sr06-after-click.png` |
| B8 | Booked an online request from **Appointments → Book** | The request moved to Booked, but the header kept saying "0 of 1 requests converted to appointments (0.0%)" | 1 of 1 (100%) | No | `text/sr06-queue-after.txt` |
| B9 | Added Maria Rivera to the waitlist (Wellness, Next 2 weeks), then **Recommend slot** | Get Best Route opened as FORWARD BOOKING "1 month out · Target: Mon, Dec 7, 2026", with no doctor or type filled in | A search within the next 2 weeks, with the waitlist entry's type | No | Possibly my click on "Next 2 weeks" didn't register; re-check. `text/sr08-recommend.txt` |
| B1 — FIXED | Right-clicked Maple's 3:00 pm Recheck (Maple also had a 9:00 visit that day; Juniper had 1:30) and chose **Scheduling → Reschedule**, then Get Best Route, **View Placement**, **Reschedule** | The **Reschedule appointment** window listed Juniper (1:30) and Maple's **9:00** visit, not the 3:00 pm visit I clicked. Confirming would have moved the wrong visits. | It moves the visit I right-clicked | No | `shots/sr-routing.cy.ts/sr05-after-reschedule.png`, `text/sr05-reschedule-modal.txt` |
| B2 — intended (Q2) | Signed in as Jordan Pike (tech), then as Dr. Priya Shah, and removed a visit of Dr. Lane's | Both succeeded: the visit was cancelled with their reason | Refused ("own" scope), or see Q2 | SCH-A2 enforced the keys but not the "own" scope | `text/sr02-tech-saved.txt`, `text/sr02-shah-saved.txt` |
| B3 | Get Best Route with a doctor who has no eVet ID (`employees.pimsId` null) | Every result card says "Doctor 7673" instead of the doctor's name. The screen looks names up with `/employees/pims/<id>`, which fails without an eVet ID (`Routing.tsx`, around line 3931). | The doctor's name | No | `text/sr05-reschedule-results.txt` (first run) |
| B4 | Reschedule from Get Best Route, then Get Best Route | A "Before routing — Other scheduled visits" check lists the visit being moved as an "other" visit and asks to **Search anyway** | The visit being moved is left out | No | `text/sr05-reschedule-results.txt` |
| B5 | Get Best Route for Biscuit when he already had a recheck at 11:00 that day | The best result was Biscuit at 10:50, overlapping his own 11:00 visit | The pet's own visit is avoided, or the warning names it | No | `text/sr03-results.txt` (first run) |

## 3. Screens that look half-built or likely to change

- **Misspelled title:** "Book appointment - MANUAL OVERIDE" (hand booking, SR-04).
- **My Day and My Week pages:** not reachable from the menus (Q6). A `PreviewMyDayModal` with a My Day / My Week switch is used only by `pages/MyMonth..tsx` (note the double dot), which no route uses.
- **On My Way:** **Minutes away** isn't filled in from the route. A visit two days away showed 2715, and the send button stays off until it's changed.
- **Settings → Staff:** the **Schedule overrides by day** picker is labelled "Employee (doctor)" but lists every login, CLs included.
- **Holds card wording:** "Placed: Sat Nov 7, 11:17 AM (Just now ago)".
- **Care outreach** opens on a view that says "No reminders match the current filters" until a priority is clicked.
- **Texted offers help text** says offers come "from care outreach or schedule loader". The waitlist sends them too.
- **Not production banner** ("Not production — you are using a development or staging environment") shows at the top of every screen on the training stack. Crop it, or hide it on the recording stack.
- **Off-production buttons** appear on the training stack: **Send to actual client** (On My Way). Record on a stack where they're hidden, or crop.
- **Get Best Route hint while rescheduling:** "Reschedule: client loaded. Run routing, open My Week, then confirm the new time." The calendar is already open beside it, and the steps are different (View Placement, Reschedule).
- **Layout:** at 1600 px, **Work Zones Map** overlaps the APPOINTMENT TYPE label above the calendar.

## 4. Demo data each video needs

The seed (`vayd-api test/scripts/scheduling-e2e-seed.ts` plus `cypress/training/stack/demo-names.sh`) gives:
- the practice and the North zone;
- Dr. Avery Lane and Dr. Priya Shah (Mon–Fri 8–4), Jordan Pike (tech), Casey Morgan (CL) and Robin Hale (manager);
- the Riveras (Maple, Juniper, Pepper) and the Chens (Biscuit);
- the visit types.

Each video's visits are booked by its spec through the API (`cypress/training/probes-sr/srKit.ts`: `srBook`, `demoDay`, `resetDemo`).

| Video | Needs | Seed exists? |
|---|---|---|
| SR-01 | Dr. Lane's day: Maple 9:00, Biscuit 11:00, Juniper 1:30 | Yes (seed + `demoDay`) |
| SR-02 | A not-started Maple visit; a started Biscuit visit (`POST /appointments/:id/actual-start`); a HOLD | Yes (spec books them) |
| SR-03 | Riveras booked, Chens free | Yes |
| SR-05 | Biscuit alone that day (one visit), Maple on another time | Yes (spec) |
| SR-15 | Dr. Lane's day as in SR-01 | Yes |
| SR-16 | A visit **today** for Biscuit (record on a weekday). Texts allowed for the Chens (`clients.doNotSms` false and `users.allowText` true), a text capture on the stack, and a Quo line for Dr. Lane if the video should show "sends from Dr. Lane's line" | Partly: I set these by hand on the test stack, and the text capture is a scratchpad preload (`scratchpad/stack/sms-capture-preload.js`). Needs adding to the training stack scripts |
| SR-06 | One portal request from Maria (spec submits it through the form); a second request for Not booked | Yes (spec). Needs Maria's login email = her record email (fix `demo-names.sh`) |
| SR-07 | Same as SR-06; a real geocodable address; visit types flagged for the form | Partly (set by hand) |
| SR-08 | Juniper (only) on the waitlist, nothing booked; texts allowed; the stack's public app URL set to the recording app (the link uses port 5173); the CL login's name set to Casey Morgan (the CL column shows "Hsch") | Partly (spec adds the entry; the URL and name need `demo-names.sh`) |
| SR-09 | Biscuit booked with Dr. Lane; a second family on the waitlist with nothing booked | Yes (spec) |
| SR-10 | A pending follow-up (`POST /forward-bookings`): Maple, Recheck in 2 weeks with Dr. Lane | Yes (spec) |
| SR-11 | A HOLD visit for Biscuit with a note | Yes (spec) |
| SR-12 | A past-due reminder for Biscuit, nothing booked (inserted into `reminders`) | No: inserted by SQL on the test stack; add to the seed |
| SR-18 | Dr. Lane's weekly schedule (seeded). An admin login for Robin Hale (seeded logins are not admins; I minted an admin token on the test stack). Hide leftover test branches and logins | Partly |
| SR-19 | No closed days; admin login | Yes, with the admin login |
| SR-17 | Juniper with a future visit, a pending follow-up and a reminder | Yes (spec + reminder by SQL) |
| SR-24, SR-25 | Biscuit booked 2 days out; Maplewood Animal Hospital in **Settings → Practice → Outside Hospitals** (or typed as a one-off) | Partly (one-off works; add the directory entry) |
| SR-26 | The sample record (Q13) | No |
| SR-04 | Same as SR-03; the Client Liaison role allowed to hand-book Recheck, Wellness and Medical Visit | No: set by API on the test stack. Add it to `demo-names.sh` |

**Demo data fixes needed before any recording** (test database only):
- Give the demo households real, geocodable Raleigh addresses. The stack geocodes through Google: "100 Test Lane, Raleigh, NC 27601" (no comma) came back in Maine, so the online form found no zone and no doctors.
- Flag the demo visit types for the request form (`showInApptRequestForm`, `newPatientAllowed`). I set Medical Visit, Recheck and Wellness by hand.
- Give the demo pets clean record numbers. They show as "Maple (#hsch-…-householdA-pet0)".
- Give the demo doctors eVet-style IDs, or routing shows "Doctor 7673" (B3). I set `pimsId` 90417 and 90418 in `vayd_api_test_sched` for the checks; `demo-names.sh` should do it.
- Hide the leftover test providers ("Marguerite Oakhollow" appears dozens of times in the doctor list) and the duplicate visit types ("Euthanasia" twice, "Sick Exam").
- Allow texts and email to the demo clients. They're seeded do-not-text and do-not-email, so text offers, On My Way and confirmations show nothing. Captured only, so safe.


## 5. Not yet checked or written

- **Nice-to-have scripts not written:**
  - SR-13 Schedule loader;
  - SR-14 Schedule optimization;
  - SR-20 Visit types and online auto-book;
  - SR-21 Reminders;
  - SR-22 Booking goals.

  I'd write them after your answers, mainly B6 (online booking) and Q12 (who sees Settings).
- **Steps not walked** are listed at the end of each script. The main ones:
  - converting a hold;
  - saving staff hours or a date override;
  - adding a closed day;
  - **Accept and inactivate**;
  - **Book** from the Forward booking list;
  - the slot-taken message on the online form.
- **Client messages:** booking confirmation and reschedule notices weren't captured. The demo clients were set do-not-contact until partway through. After I allowed messages, the request confirmation, the records request email, a text offer and an On My Way text were captured (none delivered).

## 6. How the checks were run

- **The stack:** a scratchpad copy of `cypress/training/stack/stack-up.sh`:
  - database `vayd_api_test_sched` (copy of `vayd_api_test_base`);
  - API :3220 from its own worktree `~/worktrees/sr-train-api` (detached at `build-doctor-flow`);
  - app :5220 from `training/videos`;
  - fake Stripe :4011, fake routing :4021, Redis database 10.
- **Captures:** email is captured by `test/scripts/e2e-capture-preload.js`. Texts are captured by a scratchpad preload (`scratchpad/stack/sms-capture-preload.js`), with OpenPhone set to a fake key and every text redirected to a 555 test number.
- **Changes to the test database only:**
  - 226 leftover test providers inactive;
  - demo doctors given eVet-style IDs;
  - the Client Liaison role allowed to hand-book three types;
  - three types flagged for the request form;
  - demo clients and logins allowed email and texts;
  - Maria's login email matched to her record;
  - a duplicate client from B7 removed;
  - two reminders added;
  - Robin Hale's login made an admin (plus a 4-hour admin token in `world.json`).
- **Nothing written to `vayd_api_local`** (one read-only count was blocked; see Q4). No product code changed. Nothing committed or pushed.
