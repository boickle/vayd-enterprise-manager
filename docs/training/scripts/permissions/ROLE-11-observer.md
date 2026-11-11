# ROLE-11. What an Observer sees

- **Audience:** managers.
- **Length:** 1 to 2 minutes.
- **Watch first:** PERM-01.
- **The one thing to remember:** an Observer can look at clients, payment and membership reports and inventory, and is meant to change nothing. Use it for shadowing before someone's real role starts.

## Why (opening)

"A new hire shadowing for a week needs to see Scout without being able to change anything. That's the Observer role."

## Steps

Logged in as **Kai Reed** (Observer).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home | Point at the top bar: **Home, Scheduling, Catalog, Pharmacy, Labs, Tasks** | "This is Kai, shadowing this week." | perm-seed.ts |
| 2 | Voice-over | — | "The one thing to remember: an Observer can look, and change nothing." | — |
| 3 | Clients → Tom Chen, financial tab | Point at the bill: no pay-link, void or credit buttons | "On a bill there's nothing to click: no pay links, no voids." | Paid $75 cash bill on the Chens |
| 4 | Analytics | Point at **Financial** (Payments), **Appointments, Memberships, Inventory, Patients** | "Kai can read payments, appointments, memberships and inventory reports." | — |
| 5 | Voice-over | — | "When their real role starts, add it, then take Observer off." | — |

## Notes to check before recording

- Fixed Nov 9 (RP-A12, RP-A14): booking and the other quick actions, and the client record's action buttons, are hidden for an Observer, and the API refuses booking and payments. Re-check in the dry run once `build-doctor-flow` is merged in.

## Closing

"The most common mistake is leaving Observer on after the real role is added. Remember: an Observer looks, and is meant to change nothing."
