# Scheduling and Routing training videos

Scripts for the Scout go-live series on scheduling and routing. Each video is 2 to 3 minutes and covers one task. Record them with `cypress/training/README.md`. Questions, possible bugs and demo data are in [../../scheduling-routing.md](../../scheduling-routing.md).

**Demo world:**
- **Households:** the Riveras (Maria; Maple, Juniper, Pepper) and the Chens (Tom; Biscuit).
- **Staff:**
  - Dr. Avery Lane and Dr. Priya Shah, veterinarians, Mon–Fri 8–4, North zone;
  - Jordan Pike, technician;
  - Casey Morgan, client liaison;
  - Robin Hale, practice manager (needs an admin login for Settings).
- **The test stack's routing is fake:** every drive is 15 minutes.

**Related videos already scripted:** EMR V5b (Schedule follow-ups at checkout), V9 and V10 (euthanasia), V14 (weak signal).

| ID | Title | Audience | Priority | Status (Nov 7, 2026) |
|---|---|---|---|---|
| [SR-01](SR-01-the-calendar.md) | Find your way around the calendar | All | Must | Checked |
| [SR-02](SR-02-cancel-a-visit.md) | Cancel a visit: Remove, with a reason | All | Must | Checked |
| [SR-03](SR-03-book-with-get-best-route.md) | Book a visit with Get Best Route | CLs | Must | Checked |
| [SR-04](SR-04-book-by-hand.md) | Book by hand on the calendar | CLs, doctors | Must | Checked (the owner sets each role's types, Q5) |
| [SR-05](SR-05-move-or-reschedule.md) | Move or reschedule a visit | CLs | Must | Checked; asks which visits (fixed Nov 7) |
| [SR-06](SR-06-online-requests-queue.md) | Online requests: the Appointments queue | CLs | Must | Checked |
| [SR-07](SR-07-what-the-family-sees-online.md) | What the family sees when they book online | CLs | Must | Checked up to the time picker (B6 fixed) |
| [SR-08](SR-08-text-an-open-slot.md) | Text a family an open slot | CLs, lead techs | Must | Checked |
| [SR-09](SR-09-waitlist.md) | The waitlist | CLs, doctors, techs | Must | Checked (B9 to re-check) |
| [SR-10](SR-10-forward-booking-list.md) | The Forward booking list | CLs | Must | Checked (list; Book not walked) |
| [SR-11](SR-11-holds-board.md) | The Holds board | CLs | Must | Checked (convert step not walked) |
| [SR-12](SR-12-care-outreach.md) | Care outreach | CLs | Must | Checked |
| SR-13 | Fill a light day: Schedule loader | CLs | Nice | Not written yet |
| SR-14 | Schedule optimization | Lead CLs, managers | Nice | Not written yet |
| [SR-15](SR-15-your-day-and-week.md) | Your day and week on the calendar | Doctors, techs | Must | Checked (replaces "My Day and My Week", Q6) |
| [SR-16](SR-16-on-the-road.md) | On My Way text and Start / End Visit | Doctors, techs | Must | Checked |
| [SR-17](SR-17-pet-inactive-closes-schedule.md) | When a pet dies or is made inactive | CLs, doctors | Must | Checked (Accept not walked) |
| [SR-18](SR-18-staff-hours-and-overrides.md) | Staff hours, zones and days off | Managers (admin) | Must | Checked (saving not walked) |
| [SR-19](SR-19-close-for-a-holiday.md) | Close the practice for a holiday | Practice managers | Must, urgent | Checked; a manager added Nov 26 |
| SR-20 | Visit types, arrival windows and online auto-book | Managers | Nice | Not written yet |
| SR-21 | Appointment reminders | Managers, CLs | Nice | Not written yet |
| SR-22 | Booking goals | Managers | Nice | Not written yet |
| [SR-23](SR-23-common-scheduling-mistakes.md) | The most common scheduling mistakes | All | Nice | Written from checked labels |
| [SR-24](SR-24-request-records.md) | Request records from the previous vet | CLs | Must | Checked |
| [SR-25](SR-25-records-list.md) | The Records list | CLs | Must | Checked |
| [SR-26](SR-26-file-a-record-and-check-the-summary.md) | File a received record and check the summary | CLs, doctors | Must | Checked with a fictional record |

**Probes:** the dry-run specs used for the checks are in `cypress/training/probes-sr/` (uncommitted). They book each video's demo data through the API and save screenshots and screen text.
