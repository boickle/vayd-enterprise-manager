# Permissions training videos: Pass 1 review (Nov 10, 2026)

**Scope:** all 18 scripts in `docs/training/scripts/permissions/`. You approved all of them on Nov 10.

**How each one was checked:**
- The script was checked against the current code (`build-doctor-flow` at 68c94179).
- A dry run used the free Mac voice (Samantha) on the isolated TEST stack:
  - database `vayd_api_test_perm`, with the demo staff from `perm-seed.ts`;
  - no email, text or Stripe call leaves the stack.
- Each dry run's frames were checked for visibility, and click timing was checked against `marks.json`.

**Final takes (Pass 2)** will use Nova. `turn.sh` only accepts file names in the form `<CODE> - Manager - <description>.mp4`, for example `PERM-01 - Manager - How roles work.mp4`.

**Lengths:** dry-run lengths below are at 1.25× with Samantha. Nova speaks a little slower, so final takes run about 10–20% longer.

**Permission changes since the scripts were written:**
- **Every role now views client and patient records,** including the Controlled Substances Director (pushed today).
- **Memberships:** only managers, admins and lead CLs edit benefits or cancel.
- **Receiving stock:** client liaisons no longer count or unbox.
- **Order List and inventory valuation report:** the Practice Manager now has both.
- **Message templates and manual sends** are managers-only (lead CLs keep templates).
- **Survey results:** admin only.

The scripts were updated to match these changes where they mention them.

## Bugs and rough edges found (all videos)

| # | Where | What | Seen in |
|---|---|---|---|
| B1 | Settings → Staff → Access, "What they can do today" | The hover text on a permission shows the role's internal code ("technician", "client_liaison"), not its name ("Technician"). Individual grants read well ("Granted by …"). Cause: `permissions.service.ts` sets `sourceLabel = slug`. A small fix: use the role name. | PERM-01 |
| B2 | Settings → Staff → Access and Settings → Roles, "See the full Permission Audit Log" | The link is a plain web link, so clicking it reloads the whole app: about 3 s of blank white page, then Settings opens again. Every other Settings link switches screens instantly. Small fix: use the app's router link. The video cuts the reload out. | PERM-05 |
| B3 | Permission Audit Log, "What changed" for role changes | Still raw data: `0: — → {"name":"Technician","slug":"technician","office":"Raleigh office",…}`, and the offboard row shows `worksWith: [{"userId":…}]`. License and grant rows read fine. PERM-05 points at the license row, but the role row is visible on screen. Known since Nov 9. | PERM-05 |
| B4 | Settings → Staff → Profile, "Default office" | Someone with no office of their own shows the practice default (Durham office) as their default office, even after they get an office role (Technician at Raleigh). That was how Sam Chen looked. It may be by design (default office is checkout stock, separate from the role's office), but managers will likely read it as "Sam works at Durham". See question 2. | PERM-02 |

Not bugs, but worth knowing:
- **Pay-link buttons** show only when a bill has a balance due. The scripts said a tech, CL or vet "can send pay links" on a paid bill, so that was removed.
- **Read-only roles:** the Observer and the Executive have no booking, new-client or task buttons, and no client action buttons (yesterday's fix). The Practice Manager doesn't see the role editor at all; the script had said "read-only", so ROLE-01 was corrected.

## Questions for you

1. **Demo data that's still empty.** These screens show an empty state:
   - ROLE-06: "Nothing is due to count at this office this week."
   - ROLE-07: "No campaigns yet."
   - ROLE-09: Controlled Drugs reports at $0, with no controlled-drug stock.
   - ROLE-10: an empty Mail Order Queue.

   The narration only describes what each screen is for, so the videos work as they are, and an empty count list is what launch will look like ("nothing counted at launch"). Options:
   - (a) Record as is. *Recommended for ROLE-06 and ROLE-10.*
   - (b) Seed a few made-up rows first: one draft campaign for ROLE-07, a little controlled-drug stock and a count for ROLE-09. *Recommended for ROLE-07 and ROLE-09.* About an hour of work, demo data only.
2. **Default office vs. role office (B4).** Should giving someone an office role also set their default office when they have none? If not, PERM-02 can add a line: "The default office on the Profile tab is separate: it's where checkout takes stock from." Which do you want?
3. **File names.** `turn.sh` requires `<CODE> - <who watches> - <description>.mp4`, so the final files will be named like `PERM-01 - Manager - How roles work.mp4` rather than `PERM-01 How roles work.mp4`. OK?
4. **Lengths.** At 1.25×, the dry runs are 38 s to 89 s, while the scripts aimed for 1 to 3 minutes. Nova runs about 10–20% longer, so final takes will be roughly 45 s to 1 min 45 s. Each video still covers every step in its script. Shorter is fine for role tours, so OK as is?
5. **The hover tooltip** in PERM-01 and PERM-07 is drawn by the recording, because the browser's own tooltip never shows in a video. It shows the same text the real tooltip would. OK?

## By video

All 18 dry runs pass, with every click within 2 s of its line. Files are in `~/.vayd-training-perm/dry/` (Samantha voice, not for sharing).

| ID | Dry run | Changes to the script | Notes |
|---|---|---|---|
| PERM-01 How roles work | 1:22, 7 clicks | The one thing to remember now comes right after the why. The tooltip line now says only "from her Technician role" (B1). | — |
| PERM-02 Give a role | 1:19, 13 clicks | Shows Dr. Riley Rivera ticked at both offices on the Veterinarian list (the script only said it). | B4 / question 2. Seed now gives everyone their home office. |
| PERM-03 Set a license | 0:58, 5 clicks | Adds "the medical director can set licenses too, for everyone but themselves" (RP-A15). | Setup makes Sam a Technician at Raleigh first. |
| PERM-04 Offboard | 1:29, 6 clicks | Dropped the "Before their last day" box: it only appears when there's something to warn about, and Riley has nothing. Ends on **Cancel offboarding (last day …)**. | "Works with" lists only Tess (yesterday's fix confirmed). |
| PERM-05 Audit log | 1:04, 6 clicks | Grant rows show their reason; the video points at the license row for before and after. | B2 (reload cut out), B3. Setup makes the PERM-02, 03 and 06 changes through the API, so the log has real rows. |
| PERM-06 Grant one permission | 1:00, 6 clicks | Still "Cancel a membership", which client liaisons can't do by role (owner, Nov 10). Ends on the License box: signing and prescribing can't be granted. | — |
| PERM-07 Change a role | 1:09, 3 clicks | Split "untick it" and "search for export" into two lines. | "Only show changes" shows "No permissions match" (nothing changed yet), which reads well. |
| ROLE-01 Practice Admin & Manager | 1:19, 3 clicks | Practice Manager: no role editor at all, not read-only. Closing: licenses go to the admin or the medical director. | Logins switch off camera. |
| ROLE-02 Medical Director | 1:03, 6 clicks | Clicks 7D so her week of production shows. Settings → Staff now shows her only the Access tab (RP-A15). | — |
| ROLE-03 Veterinarian & Relief | 1:15, 4 clicks | Clicks 7D (Dr. Ortiz $1,360.50). Corrected the tabs: vets have Financial, Appointments and Inventory, with no Patients tab. Removed "send pay links". | The relief vet's Settings is opened off camera (Access Denied). |
| ROLE-04 Technician & Lead | 1:08, 4 clicks | Removed "send pay links"; points at the payment with no Void. | — |
| ROLE-05 CL & Lead CL | 1:11, 2 clicks | Removed "send pay links". The lead CL's membership cancellation stays (owner, Nov 10). | — |
| ROLE-06 Inventory Manager | 0:48, 3 clicks | Settings opens straight on Branches & Locations for this role, so there's no menu step. | Question 1 (empty count list). Seed now gives archived test offices plain names. |
| ROLE-07 Executive | 1:02, 3 clicks | Adds that executives can read client records but have no action buttons (owner, Nov 9). | Question 1 (no campaign). |
| ROLE-08 Billing / AR | 0:49, 1 click | Billing no longer cancels memberships or overrides benefits (owner, Nov 10). Narration and script updated. | Setup now clears the Chens' earlier bills, so the ledger shows one bill. |
| ROLE-09 Controlled Substances Director | 0:50, 1 click | Now says they can open client and patient records (owner, Nov 10). | Question 1 (no controlled-drug stock). |
| ROLE-10 Mail order | 0:56, 2 clicks | The manager's order actions are a voice-over over the **Store** tab, because there are no orders to open. Closing from the script. | Question 1 (empty queue). |
| ROLE-11 Observer | 0:38, 1 click | No pay links, voids or credits on the bill, and no booking buttons. | — |

## What was added (training files only, uncommitted)

- `cypress/training/permRecord.ts`: shared helpers for the permissions videos, including sign-in per role, steady pointing, the tooltip box, the paid Chens bill and test-database setup.
- 18 specs, `cypress/training/perm-0N-*.cy.ts` and `role-NN-*.cy.ts`, each with a matching `narration/<name>.json`.
- `cypress/training/stack/perm-seed.ts`: home offices for demo staff, and plain names for archived test offices.
- Script fixes in `docs/training/scripts/permissions/` (ROLE-03, 04, 05, 08 and 09) for today's permission changes and the pay-link buttons.

**Reset before each final take:** run `perm-seed.ts`. Note that `record.sh` restarts the stack after 3.5 hours, which wipes the seed, so re-seed after any restart. Every spec's setup also makes the data it needs (the paid bill, Sam's role, the PERM-05 log rows).
