# Invoicing and payments videos: Pass 1 review, batch C (INV-13 to INV-17)

Nov 7, 2026. Branch `training/invoicing-videos-c`. Stack: test database `vayd_api_test_inv_c`, ports 3240/5240/4013/4023, API from `~/worktrees/train-api`, Stripe test mode, free Mac voice (Samantha). Dry runs: `~/.vayd-training-inv-c/dry/`; frames: `~/.vayd-training-inv-c/<spec name>/frames/`.

**Where I stopped:** INV-13 and INV-14 have clean dry runs. INV-16 had one clean run, but I then split one line and could not re-run it. INV-15 got as far as the strike-through check (see below), and the changed script is not re-run. INV-17 has a spec but has never run. After about 6:20 PM the Mac was at a load average of 55 to 65 (other sessions' Cypress runs, a TypeScript check and others), and every later run of mine failed with `cy.exec` (the setup `psql` calls) timing out after 60 s before any video. A tiny `cy.exec` spec passed earlier in the same state, and `psql` by hand takes 0.04 s, so this is machine load, not a spec bug. Memory was fine (55 to 80% free). These three specs only need re-running when the load drops.

Shared helper change (additive): `invKit.ts` has a new `clearAccountCredit(clientId)` (marks overpaid credit invoices deleted so a client starts at $0 credit). Nothing existing changed.

## INV-13. Account credit
- **Dry run:** clean. 1 min 22 s (free voice). 6 clicks, all within 2 s of their lines. `~/.vayd-training-inv-c/dry/inv-13.mp4`
- **Script changes:**
  - Uses Juniper's $75 Office exam (no plan, so full price); the bill is on the ledger and then on the checkout page.
  - The stale-line bug is fixed in the app and now shown on camera: after Add credit $30 the line reads "Sends $45.00 ... ($30.00 account credit comes off first)" with no reload (the off-camera reload in step 8 is gone).
  - New demonstration of step 13: a second Add credit ($50) makes the credits $80 against the $75 bill, and the line changes to "Their account credit covers this balance. Use Account credit on the bill instead of a pay link." with the pay-link buttons gone. Added about 25 s.
  - Checkout therefore shows "Account credit: $80.00 available" and "Used $75.00 of account credit. $5.00 credit left" (the script said $30).
- **Questions:** none.
- **Needs your OK:** the second Add credit ($50, "Prepaid for the next visit") added to show the covers-everything message. Say if you would rather keep it as narration only.
- **Possible app bugs:** none. The pay-link line refreshed right after both Add credits.

## INV-14. Reprice
- **Dry run:** clean. 1 min 4 s. 2 clicks in sync. `~/.vayd-training-inv-c/dry/inv-14.mp4`
- **Script changes:** Juniper is enrolled on the Adult plan (same package as Maple) after the lines are on the bill. Preview matches the script: Office exam covered, Nail trim $25.00 to $22.50, Dental chews $24.00 to $21.60, bill $125.32 to $45.29. After applying: Office exam "covered", Member 10% tags, Membership covered -$75.00, Total $45.29. The narration says "covered lines marked" instead of "the heart", and the last line says Scout keeps hand-priced lines (not shown; from the code only).
- **Questions:** none. **Needs your OK:** none.
- **Possible app bugs:** none. The page header already shows "Membership - Adult - Annual" for Juniper before the Reprice, which is correct for "just signed up".

## INV-15. Manual discounts and employer promotions
- **Dry run:** not clean yet. Spec is written and walked as far as the discount (see below); the last edit is untested.
- **Script changes:**
  - Step 4 needs the field cleared first (`{selectall}60`), otherwise 60 is typed after 75.00.
  - The script says the old price shows struck through after a hand discount. It did not in this build: after Apply discount the line shows only $60.00 (the line's regular price is kept only for membership and Reprice discounts; the API keeps a manual discount amount, not a list price). So step 8 now points at the new $60.00 and opens "Staff audit" ("Price changed on Office exam: $75.00 to $60.00") instead. Frame: `~/.vayd-training-inv-c/inv-15-manual-discounts/fail.jpg` (from the run that failed after this point).
  - The promotion steps run on a separate visit bill for Biscuit (the $75 Office exam), so the total goes $75.00 to $55.00. The Tom ledger bill is a different bill.
- **Questions:** none.
- **Needs your OK:** the Staff audit replacing the strike-through. If you want the strike-through, that needs an app change (proposal below).
- **Possible app bugs:** a hand discount does not keep or show the regular price, although the script (and my Nov 7 check notes) said it would. Proposal: store the regular price as `listUnitPrice` on a manual discount.

## INV-16. End of day
- **Dry run:** clean once (1 min 26 s, 11 clicks, one late click that is now fixed by splitting step 11 into two lines; the split is not re-run). `~/.vayd-training-inv-c/dry/inv-16.mp4` is that first take.
- **Script changes:**
  - "Today's payments" is back. **View payments** opens "Payments for Nov 7" and **All payments** opens "All payments - Saturday, Nov 7, 2026", for the practice manager. All payments shows Cash $40.00, Check $35.00, Credit card $25.00, 3 payments, grand total $100.00, and the rows Maria Rivera / Tom Chen with their types. Both work; the earlier bug is fixed.
  - The deposit steps match the script: slip draft CASH $40.00, CHECKS (1) #1042, TOTAL $75.00; "Deposit posted to Operating account"; the slip; Recent deposits row $75.00, 2 lines, posted, Robin Hale.
  - **Print deposit slip** is clicked with the browser's print stubbed off camera (a real print dialog froze the recording).
  - "Deposit to" is two lines (open the list, choose Operating account) so each click lands with its words.
- **Questions:** none.
- **Possible app bugs:**
  - The All payments list's **Deposit** column shows a time stamp (for example 2026-11-07T22:44:37.502Z) for the cash and check that are not deposited yet. It looks like the received time, not a deposit date.
  - The **Square Received Today** card under Today's Revenue shows "Request failed with status code 500" on the test stack (no Square). Visible in the first frame; crop or scroll before the final take. The check # (1042) is not in the All payments list.
  - **Print deposit slip** hung a Cypress run (system print dialog). Not an app bug.

## INV-17. The most common money mistakes
- **Dry run:** not run.
- **Script changes (owner's Tap to Pay request applied):**
  - Step 6 now points (no click) at **Tap to Pay** and says: "In the field, you'll usually take a card with Tap to Pay on the Stripe reader." then "This demo has no reader connected, so we'll use Card over phone. It works the same way."
  - The consent point opens Card over phone and points at "Owner agreed to keep this card on file", then Cancel. This is because the unticked-by-default consent box above the buttons is hidden when Maria has a saved card (needed for "Card on file" in step 2).
  - Recorded as the manager (Create deposit in the menu). Maple on the plan: Office exam covered, Nail trim $22.50, Dental chews $21.60 with Member 10%. Maria has a saved card and $30 credit.
  - The "Wait for the note: Charged the card on file" line is narration only (nothing is charged).
- **Questions:** none. **Needs your OK:** none.
- **Possible app bugs:** none seen yet.

## Other batch C videos and Tap to Pay
INV-13, 14, 15 and 16 take no card payment (credit, discounts, deposits), so the Tap to Pay lines are only in INV-17.
