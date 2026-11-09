# Membership training videos: review and approvals

The series plan, approved Nov 8, 2026, merges MEM-04 into MEM-03 and MEM-18 into MEM-17. Scripts are in
`docs/training/scripts/memberships/`. Questions, possible bugs and proposed changes from the pass-1 dry runs are in
`docs/training/review-pass1.md`, grouped by video.

**How to approve:** put **yes** in the Approved column for each video to record in pass 2, or a note on what to change.
Videos marked **Blocked** wait on a fix or a decision first.

## Status

| ID | Title | Priority | Pass-1 dry run | Blocked by | Approved |
|---|---|---|---|---|---|
| MEM-01 | Is this pet a member? Reading the Membership section | Must | Passed | — | |
| MEM-02 | Enroll a pet at the visit | Must | Passed | — (fixed Nov 9) | |
| MEM-03 | Post-appointment sign-up (owner here, or email the agreement) | Must | Passed | — | |
| MEM-05 | Owner signed up online: refund the visit | Must | Passed | — | |
| MEM-06 | Walk a client through online signup in the portal | Must | Passed | — | |
| MEM-07 | Second pet: the $75 credit | Must | Passed | — | |
| MEM-08 | Covered services during the visit | Must | Passed | — | |
| MEM-09 | Check a member's invoice before checkout | Must | Passed | — | |
| MEM-10 | How many exams are left? Benefits and the audit trail | Must | Passed | Q-10a (Golden trip fee) for one sentence only | |
| MEM-13 | Change a pet's plan | Must | Passed | — | |
| MEM-14 | Cancel a membership and settle paid vs used | Must | Passed (no-visit case) | — (fixed Nov 9) | |
| MEM-15 | When a pet passes: estimate and death wrap-up | Must | Passed | — (fixed Nov 9) | |
| MEM-17 | Paused benefits: failed payments and card disputes | Must | Passed | — | |
| MEM-19 | Renewals: the 14-day notice and what the client can choose | Must | Ran once; assembly failed under load. Re-run pending | — | |
| MEM-20 | What members see in the portal | Must | Scripted; dry run pending (shared queue) | — | |
| MEM-21 | Membership staff tasks | Must | Scripted; dry run pending (shared queue) | — | |
| MEM-24 | The most common membership mistakes | Must | Scripted; dry run pending (shared queue) | Best made last | |
| MEM-11 | Add or edit a benefit for one pet | Nice | Scripted; dry run pending (shared queue) | — | |
| MEM-16 | Pet changed owners: "Owner changed" | Nice | Scripted; dry run pending (shared queue) | — | |
| MEM-22 | Settings → Memberships | Nice | Scripted; dry run pending (shared queue) | — | |
| MEM-23 | Discount codes and share links | Nice | Scripted; dry run pending (shared queue) | — | |
| MEM-25 | Membership analytics, and linking a Stripe subscription by hand | Nice | Scripted; dry run pending (shared queue) | — | |

## Before any final take

- `build-doctor-flow` (with the Nov 9 membership fixes) is merged into `training/membership-scripts`.
- **File names:** `MEM-03 - CL - Post-appointment sign-up.mp4` (ID, roles, description; owner decision Nov 9).
- **Speed:** finished videos play at 1.25×. The lengths above are at that speed.

## Screens likely to change before launch

- **The staff "New Membership Signup" email** still gives eVet/Pulse steps (MEM-07 notes). Not filmed, but staff
  read it.
- MEM-02, 03, 05, 09, 14, 15 and 17 were re-scripted for the Nov 9 fixes and pass on the fixed code.
- **The client signup page** has hardcoded plan cards and promises ("10% off in our online store", "24-48
  business hours") that don't match the plan settings (MEM-06 notes).

## Demo data and setup

All on the TEST stack (`vayd_api_test_mem`), demo names only. Shared setup is in `cypress/training/memKit.ts`. Each
spec resets the demo households first (`resetMembershipWorld`).

| Setup | What it does | Where |
|---|---|---|
| Plans | The practice's 12 live plans and their 532 benefit lines, copied read-only from `vayd_api_local`. 72 covered catalog items are added to the test catalog by code (name, code, price only) | `setup/mem-plans.py` |
| Stripe prices | A test-mode product and price for each plan, cached in `~/.vayd-training-mem/stripe-prices.json` | `setup/stripe-mem.sh prices` |
| Members | `enrolPet`: a real Stripe **test** subscription on the plan's test price with Stripe's test Visa, the membership through the API, backdated start | `memKit.ts`, `setup/stripe-mem.sh sub` |
| Usage | `useBenefits`: benefit-ledger rows and used counts, dated | `memKit.ts` |
| Paid visit | `paidVisit`: a visit, its charges and payment by the household's saved test card | `memKit.ts` |
| Charges on screen | `addChargesOnScreen`: adds charges on the visit's Checkout panel, so coverage is worked out as it is live | `memKit.ts` |
| Renewal link | `renewalLink`: the review link the renewal email carries, signed with the test stack's test-only secret | `memKit.ts` |

| Video | Demo data it needs | Seed exists? |
|---|---|---|
| MEM-01 | Maple on Canine Foundations, 40 days in, 4 benefits used; Juniper not a member | Yes (in the spec) |
| MEM-02 | Juniper not a member; Stripe test mode for the card | Yes |
| MEM-03 | Juniper's paid wellness visit 2 h ago (5 lines, $417.98) on Maria's saved test card | Yes |
| MEM-05 | Same visit, then Juniper enrolled online | Yes |
| MEM-06 | Maria's portal login; Juniper with a visit booked in 3 days | Yes |
| MEM-07 | Maple a member for 60 days; Juniper joins (posts the $75); an open $32.02 counter invoice | Yes |
| MEM-08 | Maple a member, DAPP already used; a visit with an open bill | Yes |
| MEM-09 | Maple a member; a visit with 4 covered lines and a 50%-off sick visit | Yes |
| MEM-10 | Pepper on Canine Golden, 7 months in, 4 benefits used | Yes |
| MEM-13 | Maple on Canine Golden, 10 days in | Yes |
| MEM-14 | Maple on Canine Foundations, nothing used (after B-14 is fixed: add a paid covered visit) | Yes |
| MEM-15 | Pepper on Canine Golden, 90 days in | Yes |
| MEM-17 | Maple paused "Membership payment past due"; Juniper paused "Card dispute" (set directly; no webhooks on the test stack) | Yes |
| MEM-19 | Maple's year ends in 7 days; renewal link | Yes |

The demo world has **no Lead Client Liaison login**. Lead-CL videos are filmed as Robin Hale (practice manager). The
test database also has no `lead_client_liaison` role, so membership staff tasks there have no queue (MEM-21 notes).
