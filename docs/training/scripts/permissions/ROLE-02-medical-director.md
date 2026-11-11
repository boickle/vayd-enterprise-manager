# ROLE-02. What the Medical Director sees

- **Audience:** managers.
- **Length:** 2 minutes.
- **Watch first:** PERM-03, ROLE-03.
- **The one thing to remember:** the Medical Director is a veterinarian plus medical oversight: they set licenses and credential vets, but they don't run staff, money or marketing.

## Why (opening)

"The Medical Director signs off on the medicine. Their Scout is a vet's Scout plus the few things that oversight needs."

## Steps

Logged in as **Dr. Elena Ruiz** (Medical Director, also Veterinarian at Raleigh office, licensed).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home | Point at the top bar: **Home, Scheduling, Catalog, Pharmacy, Labs, Tasks, Settings** | "This is Dr. Ruiz, our Medical Director. No Marketing, and no Admin." | perm-seed.ts |
| 2 | Voice-over | — | "The one thing to remember: the Medical Director is a vet plus medical oversight. They set licenses and credential vets. They don't run staff, money or marketing." | — |
| 3 | Home | Click **Settings** | "Settings opens…" | — |
| 4 | Settings | Point at the section menus: **Practice** and **Scheduling** only | "…to the practice and scheduling setup a medical lead owns, like appointment types and doctor schedules." | — |
| 5 | Settings | Open **Staff ▾** and click **Staff**, pick **Sam Chen**, and point at the single **Access** tab with **License** | "Under Staff, the Medical Director sees only the Access tab, to set a license." | Sam Chen: Technician, not licensed |
| 6 | Home | Click **Analytics** | "In Analytics…" | — |
| 7 | Analytics | Point at the tabs: **Financial, Appointments, Inventory, Patients** and **Veterinary Services Delivered** | "…they see production for the doctors linked to their login, plus appointments, inventory and patient reports. Not payments or memberships." | Doctor-linked login; production in the last 7 days |
| 8 | Voice-over | — | "On a visit, the Medical Director can also write addenda on any record, change the provider credited on a line after checkout, and see every controlled-drug report." | — |

## What they can't do

- **Marketing:** opening it shows "You do not have permission to: See Marketing: email campaigns and promotions".
- **Staff:** only the Access tab (licenses); no profiles, schedules, roles or audit log.
- Payments, refunds and membership changes beyond a vet's.

## Notes to check before recording

- The Medical Director doesn't hold "Analytics for every doctor" (owner, Nov 9: leave as is), so Veterinary Services Delivered shows only their own production. Note: the catalog's note on "Production (VSD)" says the Medical Director sees every provider; see `docs/training/permissions.md`.

- **Fixed Nov 9 (RP-A15):** Settings → Staff opens for the Medical Director with the Access tab only. Re-check in the dry run once `build-doctor-flow` is merged into this branch.

## Closing

"The most common mistake is asking the Medical Director to fix a staff or billing problem. That's the practice manager. Remember: the Medical Director is a vet plus medical oversight: licenses and credentialing, not staff or money."
