# Schedule follow-ups: build plan

Status: **approved, in progress** (updated Nov 3, 2026). Branch: `build-doctor-flow`.
Mockup: https://claude.ai/artifact/7XcLmuRuqdGUYgo3Xbay6p (fake data, and public; it shows every decision below).

## Progress (Nov 3, 2026)

| Step | State |
|---|---|
| 1. Groundwork | Done: `src/components/followUps/plannerModel.ts` (+ tests), `plannerData.ts` |
| 2. Planner window on checkout | Done: `ScheduleFollowUpsPlanner.tsx`, `ScheduleFollowUpsButton.tsx`; replaces `WrapUpForwardBooking` on `VisitCheckoutPage.tsx` |
| 3. Find a time without leaving | Done: embedded `RoutingCalendarWorkspace`; `Scheduler.tsx` reports planner bookings via `plannerEvents.ts` and stays put |
| 4. Add a pet to a household visit | Done: `plannerActions.addPetsToUpcomingVisit`, later-stop check in `visitImpact.ts` |
| 5. Text the owner | Done, including the editable Settings template `follow_up_booked_confirmation_sms` (merge fields `{{booked_visits}}`, `{{other_follow_ups}}`; seeded in app and API) |
| Visit type + history minutes | Done: required visit type per card (and per pet added to a household visit); lengths from the provider's 30-day history (`plannerTiming.ts`); Routing keeps the planner's type |
| 6. Start/End Visit + left-nav | Done: Start/End Visit opens the planner (its window steps aside while it is open); left-nav "+ Forward Booking" opens `ScheduleFollowUpsLauncher` (find a pet or owner, then the planner with no visit). The header menu "+ Forward Book" (forward booking list `?new=1`) opens the same picker. Labs-pending tasks ("Forward book X once labs are back") open the planner with that pet under "Labs are back · needs a plan" (`ScheduleFollowUpsForTask`): add to a visit on the books, a new card, or no follow-up; the earlier visit's Labs pending choice is kept; Done closes the task with a note of what was done. The old Add forward booking form and checkout widgets (`CreateForwardBookingModal`, `WrapUpForwardBooking`, `CheckoutFollowUpPrompt`, `bookFollowUpNow`) are deleted. |
| 7. Measure | Done from saved data, no new tracking: Forward Booking analytics adds "How follow-ups were handled" (booked at the visit, already booked, sent to the CLs, labs pending, no choice) plus not-appropriate count and confirmation texts sent. Not measured: planner opens and undos. |

Clicked through on the local API and `vayd_api_local` (Nov 3, 2026): planner load, reminders, upcoming visits, add a pet to a household visit (appointment created, visit lengthened by history minutes, Undo then lock), View in calendar (dashed preview), Find a time prefill (type, minutes, provider), Done (dispositions saved), the owner text (not sent), read-only reopen, and clean-up of search rows when the page closes mid-search. Not completed on local data: a Routing booking, because local schedules return no openings.

Build notes:
- **Same pet sent to the CLs twice from one visit:** the API keeps one open row per source visit, so only the pet's first row links to today's visit (`SourceVisitLinks`).
- **Added time per pet** comes from the visit provider's 30-day history: the visit's length with the pet minus without (`estimateAddedMinutes`).
- **View in calendar** highlights the visit and draws the longer visit as the calendar's usual dashed preview, view-only (`plannerEvents.ts` preview events).
- **Routing's "Other scheduled visits" check** still appears before searching from the planner. It is redundant there (the planner already shows those visits); a candidate for skipping when the search comes from the planner.
- **AI wording (possible later addition):** an optional "Polish wording" button that refuses any rewrite that drops a date, time or pet name. Not built.

## Goal

Techs book the next visit before they leave the house. Today the checkout follow-up prompt is five stacked radio buttons per pet, and staff report it is hard to use. It cannot give different pets different timing or needs, cannot see the household's other upcoming visits, and "Book it now" leaves checkout for Routing and never comes back. (`FOLLOW_UP_BOOK_RETURN_KEY` is written in `bookFollowUpNow.ts` and nothing reads it.)

Replace the prompt with one **Schedule follow-ups** window. Pets go into cards, and each card is one future visit. It opens from all three places: checkout, Start/End Visit, and the left-nav "Add forward booking" shortcut.

## Decisions already made

| Topic | Decision |
|---|---|
| Name | Button and window say **Schedule follow-ups**. |
| Button | Full-width pill with a calendar icon and an arrow. Pulses while today's pets are still open. Turns into an outlined **"Review follow-ups"** button once all are done (opens read-only after Done). |
| Payment | Follow-ups do not block payment (unchanged). |
| Timing | Quick chips for 2 weeks, 1 month, 3, 6 and 12 months, plus **Custom** ("In N days/weeks/months/years" or "on [date]"). |
| **A pet on several cards** | A pet can be on as many cards as it needs, e.g. Marvin on a 2-week ear recheck **and** a 1-year annual. Tapping a pet on a card opens "Also book Marvin in…" and "Move Marvin to…". Each placement has its own notes and its own reminder check. **No follow-up needed** is the one exception: it takes the pet off every other card. |
| Reminders | Each pet shows its due reminders. On a card they are colored against that visit's date: green = can be done at this visit (due **30 days before to 45 days after** the visit, one window for every reminder type), amber = due before it, red = overdue, grey = after it (with the date shown). "Add these to notes" copies the green ones into that placement's notes. |
| Household | Pets not on today's visit are listed as optional. Their upcoming visits show as cards you can add a pet to. A banner flags household pets that are overdue with nothing booked. Their bookings live on the calendar and the forward booking list only; **nothing is written onto today's charts** about them. |
| Provider | Each new card has a **Keep Dr. X** checkbox (today's provider). Unchecking it shows a provider dropdown that includes Tech Team. |
| **Changing your mind** | **Booked appointments lock.** Pressing Book (Find a time) or Add (existing visit) puts the appointment on the calendar immediately. The confirmation offers **Undo for 10 seconds** for mis-taps; after that the card is locked. Its pets can't be moved off it, and it has no Change time or Undo. The card shows **View appointment**, which opens the calendar in the side layer on that day with the visit highlighted. Rescheduling or cancelling happens there, through the calendar's normal steps and cancellation reason. If a planner appointment is cancelled on the calendar before Done, the planner notices and puts those pets back as needing a follow-up. Things that aren't appointments (CL cards, labs pending, no follow-up, cards not yet booked) stay movable until Done. A pet on a booked card can still be **added** to another card. |
| **When things save** | Appointments go on the calendar **as soon as they are booked**, so the slot can't be lost. Everything else saves together when the tech presses **Done**: the per-pet follow-up choice, CL rows, labs tasks, and the household CL note. **After Done everything is locked**, as the API already enforces (no server change). Reopening shows the results read-only. |
| **Leaving early** | Closing the window, or navigating away from checkout, with unsaved work shows a warning: "Follow-ups aren't finished". It lists what isn't saved yet, which of today's pets still need a follow-up, and what is already on the calendar and will stay booked. It also notes that no confirmation text has been sent. Buttons: **Keep working** (default) and Leave without saving. |
| **Adding to an existing visit** | Show what adding the time does to the rest of that provider's day, not "there is room". The card shows "Adds about 20 min", then lists each later stop with ✓ (still inside its arrival window) or ⚠ (minutes past its window). Buttons: Add (or **Add anyway** when there's a warning), **View in calendar**, and **Find a different time** (moves the pet to a new card). View in calendar opens that provider's day in the side layer. The added time is dashed, late stops are red, and nothing changes until Add is pressed. |
| CL note | One **household note for the CLs** (e.g. "owner prefers Tuesdays") appears once any card is marked for the CLs. It saves at Done onto every forward-booking row for that household. Each pet's own notes still go on its own row. |
| Owner text | After anything is booked, **Done** becomes "Next: text the owner →". The same window switches to a review step (no pop-up on top of the pop-up): a summary on the left, an editable text on the right. **Send is the default action.** "Finish without texting" is secondary. One text covers the whole household, with lines in date order. |
| Text line | Each booked line says "with Dr. Lastname" or "with our tech team", depending on who that visit was booked with. The text is sent **from the line of the provider on the earliest booked visit**. Tech Team, or any provider without a line of their own, falls back to the practice main line, never the reminders line. |
| No text possible | If the client is marked do-not-text or has no mobile number, the review step offers **email** instead. If there's no email either, it says "No text or email on file" and still lets them finish. |

## What already exists (reuse, don't rebuild)

| Need | Existing code |
|---|---|
| Save a pet's follow-up choice (appointment + encounter, queue row, labs tasks) | `src/components/forwardBooking/saveForwardBookingDecision.ts` |
| Household roster for today's visit | `getHouseholdRoster` in `src/api/visitWorkflow.ts` |
| Household upcoming visits | `fetchClientAppointmentsStaff` (`src/api/pimsAppointments.ts`); helpers in `src/utils/nextScheduledAppointmentForVisit.ts`, `src/utils/bookingHouseholdVisitWarning.ts` |
| Add a pet to an existing visit | One appointment per pet: `createAppointment` at the sibling's slot, then `alignSiblingVisitScheduledTimes` (`src/utils/householdVisitTimeAlign.ts`). The pattern is in `SchedulerBookModal.tsx` around lines 2134–2165 and 2850–2865. Helpers are in `src/utils/schedulerAddPet.ts`. |
| Later stops pushed past their windows | `summarizeReconciledDayWindowWarnings` (`src/utils/routingCardWindowWarning.ts`) after POST `/routing/eta`; window rules in `src/utils/windowWarning.ts` and `schedulerWindowWarning.ts`; a similar "longer visit" preview in `src/utils/editVisitTimePreview.ts` |
| Calendar preview before committing | `src/utils/routingCalendarPreviewStorage.ts`; "preview on calendar, then approve" flow in `SchedulerBookModal.tsx` (~line 2395) |
| Undo within 10 seconds | `deleteAppointment` in `src/api/appointments.ts` (Scout-created visits are soft-deleted) |
| Focus a visit on the calendar | `dispatchRoutingFocusHouseholdVisit` in `src/utils/bookingHouseholdVisitWarning.ts` |
| Block navigation while work is open | `src/utils/forwardBookingWorkspaceGuard.ts` (existing lock pattern). The app uses `<BrowserRouter>`, so React Router's `useBlocker` is not available; use the guard plus `beforeunload`. |
| Reminders, today's pets | `getVisitReminders(encounterId)` in `src/api/visitWrapUp.ts` (includes reminders today's visit will create) |
| Reminders, other household pets | `listPatientOpenReminders(patientId)` in `src/api/careOutreach.ts` |
| Provider list (includes Tech Team) | `fetchPrimaryProviders()` in `src/api/employee.ts`; label format matches `providerSelectLabel` in `CreateForwardBookingModal.tsx` |
| Tech Team detection | `isNonDoctorPlaceholderName` in `src/utils/bookingCalendarMetrics.ts` |
| Send a text from a provider's line | `sendClientSms(clientId, { primaryProviderId \| from, source, patientIds })` in `src/api/clientSms.ts`; line choice via `resolveOnMyWaySmsFromLine` in `src/utils/onMyWaySmsFromLine.ts` |
| Do-not-text flag | `clientDoNotSmsFromRecord` in `src/utils/doNotSmsWarning.ts` |
| Email to client | Gmail compose path used by `ClientContactComposeModal.tsx` (`useClientEmailComposeSetup`, `smsToEmailDraft`) |
| Editable message templates | `src/utils/messageTemplateSeeds.ts` (`SYSTEM_TEMPLATE_SEEDS`) |
| Slot search | `Routing.tsx` inside `RoutingCalendarWorkspace.tsx`, started from a forward-booking intent (`routingForwardBookingIntent.ts`) |

## Data mapping

The planner holds a list of **placements** (pet + card + notes), not one choice per pet.

**Side effects come from each placement, independently:**

| Placement | Side effect | When |
|---|---|---|
| New card, booked | Appointment per pet | Immediately |
| Existing household visit | Appointment per pet at that slot, times aligned | Immediately (on Add) |
| New card, sent to CLs | Forward-booking row per pet (interval or date, provider, pet notes, household note, premeds). All pets on the card share one target date, so the existing same-date grouping keeps them together. | At Done |
| Labs pending | One task per pet | At Done |
| No follow-up | none | At Done |

**Each of today's pets still saves exactly one existing disposition**, chosen by priority from its placements:

1. Any booked or added placement → `booked_at_appointment`
2. else any CL placement → `forward_book_fields` (from the earliest CL card)
3. else labs → `labs_pending`
4. else only on an upcoming visit already on the books → `already_booked`
5. else → `not_appropriate` with reason

Example: Marvin is booked for 2 weeks and sent to the CLs for 1 year. He saves `booked_at_appointment`, and his 1-year forward-booking row is still created.

**Household pets not on today's visit** get no disposition (they have no appointment today). Booking creates an appointment. Sending to the CLs creates a forward-booking row with no source visit (already supported).

**Custom timing:** "In N units" saves as `intervalAmount`/`intervalUnit`. "On [date]" saves the nearest whole-unit interval plus the forward booking's book-after date (`book_after_date` already exists on `forward_bookings`).

## Build steps

Each step ends with `npm test` passing and a manual click-through on checkout. Commit per step.

### Step 1: Groundwork (no visible change)
- `src/utils/followUpPlanner/` holds the pure logic, with unit tests:
  - `targetDate(interval | custom)` and `planName()`
  - `reminderFit(due, target)`, returning `overdue | early | fits | later | booked`. Window: **30 days before to 45 days after** (confirm, see open questions).
  - `dispositionForPlacements(placements)`: the priority rule above
  - `buildFollowUpConfirmationText({ clientFirstName, bookings[] (date-sorted), clMentions[], labsPets[], practiceName })`. Each line uses `providerTextLabel(provider)`: "Dr. Lastname", or "our tech team" when `isNonDoctorPlaceholderName`.
  - `confirmationSendLine(bookings, providers)`: the earliest visit's provider line; Tech Team or no line → practice main.
- `useHouseholdFollowUpData(appointmentId, encounterId)` loads roster, household upcoming visits, reminders for every pet, and providers in parallel.
- Check with the API (`vayd-api`; set `MIGRATION_DB_NAME` if a migration is needed):
  - Does forward-booking create accept a `days` interval and an explicit target date?
  - Do the forward-booking list rules (`forwardBookingListVisibility.ts`, `careOutreachForwardBookingExclude.ts`) hide a row whose source visit is `booked_at_appointment`? This matters for Marvin's 1-year CL row.
  - Does the list have somewhere to store a **household note**? If not, prepend it to each row's `bookingNotes` ("Household: …").

### Step 2: The planner window (checkout only)
- `src/components/followUps/ScheduleFollowUpsButton.tsx` (the pill button with per-pet status chips) and `ScheduleFollowUpsPlanner.tsx` (the window).
- Layout as in the mockup: pet list on the left, three groups of cards (already on the calendar / new follow-up visits / not booking today), and a footer with per-pet progress.
- Placements state, with moving and adding:
  - drag and drop between cards
  - tapping a pet in the list → "Where does Marvin go?"
  - tapping a pet on a card → "Also book Marvin in…" and "Move Marvin to…"
  - Tapping is the main path on iPads.
- New card: interval chips + Custom, notes per placement, reminders, "Keep Dr. X" (unchecking reveals the provider dropdown, Tech Team included), and "Needs premeds".
- Buttons on a card: **Send to CLs to book** (marks the card; the row is created at Done, with Undo until then) and **Find a time now** (step 3).
- Labs pending card: who reviews and when to remind, using the existing labs task fields.
- No follow-up card: one-tap reasons plus free text. It removes the pet's other placements.
- Household CL note box (appears once any card is marked for the CLs).
- **Done** writes everything in this order: CL rows → labs tasks → dispositions. Each runs one at a time, and a failure stops there with a clear message. Already-written items are not repeated on retry.
- Leave warning: a `followUpPlannerDirty` lock in the style of `forwardBookingWorkspaceGuard.ts`, checked by the planner's Close button, by checkout's "Back to chart", by left-nav links, and by `beforeunload`.
- Replace `WrapUpForwardBooking` on `VisitCheckoutPage.tsx` with the new button. Keep `WrapUpForwardBooking.tsx` in place until step 6.

### Step 3: Find a time without leaving
- Open `RoutingCalendarWorkspace` in a full-height side layer over the planner (same page, no `navigate`). Prefill it with a forward-booking intent built from the card: pets, interval/target date, provider, length.
- **Spike first (about half a day).** `Scheduler` calls `navigate()` about 39 times, and `Routing` calls it twice. Find which of those fire during a forward-booking book, and add an `embedded` / `onBooked` path so they report back instead of navigating. If that proves too tangled, fallback: open Routing in a **new browser tab** and have the planner listen for the booking through `storage` events. That fallback still never replaces the checkout screen.
- After booking: a confirmation with **Undo** for 10 seconds (soft-deletes the new appointments). Then the card shows "✓ Booked · date · window · provider" and **View appointment**, and its pets are locked to it. The planner keeps the new appointment ids for the text.
- On reopen and before Done, reload the planner's appointments. Any that were cancelled on the calendar free their pets again.
- Remove the unused `FOLLOW_UP_BOOK_RETURN_KEY` handoff.

### Step 4: Add a pet to an existing household visit
- An upcoming-visit card takes dropped pets, with notes per pet.
- Window impact:
  - Ask the routing ETA endpoint for the provider's day with the visit lengthened by the pet's time.
  - Run `summarizeReconciledDayWindowWarnings` on the result.
  - List the later stops with ✓/⚠ and minutes past their window.
  - Button reads **Add Marvin** or **Add anyway**.
- **View in calendar:** the same side layer as step 3, showing that provider's day with the added time dashed and late stops in red. The layer has its own Add / Find a different time buttons.
- Commit: pull the add-pet commit out of `SchedulerBookModal.tsx` into a shared helper (`createAppointment` at the sibling's slot with the same provider, then `alignSiblingVisitScheduledTimes`) so the scheduler and the planner use the same code.
- After Add: the same 10-second **Undo**, then locked with **View appointment**.
- After adding, if a warning remains, the card says so ("Ruiz household may arrive 5 min past their window. Scheduling will see the warning.").

### Step 5: Text the owner
- The review step is a second view inside the planner, not a new pop-up.
- Summary: booked visits (date order, with provider), sent to CLs (with household note), labs pending, and no follow-up. CL and labs items each have a "Mention in the text" checkbox.
- Editable text with Reset wording and a character/text count. Send is the default button.
- Shows which line it will send from ("from Dr. Patel's line" / "from the practice main line").
- Do-not-text or no mobile on file: switch the right side to an email draft (`smsToEmailDraft`). Gmail access is required to send email, so if the tech lacks it, say "Ask the front desk to email" and finish.
- Add a system template `follow_up_booked_confirmation_sms` to `messageTemplateSeeds.ts` so the wording is editable in Settings.
- `sendClientSms(..., { source: 'follow_up_confirmation', patientIds })` so failed sends show up in the existing delivery-failure banner.

### Step 6: Same window everywhere
- **Start/End Visit** (`SchedulerActualVisitTimeModal.tsx`): replace the follow-up section with the Schedule follow-ups button, opening the planner over the modal. Keep the "optional here" copy.
- **Left-nav Add forward booking** (`CreateForwardBookingModal`, opened from `ScheduleLayout.tsx`, `ForwardBookingPage.tsx`, `PimsTasksPage.tsx`): after picking a patient, open the planner for that household. With no today's visit, every pet is optional and there are no dispositions to settle.
- Delete `WrapUpForwardBooking.tsx` and the old per-pet radio flow once nothing uses them. Keep `ForwardBookingDecisionFields` only if another screen still needs it.

### Step 7: Measure it
- Log per visit:
  - planner opened (y/n)
  - visits booked now
  - pets added to an existing visit
  - sent to CLs
  - labs pending
  - not needed
  - pets with more than one follow-up
  - undos within 10 seconds
  - text sent
- Feed it into `ForwardBookingAnalytics` so you can see whether booking at the visit goes up.

## Tests to add
- **Unit:**
  - target dates (month-end, leap year)
  - reminder windows
  - disposition priority (including Marvin: booked + CL)
  - text builder: one pet, two pets, three pets, the same pet on two lines, Tech Team line, CL and labs mentions on and off, date order
  - send-line choice
- **Component:**
  - tap-to-move and "also book" menus
  - No follow-up clears other placements
  - pets on a booked card can't be moved off it; Undo works only within 10 seconds
  - Custom interval
  - Keep Dr. X unchecked shows the dropdown
  - leave warning lists unsaved work
  - Done goes to review only when something was booked
  - do-not-text switches to email
- **Existing guard:** `src/pages/roomLoaderFormGuard.test.ts` must keep passing (unrelated, but `npm test` runs it).

## Answered questions
1. Reminder window: one window for everything, 30 days before to 45 days after.
2. Household pets booked here: calendar and forward booking list only, nothing on today's charts.
3. Done label: "Review follow-ups".
4. Changing after booking or Done: booked appointments lock after a 10-second undo, and changes go through the calendar. Everything locks at Done. No server change.
