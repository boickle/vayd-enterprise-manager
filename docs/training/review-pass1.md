# Online Store videos: Pass 1 review (dry runs)

Each video was checked against the code and dry run with a free Mac voice (Samantha) on the training stack. The stack used a test database (`vayd_api_test_osv`) and Stripe test mode, with test card 4242. Nothing was recorded with Nova yet.

For each video:
- the spec is `cypress/training/<name>.cy.ts` and the narration is `cypress/training/narration/<name>.json`;
- the dry-run video is in `~/.vayd-training-osv/dry/` (local only).

"In sync" means `record.sh` reported every click landing within 2 s of the line that names it.

Answer what you can below. Pass 2 records only the videos you approve.

## Your decisions (Nov 8)

- **B8, pause:** fix. A pause only ever delays the next shipment, never brings it earlier.
- **B9, blank box in Pay now:** fix the CSS.
- **B10, approved at the visit:** build an **Approved by doctor** checkbox on each mail-order prescription line at visit checkout.
  - It ticks itself when the doctor signed the script in the drawer, and Scout logs who ticked it and for which doctor.
  - If it's unticked, checkout asks "Are you sure this still needs the doctor's approval?"
  - The approval task then goes to **both the doctor and the doctor's tech**. The order stays in the Mail Order Queue under **Needs approval**, with the "Task with …" chip.
- **B11, reject email:** fix. Sending the reject email counts as contacting the client.
- **Q9, eVet pay links:** links work, and nothing needs fixing. The portal blocks eVet bills only while eVet sync is on, and pay links don't check sync. OSV-04's narration will mention pay links; re-record after sync is off.
- **Q12a:** add the **Billing / AR** role and a demo billing login to the training setup (test database only).
- **Q12b:** one closing line for the other three task types is enough.
- **Texting panel 500:** restart the training stack with `TRAINING_SMS_CAPTURE=1`.
- **OSV-07:** click **Summarize Case** on camera (demo chart only).
- **Coupons:** the Discount box starts empty. No end date for now.
- **Lengths:** shorter videos are fine.

## Across all videos

- **Run setup:** the recording needs `CYPRESS_OSV_WORLD`, the demo-data file from `setup/online-store-demo.cjs`, besides `record.sh`'s usual variables. The store's card fields also need the app's `pk_test_` Stripe key (`.env.local` in the training worktree, never a live key).

## OSV-01 Shopping the store as a portal client

- **Dry run:** passed, 2:11, 14 clicks in sync. The frames show the whole screen, and nothing hides under the header.
- **Changed in the script:**
  - **Step 3:** the portal has no **Shop** button in a top bar. Maria opens the store from the portal's **Online pharmacy & store** card (**Shop now**). **Shop** is in the store's own top bar.
  - **Step 10:** split into one line per click: **← All products**, **Dental chews**, **Maple**, **Buy once**, **Add to cart**.
- **Confirmed:** total **$69.33** (Subtotal $60.99, Shipping $4.99, Sales Tax $3.35). On the next visit, the cart shows **Card on file** "Visa •••• 4242".
- **To decide:**
  - The portal opens on Juniper (the first pet). The video doesn't comment on it.
  - The store shows "← Back to Juniper's portal" at the top, because she came from Juniper's page. That's fine, but the narration doesn't mention it.

## OSV-02 Guests: gift cards and items without a login

- **Dry run:** passed, 2:02, 14 clicks in sync, including the **guest gift card payment** (Stripe test card 4242). That payment hadn't been walked before.
  - The capture file got 3 emails: the gift card receipt, the gift card email to the recipient, and the earlier OSV-01 receipt. The stack sends no real email.
- **Changed in the script:**
  - **Step 3:** the **Gift Cards** tab opens the gift card page directly. There's no tile to click.
  - **Step 8:** the button reads **Add $50 gift card — $50**.
  - **Step 12:** the thank-you page now says "Your gift card · $50.00 gift card ••••… · Email to Tom Chen is on its way now." The old "Your gift cards are on their way by email" only shows when there's no gift card list. The narration now says "The guest gets a receipt, and the gift card email to Tom is on its way."
  - Steps 6 and 9 are split into one field per line.
- **Confirmed:** guest dental chews total **$31.35**. The balance check shows "Gift card ••••2345: $50.00 available".
- **To decide:** the balance window stays open over the closing lines. That's fine to me. Tell me if you'd rather it close first.

## OSV-03 Help a client change, pause or fix an auto-ship in the portal

- **Dry run:** passed, 1:20, 5 clicks in sync. It's shorter than the 2 to 3 minutes planned: the window is mostly pointed at, not clicked.
- **Stripe-calling buttons:** checked once outside the video in Stripe test mode, with no failed requests.
  - **Pause for a while** and **Resume auto-ship** both work.
  - **Move date** works.
  - **Update the card for this auto-ship:** a new test Mastercard was saved, and the window then showed 4444.
  - **Cancel auto-ship** and **Yes, cancel it** work.
- **Changed in the script:**
  - **Step 1:** Maria first picks **Maple** in the pet switcher at the top of the portal. The portal opens on Juniper.
  - **Step 12:** after **Update card**, the window shows "Card for this auto-ship: Visa ending 4242" with new card fields and **Use this new card**. The narration says so.
  - **Step 13:** the portal has no **Auto-ship** link. The video goes to the store, and **Auto-ship** in the store's top bar opens **Auto-ship items**.
- **Possible bug B8: pausing can move the next shipment earlier.**
  - **What happened:** Maple's next shipment was Saturday, May 8, 2027. Maria paused "until" the earliest date offered, Monday, Nov 9, 2026 (tomorrow), then resumed. The next shipment became Nov 9, 2026: six months early, and inside the two-day rule that **Move date** enforces.
  - **Cause:** the pause sets `renewalDate = pausedUntil`, whatever the old date was (`mail-order.service.ts`, the pause branch; the staff-side copy looks the same). Stripe's own billing date doesn't move, so Scout and Stripe then disagree.
  - **Expected:** a pause only pushes the next shipment later, never earlier.
  - The video doesn't click Pause, so it isn't affected.
- **Demo data:** the portal shows "Your recent visit can be covered. Maple has 24 hours left to become a member" at the top. That's seeded visit data. It's harmless, but I can hide it if you'd rather.
- **Already noted:** the **Auto-ship items** page shows "next bill 2027-05-08" and "89.00 before tax" (no $).

## OSV-04 Paying an open bill in the portal, and old eVet bills

- **Dry run:** passed, 1:05, 2 clicks in sync. **Step 7 walked:** Maria paid a $75.00 Scout bill (an office exam for Maple) online with her saved test Visa, and the portal said "Paid $75.00. Thank you."
- **Changed in the script:**
  - **Step 1:** the greeting depends on the time of day, so the narration doesn't say "Good evening".
  - **Step 5:** the eVet bill shows on Tom's **Financial** tab as row **#48213 eVet · Open · $85.00**. The video points at it.
  - **Step 6:** the video doesn't take the payment. It says "take the payment here, like any other bill. The invoicing videos show how."
- **Possible bug B9: a tall blank box in the portal's Pay now panel.**
  - **What happened:** after **Pay now**, a screen-tall empty area sits above **Card on file**.
  - **Cause:** the gift card entry is wrapped in `<div className="vayd-store">`, and `.vayd-store` has `min-height: 100vh` (`Store.css`), which is meant for whole store pages. `PortalAccountCard.tsx`, the pay panel.
  - **On camera:** yes, in OSV-04. I'd fix it before recording, or start the video lower down.
- **Question Q9: pay links for eVet bills.** Tom's Financial tab offers **Email pay link** and **Text pay link** ("Sends $85.00 for the unpaid invoice") for the eVet bill, while the portal says it can't be paid online. Can a pay link collect an eVet bill? If it can, the "take it by phone" rule in OSV-04 should mention pay links. If it can't, the buttons shouldn't show for eVet bills.
- **Re-record after eVet sync is turned off.** That's already noted in the script.

## OSV-05 Send an item by mail from the visit checkout

- **Dry run:** passed, 1:20, as Dr. Avery Lane on a visit for Juniper today. **Approve** in the drawer, which hadn't been walked before, works.
- **Changed in the script:**
  - **Step 5 (Open the line) is gone:** the line's drawer now opens by itself when the medicine is added.
  - **After Approve:** the line closes, so there's a new "Open it again" step before **Mail order**.
  - **Step 6:** the narration covers only the fields the doctor fills: **Directions (sig)**, **# refills** and **Acute or chronic**. **Discard after** fills in by itself.
  - **Step 8:** the **Send to mail queue** window also has **Ship to** (Home, or A different address). The video doesn't stop on it.
  - **Step 13:** the total is **$93.99** in this video (heartworm $89 + shipping $4.99). The $131.97 in the script included joint chews, which the video doesn't add. The narration doesn't say a figure.
- **Possible bug B10: an approved script still waits for the doctor.**
  - **What happened:** Dr. Lane wrote and approved the script in the drawer (`rxApprovedAt` is set on the line), then chose **Mail order** with **Take payment now**. The line still showed "Waiting on doctor · Approval task with Jordan Pike", and order #279 is `awaiting_doctor_approval`.
  - **Cause:** in `mail-order.service.ts` (the visit-checkout path, F15), a line approved on the bill isn't flagged by the F15 check. The next check then flags any item with "requires doctor approval", which every prescription has. The F15 comment says an approved script "goes out".
  - **Question:** should a script the doctor approved at the visit skip the mail queue approval?
    - **If yes:** it's a fix, and OSV-05 then shows "Approved".
    - **If no:** the narration should say the doctor approves it once more from the task.
- **Not a bug, but worth knowing:** the approval task goes to the doctor's team technician (Jordan Pike), with the doctor watching (`routeToDoctorTeam`). That's by design.
- **Juniper's "Chronic medications on this visit" box:** after earlier takes, it lists the heartworm chewable. Pass 2 runs on a freshly reset stack, so it will be empty.

## OSV-06 Take a phone order

- **Dry run:** passed, 0:55, 6 clicks in sync. Casey Morgan (CL) did it all on Maria's **Financial** tab. **Step 7 walked:** **Charge card on file** charged Maria's saved test Visa **$42.97** (joint chews $36 + shipping $4.99 + tax $1.98). The line then showed **Mail order · In mail queue**, with **Request cancellation**.
- **Changed in the script:**
  - **Step 1:** the bill opens as **New invoice · Direct invoice**. The charge box reads **Add charges for another pet…**, and the search itself is **Add a charge for Juniper**.
  - **Step 7:** the payment method box reads **Card on file · Visa •••• 4242**, with **Charge card on file**, **Email invoice** and **Text to Pay** next to it. The narration mentions the pay link without clicking it.
  - **Steps 4 to 6:** one action per line.
- **Shorter than planned:** 55 seconds, against the 2 to 3 minutes in the script. That's fine to me for a phone order.
- **Card on file on the Financial tab:** it shows "Owner agreed Nov 8, 2026, from the online store" after Maria's store purchase. That's good, and it shows on screen.

## OSV-07 Approve, send back or decline a prescription mail order

- **Dry run:** passed, 1:24, 8 clicks in sync.
  - Robin sent the task to Dr. Lane.
  - Dr. Lane lowered **Quantity to approve** from 3 to 1, picked **Chronic**, and clicked **Approve**.
  - In the queue, the order's activity shows "Doctor approved 1 of 3 Thyroid tablets 0.4 mg (90 ct) · Stripe refund $76.00", a Stripe test-mode refund.
- **Changed in the script:**
  - **Step 7:** **Summarize Case** is pointed at, not clicked. Clicking it sends the chart to the AI service. On demo data that's harmless, but it's an outside call from the test stack. Tell me if you want it clicked on camera.
  - **Step 12:** **Send back** and **Rejected** are shown **before** Approve, because the task closes after Approve. The reject button reads **Rejected**, not "Reject".
- **On screen, to clean up before recording:**
  - **Texting panel error:** the queue's text/email panel shows "Request failed with status code 500". The stack has no texting key. B6's phone fix stopped the 400s, but reading texts still fails. Fix: start the stack with `TRAINING_SMS_CAPTURE=1` (captured, never sent), or hide the panel in the video.
  - **Leftover rejected order:** "1 rejected order still need the client contacted · Open Rejected" shows over the queue. It comes from the seed data, not this video. The demo setup should clear it. Also, "1 rejected order still need" should read "needs".

## OSV-08 Fill an order and print its label

- **Dry run:** passed, 1:37.
  - Riley Brooks filled Juniper's approved thyroid order from **Raleigh office · Office shelf**. Lot **TH24117 · exp 2027-09-04 · QOH 6** was picked for her.
  - She clicked **Mark filled**, set a 6 oz weight, then **Get cheapest rates** and **Print cheapest label** (an EasyPost test label with a test tracking number).
  - The order moved to **Check**, with **Void / refund this label**.
  - One click was 1.1 s late, and I've fixed it since.
- **Changed in the script:**
  - **One order instead of two:** the video fills Juniper's thyroid order only. It has the lot step, so steps 1 to 7 use it, and Maple's joint and dental chews order isn't needed.
  - **Steps 11 and 15:** after **Mark filled**, the order leaves **Fill** for **Ship / pickup**. After the label, it moves to **Check**. The video follows it with those filters and reopens the order.
  - **Step 4:** the **Location** list for the demo office is **Car (default)** and **Office shelf**.
- **Demo setup fixed:**
  - Lot TH24117 was in **Car**, not **Office shelf**, so filling from the shelf showed no lot. `setup/online-store-demo.cjs` now puts it on the shelf (code MAIN).
  - The setup and the per-take reset now **delete** earlier orders instead of cancelling them. Cancelled orders counted as "rejected orders still need the client contacted", which caused the red banner in OSV-07.
- **On screen:** the texting panel's "Request failed with status code 500" again (see OSV-07).

## OSV-09 Second check and tell the client

- **Dry run:** _rerunning (see the end of this file)._
  - Riley Brooks filled and labelled Juniper's thyroid order off camera. Robin Hale, who didn't fill it, opens it under **Check**, sees "Filled by Riley Brooks", points at **Print check slip**, and clicks **I checked Juniper**.
  - The order moves to **Contacted**. Robin clicks **Email client**, reads the prewritten "Email — order shipped", and clicks **Send email**.
  - The email was captured on the stack and addressed only to deirdre@vetatyourdoor.com ("[TEST to maria.rivera@example.com] Juniper's order #272 has shipped").
- **Changed in the script:**
  - **Contact step:** after sending, there's no "Emailed" button. The order shows "Client was emailed." with the test tracking number, and the status moves to **Done**.
- **On screen:** the texting panel's 500 error again (see OSV-07). The panel also has a **Send for real (non-prod)** box. Recording never ticks it.

## OSV-10 Reject or cancel an order, and refund

- **Dry run:** passed, 1:09, 3 clicks in sync.
  - Maria put Maple's heartworm chewable on auto-ship ($89, test Visa). Robin found the order by number and clicked **Reject + refund + email**. The window reads "Refunds the Stripe charge, cancels linked auto-ship". Robin typed an **Internal reason (staff only)**, read the email and clicked **Send email**.
  - Checked afterwards: Stripe test mode shows the $89 refund **succeeded**, and the auto-ship is inactive. The email was captured, addressed only to deirdre@vetatyourdoor.com ("Update on your Vet At Your Door order #273").
- **Possible bugs:**
  - **B11, "Contact client" stays after the reject email.** After **Reject + refund + email** sends the email, the order still shows **Rejected · Contact client**. It also counts in the "rejected orders still need the client contacted" banner, so staff have to mark the client contacted a second time.
    - Cause: the email step records only a note ("Client email sent: …"). The queue looks for a "contacted" note, or a reject-outreach note.
    - **Q11:** should sending the reject email count as contacting the client? I think yes.
  - **Payment status:** the order's payment status stays **paid** after the refund (`mail_orders.paymentStatus`). The queue doesn't show it, but reports reading that field would. Minor.
- **Changed in the script:**
  - **Step "the refund is noted":** when you type a staff reason, it replaces the automatic "Rejected and refunded." note. The video doesn't open the rejected order to show a refund note. It ends on the order under **Rejected**, and the narration says the card is refunded and the auto-ship cancelled.
  - **Cancel requests:** shown by pointing at the **Cancel requests** filter only. Demoing one needs a doctor or tech to ask for a cancel from a visit bill. Tell me if you want that added.

## OSV-11 The Auto-ships list: payment problems, pause, edit

- **Dry run:** _rerunning (see the end of this file)._ The first try stopped in setup: Maria's second purchase found her saved card ("Card on file"), and the setup helper now waits for it.
- **What the video does:**
  - Maria puts Maple on two auto-ships off camera: joint chews monthly, heartworm every 6 months. The heartworm one is marked failing in the test database.
  - Riley Brooks opens **Payment problems** (**Payment failing**), goes back to **Active**, pauses the joint chews (**Resume on**, then **Pause until …**), and shows it under **Paused**.
  - Riley then opens **Edit** on the heartworm auto-ship. **Item** and **Qty** are greyed out, with the "Looks wrong? … Re-send …" note; **Frequency** isn't.
  - Robin Hale opens the same **Edit**, which reads "Price differences charge the card on file, refund via Stripe, or add an account credit — and update Financials". Robin cancels, then points at **Card** and **Cancel** on the row.
- **Changed in the script:**
  - **Order of steps 5 to 8:** after **Pause**, the joint chews leave the **Active** list, so Riley's **Edit** is shown on the heartworm auto-ship instead.
  - **Pause is clicked through** in Stripe test mode, and the video shows "Paused until …". B8 (pausing can move the next shipment earlier) applies here too.
  - **Step 1:** there's no **Active** column. Each row has a status badge (**Active**, **Paused until …**, **Ended: card failed**, **Cancelled**).
- **Q11b:** should the video also show a real **Cancel**? It's permanent and asks for confirmation. I've left it as pointed at, not clicked.

## OSV-12 Billing tasks from the store

- **Dry run:** passed, 1:04, 4 clicks in sync.
  - The setup posts signed **test** Stripe events to the training API: Tom Chen's joint chews auto-ship for Biscuit fails for good, and Stripe ends it.
  - Robin opens **Tasks → Unassigned**, opens "Call Tom Chen: auto-ship card failed, Joint support chews (60 ct) for Biscuit has stopped" (**Priority: Urgent**), and clicks **Assign to me**. **Auto-ships → Payment problems** then shows Tom's auto-ship as **Ended: card failed**.
  - The staff alert "Auto-ship payment failed, auto-ship ended — Tom Chen" was captured, addressed only to deirdre@vetatyourdoor.com.
- **Questions:**
  - **Q12a, Billing queue:** the test database has no **Billing / AR** role, though your local copy does, with 2 people holding it. So store Billing tasks land with no queue, and any login sees them under **Unassigned**. Should the training setup add the role and give it to a demo billing login, so the video shows the real billing queue? (Training setup only, no app change.)
  - **Q12b, steps 4 to 6:** the "charge refunded", "auto-ship not set up" and "cancel pending" tasks aren't set up. Each needs real Stripe test objects (a real charge to refund, or a subscription Stripe refuses). For now the video names them in one closing line. Do you want them built out, or is one line enough?
  - **Q12c, the task text:** it says "Scout emailed tom.chen@example.com when the first charge failed". The demo skips the first-failure event, so that email never happens in the demo. Harmless on camera, but the setup could post the first-failure event too.
- **Changed in the script:**
  - **Added "Assign to me"**, so nobody else calls the family too.
  - **The task was created by Casey Morgan**, the practice's first admin. Billing tasks need someone to be their creator. On camera it reads "Created by Casey Morgan", not "Scout". Tell me if that should say Scout.

## OSV-14 Gift cards: issue one, check a balance

- **Dry run:** passed, 1:10. Two clicks were 2.1–2.3 s late. One is fixed: closing Maria's card now happens off camera. The other ("Issue it") gets checked in the Nova take.
  - Robin searches "Rivera", opens Maria's $50 card (**Gift card ••••2345 · Active**, "issued by staff"), and points at **Print / Email card / Adjust balance / Void**. **Refund buyer** shows only for bought cards.
  - Robin then issues a $25 card to Tom Chen, with reason "Service recovery: late visit". The email is left blank, so nothing is sent. The card shows "issued by staff (Service recovery: late visit)".
- **Changed in the script:**
  - **Button names:** **Adjust balance** (not "Adjust") and **Void** (not "Void card").
  - **Issuing is a form on the page**, not a pop-up window, titled **Issue a gift card**. Its fields are **Amount, Reason \*, Recipient name, Recipient email, Send on, Message**.
  - **Step 1:** the video opens on **Sold gift cards** directly. The script's path **Pharmacy → Store → Gift cards** works, but the top bar then highlights **Catalog**, not **Pharmacy**: the page sits under `/schedule/inventory/`. A small nav glitch; worth fixing before staff use it.
- **The other roles** (lead CLs issuing cards) weren't checked. Every take signs in as Robin.

## OSV-15 List an item in the store

- **Dry run:** passed, 1:03. One click was 2.1 s late.
  - Robin points at **On the store / Removed**, at **Dental chews** (its approval, pet, home page and remove controls, then categories, sale and description), and at the heartworm chewable's **Needs doctor approval**.
  - Robin clicks **+ Add store item**, names a product "Calming capsules", clicks **Create master product**, searches "Gabapentin", and clicks **Add to Calming capsules**.
  - Scout refuses it with: "Gabapentin 100 mg capsules is a controlled drug, so it can't be listed in the online store. Controlled drugs are not sold through the online store; the DEA log is kept in Vet Snap."
  - The empty "Calming capsules" product is deleted before each take (test database only).
- **Changed in the script:**
  - **Step 7:** the refusal is shown in **+ Add store item**, where a manager would actually try it, not through **Catalog → Online Store**. That joins steps 6 and 7.
- **On screen:** **Removed (…)** still counts the leftover test products ("hinv carprofen …"), as noted on Nov 7. The video doesn't open **Removed**.

## OSV-16 Coupons

- **Dry run:** passed, 1:03, 6 clicks in sync.
  - Robin opens **Coupons**. The list has the seeded **PLUS10** (members only).
  - Robin clicks **Add coupon** and fills in **Code** WELCOME10, **Name**, **Discount** 10 (% off the order), **Uses** Once per customer and **Orders** Subtotal over 25, then clicks **Save coupon**.
  - Maria adds joint chews off camera, types WELCOME10 in her cart and clicks **Apply**. **Coupon −$3.60** shows; the total goes from $42.97 to $39.17. No order is placed.
- **Changed in the script:**
  - **There's no "Ends" date** on a coupon. To end one you untick **Active** or delete it. The closing line "making a new code instead of ending an old one" still fits.
  - **Labels:** the limit is chosen under **Uses** (**Unlimited / Once per customer / Single use**); the list column is **Limits**. The minimum is under **Orders → Subtotal over**.
  - **Discount starts at 10**, so a typed 10 became 1010 and the save failed with "A percent off cannot be more than 100." The video clears the box first. Staff will do the same thing; consider starting the box empty.
- **On screen:** at this window width, the **Discount** and **Orders** dropdowns are cut off ("% off the ord", "Subtotal over…").
