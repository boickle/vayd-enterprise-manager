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
