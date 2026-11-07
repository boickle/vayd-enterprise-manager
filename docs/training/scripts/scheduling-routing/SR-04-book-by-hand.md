# SR-04. Book by hand on the calendar

- **Audience:** CLs; doctors on their own calendar.
- **Length:** 2 minutes.
- **Watch first:** SR-03.
- **The one thing to remember:** book by hand only when routing can't, and always check the red preview before you click Book.

## Why (opening)

"Sometimes the family needs one exact time, like the only hour they're home. Booking by hand puts the visit exactly where you say, so check the preview first."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home, Dr. Lane's week | Point at Tuesday 11:30 | "Tom Chen can only do Tuesday at 11:30." | Dr. Lane's week with a few visits. The Chens have nothing booked. Signed in as Casey Morgan (CL). The Client Liaison role may hand-book Recheck, Wellness and Medical Visit (Settings → Roles) |
| 2 | Home | Point at the one thing to remember | "Book by hand only when routing can't, and always check the red preview before you click Book." | — |
| 3 | Home | Double-click the empty space at Tuesday 11:30 | "Double-click an empty spot on the calendar." | — |
| 4 | **Book appointment - MANUAL OVERIDE** | Point at the title and the time, "Tuesday, Nov 10, 2026 · 11:30 AM – 12:00 PM" | "This is a manual booking, at the time you clicked." | — |
| 5 | Book appointment | Check **Provider** is **Avery Lane** | "Check the doctor." | — |
| 6 | Book appointment | Choose **Recheck** in **Appointment type** | "Pick the visit type." | — |
| 7 | Book appointment | Type "Chen" in **Search client or patient** and click **Tom Chen** | "Find the family." | — |
| 8 | Book appointment | Choose **Biscuit** in **Patient** | "Pick the pet." | — |
| 9 | Book appointment | Set **Duration** to **30 min** and type "Ear recheck" in **Description (optional)** | "Set how long, and why they're coming." | — |
| 10 | Book appointment | Point at **Put on waitlist for a sooner appointment** | "If the family would like something sooner, tick this. We keep this time, and they go on the waitlist too." | — |
| 11 | Book appointment | Click **Preview on calendar** | "Preview on calendar. Nothing is saved yet." | — |
| 12 | **Manual booking preview** | Point at the red slot and "Avery Lane · Tom Chen", **Tue Nov 10 · 11:30 AM – 12:00 PM** | "The red slot shows where it lands. Scout checks the drive times around it." | — |
| 13 | Manual booking preview | Click **Book** | "If it looks right, Book." | — |
| 14 | Calendar | Point at "Appointment saved to the schedule." | "Saved." | — |

## What else you can do here

- **Back to book form** in the preview to change something.
- **Call client** and **Text client** in the preview.
- **Needs pre-meds** gives the shorter pre-meds arrival window.
- **Staff notes (optional)** are for the team, not the family.
- **Provider** can be changed to book on another doctor's calendar.

## What other roles see

- **CLs:** only the visit types their role may book by hand (set by a manager in **Settings → Roles**). If **Appointment type** is empty, ask a manager.
- **Doctors:** can book by hand on their own calendar only, with their role's types.
- **Techs:** the same window, with their role's types.

## Closing

"The most common mistakes: booking by hand when routing would have found a better time, and clicking Book without looking at the red slot. Remember: book by hand only when routing can't, and always check the red preview before you click Book."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL, end to end.** The visit saved and showed on Dr. Lane's calendar.
- **On the test stack, no role had any hand-bookable type.** The type list was empty until I set the Client Liaison role to Recheck, Wellness and Medical Visit through the Settings API. If production is the same, CLs can't book by hand at all (see the review, Q5).
- **The title is misspelled:** "MANUAL OVERIDE" (should be OVERRIDE). Fix before recording, or don't point at it.
- **Search shows after a type is picked:** **Search client or patient** appears only once **Appointment type** is set.
- **Not walked:** the zone or doctor warning that needs a lead CL or manager to override.
