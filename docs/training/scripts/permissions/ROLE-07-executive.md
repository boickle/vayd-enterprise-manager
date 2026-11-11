# ROLE-07. What an Executive (read-only) sees

- **Audience:** managers (practice admins).
- **Length:** 2 minutes.
- **Watch first:** PERM-06.
- **The one thing to remember:** an executive sees every report and Marketing, and changes nothing, unless you grant them Marketing edit rights. No Settings, no Admin.

## Why (opening)

"The exec team needs to see how the practice is doing without risk of changing anything. That's the Executive role."

## Steps

Logged in as **Blair Stone** (Executive (read-only)).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home | Point at the top bar: **Home, Scheduling, Pharmacy, Labs, Tasks, Marketing** | "This is Blair, on the exec team. Marketing is here. Settings and Admin aren't." | perm-seed.ts |
| 2 | Voice-over | — | "The one thing to remember: an executive sees every report and Marketing, and changes nothing unless you grant Marketing edit rights." | — |
| 3 | Home | Click **Analytics** | "Analytics…" | — |
| 4 | Analytics | Point at the tabs: **Financial, Appointments, Communication, Memberships, Inventory, Patients**, and **Payments, Veterinary Services Delivered, Projected Revenue, Gift Cards** | "…shows every report, for every doctor." | Some payments in the last 7 days |
| 5 | Home | Click **Marketing** | "Marketing…" | — |
| 6 | Marketing menu | Point at **Promotions** and **Email campaigns** | "…has promotions and email campaigns." | — |
| 7 | Marketing menu | Click **Email campaigns** | "Open Email campaigns." | One draft email campaign |
| 8 | Email campaigns | Point at the list with no **New campaign** button | "Blair can read campaigns and their results, but there's no New campaign." | — |
| 9 | Voice-over | — | "To let one executive edit campaigns and promotions, a practice admin grants them that one permission on their Access tab." | — |

## What they can't do

- **Settings:** "Access Denied. None of your roles includes a Settings permission."
- **Admin:** never shown.
- **Bank deposits:** "Bank deposits isn't part of your access".

## Notes to check before recording

- Fixed Nov 9 (RP-A12, RP-A13, RP-A14): the booking, new-client, Room Loader, task and forward-booking actions and the client record's action buttons are hidden for executives, and the API refuses payments from them. Executives may read client records (owner, Nov 9). Re-check in the dry run once `build-doctor-flow` is merged in.

## Closing

"The most common mistake is giving an exec an admin login to see reports. The Executive role shows everything without the risk. Remember: executives see every report and Marketing, and change nothing unless you grant Marketing edit rights."
