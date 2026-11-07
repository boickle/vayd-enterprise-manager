# SR-03. Book a visit with Get Best Route

- **Audience:** CLs (and anyone who books).
- **Length:** 3 minutes.
- **Watch first:** SR-01.
- **The one thing to remember:** let routing pick the doctor and time, then read the arrival window to the family.

## Why (opening)

"Every visit we book changes how far our doctors drive. Get Best Route finds the time that fits the day best, so doctors drive less and see more families."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Any screen | Click **+ Appointment** (top right) | "Tom Chen calls: Biscuit needs his ear rechecked. Click + Appointment." | Dr. Lane's day: Maple Rivera 9:00 and Juniper Rivera 1:30. The Chens have nothing booked. Signed in as Casey Morgan (CL) |
| 2 | **Get Best Route** | Point at the one thing to remember | "Let routing pick the doctor and time, then read the arrival window to the family." | — |
| 3 | Get Best Route | Point at **Date** (from → to) | "It searches from today through the next week. Change the dates if the family asks for later." | — |
| 4 | Get Best Route | Type "Lane" in **Doctor** and pick **Avery Lane** | "Pick the doctor first. Or tick ASAP All Doctors In Zone Search to search every doctor who works the area." | — |
| 5 | Get Best Route | Choose **Recheck** in **Appointment Type** | "Then the visit type. It sets how long the visit takes." | — |
| 6 | Get Best Route | Type "Chen" in **Client** and pick **Chen, Tom** | "Find the family." | — |
| 7 | Get Best Route | Click **Biscuit** under **Which patients are you booking?** | "Pick the pet. If you skip this, the visit books with no pet." | — |
| 8 | Get Best Route | Point at the address with the green tick and **Zone North** | "Scout checks the address and finds the zone." | — |
| 9 | Get Best Route | Click **Get Best Route** | "Search." | — |
| 10 | **Results** | Point at the first card: doctor, day and time, **Arrival Window**, **Added Drive**, **Whitespace After Booking** | "The best fit is first. It shows the arrival window, how much driving it adds, and how much of the day is left open." | — |
| 11 | Results | Click **View Placement** on the first card | "View Placement shows it on the doctor's calendar." | — |
| 12 | **Routing preview** | Point at **WINDOW** and the outlined visit on the calendar | "Here's where Biscuit would go." | — |
| 13 | Routing preview | Point at **Call client** and **Text client** | "If you need to check with the family, call or text from here." | — |
| 14 | Routing preview | Click **Book** | "Book it." | — |
| 15 | **Book appointment** | Point at **Biscuit**, ticked, with **Recheck** | "Each pet gets its own visit at this time, with its own type." | — |
| 16 | Book appointment | Type "Ear recheck" in **Description (optional)** | "Add why they're coming." | — |
| 17 | Book appointment | Click **Book appointment** | "Book appointment." | — |
| 18 | Calendar | Point at "Appointment saved to the schedule." and the new card | "It's on the calendar." | — |
| 19 | Voice-over | — | "Now read the arrival window to Tom: Monday between … and …." | — |

## What else you can do here

- **Scheduling Preferences** (preferred doctor, days and time of day, **Force earliest available**) narrows the search to what the family wants.
- **Reserve handling:** leave it on **Protect reserve (default)**. The reserve keeps room for new patients and urgent visits.
- **Needs pre-meds** books the shorter pre-meds arrival window.
- **Type a different address** books at another address, for example a relative's home.
- **Minutes** overrides the visit length.
- With two or more pets, tick each pet; each gets its own visit at the same time.

## What other roles see

- **Doctors** can book only on their own calendar.
- **Techs and CLs** can book for any doctor.

## Closing

"The most common mistakes: skipping the pet, which books a visit with no patient, and telling the family the start time instead of the arrival window. Remember: let routing pick the doctor and time, then read the arrival window to the family."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL**, end to end, in Week view on the training stack. The Chen visit was saved and showed on Dr. Lane's calendar.
- **Doctor comes first.** Picking a type before a doctor shows "You must pick a doctor first before picking an appointment type or number of pets."
- **The pet isn't ticked unless you pick it in step 7.** Without it, the Book window ticks **No patient**, and Biscuit's section is greyed out.
- **Not walked:** **Scheduling Preferences**, **ASAP All Doctors In Zone Search** and **Type a different address**.
- **Routing on the training stack is fake:** every drive is 15 minutes, so **Added Drive** and the scores won't look like a real day. Say "for example" when pointing at numbers.
- **Demo data to fix before recording:**
  - The doctor list repeats "Marguerite Oakhollow" many times (leftover test providers).
  - The type list has two "Euthanasia" entries and a "Sick Exam".
  - The demo doctors need eVet-style IDs, or the results show "Doctor 7673" instead of Avery Lane (see the review).
- **Layout:** at 1600 px wide, **Work Zones Map** overlaps the APPOINTMENT TYPE label above the calendar.
