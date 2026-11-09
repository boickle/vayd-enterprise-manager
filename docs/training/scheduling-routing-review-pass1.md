# Scheduling and Routing videos: pass 1 review (dry runs)

Dry runs use the free Mac voice (Samantha) on my own test stack: database vayd_api_test_sched, app :5220, API :3220. The API comes from build-doctor-flow and the frontend from training/videos. Nothing has been recorded with Nova yet. Specs are `cypress/training/sr*.cy.ts`, narration is `cypress/training/narration/sr*.json`, and both are uncommitted.

## Across the series
- **Not production banner:** hidden in every video by `srRecord.ts` `hideNonProdBanner()` (spec only, no product change).
- **New since this morning's merge of `main`:**
  - a "🎉 Pet Snapshot Time? 🎉" button above the calendar;
  - the top menu now reads Home, Scheduling, Catalog, Pharmacy, Labs, Tasks.
  
  Both appear in every calendar video. Question: keep them on screen, or is the snapshot button about to change?
- **Logins:** `cypress/training/.credentials` doesn't exist. Specs sign in with the seed's test logins (`signInAsScheduling`), as the EMR videos do.
- **trainingKit.ts:** `tap()` now also takes `'rightclick'`. One added branch; existing calls are unaffected.

## SR-01 Find your way around the calendar
- **Script changes:**
  - **Today** is pointed at, not clicked. Clicking it jumps to this week, which may not contain the demo day.
  - The arrows go forward and back.
  - Wait for "Loading drive times…" to clear before the video starts.
  - "Open Scheduling again, / and click View appointment" is split into two lines so each click matches its words.
- **Dry run:** 101.5 s with the Mac voice. Visibility is fine. One late click (fixed by the split).
- **Recheck:** 102.3 s, all 7 clicks within 2 s. **Ready for the Nova take.**

## SR-02 Cancel a visit: Remove, with a reason
- **Script changes:** none beyond splitting into one action per line. The HOLD case stays voice-over only (as scripted).
- **Dry run:** 87.6 s, all 8 clicks within 2 s. Frames are clear: the menu, the reason prompt, "Visit removed from the schedule." and the started-visit refusal. **Ready for the Nova take.**
- **Note:** a started visit looks the same on the calendar as one that hasn't started. Nothing tells the CL it has begun until Remove refuses. Low priority; flagged only.

## SR-03 Book a visit with Get Best Route
- **Script changes:**
  - **The doctor is already filled in** from the calendar's provider filter (Avery Lane). The script said to type and pick the doctor. Now it points at the filled field and says "type another name to change it, or tick ASAP to search every doctor in the zone."
  - **The green + Appointment button** in the header opens Get Best Route directly. The narration now says "Click plus Appointment."
  - **One action per line.** The contact row (Call client / Text client) is pointed at, not clicked, so no text or call goes out.
- **Dry run:** 111 s, all 8 clicks within 2 s, after these fixes:
  - waiting for the pet chip and zone after picking the family;
  - pointing at the top result card, not the whole list (the list had scrolled to later days);
  - waiting for "Loading drive times…" to clear after booking, then pointing at Biscuit's new card.
- **Question:** the **Book appointment** window shows an unticked **"No patient"** section under Biscuit's, with its own type and description. A new CL could think they need to fill it in. Is it meant to show when a pet is already picked? If so, the video says "leave No patient unticked". Otherwise it's a small UI fix (product code, so I'm asking first).
- **Note:** the calendar card shows the arrival window (Maple, booked 9:00, reads "8:00 AM – 10:00 AM"), which is right, but it means the card starts an hour before the visit. SR-01 already explains it.
- **Recheck after fixes (Nov 7, evening):** the outline now sits on the top result card, and the video ends on the calendar with Biscuit's new visit. That run was under heavy load from two other sessions' Cypress runs (130 s, one click 0.1 s past the limit). **Record the Nova take when the machine is quiet.** **Ready for the Nova take.**

## SR-04 Book by hand on the calendar
- **Script changes:**
  - **One action per line.**
  - **The search box only appears after a type is picked,** so the video picks Recheck before searching.
  - **Duration:** Recheck sets 30 min by itself, so the video points at Duration instead of setting it.
  - **The family is found with one click** on "Biscuit" in the search results, which fills both the client and the pet.
- **Dry run:** 93.5 s, all 5 clicks within 2 s. The visit saved at Tue Nov 10, 11:30–12:00 with "Ear recheck". Frames show the double-click spot, the form, the red preview slot and the saved visit. **Ready for the Nova take.**
- **Fixed (owner, Nov 7): title spelling and preset type.** build-doctor-flow `d54d2c7`, merged into training/videos.
  - The title reads "MANUAL OVERRIDE".
  - Booking by hand on the calendar (timed and all-day) opens with Appointment type on **"Choose…"** instead of a preset Medical Visit / 60 min.
  - Get Best Route, reschedule and add-pet bookings keep the type they bring.
  - A source test is in `SchedulerBookModal.manualNoDefaultType.test.ts`.
  - **Not pushed yet.**
  - Rerun on the fixed screen: 90.4 s, all 5 clicks within 2 s.
- **Stack note (no product change):** the training app server now uses its own Vite cache (`vite.sch.config.ts`, local and not committed). Another session's dev server rebuilt the shared cache, which left my pages blank.

## SR-05 Move or reschedule a visit
- **Script changes:**
  - **The "only this pet or everyone?" question comes after Biscuit's move,** on Maple, because Biscuit is the only Chen visit that day. The video opens it and clicks Cancel.
  - **Explore alternatives and Edit Appointment** are pointed at, not opened.
  - **"Reschedule appointment" sits below the fold** of its window, so the video scrolls to it before clicking.
- **Final (Nov 8, 1.25x):** "SR-05 - CL, Tech, DVM - FINAL - Move or reschedule a visit.mp4", 100.7 s. Frames show Biscuit moved from Mon 11:00 to Tue 8:15 with "Was …", the same-household question (Only Maple / All 2 visits) and the Scheduling menu.
- **Click check:** sr05-16, -18 and -19 are flagged "late". Each is a planned second click after the pointer rests, not a real delay: the check measures every click from the start of its line.

## SR-07 What the family sees online (and SR-06's off-camera requests)
- **Bug found and fixed (owner approved, Nov 8): "Unable to load availability" on the request form.**
  - **What families saw:** in **Pick a Date & Time**, an error box and an empty calendar, even though Dr. Lane had open times from Nov 9.
  - **Cause:** the date picker treated each new copy of the same doctor and pet lists as a change, and fetched availability again each time: about 130 identical calls in 15 seconds. The API's rate limit refused all but the first 10 (429).
  - **Fix:** build-doctor-flow `82d5bc85` (the form builds its doctor lists once) and `c551c016` (the picker fetches again only when the doctors or pets really change). Merged into training/videos. **Not pushed.**
  - **Checked in the browser:** 3 availability calls, all answered, and the calendar shows open days.
  - **The same code is on main**, so live families may see this today.
- **Form change since the script was checked:** a request now needs either a picked time or a note under "Tell us your preferred times". SR-06's off-camera request for Juniper now includes "Any weekday afternoon".
- **SR-06 step 7:** the Doctor box starts empty when the request names no doctor. The video types "Lane" and picks Avery Lane, as the script says.

## SR-06 Online requests: work the Appointments queue
- **Script changes:**
  - **After Book appointment,** Scout returns to Appointments and opens **Text requester**, with the arrival window already written ("We have booked you with Dr. Lane on Monday, November 9th… between 8:00 AM and 10:00 AM"). The video shows the text, then clicks **Cancel** and **Don't send**, so nothing is sent. Narration: "Send it, or cancel if you'd rather call. Scout checks before it drops the text."
  - **The "Back in Appointments" step** (header → Scheduling → Appointments) is gone. Scout goes back there by itself.
- **Test stack only:** each run clears the public form's rate-limit counters (3 an hour per address) in the stack's own Redis db. Tonight's repeated runs had used them up.
- **Final (Nov 9, 1.25x):** "SR-06 - CL - Online requests - work the Appointments queue.mp4", 102.4 s. Frames show Maple's request with the family's note, Get Best Route with Avery Lane, Book, the text to Maria, Juniper marked "Not ready to schedule", and New at 0.
- **Click check:** the "late" clicks in sr06-09 (pick the doctor, then search) and sr06-14a (Cancel, then Don't send) are planned follow-on clicks within one line, not delays.
- **SR-07 final (Nov 9, 1.25x):** "SR-07 - CL - What the family sees when they book online.mp4", 67.7 s. Frames show the address questions, Maple with "Limping on the left hind leg", Flexible, Pick a Date & Time with Dr. Lane's open November days, the preferred-times note, and Thank You with the membership offer. The video doesn't pick a time (no Auto-Booked demo).

## SR-08 Text a family an open slot
- **Script change: a confirmed offer goes to To review, not Booked.** Booked is "Offers staff reviewed on the calendar, or marked booked after manual follow-up." The video ends on To review: "Check it on the calendar. Once it's reviewed, it moves to Booked." **Question for the owner:** is that the intended flow, or should a family's confirmation go straight to Booked?
- **The text is captured on the test stack, never sent.** The family's page is opened from the captured link. The stack now sets APP_URL to the recording app (local stack-up patch), so the link works.
- **Check before sending** said Juniper's sex is unknown (so no pronouns) and Juniper has no reminders due.
- **The family's page loads blank for about 5 seconds.** That stretch is cut from the video.
- **SR-08 final (Nov 9, 1.25x):** "SR-08 - CL, Tech - Text a family an open slot.mp4", 68.3 s.

## SR-09 The waitlist
- **Final (Nov 9, 1.25x):** "SR-09 - CL, Tech, DVM - The waitlist - add a family, then fill an opening.mp4", 95.4 s. Frames show Add to waitlist from Biscuit's right-click menu (ASAP, note), Tom Chen's card ("Has Tue, Nov 10 — wants sooner", prefers Avery Lane), Recommend slot on Maria Rivera's card, results, and the Book window with Text offer.
- **B9 still shows:** Recommend slot for a "Next 2 weeks" entry opens as "FORWARD BOOKING · 1 month out · Target: Wed, Dec 9". The results still offer Tue Nov 10.
- **About 8 s of silence** while Get Best Route searches (sr09-12). Re-record with a longer line if it bothers you.

## SR-10 Forward booking list
- **Bug (needs owner decision): Book on a Forward booking card ignores the card's visit type.**
  - **Seen:** Maple's card says Recheck ("Recheck left hind leg"). Book opened Get Best Route with Appointment Type **Euthanasia**.
  - **Cause:** `Routing.tsx` (around line 2990) uses the card's type only when the follow-up comes from the visit team's planner (`origin: 'follow_up_planner'`). Every other forward booking gets the default: the first type in the sorted picker, which is Euthanasia in the test practice. The code comment says "usually HOLD".
  - **Risk:** a CL who doesn't check books the wrong visit type.
  - **Not changed** (needs your OK). The video has the CL pick Recheck: "Check the visit type matches the card."
- **Final (Nov 9, 1.25x):** "SR-10 - CL - The Forward booking list - follow-ups sent to the CLs.mp4", 67.9 s. Book later, Mark complete and Remove are pointed at, not clicked.

## SR-11 Holds board
- **Open / convert works.** It stayed on the board only while old test holds were listed (see below). With a clean board it opens the calendar, and the video shows that.
- **Not an app bug: the board listed Biscuit's hold several times.** The test reset flags old visits deleted but leaves them active, and the Holds board filters on active. When staff remove a visit, the app sets both. SR-11's setup now does the same.
- **Edit Appointment on the hold:** Type HOLD → Wellness, then Save. Shown on camera.
- **Open / convert shows an "On hold visit" panel** on the calendar ("Review this calendar hold. Edit to change time, visit type, or pets — or go back to Holds"), with **Back to Holds** and **Edit appointment**. The video uses that: Edit appointment, Type HOLD → Wellness, Save, then "Appointment booked".
- **Final (Nov 9, 1.25x):** "SR-11 - CL - The Holds board.mp4", 62.3 s.

## SR-15 Your day and week
- **Final (Nov 9, 1.25x):** "SR-15 - Tech, DVM - Your day and week on the calendar.mp4". Maps and the PDF printer are pointed at, not clicked. Escape does not close **View appointment** (only its ×).

## SR-16 On the road
- **Recorded at about 5 AM,** so **Now (start)** fills in 04:52 AM for an 11:00 visit. Re-record during a working day if that looks wrong.
- **The On My Way text was captured on the test stack, not sent.** "Send to actual client" is visible but not clicked.

## SR-12 Care outreach
- **Same bug as SR-10:** Route on a care-outreach row ("Care outreach follow-up: Annual wellness exam") opens Get Best Route with Appointment Type **Euthanasia** and an empty Doctor. The video picks Avery Lane and Wellness. One fix in `Routing.tsx` would cover both (use the row's type for every forward-booking origin, not only the planner).
- **Test data:** Biscuit's "Annual wellness exam" reminder, due 5 days ago, is inserted by the video's setup (test DB).
- **SR-12 final (Nov 9, 1.25x):** "SR-12 - CL - Care outreach - pets due with nothing booked.mp4".

## SR-16 to SR-26 finals (Nov 9, 1.25x)
- **SR-16, SR-17, SR-19, SR-24, SR-25, SR-26:** recorded. In SR-26 the summary's HANDLING ALERT ("Snapped once in 2025 during ear exam") shows, and 6 reminders are entered.
- **SR-26 test data:** each take clears Biscuit's reminders and Previous Medical Records note first, because Scout skips reminders already on the chart. The second take otherwise found 0 reminders.
- **SR-18:** recorded with an admin token minted for the training world (test stack only). Nothing was saved. The test manager user was set back to its normal role afterwards.
- **SR-23:** a pointer tour of the nine mistakes; page loads are cut.
- **Test-only setup changes (not committed):** the demo reset now reactivates the demo pets after SR-17. Each SR-06 and SR-07 run clears the public form's rate-limit counters. The stack sets APP_URL to the recording app so offer links work.
