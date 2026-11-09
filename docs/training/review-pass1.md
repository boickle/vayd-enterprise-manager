# Membership training videos: pass 1 review

Pass 1 = steps 1 to 8 for each video: script checked against the code, Cypress dry run with a free Mac voice
(Samantha), timing and visibility checked. No final takes yet. Dry-run files are in `~/.vayd-training-mem/dry/`
(not in `~/Movies/VAYD Training`).

**Setup used for every dry run:**
- **Code:** app on `training/membership-scripts` (made from `training/videos`, which is 46 commits behind
  `build-doctor-flow`; none of those commits touch the membership screens). API on `build-doctor-flow` (827efe45).
- **Database:** test database `vayd_api_test_mem`, with ports and Redis of its own. Scheduled jobs off, email
  captured to a file, Stripe faked unless noted. The control database and the AI keys are off.
- **Plans:** the practice's 12 live membership plans and their benefits, copied read-only from `vayd_api_local`
  (`cypress/training/setup/mem-plans.py`). No client data was copied.

## Summary (Nov 9, 2026, early morning)

- **Dry runs passed:** 13 of 23: MEM-01, 02, 03, 05, 06, 07, 08, 09, 10, 13, 14, 15, 17. All clicks are in sync
  and the whole screen is visible. Dry-run files are in `~/.vayd-training-mem/dry/`.
- **Scripted, dry run pending:** MEM-19 (ran once, failed in assembly under load), 20, 21, 24, 11, 16, 22, 23, 25.
  They wait for a free turn in the shared recording queue.
- **Need a quick re-run before final takes:** MEM-01 (first run was on the fake Stripe; billing card now shows the
  test Visa), MEM-08 and MEM-15 (one line each reworded after their runs).
- **Blocks recording:**
  - **B-14 (money):** the cancel settlement leaves out covered services added during visits, and counts paid
    member-discount lines instead. It refunds too much on every mid-year cancel and death wrap-up (MEM-14, MEM-15).
    The root cause is shared with MEM-09: covered visit lines are saved with no regular price.
  - **Q-02a:** staff enrollment from the chart never starts Stripe billing after the first fee (MEM-02).
- **Other possible bugs** are listed under each video: the post-visit receipt never shows (MEM-03, 05); the staff
  signup email still gives eVet/Pulse steps (MEM-07); "Billed through Square" on a never-Square member (MEM-02);
  "Owner paid — refund visit" on every Stripe member (MEM-01); two welcome emails (MEM-03); wording slips
  (MEM-05, 06, 17).
- **Plan data for you:** Golden covers two visits but one trip fee (Q-10a). Store discount is set on only 3 of 12
  plans, while the cards promise 10% on all (MEM-13 notes).
- **Security note:** while reading the API `.env` for the renewal-link secret's name, I printed part of the local
  `JWT_PRIVATE_KEY` value into this session's output. It's the local development key. Rotate it if you'd rather;
  nothing was written anywhere else.

## Stack and tooling notes

- **AI call from the test stack (fixed for my stack):** the chart's **Case summary** called Anthropic with the
  `.env` key, sending demo data only. I restarted my stack with `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` blank.
  The box then shows "Request failed with status code 400", so specs close **Case summary + chat** before
  filming. Other training stacks still make this call. `stack-up.sh` should blank both keys; that's a
  training-file change, so it waits for your OK.
- **Stripe test mode:** card steps need Stripe's own test mode (the fake can't take a card), so my stack runs with
  `TRAINING_STRIPE=test`. Setup creates test-mode products, prices and subscriptions for the demo plans
  (`setup/stripe-mem.sh`, test keys only). Emails were captured to a file; none went to anyone.
- **Hidden-window throttling:** after a few minutes, headless Electron throttles page timers, so typing and drawing
  crawled (one 3-second signature took 11 minutes). My runs set `ELECTRON_EXTRA_LAUNCH_ARGS` to turn throttling off.
  Other training sessions may want the same.
- **Machine load:** several sessions ran recordings, ffmpeg jobs and builds at once (load average 60–107), which
  caused page-load and request timeouts. My specs raise Cypress's timeouts.
- **`training/videos` doesn't have the control-database fix** that `training/room-loader-video` has. I exported
  `CONTROL_DB_ENABLED=false` and `GMAIL_POLL_INTERVAL_MS=0` myself and checked that the API only talks to
  localhost.

## By video

### MEM-01. Is this pet a member? Reading the Membership section

- **Dry run:** passed, 92 s with Samantha (Nova runs a little longer). 3 clicks, all in sync. Whole screen visible.
- **Script changes:** written from the code this pass. Line 12 now points at the trip-fee "Choose 1" row,
  because a used-up row reads "Used" and moves to the bottom of the list.
- **Possible bug: "Owner paid — refund visit" never goes away.** It shows on every Stripe-billed member who
  hasn't had a post-visit refund, here on a membership 40 days old. The rule
  (`PatientMembershipPanel.tsx` `ownerPaidOnline`) only checks that a `sub_` id exists and the start isn't in
  the future, with no time limit. Staff will see it on almost every online member. Expected: shown only
  within the post-visit window, like **Post-appointment sign-up**. Related: memberships.md rule 82.
- **Question: audit trail on a migrated or online member.** The first entry reads "Enrolled in … · <who> ·
  <today>". On real online signups it should show the signup. Worth a look on staging; I couldn't make a real
  online signup on the fake Stripe.
- **Look:** a thin orange outline shows on the collapsed **Membership** header in lines 4–5. It looks like the
  app's focus ring, not the kit's outline. Harmless, but visible.

### MEM-02. Enroll a pet at the visit

- **Dry run:** passed, 105 s with Samantha, Stripe test mode, test Visa 4242. 7 clicks, all in sync.
- **Script changes:** line 19 said "confirm she agreed to the charge". The box is actually **Owner agreed to keep this
  card on file**, so it now reads "tick this box only if Maria agrees to keep the card on file".
- **Q-02a (blocks recording): which way do staff sign up at the visit?** **Enroll in a plan** puts the first fee on a
  counter invoice but doesn't start Stripe billing for the months after. Staff enrollment never creates a
  subscription (`patient-membership.service.ts`); only post-visit signup and online checkout do. So a monthly
  member enrolled this way is billed once, then never again. **Recommended:** at the visit, staff use
  **Post-appointment sign-up** (MEM-03), which takes a card and starts the subscription. Then either drop MEM-02 or
  make it "Enroll when the owner pays the year up front". Longer term, **Enroll in a plan** should start the
  subscription too.
- **Possible bug (related): a chart-enrolled member shows as "Billed through Square".** After the fee is paid,
  Juniper's panel says "Billing card: Billed through Square. Enter the card the owner gives you to move billing to
  Stripe now… Scout cancels the Square subscription." Juniper was never on Square. The panel treats any membership
  without a `sub_` id as Square (`patient-membership.service.ts` ~l.318–337). Expected: "Not billed yet" or similar,
  not Square. Not in a test plan.
- **Possible bug: the enroll list shows every plan, dog and cat, all ages.** Juniper, a 6-year-old cat, is offered
  the Canine plans first. This is open item OQ-85 in `docs/test-cases/memberships.md` (still open).
- **Data: Feline Foundations has no online store discount.** The plan's **Online store discount** is blank. The
  Canine plans have 10%. That's in your live plans (`vayd_api_local`), not just my copy. Check whether cats are
  meant to get 10% in the store too.
- **Agreement wording:** the agreement still lists "priority scheduling, priority 7-day support" under each plan.
  On Oct 31 you dropped those claims from the check-in email (room-loader D9). The agreement is a legal text, so I
  only flag it.

### MEM-03. Post-appointment sign-up (now includes MEM-04, email the agreement)

- **Dry run:** passed, 114 s with Samantha, Stripe test mode. 8 clicks, all in sync.
- **Totals agree:** the screen showed paid $417.98, covered $385.96, refund $385.96, new total $32.02. Afterwards
  the invoice in the database is total $32.02, paid $32.02, membership adjustments −$385.96. The panel shows Visa
  ending 4242 on a new test subscription.
- **Script changes:** the "enter a card" step became "her card on file pays the membership", because the card
  box only appears when the owner has no saved card. Line 20 points at the new membership on the panel, because
  the receipt never shows (next bullet).
- **Possible bug: staff never see the post-visit receipt.** On success the panel closes the modal at once
  (`PatientMembershipPanel.tsx` `onCompleted` → `setPostVisitOpen(false)`). The receipt (`SignupReceipt`) is where
  "Refund of $X FAILED. Refund this by hand", "Charge … FAILED. Collect this by hand" and "The client email did not
  send — let them know manually" would appear. When a refund or charge fails, nobody would know. Expected: keep the
  modal open on the receipt until **Done**.
- **Possible bug: two welcome emails for one signup.** Maria got "Welcome to VAYD Membership - Juniper" and
  "Welcome to VAYD Membership — Juniper's visit has been updated", plus the staff notice. Both welcomes went to the
  file capture (addressed to deirdre@ by the test redirect). Expected: one client email with the breakdown.
- **Question Q-03a: invoice list vs window.** The picker says "Showing paid invoices from the last 48 business
  hours" while the signup window is 24. That's memberships.md rule 82, known. Fine to leave? **Recommended:** yes,
  because the window check still applies when you calculate.
- **Look (fix for the final take):** in line 19 the cursor ends up resting on **Cancel**, because the button shrinks
  to "Signing them up…" as it's clicked. I'll move the cursor away after the click.
- **Not filmed:** the emailed-agreement path end to end (the owner signing from the link). The email option is
  shown up to **Email agreement to sign**, not sent.

### MEM-05. Owner signed up online: refund the visit

- **Dry run:** passed, 70 s with Samantha, Stripe test mode. 5 clicks, all in sync. Short; fine for one task.
- **Totals agree:** refund $385.96. Afterwards the invoice is total $32.02, paid $32.02. The **Owner paid** button is
  gone after the refund.
- **Possible bug (wording): the footer button reads "Sign up & refund $0.00" before you calculate.** In
  owner-already-paid mode it should say "Refund …". It reads "Refund $385.96" once calculated.
  `PostVisitMembershipSignup.tsx` `signupActionLabel` with no preview.
- **Possible bug (wording):** the confirm dialog says "already paid for Membership - Feline Foundations - Monthly
  monthly online".
- **Same as MEM-03:** the receipt never shows after the refund (the modal closes on success).
- **Related to MEM-01's bug:** because **Owner paid — refund visit** shows on every Stripe member, staff could start
  this on a months-old membership. The window check still applies when they calculate, but the button invites it.

### MEM-06. Walk a client through online signup in the portal

- **Dry run:** passed, 100 s with Samantha, Stripe test mode, test Visa. 6 clicks, all in sync.
- **Checked:** the membership was created in Scout at once (active, $59 monthly, test subscription); the panel shows
  Visa ending 4242. One welcome email and one staff notice went to the file capture.
- **Script changes:** I added the cardholder name and billing address (required, not pre-filled), and the booked-visit
  requirement. Line 18 no longer mentions the $75 credit, because it only shows for a second pet.
- **Possible bug (wording): "may take up to 24-48 business hours for Juniper's membership to be fully active".** On
  Stripe the membership is active at once (memberships.md "other promises" list). **Recommended:** drop that
  sentence.
- **Possible bug (wording):** the success page's NOTE says "please login to your client portal" while she's already
  logged in.
- **Mismatch: the plan card promises "Member pricing (10% off) in our online store" for cats, but Feline
  Foundations has no store discount set** (see MEM-02). The card text is hardcoded in `MembershipSignup.tsx`, not
  read from the plan (memberships.md OQ-107 style).
- **Look:** the Foundations card says "Annual Membership Plan" under the name even when she pays monthly
  (hardcoded tag line).
- **Question Q-06a:** the billing address isn't pre-filled from the client record. Leave it, or pre-fill?
  **Recommended:** pre-fill from the household address.
- **Data note:** the success page and signup list show the practice phone (207) 536-8387 and info@vetatyourdoor.com
  from the page code, even on the Raleigh demo. Fine for VAYD.

### MEM-07. Second pet: the $75 credit

- **Dry run:** passed, 72 s with Samantha, Stripe test mode. 4 clicks, all in sync.
- **Checked:** enrolling Juniper while Maple is a member posted a $75 credit invoice ("Membership Multi-Pet —
  Juniper", qty −1) and an audit entry. **Account credit** then showed "$75.00 available" and paid the $32.02 bill.
  The header shows **CREDIT $42.98**.
- **Answer to the earlier plan:** the credit is automatic (`membership-multi-pet-credit.service.ts`), for every
  enrollment route that goes through `createPatientMembership`. The emails still tell staff to add it by hand
  (memberships.md rule 56). Check that the welcome and staff email wording matches automatic posting.
- **Possible bug (small): the ledger row doesn't say what the credit is.** It reads "Direct invoice · Scout · Credit
  ($75.00)". Staff have to open it to see "Membership Multi-Pet — Juniper". Expected: the description on the row.
- **Tooling:** earlier takes had left "Membership agreement" history rows and 14 open visit charts on Juniper. The
  reset now clears both for the demo households.
- **Possible bug (go-live): the staff "New Membership Signup" email still gives eVet/Pulse steps.** After "Already
  active in Scout…", it says "2. Add Wellness Plan to Pulse for Juniper… 3. Enter Payment in Pulse. In eVet, after
  adding the wellness plan, click Make Payment… full annual amount", then a payment type "Membership Plan Payment",
  then "no need to enter payments from square". Once eVet is off, steps 2–3 are wrong and step 3 would double-record
  the money. Expected: the steps that apply in Scout only (the welcome text, the $75 note). Also "primary provider
  is: TBD" for a pet with a booked doctor. Not in a test plan.
- **Possible bug: Maple's welcome email says "A $75 credit for enrolling an additional pet has been applied"**,
  though Maple enrolled first and no credit was posted for her (the only credit is Juniper's). The email's
  "second pet" check (rule 56) doesn't match the credit service's check. Worth one look on staging.

### MEM-08. Covered services during the visit

- **Dry run:** passed, 79 s with Samantha. 5 clicks, all in sync. Final narration line 13 reworded after the run
  (only that clip changes).
- **Script changes:** the benefit picker appears for the wellness visit itself, because Foundations has both an
  included visit (1 a year) and an unlimited 50%-off visit. The planned Quick (Tech) example was dropped.
- **Question Q-08a: picker labels.** The options read only "included" and "50% off", with no benefit name. Fine
  for Foundations; with more groups it could be unclear. **Recommended:** show the benefit group name under each
  option.
- **Note:** the visit checkout total has no "Membership covered" row, unlike the counter invoice (that row appears in
  MEM-09). Not a bug, just different.

### MEM-09. Check a member's invoice before checkout

- **Dry run:** passed, 67 s with Samantha. No clicks (it's a review); every pointer lands on its line.
- **Script changes:** written from what the screen shows. There's no tax on any of these lines, and no **Membership
  covered** row (next bullet), so the script doesn't mention either.
- **Possible bug: covered charges added during the visit don't record what the plan covered.** Lines added on the
  visit screen are saved as $0 with no regular price (`listUnitPrice` empty) and no `discountReason`. The bill's
  `membershipAdjustments` stays $0.00, so the **Membership covered** row never shows. Here that's four covered lines
  worth about $430, against rule 22 in memberships.md. A post-visit signup does record it (MEM-03: −$385.96). This
  could make "covered services used" read low in cancel settlements (MEM-14) and in the planned reconciliation
  reports (REC-003).
- **Possible bug (small): the member's 50%-off exam shows as a plain $67.50.** No regular price and no "Member 50%"
  tag, so neither staff nor the client can see the saving.
- **Look:** on the checkout page the top bar reads "Active Patient — Patient #8…" instead of "Maple".

### MEM-10. How many exams are left? Benefits and the audit trail

- **Dry run:** passed, 64 s with Samantha. 2 clicks, both in sync.
- **Data question Q-10a: Golden covers two visits but only one trip fee.** Canine Golden has a "6 Month Followup"
  visit group (1) on top of the annual visit (1), but its "Trip Fee or 5 others" group allows 1 a year. After
  Pepper's first visit the trip fee shows **Used**, so his covered six-month visit would still charge a trip fee.
  The client signup card and the agreement both say "Two wellness exams **with trip fees**". That's your live plan
  setup (copied from `vayd_api_local`), not just my copy. **Recommended:** raise Golden's trip fee allowance to 2,
  or reword the card and agreement. I left trip fees out of the narration until you decide.

### MEM-13. Change a pet's plan

- **Dry run:** passed, 75 s at 1.25× with Samantha, Stripe test mode. 5 clicks, all in sync.
- **Checked:** Golden ($99) → Foundations ($69), 10 days in. The message read "$30.00 (1 month billed this
  membership year × $30.00) was credited and comes off their next bills. It is not refunded to the card." That
  matches your Oct 29 rule. The audit trail shows "Stripe billing moved…" and "Changed plan from … to …" by Casey
  Morgan. Start and expiry dates were unchanged.
- **Script change:** the **Plan changed** message is now on camera (it wasn't in the plan).
- **Not filmed:** the greyed-out button for a CL after the first month. The tooltip only shows on hover, so it's
  described in the script instead. Tell me if you want a second short clip as a lead CL or manager.
- **Data (adds to MEM-02's note): which plans have a store discount.** In your live plans, 10% is set on Canine
  Foundations (monthly and annual) and Feline Foundations **annual**. It's blank on Feline Foundations **monthly**,
  all four Golden plans and all Puppy/Kitten plans. The signup cards and the agreement promise 10% for every plan.

### MEM-14. Cancel a membership and settle paid vs used

- **Dry run:** passed, 62 s at 1.25× with Samantha, Stripe test mode. 2 clicks, both in sync. Uses a member with no
  visits ($69 paid, $0 used, $69 refunded). After the cancel, Scout opens the client's settlement receipt; that's now
  on camera.
- **Bug B-14 (high, money; blocks recording): the cancel settlement leaves out covered services added during
  visits.** What I did: Maple on Foundations, then a real visit with charges added on screen (wellness visit,
  rabies 3-year and 4Dx covered, plus a 50%-off sick visit she paid $67.50 for), paid by card. Then **Cancel**.
  What happened: "Covered services used **$67.50**" (only the sick visit, which she paid for herself) and "Refund to
  owner **$1.50**". What I expected: about $300 of covered care counted (wellness $118 + rabies + 4Dx), and the
  owner **owing** money. Cause: `membership-cancel-settlement.service.ts` `coveredThisTerm` values each line at
  `listUnitPrice ?? unitPrice`. Covered visit lines are saved at $0 with no list price (MEM-09), so they count as
  $0. It also counts the paid 50%-off line as "covered services used". This hits every mid-year cancel, and the
  euthanasia estimate (MEM-15) uses the same preview. Related test cases: memberships.md rule 36 and the SCN and
  REC rows; not listed as found there.
- **Question Q-14a: one click moves money.** **Cancel & refund $69.00** refunds at once, with no "are you sure?".
  **Recommended:** a confirm step that repeats the amount, like **Move to this plan** has.
- **Note:** in Stripe test mode a membership started "120 days ago" has only one $69 invoice (the test subscription
  is new), so "paid this year" reads $69 rather than 4 × $69. On real data it would show every month paid.

### MEM-15. When a pet passes: the euthanasia estimate and death wrap-up

- **Dry run:** passed, 50 s at 1.25× with Samantha, Stripe test mode. 3 clicks, all in sync. Line 9 reworded after
  the run to match the screen.
- **Script change:** filmed from **Deactivate** on the chart, the case every role meets (a pet that died at home).
  The euthanasia-visit route (estimate line, checkout wrap-up) is covered in "What else" and in EMR V9 and V10, not
  re-filmed. Tell me if you want a separate euthanasia-visit video.
- **Depends on B-14:** the wrap-up's "Will refund $99.00" comes from the same settlement as Cancel. After real visits
  it would refund too much.
- **Question Q-15a (known, memberships.md agreement table):** the agreement says "No partial refunds are issued", but
  the wrap-up refunds the unused part. Which is right? **Recommended:** keep the refund and change the agreement.
- **Look:** after inactivating, the Membership section stays collapsed with no **Inactive** badge. It was the heart
  disappearing that showed the change.

### MEM-17. Paused benefits (now includes MEM-18, card disputes)

- **Dry run:** passed, 56 s at 1.25× with Samantha, Stripe test mode. 2 clicks, both in sync. Changing the card
  worked: "Saved. Membership payments now go on this card."; the billing card became Mastercard ending 4444.
- **Script changes:** added **Name on card** (required). The pause is set in setup, because the test stack can't
  receive Stripe webhooks. So the owner email, the staff task and the automatic resume after the retry aren't
  checked here.
- **Possible bug (wording): a paused member also says "Benefits are available right away."** That line sits
  directly under the **Benefits paused** badge. Expected: hide it while paused.
- **Question Q-17a:** after **Use this card for the membership**, benefits stay paused until Stripe's next retry
  succeeds. Should changing the card also retry the missed invoice at once (the component has a "Stripe charged the
  card today." message for that case)? **Recommended:** yes, retry at once, so the CL can tell the owner it's
  settled.
- **Rehearsal item (launch plan §4):** the failed-payment path end to end (declining test card 4000 0000 0000 0341,
  owner email, task, resume) still needs a staging run with webhooks.

### MEM-19. Renewals

- **Dry run:** the spec is written and one take ran to the end, but assembly failed under heavy machine load (no black
  start frame). A clean take waits for a free turn in the shared recording queue. Earlier frames showed the page
  loading from a signed review link.
- **Tooling:** the test stack now starts with a test-only `MEMBERSHIP_RENEWAL_TOKEN_SECRET` so specs can make the
  link the renewal email carries. That was set for my stack only, not in `stack-up.sh`.
- **Not checked:** the renewal job itself (scheduled jobs are off) and the notice email.

### MEM-20, MEM-21, MEM-11, MEM-16, MEM-22, MEM-23, MEM-25, MEM-24: scripted, dry runs pending

- **Why pending:** from about 11 pm, training recordings on this Mac go through one shared queue (a coordinating
  session set it up, saying you'd asked for it). The final videos due by 7 am go first, and dry runs only queue when
  no one is waiting. These scripts are written from the code with screen labels taken from the source; each marks
  what to confirm on its first dry run.
- **MEM-21 (finding): the test database has no `lead_client_liaison` role.** Membership tasks there get no queue and
  reach only the practice-manager watchers. `vayd_api_local` has the role and 1 holder, so production is likely
  fine. This is your launch checklist item "at least one employee holds Lead Client Liaison".
- **MEM-16, MEM-21:** the owner-change flag and the tasks come from scheduled jobs and webhooks, so the specs will
  create them directly.
- **MEM-24** is best made last; it reuses the other screens.

## Fixes made (Nov 9, 2026, after your answers)

App fixes are on branch `fix/membership-findings` in both repos (worktrees `~/worktrees/mem-fix-fe` and
`~/worktrees/mem-fix-api`, made from local `build-doctor-flow`). Not committed yet.

| Finding | Fix |
|---|---|
| B-14 settlement leaves out covered visit lines | Covered lines now keep their regular catalog price (amount $0), so the bill shows **Membership covered** and the settlement counts them. The settlement counts a covered line at its regular price, a member-priced line only by its discount, and never what the owner paid |
| Refund rule (your answer) | No partial refund by default. The preview shows **Unused (not refunded)**. **Refund the unused $X (exception)** needs a reason, which goes in the audit. The owner email says "no partial refund". Amounts owed are still charged. The euthanasia estimate and the wrap-up follow ("No refund: the unused $X is kept under the agreement") |
| Q-14a one-click cancel | Cancel now asks to confirm, repeating the amount |
| Q-02a Enroll didn't start billing | **Enroll in a plan** now takes the card on file or a new card, and starts the Stripe subscription (first period charged today). If Stripe declines, nothing is enrolled. No counter-invoice fee |
| Enroll list showed every species and age (OQ-85) | Filtered to the pet's species and age, same rule as post-visit signup |
| "Billed through Square" on a never-Square member | Reworded to "Not billed through Stripe yet (older memberships may still be on Square)…"; the button reads **Start Stripe billing** |
| Post-visit receipt never shown | The modal stays on its receipt until **Done** |
| "Owner paid — refund visit" on every Stripe member | Shown only while a paid visit is inside the post-visit window |
| "Sign up & refund $0.00" in refund-only mode; "Monthly monthly" | "Refund visit" before calculating; the interval word is dropped when the plan name has it |
| Two welcome emails on post-visit signup | Post-visit signup skips the plain welcome (its own email has the welcome and the breakdown) |
| Staff signup email gave eVet/Pulse steps; provider "TBD" | Pulse/eVet/Square steps removed; "not chosen yet (set it on the pet's chart)" |
| First pet's welcome claimed the $75 credit | The "another member pet" check no longer counts the pet signing up |
| Ledger credit row didn't say what it was | Direct invoices show their first line (e.g. "Membership Multi-Pet — Juniper") |
| 50%-off member exam showed as a plain price | Copay and percent-off benefit lines keep the regular price and a "Membership discount (…)" reason |
| "Benefits are available right away" while paused | Hidden while paused |
| Q-17a card change didn't retry | Changing a past-due member's card pays the open invoice now; when it goes through, benefits resume and the message says so |
| Online signup: billing address not pre-filled; "24-48 business hours"; "please login" | Cardholder and address pre-filled from the household (client logins only); both sentences fixed |
| Plan card said "Annual Membership Plan" when monthly | Code default now "12-Month Membership Plan". **Your plans also carry "Annual Membership Plan" in their card tag line (plan data)** |
| Checkout top bar "Patient #8579" | The checkout page now names the pet in **Active Patient** |
| Training stacks call AI and the control DB | `stack-up.sh` on `training/membership-scripts` now blanks the AI keys and turns off the control DB and Gmail polling. `training/videos` is checked out with uncommitted edits in another session's worktree (`sch-train-fe`), so I left it |

**Not changed (your answers):** picker labels (Q-08a), the 48-hour invoice list (Q-03a), plan data.

**Tests:** API: membership, payments and transaction suites 945 (939 pass, 6 todo); visit workflow and Room Loader
suites pass (one split spec updated for the new discount mark). Front end: `tsc -b` clean; 44 related test files
pass, plus new wrap-up label tests. Changed tests: refund tests now pass `refundUnused` with a reason, or check the
new default.

**Checked in the app (Nov 9, early morning), on the fixed code:** dry runs on my test stack with Stripe test mode:
- MEM-02: Enroll charges $59 and starts billing; "Benefits are available right away" shows.
- MEM-03 and MEM-05: the receipt shows, then **Done**.
- MEM-09: **Membership covered −$281.13**, **Member 50%**. (Since then another session relabelled the row, e.g. "4 items included in membership −$281.13"; the script uses the new label.)
- MEM-14: no partial refund, the exception box, the confirm step, the settlement line "unused $69.00 kept".
- MEM-15: "No refund: the unused $99.00 is kept".
- MEM-17: a real $69 missed payment (Stripe test mode) is taken on the new card, and benefits come back.
- MEM-01: no **Owner paid** button.
- The settlement probe after a real visit now counts $348.63 used, and the owner owes $279.63.

Two fixes came from these runs: the agreement is filed after the purchase record (so "available right away" shows),
and the Stripe idempotency key includes the card.
