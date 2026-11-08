# Invoicing and payments videos: Pass 1 review (dry runs only)

Nov 7, 2026. Branch `training/invoicing-videos`. Stack: test database `vayd_api_test_inv`, API on build-doctor-flow (f620ada2), Stripe test mode, free Mac voice (Samantha). Dry runs are in `~/.vayd-training-inv/dry/`; the frames `record.sh` saved are in `~/.vayd-training-inv/<spec name>/frames/`. Batch A: INV-01 to INV-06. No final takes yet.

Setup notes that apply to all six:
- The worktree had no `node_modules` or `.env`. I linked `node_modules` to the main checkout's, and made a git-ignored `.env` holding only the Stripe test publishable key and the payment-provider line, copied from another worktree. Without them the card form says "Card entry is not configured".
- Shared helpers: `cypress/training/invKit.ts`. Each spec resets both households' bills, estimates and leftovers first.
- Stripe finds saved cards by client email, and the shared Stripe test account already knows the demo emails. So INV-03, 04 and 05 give the client a fresh email for the take; the next spec's reset puts the demo email back.

## INV-01. How charges get onto the invoice
- **Dry run:** clean. 1 min 49 s (free voice). 5 clicks, all within 2 s of their lines. `~/.vayd-training-inv/dry/inv-01.mp4`
- **Script changes:** step 12 now says the declined chews stay under **Pre-visit accepts** with a red "declined" tag and Re-add (that is where the screen shows them). Added a Pass 1 section.
- **Verified:** Accept works as a CL-level login at the member price (the Nov 6 fix holds); earlier-decline shows "Add to invoice"; Chart the decline; "still need doses" note.
- **Questions:** none.
- **Needs your OK:** none.
- **Possible app bugs:** none.

## INV-02. Review the invoice before checkout
- **Dry run:** clean. 1 min 9 s. No clicks (pointing only). `~/.vayd-training-inv/dry/inv-02.mp4`
- **Script changes:** none to the steps; Pass 1 section added.
- **Questions:** it runs well under the planned 2 minutes. Do you want a click in it, for example opening the chews line to show **Pick a lot**, or is a short video fine?
- **Needs your OK:** none.
- **Possible app bugs:** none. Totals match ($51.30, $1.19, $52.49).

## INV-03. Save a card and charge the card on file
- **Dry run:** clean. 1 min 16 s (long Stripe waits are cut). 4 clicks in sync. `~/.vayd-training-inv/dry/inv-03.mp4`
- **Script changes:** uses Maple, not Juniper (Juniper has no plan, so $22.50 and $162 wouldn't be member prices). The consent-box step moved to step 2 because the box shows only while no card is saved. Tooltips (not visible on video) are no longer narrated.
- **Questions:** is Maple instead of Juniper fine for this video?
- **Needs your OK:** none.
- **Possible app bugs:**
  - The first run showed a saved card for Maria before any was saved, because Stripe matched her demo email to a customer left by earlier test use. In real life, two clients who share an email would share a saved card. Worth a look. (The failing screenshot was overwritten by the clean run.)
  - The consent box above the payment buttons is **ticked by default** ("Owner is happy for us to keep this card on file… uncheck if they say no"). The script wording is "ask before you tap". If the point is "ask first", a box that starts ticked works against it. Frame: `~/.vayd-training-inv/inv-03-card-on-file/frames/f003.jpg`.

## INV-04. Split payment
- **Dry run:** clean. 1 min 27 s. 7 clicks in sync. `~/.vayd-training-inv/dry/inv-04.mp4`
- **Script changes:** none to the steps; Pass 1 section added.
- **Verified:** $50 gift card, $30 credit, $82 card, ledger row "Gift Card, Account credit, Visa •••• 4242", ledger Method list with Cash, Amount, Cash received. The card on file was loaded before Cash was chosen, so the flip-back rough edge did not occur.
- **Questions:** Maria's ledger also shows the demo $25 card invoice and the $30 credit row on screen. They aren't narrated. Fine?
- **Needs your OK:** none.
- **Possible app bugs:** none new.

## INV-05. When a card is declined
- **Dry run:** clean. 1 min 40 s. 6 clicks in sync. `~/.vayd-training-inv/dry/inv-05.mp4`
- **Script changes:** step 12 is now shown, not only said: Tom's first typed card (4000 0000 0000 0002) is declined with "That card could not be used — check the number and try again", then **Cancel**, reopen Card over phone and a good card pays. About 25 seconds longer.
- **Verified:** the decline message clears after the good card pays (the Nov 6 fix works). Frame: `~/.vayd-training-inv/inv05-77.jpg`.
- **Questions:** OK to show the typed-card decline? Retyping the number in place made Stripe's box shift digits into the wrong fields (CVC 122, ZIP 7513), so the video cancels and starts again. That looks like a Cypress and Stripe-field effect, but I haven't tried it by hand.
- **Needs your OK:** none.
- **Possible app bugs:** none confirmed (see the retyping note above).

## INV-06. Make and send an estimate
- **Dry run:** clean. 1 min 11 s. 7 clicks in sync. `~/.vayd-training-inv/dry/inv-06.mp4`
- **Script changes:** ends by closing the estimate with **Save estimate** and pointing at the list row and its status; closing line moved after that.
- **Questions:** the test stack has no Gmail. I stub the Info inbox and the send inside the browser (the window is the real one; nothing is emailed). With the stub, the estimate stays **Draft**. The client History box does not show the new "Estimate email" line until the page is reloaded (it is recorded; not shown live). Do you want the final take on a stack with a real shared inbox so the status can show Sent? Also the estimate number reads #2 or higher after earlier takes; the script says #1.
- **Needs your OK:** the browser stub for the final take, or a stack with a real inbox (sending only to deirdre@vetatyourdoor.com).
- **Possible app bugs:** estimates still ignore the member discount (known; Juniper has no plan so the video avoids it). Not re-tested on Maple.

# Batch B: INV-07 to INV-12

Same stack and setup as batch A. Dry runs are in `~/.vayd-training-inv/dry/`. Two things changed in shared code and apply to every video: `trainingKit.ts` now waits until a long smooth scroll has stopped before it outlines or clicks (an Email Ledger outline landed on the wrong box on INV-08 without it, +about 0.1 s per tap), and `invKit.ts`'s reset also clears estimates and the Receipt, Invoice and Ledger email history lines left by earlier takes.

## INV-07. Turn an estimate into the invoice
- **Dry run:** clean. 1 min 21 s (free voice). 7 clicks, all within 2 s of their lines. `~/.vayd-training-inv/dry/inv-07.mp4`
- **Script changes:** added a Pass 1 section. The list under Find estimate shows two estimates (Juniper's dental one and Maple's), newest first; the video opens the first. Part 2 converts Maple's estimate, and **Which visit is this for?** lists two visits (Juniper's today, Maple's tomorrow), so the video picks Maple's. Estimate numbers aren't spoken (they climb with every take).
- **Verified:** Find estimate, expand, Convert, the "Added … to this bill" note, the visit picker, and the Converted status all work. Maple's estimate lines show the member price with the list price struck through ($162.00, $22.50).
- **Questions:** the script's "selected when it's the only one" case isn't shown because the family has two visits. Do you want the single-visit case instead?
- **Needs your OK:** none.
- **Possible app bugs:** none. Frame sheet checked; `~/.vayd-training-inv/inv-07-estimate-to-invoice/frames`.

## INV-08. Email an invoice, receipt or household ledger
- **Dry run:** clean apart from one click 0.1 s past the 2 s limit (the Send email click, line 7, +2.1 s). 51 s. 4 clicks. `~/.vayd-training-inv/dry/inv-08.mp4`
- **Script changes:** the paid bill is the demo's $25 card bill, the unpaid one a $25 nail trim. The video clicks the unpaid bill's row, which the table didn't list. Sending is stubbed in the browser (no Gmail on the test stack): the window is the real one and nothing is emailed.
- **Questions:** the Email receipt button sits at the bottom of the invoice pane, so the page scrolls down to it and the ledger list scrolls out of view. Fine, or do you want the video to open on a shorter invoice?
- **Needs your OK:** the browser stub, or a stack with a real inbox, for the final take.
- **Possible app bugs:** none. After the send, the Receipt email line shows under the client's History right away (unlike the estimate email in INV-06).

## INV-09. What the client sees in the portal
- **Dry run:** clean. 1 min 1 s. 4 clicks in sync. `~/.vayd-training-inv/dry/inv-09.mp4`
- **Script changes:** the bill is Juniper's $25 nail trim. Maria already has a saved Visa on the shared Stripe test account, so the pay form shows **Card on file** first; the video points at it, clicks **Use a different card**, then shows Name on card, Card number and the save-my-card box. Added a **Done** click for the invoice window.
- **Questions:** none.
- **Needs your OK:** none.
- **Possible app bugs:** the pay form is mostly empty space. Under **Have a gift card?** there is a tall blank block, and the card box is tall. Cosmetic. Frame: `~/.vayd-training-inv/inv-09-what-the-client-sees/frames`.

## INV-10. Open balances, including old eVet invoices
- **Dry run:** clean. 53 s. 1 click. `~/.vayd-training-inv/dry/inv-10.mp4`
- **Script changes:** Tom's Scout bill is a $75 Office exam, so the ledger reads $155.00 and the pay-link line "Sends $155.00 for 2 unpaid invoices"; the voice quotes no totals. Updated the role note.
- **Verified:** as a client liaison, the eVet invoice shows **Edit in Scout** and **Email invoice**, and no **Void** (the fix works).
- **Questions:** it is short on action (one click). Want the video to also show **Edit in Scout** being clicked? It would take over the invoice, so I left it out.
- **Needs your OK:** none.
- **Possible app bugs:** none.

## INV-11. Return items and refund
- **Dry run:** clean. 1 min 32 s. 7 clicks in sync. `~/.vayd-training-inv/dry/inv-11.mp4`
- **Script changes:** none to the steps. The voice avoids dollar amounts the screen shows.
- **Verified:** the original bill stays Paid and Due $0.00 after both returns; the card gets $60 then $10, and $50 goes back as account credit (CREDIT $50.00 at the top). The staff-only box now reads "Staff only · voided and refunded payments (2)" (the wording bug is fixed); the box stays closed. After the first return the quantity box reads "≤ 1" and "$10.00 can still go back to the card".
- **Questions:** none.
- **Needs your OK:** none.
- **Possible app bugs:** none new.

## INV-12. Refund, void a payment, void an invoice
- **Dry run:** clean. 1 min 14 s. 6 clicks in sync. `~/.vayd-training-inv/dry/inv-12.mp4`
- **Script changes:** none to the steps; step 9 is three clicks (Void invoice, type the reason, Void). Pass 1 section added.
- **Verified:** Refund payment window (Amount, Reason, Full for this invoice, Process refund), Void payment window, and the card-paid refusal "This bill was paid by card ($55.00 still taken). Refund the card payment first, then void the invoice." The message appears at the top of the invoice pane; the refusal text isn't inside the dialog.
- **Questions:** the video is the same height as the others but lives mostly on the Payments block, which sits low in the pane, so the page scrolls to it. Fine?
- **Needs your OK:** none.
- **Possible app bugs:** none. Not shown: the doctor, technician and CL views in the table (walked on Nov 7).

## Run notes
- One INV-12 run stalled about 25 minutes while another session's memory use pushed free memory to 40% (level 2); I stopped only my own run, waited for level 1 and 76% free, and it then ran normally.

# Pass 2: final takes (Nova), Nov 7, 2026

Stack: `vayd_api_test_inv`, API on build-doctor-flow 882ed47f (rebuilt; migrations ran on the training DB only), Stripe test mode. The fresh DB needs `setup/invoicing-demo.sql` loaded once (`psql -f`) before any INV spec: without it `Nail trim` is missing and the order POST returns 400. Files are in `~/Movies/VAYD Training/`; frames in `~/.vayd-training-inv/finals-frames/<ID>/`.

- **INV-01:** Pass 2: recorded, 128 s, 5 clicks in sync. To be RE-TAKEN after the line-row price/QTY overlap fix (owner, later).
- **INV-02:** Pass 2: recorded, 82 s, no clicks. To be RE-TAKEN after the overlap fix.
- **INV-03:** Pass 2: recorded, 95 s, 5 clicks in sync; the consent box now starts unticked and the video ticks it ("Ask the client, then tick the box"). Spec and narration since gained two Tap to Pay lines (point at Tap to Pay; "no reader connected, so Card over phone") that are NOT in the recorded file. RE-TAKE later, with the overlap fix.
- **INV-04:** Pass 2: recorded, 109 s, 7 clicks, one 0.1 s late (the Method list click, +2.1 s). To be RE-TAKEN after the running-balance, Account credit amount and card-on-file changes.
- **INV-05:** Pass 2: recorded with the two Tap to Pay lines, 136 s, 6 clicks in sync.
- **INV-07:** Pass 2: recorded, 94 s, 7 clicks in sync.
- **INV-09:** Pass 2: recorded, 73 s, 4 clicks in sync.
- **INV-10:** Pass 2: see report (adds the Edit in Scout click and narration).
- **INV-11:** Pass 2: recorded, 112 s, 7 clicks in sync.
- **INV-12:** Pass 2: recorded, 92 s, 6 clicks, one 0.1 s late (inv12-07, +2.1 s).
- **INV-06, INV-08:** not recorded (waiting on a real-send decision).
- Kit: `trainingKit.ts` `center()` waits 300 ms (was 450) before settling, so taps land slightly sooner.
- App wording leftover: the consent box now starts unticked but still says "uncheck if they say no" (VisitCheckoutPanel.tsx).
- **INV-10 (Pass 2):** recorded, 78 s, 2 clicks in sync. Adds the Edit in Scout click ("That takes the invoice over. Scout owns this bill now..."), pointing at Save invoice. Possible app bug: right after Edit in Scout the ledger Balance due reads $235.00 (was $155.00) and lists #48213 as a Scout invoice; it looks double-counted until a reload.

## Pass 2, re-takes (Wave 11 checkout, sync fixes), Nov 7, 2026
Each re-take was checked frame by line: one frame at every line start + 1 s, from marks.json with the offCamera cuts applied. Every frame matched its line, apart from the notes below.
- **INV-02:** 82 s, no clicks. Price no longer overlaps QTY. Cosmetic: the narrower Item column wraps the "Normally hidden" chip on the Biohazard line.
- **INV-03:** 123 s, 6 clicks in sync. Tap to Pay lines, tick the box, then Card on file, "Charge $22.50 to Visa •4242" (pointed at), Charge to confirm, "Paid in full".
- **INV-04:** 130 s, 7 clicks, one 0.1 s late (the Method select, inv04-19). Rewritten one action per line: gift card, Balance due $112, green Account credit ($30.00), apply, Balance due $82, green Card on file, confirm button, Charge, Paid in full list. Script .md updated.
- **INV-06:** 85 s, 7 clicks, one 0.0 s late (inv06-14 +2.0). Browser stub for the send; nothing emailed; Draft status shown; narration claims no delivery.
- **INV-07:** 94 s, 7 clicks in sync, after merging f31a634 ("Which visit is this for?" one visit per line). The owner's "INV-07 FINAL" file was left alone; this take is a separate file.
- **INV-08:** 64 s, 4 clicks, one late (inv08-07 +2.2 s). Browser stub; nothing emailed.
- **INV-09:** 73 s, 4 clicks in sync, every line matched. Note: line inv09-11 (credit message) is not shown on screen.
- **INV-12:** 92 s. The first re-take showed the picture 3 to 4 s behind the voice from the refund Cancel (about 34 s) on, so the Cancel was visible at 38 s. The marks, clicks and cuts were fine (the only cut was 0.3 s). The recording itself lagged, probably while the Mac was loaded (load average 40 to 130, other sessions' Cypress runs). The spec now waits for the Void payment dialog to close and for the Void invoice textarea to be visible. A second take at a lower load was in sync on every line.
- **Process note:** `cy.exec('psql ...')` timed out (60 s) in the reset step of 8 runs while the Mac was overloaded. Runs were retried; the load gate in the recording wrapper waits for load under 30 first.
