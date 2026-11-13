# SR-06. Online requests: work the Appointments queue

- **Audience:** CLs.
- **Length:** 3 minutes.
- **Watch first:** SR-03.
- **The one thing to remember:** every request ends as Booked or Not booked, with a reason. New should be empty at the end of the day.

## Why (opening)

"A family who asked for a visit online is waiting to hear from us. An empty New list means nobody is waiting."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Scheduling → Appointments** | Point at the tabs **New (1)**, **Auto-Booked**, **Contacted**, **Booked**, **Not Booked** | "Online requests land in New." | One request from Maria Rivera for Maple: Medical Visit, "Limping on the left hind leg since yesterday", Flexible, note "Mornings are best, not Wednesdays". Signed in as Casey Morgan (CL) |
| 2 | Appointments | Point at the one thing to remember | "Every request ends as Booked or Not booked, with a reason." | — |
| 3 | Request card | Point at **Existing client**, Maple, **Medical Visit**, the reason, **Timing: Flexible** and **CLIENT NOTE** | "The card shows who, which pet, why, how soon, and anything the family told us about timing." | — |
| 4 | Request card | Point at **Request PDF** and **View full request** | "The full form is one click away." | — |
| 5 | Request card | Click **Book** | "To book it, click Book." | — |
| 6 | **Get Best Route**, APPOINTMENT REQUEST | Point at "Appointment request from Maria Rivera. Maple: Medical Visit. Urgency: Flexible" | "Routing opens with the request filled in." | — |
| 7 | Get Best Route | Pick **Avery Lane** in **Doctor**, then click **Get Best Route** | "Pick the doctor and search, like any booking." | — |
| 8 | Results | Click **View Placement** on a morning that isn't a Wednesday | "Use the family's note: mornings, not Wednesdays." | — |
| 9 | Routing preview | Click **Book** | "Book." | — |
| 10 | **Book appointment** | Point at Maple, ticked, with **Medical Visit** and the family's note in the description | "The pet, the type and the family's note carry over." | — |
| 11 | Book appointment | Click **Book appointment** | "Book appointment." | — |
| 12 | Appointments | Point at **New (0)** | "The request moves to Booked by itself." | — |
| 12b | Appointments | — | "One exception: if you book a request as a HOLD type, for example to keep a time while the family decides, it doesn't go to Booked. It shows On hold." | — |
| 12c | Header | Click **Scheduling**, point at **Holds**, click it and show the Holds board. Then go back to Appointments (off camera) | "You follow it up on the Holds board. Open Scheduling, then Holds." | — |
| 13 | Voice-over, a request that can't be booked | Click **Not booked** | "If it can't be booked, click Not booked." | A second request |
| 14 | **Mark as not booked** | Open **Reason**, choose **Out of Area**, click **Mark not booked** | "Pick the real reason. These feed our reports on why requests don't book." | — |
| 15 | Voice-over | — | "Called and left a message? Mark contacted, and add a note, so the next person knows." | — |

## What else you can do here

- **Text client:** the **Text requester** window, with templates such as "Appointment request — received (auto)".
- **Email client** and **Go to Gmail thread** (need the shared inbox).
- **Link appointment…:** if you booked the visit another way, link it so the request shows as booked.
- **Auto-Booked:** families who picked a time online. Review each one.
- **Notes** on each request.

## What other roles see

- **Techs, lead CLs, managers and the medical director** can also work the queue.
- **Doctors** don't, by default.

## Closing

"The most common mistakes: booking the visit from the calendar and leaving the request sitting in New, and Not booked with no real reason. Remember: every request ends as Booked or Not booked, with a reason. New should be empty at the end of the day."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL**, end to end: the request came in from the portal, was booked through **Book**, and linked by itself (`bookedAppointmentId` set, **New (0)**).
- **Checked:** the **Mark as not booked** reasons and the **Text requester** window.
- **The header counter didn't update.** After booking it still said "0 of 1 requests converted to appointments (0.0%)". See the review.
- **No email to the family when staff book a request.** Only "We Received Your Appointment Request" was captured. Say "call or text them the time" in the video, or confirm how families hear about the time (review, Q9).
- **Not checked:** **Email client** and Gmail (the training stack has no inbox), and **Auto-Booked** (blocked by B6 for signed-in clients).
- **Demo data:** the portal login's email must match the client record's email, or the request creates a second household (B7).
