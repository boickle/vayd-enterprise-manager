# ROLE-03. What a Veterinarian and a Relief Veterinarian see

- **Audience:** managers.
- **Length:** 2 to 3 minutes.
- **Watch first:** PERM-02, PERM-03.
- **The one thing to remember:** a vet needs both the Veterinarian role at their office and a veterinary license to sign and prescribe. A relief vet has the same clinical access but no reports or practice setup.

## Why (opening)

"Vets do the medicine, so their Scout is built around visits, records and prescriptions. Here's what they see, and what a relief vet doesn't."

## Steps

Part 1 logged in as **Dr. Maya Ortiz** (Veterinarian at Raleigh office, licensed). Part 2 as **Dr. Noah Park** (Relief Veterinarian, licensed).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home (Dr. Ortiz) | Point at the top bar: **Home, Scheduling, Catalog, Pharmacy, Labs, Tasks, Settings** | "This is Dr. Ortiz, a staff veterinarian." | perm-seed.ts; vet logins linked to themselves as doctor |
| 2 | Voice-over | — | "The one thing to remember: a vet needs the Veterinarian role at their office and a veterinary license. The role opens the screens; the license lets them sign and prescribe." | — |
| 3 | Home | Click **Analytics** | "Analytics opens to their own production." | Production for Dr. Ortiz in the last 7 days (perm-seed.ts) |
| 4 | Analytics | Point at **Veterinary Services Delivered** and the tabs **Financial, Appointments, Inventory** | "Vets see their own services delivered, appointments and inventory reports." | — |
| 5 | Home | Click **Settings** | "In Settings…" | — |
| 6 | Settings | Point at **Euthanasia consent** under **Practice** | "…vets manage the clinical setup they own, like euthanasia consent and aftercare." | — |
| 7 | Clients → Tom Chen, financial tab | Point at the paid bill with **Void** on the payment | "On a bill, a vet can void a payment on their own visits." | Paid $75 cash bill on the Chens (Office exam) |
| 8 | Home (Dr. Park) | Point at the top bar: no **Settings** | "Now Dr. Park, a relief vet. Same clinical screens, but no Settings." | — |
| 9 | Home | Type /schedule/settings, or click a Settings link | "If he tries Settings, Scout says so: Access Denied." | — |
| 10 | Settings | Point at "Access Denied. None of your roles includes a Settings permission." | "None of your roles includes a Settings permission." | — |
| 11 | Home | Click **Analytics** and point at the single **Inventory** tab | "His Analytics has only inventory: no production or finance reports." | — |
| 12 | Voice-over | — | "On a visit, a relief vet can examine, write and sign records and prescribe, just like a staff vet. He can't void payments, see controlled-drug reports, or manage tasks for others." | — |

## What other roles see

- **Medical Director:** everything a vet sees, plus credentialing (ROLE-02).
- **Technicians** can't sign a SOAP or approve a prescription (ROLE-04).

## Notes to check before recording

- **Relief Veterinarian** has 0 holders in production today. Owner, Nov 9: keep part 2 (it helps when we hire one).
- **Production view:** Veterinary Services Delivered shows a vet's own production only when their login is linked to themselves as the doctor (all 15 production vets are). A vet whose login isn't linked sees "No providers are assigned to your user account".
- Fixed Nov 9 (RP-A17): the **Euthanasia consent** help text no longer names doctors.
- **Demo production** for Dr. Ortiz (a week, $1,247) is in perm-seed.ts.

## Closing

"The most common mistake is giving a new vet the role but not the license, or the license but no office. Remember: a vet needs the Veterinarian role at their office and a veterinary license."
