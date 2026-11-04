# EMR and visit workflow training videos: VAYD doctors and technicians

Fifteen short videos, 2 to 4 minutes each, one task per video. One series that everyone on a visit watches. Where a step is different for your role, there is a short **Doctors:** / **Techs:** / **Liaisons:** line in the table. Written from the code on Nov 3, 2026, using the owner decisions of Nov 2 and 3, 2026. Screen names, tabs, buttons and messages come from the app source. Do a dry run on the demo database first. Places that need a visual check on the first take are marked **[check on screen]**.

**Who this is for:** everyone who works a visit in Scout: veterinarians, licensed technicians, technicians, and (for the phone, payment and refill parts) client liaisons.

**What each role can and can't do** (so you never promise more than the role has):

| Task | Doctor (licensed vet) | Licensed tech | Tech (unlicensed) | Client liaison |
|---|---|---|---|---|
| Open the SOAP or medical note, chart vitals, exam and notes | Yes | Yes | Yes | No |
| Add charges, match plan items on Checkout prep | Yes | Yes | Yes | Yes (charges) |
| Record a vaccine dose with lot and tag | Yes | Yes | Yes | Not covered here |
| Be the vet of record on a rabies dose | Yes, with a license number on file | No | No | No |
| Write Rx directions and refills | Yes, as the prescriber | Enters them for the visit's vet | Enters them for the visit's vet | No. Can only use a refill, which copies directions that are already on file |
| Approve a script on the invoice for dispensing, print the label | Yes | Yes | Yes | No. Sends unapproved scripts to the mail queue for the doctor |
| Enter and complete in-house lab results | Yes | Yes | Yes | No |
| Sign & lock a full SOAP | Yes | No | No | No |
| Sign a quick visit or medical note (**Wrap up**) | Yes | Yes | No | No |
| Take payment (reader, card on file, card over phone, cash, check) | Yes | Yes | Yes | Yes |
| Send euthanasia consent, take a card by phone, **Run Payment from Authorization** | Yes | Yes | Yes | Yes (the phone-card path is usually theirs) |
| Send pay links, refund a card payment | Yes | Yes | Yes | Yes |
| Void an invoice | No | No | No | No (lead client liaisons, billing and managers only) |
| See the pet's **History** tab | Yes | Yes | Yes | Yes (all staff) |

**Which videos matter most for each role** (everyone can watch all of them; the steps are the same for everyone):

| Role | Core videos | Also useful |
|---|---|---|
| Doctor | V1–V8, V10, V13, V14 | V9, V11, V12, V15 |
| Licensed tech | V1–V8, V11, V12, V14 | V9, V10, V13, V15 |
| Tech | V1–V5, V7, V8, V14 | V6 (what you can't sign), V11, V13 |
| Client liaison | V9, V15 | V5, V11 (refills), V14 |

**How to get to every screen**
- **The visit:** **Home** is the calendar. Pick the doctor in the list at the top right (**Dana Demo** in the demo) and click **Today**. Right-click the appointment (long-press on a tablet) **[check on screen]**. Under **On Visit Day** there is **Start Encounter** (it says **Edit Encounter** once one exists) and **Start / End Visit**. **Start Encounter** asks **SOAP** ("Doctor exam — history, exam, assessment, and plan.") or **Medical note** ("Tech visit write-up — history, plan, and invoice. Not a SOAP.").
- **From the pet's chart:** **Patients**, open the pet, then use the chart toolbar (**Medical note**, **Send form**, **Print document**, **Communicate**, **Invoice**). The chart also offers to continue an open SOAP or start one on a booked visit.
- **The SOAP page** has the tabs **Subjective**, **Objective**, **Assessment**, **Plan** and **Checkout prep**. The **Checkout** panel is on the right. **Wrap up visit** is top right.
- **Checkout** (the whole household pays once): the **Checkout** button at the bottom of the SOAP's Checkout panel.
- **Euthanasia consent:** on the Scheduler, right-click a euthanasia visit, then **Visit Prep**, then **Send Euthanasia Consent** (it changes to **Re-send Euthanasia Consent** or **View Euthanasia Consent**).
- **In-house labs:** **Labs**, then the **In-house labs** tab **[check on screen: where Labs sits in the top menu]**.
- **Pay links and refunds:** **Clients**, open the client, scroll to **Ledger**.

**Demo logins** (all names are fictional):
- `Dr. Dana Demo`: licensed veterinarian, with a license number on file.
- `Lee Demo`: licensed lead technician.
- `Tess Demo`: technician, not licensed.
- `Casey Demo`: client liaison.

---

## V1. Opening the visit and the SOAP for each pet (2 to 3 min)

Goal: open the right chart for each pet on a household visit. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Home** (the calendar). In the doctor list at the top right pick **Dana Demo**, then click **Today**. Right-click the Rivera visit, **On Visit Day**, **Start Encounter** | A small window titled with the first pet's name: **SOAP** and **Medical note** | "Every visit starts on the calendar. Right-click the visit, go to On Visit Day, and choose Start Encounter." |
| 2 | Click **SOAP** | The SOAP page. Header: **Biscuit · Rivera**, the signalment, and "Exam: … · Visit #… · Comprehensive SOAP" | "For a doctor exam, pick SOAP. Up top you'll see the pet, the family, and the visit number. Click the pet's name any time to open the full medical record." |
| 3 | Point at the pet tabs: **Biscuit**, **Maple**, **Pepper** | One tab per pet. A heart shows on any pet with a membership | "The Riveras have three pets on this visit, so there's a tab for each one. Each pet gets its own chart. Click a tab to switch." |
| 4 | Click **Maple** | Maple's SOAP opens. Same visit number | "Switching pets keeps you on the same visit. Anything you typed for Biscuit is already saved." |
| 5 | Point at the right side | The **Checkout** panel with the household's charges | "The bill builds on the right while you work. The whole household shares one invoice." |
| 6 | Point at a presence chip, if a colleague is on the visit | A chip with their name, or that they're recording | "If someone else is in this visit, you'll see their name here, so you know you're working together." |

**Techs:** "You can open the SOAP and chart vitals and notes. Signing a full SOAP is the doctor's job. You'll see a small lock note at the top that says 'Only a licensed veterinarian can sign and lock a SOAP.' That's normal."

**Common mistakes**
- **Starting a Medical note when the doctor is doing an exam.** A full exam is a SOAP. A medical note is the tech visit write-up. To fix it, click **Switch to SOAP** at the top of the medical note and confirm. The note text moves into the SOAP and the SOAP opens (see V12). It works until the note is signed. The other way, a SOAP with nothing typed in it yet shows **Switch to medical note**.
- **Charting on the wrong pet tab.** Check the pet's name in the header before you type.
- **Opening a new encounter when one exists.** The menu says **Edit Encounter** once there is one, and that opens the existing chart.

**Demo data needed**
- Client **Rivera household** with three pets on one wellness visit today: **Biscuit** (dog), **Maple** (dog, on a membership), **Pepper** (cat). Dr. Dana Demo is the primary provider.

---

## V2. Vitals and the physical exam (2 to 3 min)

Goal: record weight, TPR and the exam so the chart is ready to sign. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | On Biscuit's SOAP, click **Objective** | **Vitals (TPR, weight, BCS /9, FAS /5)** | "Vitals go on the Objective tab." |
| 2 | Type **Weight**, choose **Lb** or **kg** | The weight box is marked required until it's filled | "Weight is required for every pet. If you really couldn't weigh them, use No weight taken, so the chart says so." |
| 3 | Fill **Temp °F**, **HR (bpm)**, **RR (rpm)**, **BCS /9**, **FAS /5** | The fields save when you click out | "Fill in what you took. Each box saves when you click out of it. There's no Save button to remember." |
| 4 | Under "Physical exam — normal by default, tap a system to flag abnormal", tap a system | That system flips to abnormal with room for a note | "The exam starts normal. Only tap the systems that aren't normal, then describe what you found." |
| 5 | Type in the notes box ("Additional objective observations…") | Text appears in the notes | "Anything else you noticed goes here. Bold anything abnormal so it stands out." |
| 6 | Click **Subjective**, type the history | "Presenting history, owner concerns…" | "History goes on Subjective. If the family filled in the check-in form, those answers are already here." |
| 7 | Repeat on **Maple** and **Pepper** | Each pet has its own vitals | "Do this for every pet. The wrap-up won't let anyone sign until each pet has a weight." |
| 8 | Point at the page (no button to press) | No Save button for the SOAP text | "You don't need to save the SOAP. It saves by itself every few seconds, and when you switch to another pet or leave the page. If the signal drops, your text stays on this device and saves when you're back online. Vaccines and prescriptions are different: those have their own Save button. You'll see that next." |

**Techs:** "This is usually your part of the visit. Weigh, take TPR, and get it in before the doctor comes in."

**Doctors:** "The exam and the Assessment tab (the Problems list and clinical reasoning) are yours. To add a problem, type its name and click **Acute** or **Chronic**. A problem is Active until you set it to Resolved. The presenting complaint goes in Subjective, and rule-outs go in the clinical reasoning. If you use AI Scribe, the same fields fill in from the recording, and you review them. The Problems list is in the same place, and AI Scribe's suggested problems only ask Acute or Chronic."

**Doctors:** "Pets coming over from eVet may show suggestions under **Chronic problems on this visit** at the top of the SOAP, and at the top of the pet's chart, like 'From eVet: Hyperthyroidism (Dr. …, Mar 2025)'. Click **Accept** to add it as a chronic, active problem. You can switch it to Acute in the Problems list. Click **X** to dismiss it, and it won't come back for this pet. If you ignore it, it stays there until someone decides." **[check on screen]**

**Common mistakes**
- **Skipping weight.** The wrap-up shows **Weight needed** and blocks signing.
- **Weight in the wrong unit.** Check **Lb** or **kg** before you type.
- **Typing every normal system.** The exam is normal by default. Flag only the abnormal ones.

**Demo data needed**
- Same Rivera visit. Biscuit has an earlier weight on file (to show the change). Pepper has no weight on file.
- Biscuit has an active eVet diagnosis that isn't on his problem list (to show an eVet suggestion card).

---

## V3. Orders, Checkout prep, and the duplicate warning (3 min)

Goal: get today's vaccines and products onto the bill without doubling anything. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | In the **Checkout** panel, click into "Add a charge for Biscuit" and type a vaccine name | A search list of catalog items | "To charge something, type it in the box at the top of Checkout for that pet." |
| 2 | Pick the item | The line appears on the invoice | "It lands on the bill. The plan narrative is yours (or AI Scribe's) to write; charges don't add to it." |
| 3 | Add the same item again for Biscuit | A window, **Already entered for this pet**: "This item was already entered for this pet today on this invoice. Already there:" and the existing line. Buttons **Add anyway** and **Cancel** | "If you add the same item for the same pet on the same invoice on the same day, Scout stops and shows you what's already there." |
| 4 | Click **Cancel** | Nothing is added | "Most of the time it's a double tap. Cancel, and nothing changes." |
| 5 | On the existing line, raise the quantity to 2 | Qty 2 on one line. No warning | "If you really gave two, the normal way is quantity 2 on the one line. Only use Add anyway when it really needs to be a separate line." |
| 6 | Click the **Checkout prep** tab | A badge with the number of plan items still to match | "Checkout prep matches what's in the plan to the charges. It's optional and it's not part of the signed chart." |
| 7 | Match or dismiss each suggested item | The badge count goes down | "Match each plan item to a charge, or dismiss it. If you leave some, Scout asks before wrap-up: Continue anyway, or Go to Checkout prep." |

**Common mistakes**
- **Clicking Add anyway out of habit.** It makes a second line and a second charge.
- **Adding a charge on the wrong pet.** Use the box labelled for that pet.
- **Thinking Checkout prep is the medical record.** It's only for the bill.

**Demo data needed**
- Catalog items: DHPP, Rabies 1yr, Rabies 3yr, FVRCP, a heartworm test, a flea and tick product.
- One item already on Biscuit's invoice (to trigger the duplicate warning).

---

## V4. Recording vaccine doses: lot, tag and the rabies vet of record (3 to 4 min)

Goal: record every dose so it reaches the chart, the certificate and the reminders. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | In **Checkout**, find the vaccine line, click **Enter dose / Rx details** | The dose form | "A vaccine isn't finished when it's charged. It needs a dose record. That's what puts it on the chart, the certificate and the reminder list." |
| 2 | Pick the lot in the lot picker | **Lot number**, **Drug expiration**, **Manufacturer** fill in from the lot | "Pick the bottle you actually used. The lot number, expiry and manufacturer come with it." |
| 3 | Check **Date given** and **Next due** | Both filled in | "Next due is required. It's what sends the reminder." |
| 4 | On a rabies line, type the **Rabies tag \*** number | The tag box | "Rabies needs a tag number. If there's no physical tag, type 0." |
| 5 | Click **Record dose** | The line gets a check. Summary "Lot … · next due …" | "Record dose, and you'll see the lot and the next due date on the line." |
| 6 | Show a rabies dose on a visit whose provider isn't a licensed vet | "The vet of record must be a licensed veterinarian for a rabies dose. Choose the veterinarian who gave or supervised it." | "The rabies certificate prints the vet of record, so it has to be a licensed veterinarian. Scout uses the visit's vet. Anyone on the visit can type the dose in." |
| 7 | Show a vet with no license number on file | "Dr. … has no license number on file. Ask a practice manager to add it in Settings → Staff before recording a rabies dose." | "And that vet needs a license number in Scout. If you see this, ask a manager to add it. Don't move the dose to someone else." |
| 8 | Point at **Dose history** | The staff-only history of this dose | "Dose history shows who recorded or changed it, and when. It's for staff only and never prints." |

**Techs:** "You can record every dose, rabies included. The doctor on the visit is the vet of record, not you."

**Doctors:** "Your practice manager enters your license number and signature in Settings → Staff. Before your first rabies dose, check with them that both are there."

**Common mistakes**
- **Typing the lot and tag but not pressing Save.** Doses don't save by themselves the way SOAP text does. Press the dose's Save button before you move on.
- **Leaving a vaccine charged but not recorded.** The wrap-up shows **Dose needed: …** and blocks signing.
- **Picking the wrong lot.** Match the bottle in your hand.
- **A lot showing zero on hand.** Scout asks for a reason. Usually the right bottle just isn't counted yet. See the inventory videos.

**Demo data needed**
- Rabies 3yr with two lots on Demo Car A, and DHPP and FVRCP with a lot each.
- A second visit whose provider is **Lee Demo** (to show the vet-of-record message), and a vet with no license number (to show the second message).

---

## V5. Household checkout and payment (3 to 4 min)

Goal: take one payment for the whole family. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | At the bottom of the SOAP's **Checkout** panel, read the line under the button | "Everything is recorded. Checkout collects for the whole household at once." or "… still need doses, scripts, or a lot picked." | "Before checkout, everything has to be recorded. If something's missing, the button tells you what." |
| 2 | Click **Checkout** | The **Checkout** page: "One bill for 3 pets on this visit — the owner is charged once." **Follow-up** on the left, the invoice on the right | "This is the one screen where the family pays, for all three pets at once." |
| 3 | Under **Follow-up**, record the next visit | The follow-up question | "Ask about the next visit while they're still here. Payment doesn't wait on it." |
| 4 | Check **Branch** and **Location** | Filled in with your truck | "Make sure the branch and location are right. That's where the stock comes off." |
| 5 | Card reader: pick the reader once, then **Tap to Pay** | "Sent $… to …. Present the card on the reader — this screen updates when payment succeeds." | "For the card reader, click Tap to Pay and hand the reader over. The screen updates on its own when it's paid." |
| 6 | Or **Card on file** | "Charged the card on file." | "If the family has a card on file and agrees, use Card on file." |
| 7 | Or **Cash** | **Cash received**: "Amount due is $…. Enter cash received (or leave blank for exact)." then "Recorded cash payment of $…." | "For cash, type what they handed you, or leave it blank if it's exact." |
| 8 | Point at the card-on-file checkbox before a new card | "Owner is happy for us to keep this card on file for future visits, refills, and memberships. Ask before you tap — uncheck if they say no." | "Ask before you save a card. If they say no, leave it unchecked." |
| 9 | Read the hint at the bottom | "Payment locks the invoice and posts these charges to the chart. Ending the visit on the schedule and signing the SOAP are separate steps — neither one waits on this." | "Payment, signing and ending the visit are three separate steps. Doing one doesn't do the others." |

**Techs:** "You can take every kind of payment here."

**Common mistakes**
- **Pressing Tap to Pay again because the reader is slow.** Wait for the screen to update. If you need to stop, use **Cancel reader**.
- **Wrong location.** Stock comes off the wrong truck.
- **Saving a card without asking.**

**Demo data needed**
- The Rivera visit with all doses recorded. A test reader (Scout Terminal or WisePOS) online. A saved test card on the Rivera household.

---

## V6. Wrap-up: the client recap, and who signs what (3 to 4 min)

Goal: send the recap and lock the charts, and know who's allowed to sign. **Everyone (signing is for doctors on a SOAP).**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | On the SOAP, click **Wrap up visit** | **Wrap up visit**. A card for each pet, then **Client recap** | "Wrap up is where you review the whole family's charts and send the recap." |
| 2 | Point at each pet card | "4 of 4 sections charted", plus **Weight needed**, **Dose needed: …** or **Rx needed: …** if anything is missing | "Each pet shows how much is charted. A red button here takes you straight to whatever's missing." |
| 3 | In **Client recap**, read the draft | **To**, **Subject**, **Message**. The recap is written from the charts | "Scout writes the recap from the charts. Read it like the family will, and fix anything you'd say differently." |
| 4 | Show a client marked Do not email | "This client is marked "Do not email", so their address was not filled in. Type an address only if the client asked for this email." | "If the family asked us not to email, the address stays blank. Only type one in if they asked for this email." |
| 5 | Click **Send to client**, or **Don't email**, type **Why no recap?**, and click **Record: no recap** | "Sent … to …. Filed on each covered pet's EMR under Communications." | "Either send it, or record why you didn't. One of the two has to happen before signing." |
| 6 | Point at the footer: **Client recap**, **Dose & Rx**, **Weight** | Each turns into a check when done | "These three checks have to be done before you can sign." |
| 7 | Click **Sign & lock SOAP (3 charts)** | **SOAP signed & locked**. Each pet: "Signed & locked by Dr. Dana Demo — …" | "One click signs all three charts. After that they're locked." |
| 8 | After signing, click **Redo client email** | The recap opens again | "Made a mistake in the email? You can still redo it after signing. The draft keeps saving, and the original stays on the record." |
| 9 | Back on a locked SOAP, point at **Write addendum** | "Append a dated note without unlocking the signed SOAP" | "Need to add something later? Write an addendum. The signed chart stays as it was." |

**Doctors:** "Only a licensed veterinarian can sign and lock a full SOAP. That's you."

**Techs:** "On a full SOAP the sign button is greyed out for you, with 'Only a licensed veterinarian can sign and lock a SOAP.' Get the recap and doses ready, then hand it to the doctor. Licensed techs can sign a medical note (see V12). Unlicensed staff don't sign anything."

**What happens if nobody signs (say once, plain language):** "If a SOAP is still open a day later, Scout gives the visit's doctor a task called 'Finish the chart for Biscuit'. The medical director can see it too. It goes away when the chart is signed. **End Visit** on the calendar only records the visit times and the follow-up. It doesn't sign anything."

**Common mistakes**
- **Thinking End Visit or payment signs the chart.** They don't.
- **Sending the recap to a Do not email client** because the address was on file.
- **Leaving charts open overnight.** That's what the Unfinished chart task is for, but don't rely on it.

**Demo data needed**
- The Rivera visit, all three pets charted. A second household marked **No Email** (to show the warning). A connected practice mailbox.

---

## V7. A sick visit: patient alerts and an in-house lab (3 to 4 min)

Goal: see the alert before you start, and run an ear cytology in-house. **Everyone except client liaisons.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open the SOAP for **Rocket** (Gus Okafor) | A banner at the top: **Patient alerts — Rocket**, the alert text, and who wrote it | "Always read the alert banner first. It's the same alert as on Rocket's record, like 'Bites — needs a muzzle for ears'." |
| 2 | Add the ear cytology charge in **Checkout** | The lab line shows **Run the lab / view results** | "When you charge an in-house lab, the line tells you it still needs to be run." |
| 3 | Click **Run the lab / view results** | The result form. For cytology: a notes box, "Describe what you saw." | "Do the cytology and write what you saw." |
| 4 | Click **Save, finish later** | Saved, not finished | "If you're interrupted, Save, finish later keeps what you have." |
| 5 | Or open **Labs**, **In-house labs**, **Waiting to run** | A list by day, filter **All providers** | "Anything ordered and not run yet is on this list, for the whole practice. Whoever's free can run it." |
| 6 | Finish the result, click **Save results** | The lab moves to **Recently resulted** | "Save results completes it. It's on Rocket's chart now." |
| 7 | Point at the pet's **History** tab (see V13) | "Lab result" rows with who entered and completed it | "Every entry and every edit is logged with your name." |

**Techs:** "You can enter and complete in-house results yourself. No license is needed. Licensed or not, if you ran it, you can finish it."

**Common mistakes**
- **Not reading the alert.** It's at the top for a reason.
- **Leaving labs on Save, finish later.** They stay on **Waiting to run** until someone saves the results.
- **Blank rows on a panel.** Scout asks for "a value or a comment on each row."

**Demo data needed**
- Client **Gus Okafor**, dog **Rocket**, with a patient alert ("Bites — muzzle for ear exams") written by Lee Demo. A sick visit today with Dr. Dana Demo.
- An in-house **ear cytology** catalog item, and one other pending in-house lab from yesterday on the worklist.

---

## V8. Prescriptions: directions, approval, the label and Rx history (3 to 4 min)

Goal: get Rocket's ear medication written, approved and labelled. **Everyone except client liaisons.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Add the ear medication charge. Its line says **No script entered yet** | The line is marked pending | "A medication going home needs a script before checkout." |
| 2 | Click **Enter dose / Rx details** | **Name**, **Refills**, **Refill expiration** (+3m, +6m, +12m), **Start date**, **Acute or chronic**, **Instructions (sig)** **[check on screen: the invoice line also shows "Directions (sig)"]** | "If Rocket has had this before, the sig carries over from his last fill. Otherwise it starts from the item's default." |
| 3 | Choose **Acute**, type the directions, click **Save Rx** | Summary "Acute · 0 refills · sig on file" | "Pick acute or chronic, check the directions, and save." |
| 4 | Click **Approve** on the invoice line | "Approved by …" | "Approve means it's checked and ready to dispense." |
| 5 | Click **Send Rx label to DYMO** | The label preview with the vet's name and license | "Print the label from here. It carries the doctor's name and license." |
| 6 | Click **History** on the Rx row | "Nov 3, 10:42 AM — Directions entered by Lee Demo (tech) for Dr. Dana Demo: …" | "History shows exactly who entered the directions and for which doctor. Staff only, never printed." |
| 7 | Show two people saving the same Rx | "Changed by Dr. Dana Demo, reload. Your entries are still on screen and have not been saved." with **Reload their version** and **Save mine anyway** | "If two of you edit the same script, the second save stops. Your typing is still there. Usually you want Reload their version, then add your change." |

**Doctors:** "You write directions and refills directly, and you're the prescriber."

**Techs:** "You can enter the directions too. Scout saves them for the visit's vet, who is the prescriber. Then you can approve it for dispensing and print the label."

**Liaisons:** "You can't write directions. You can fill a refill of a script that's already on file (see V11). Anything new waits for a doctor or tech, or goes to the mail queue: 'A doctor or technician must approve — or switch to Mail order'."

**Common mistakes**
- **Typing directions and walking away.** Prescriptions don't save by themselves. Press **Save sig** / **Save Rx** before you leave the line.
- **Saving without Acute or chronic.** "Choose acute or chronic for this prescription."
- **Refills past a year.** "Refill expiration cannot be more than 1 year from today."
- **Clicking Save mine anyway without reading theirs.** You'll overwrite the doctor's change.

**Demo data needed**
- Rocket's visit from V7. An ear medication with a default sig. A previous fill of the same drug (to show "Sig carried over from this patient's last fill").
- A DYMO printer, or the label preview only.

---

## V9. Euthanasia, before the visit: estimate, consent and card (3 to 4 min)

Goal: price the visit, get consent, and get a card on file before the family's hardest day. **Everyone. The phone-card path is usually a client liaison task.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | On the Scheduler, right-click Clementine's visit, **Visit Prep**, **Send Euthanasia Consent** | **Estimate for Clementine**: "The consent form quotes one total and asks for a card against it. Nothing is charged until after the visit." | "We always price the visit first, because the consent form shows the family one total." |
| 2 | Check the lines, **Weight**, and **Aftercare the family will confirm** | The estimate, with any aftercare warnings | "Make sure the aftercare matches what the family asked for. The form asks them to confirm it." |
| 3 | Family can use the form: click **Email consent**, **Text consent**, or **Have them sign here** | Toast "Consent sent to …. Link copied." | "Most families sign the online form. They choose their items, sign, and enter a card." |
| 4 | Show the family's view: the **Card authorization** paragraph | "About 24 hours before the visit (or right away, if the visit is sooner), we'll place a hold … A hold is not a charge. If the visit is rescheduled, we'll move the hold to the new date. If it's cancelled, we'll release it." | "This is what the family reads. We hold, we don't charge, and we charge the final amount on the day." |
| 5 | Family can't use the form: click **Take card by phone** | **Take card over the phone**: "With the client on the line, tell them their card will not be charged until the day of service…" | "If the family can't manage the form, take the card over the phone. Read them that sentence first." |
| 6 | Type the Stripe test card **4242 4242 4242 4242**, any future date, any CVC and ZIP, click **Authorize $…** | The estimate now has a card | "In the demo we use Stripe's test card. With a real family, type their card while they read it out." |
| 7 | Close and reopen the menu | It now says **Re-send Euthanasia Consent**, later **View Euthanasia Consent** | "The menu tells you where things stand: sent, or signed." |
| 8 | Voice-over on the hold | — | "You never place or move the hold yourself. Scout places it about a day before the visit, moves it if the visit moves, and releases it if the visit is cancelled. A phone card is held right away. If the visit is more than a day off, Scout lets go and holds it again the day before **[check on screen: status line after the release]**." |

**Liaisons:** "This is usually your call to make. The family hears the plan, and you take the card."

**Common mistakes**
- **Sending the consent before the estimate is right.** Fix the estimate, then send or re-send.
- **Charging the family over the phone.** You only place a hold. Nothing is charged until checkout.
- **Taking a card by phone and also sending the form for the same card.** Pick one.

**Demo data needed**
- Client **June Whitfield**, cat **Clementine**, euthanasia appointment in two days with Dr. Dana Demo. An estimate with euthanasia, private cremation and a clay paw print. June's email and mobile on file.
- Stripe test mode.

---

## V10. Euthanasia at the visit: consent first, then Run Payment (3 to 4 min)

Goal: make sure consent is on file before checkout, then collect the approved amount. **Everyone. Doctors and techs at the home.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open Clementine's SOAP. Right side, **Euthanasia consent** | A badge: **signed**, **sent**, or **needed** | "Before anything else, look at the consent box. It has to say signed before checkout." |
| 2 | Not signed, family is here: click **Signed printed consent** | Badge **printed**. "Signed printed consent." | "If they signed a paper form at the visit, record it here." |
| 3 | Or **Gave oral consent**, pick **First staff member** and **Second staff member**, click **Record consent** | Badge **oral**. "Gave oral consent. Heard by … and …." | "Verbal consent needs two staff members who heard it. Scout won't let you pick the same person twice." |
| 4 | Click **Add selected items to plan** | The family's chosen items on the plan | "Whatever the family chose on the form, like a clay paw print, comes onto the bill with one click." |
| 5 | Go to **Checkout** | **Estimate given to the family** with the bubble: "This owner approved $… on {date} — it will be charged when you click "Run Payment from Authorization"." | "This bubble tells you exactly what the family approved and when." |
| 6 | Point at the difference line | "An additional $… will be charged to the same card when you click the button." or "$… less than authorized — the rest of the hold is released." | "If the final bill is a bit different, it says so here. The family agreed to that on the form." |
| 7 | Click **Run Payment from Authorization** | The invoice is paid | "Nothing is charged until you click this. One click, once." |
| 8 | Family decides not to go ahead: **Family declined**, then **Yes, the family declined** | "Estimate declined. The card hold was released and nothing was charged. The signed consent is marked withdrawn. Cancel the visit if it will not go ahead." | "If the family changes their mind at the door, that is okay. This releases the hold and charges nothing. Then cancel the visit." |
| 9 | Open the old consent link after checkout | "This visit has already been checked out. Please contact the practice." | "Once checkout is done, the form can't be signed any more. That's why consent comes first." |

**Doctors:** "Check the consent badge before you start. If it says needed, record printed or oral consent first."

**Common mistakes**
- **Checking out before consent is recorded.** The family can't sign the online form afterwards. **[check on screen: whether Scout also blocks Run Payment without consent]**
- **Clicking Run Payment twice.** Wait for the screen.
- **Oral consent with one witness.** It needs two different staff members.

**Demo data needed**
- Clementine's visit today, with the estimate held on the test card (from V9) and one extra item added at the visit (to show the difference line).
- A second euthanasia demo visit with consent not yet signed (for printed/oral), and Lee Demo and Tess Demo as witnesses.

---

## V11. Refills of eVet prescriptions, eVet vaccines and the rabies certificate (3 min)

Goal: fill Mittens's refill from her old eVet script and reprint her rabies certificate. **Everyone. Refills are often a liaison task.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open Harold Benning's visit for Mittens. In **Checkout**, click **Refills** | **Refills for Mittens**, a list of prescriptions on file, each with "… refills left", who prescribed it, and the sig | "Prescriptions from eVet came across, so Mittens's old scripts are here." |
| 2 | Click **Use this refill** | The line shows "Refill of Rx #…", "Prescribed by …", "Directions are locked to the prescription." | "Using a refill takes one off the script and copies the directions exactly. Nobody can change them." |
| 3 | Already added the drug as a normal line? Click **Check refills** on that line | "See refills left on this pet's prescriptions for this item" | "If you added the drug first, Check refills turns that line into the refill." |
| 4 | Point at **Undo refill** | "Put the refill back on the prescription and unlock the directions" | "Picked the wrong one? Undo refill puts it back." |
| 5 | No refills left | "No prescriptions on file for Mittens." or no refills left | "No refills left means the doctor writes a new script. That's not a refill." |
| 6 | Click Mittens's name, open the **By date** timeline **[check on screen: where eVet vaccine rows appear]** | Her vaccine history, including doses from eVet | "Her vaccine history from eVet is on her chart too." |
| 7 | Chart toolbar, **Print document**, **Rabies certificate** | The certificate with the vet's name and license number | "The reprint shows the vet who gave the dose and their license number, as it was on the day of the dose." |

**Liaisons:** "Refills are the one script you can add yourself, because you're only copying directions a vet already wrote."

**Common mistakes**
- **Typing a new sig instead of using the refill.** That's a new prescription and needs approval.
- **Reprinting with the wrong vet.** The certificate takes the vet from the dose. Don't change it.

**Demo data needed**
- Client **Harold Benning**, cat **Mittens**, with an eVet-imported prescription (2 refills left), one with none left, and an eVet rabies dose with a vet and license.

---

## V12. A medical note signed by a licensed tech (2 to 3 min)

Goal: write up a tech visit and sign it. **Licensed techs and doctors. Unlicensed techs watch to know what to hand off.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Scheduler, Harold's visit, **Start Encounter**, **Medical note** | The page header: "… · Medical note · Visit #…" | "A tech visit, like a refill and a nail trim for Mittens, is a medical note, not a SOAP." |
| 2 | Type in **History** and **Plan**, or use **Start AI scribe** and **Write up visit** | "Why they are here, how the pet is doing, owner observations…" | "History and plan, in plain words. Or record the room and let Write up visit draft it." |
| 3 | **Checkout prep** and the **Checkout** panel | The bill on the right, with payment buttons | "Charges and payment are right here on the side." |
| 4 | **Client email** tab | A subject and message | "Write a short email for Harold if he'd like one." |
| 5 | Point at **Switch to SOAP** at the top, click it, then click **Cancel** | A box: "Switch this medical note to a SOAP? The note text moves into the SOAP." | "If you picked a medical note but the doctor ends up doing an exam, don't start over. Click Switch to SOAP. What you wrote moves into the SOAP and the SOAP opens. It works until the note is signed. We'll cancel here because Mittens really is a tech visit." |
| 6 | Click **Wrap up** | The note is signed, and you're back on the schedule. **Switch to SOAP** is gone once the note is signed | "Wrap up signs and locks the note." |
| 7 | Logged in as Tess Demo | **Wrap up** is greyed out: "Only a licensed veterinarian or licensed technician can sign this record." | "If you're not licensed, the button stays grey. Write it up and ask a licensed tech or the doctor to sign." |

**Techs:** "Licensed techs: you can sign a quick visit or a medical note. Unlicensed techs: you can write it, not sign it."

**Doctors:** "You can sign these too, but a medical note is not a SOAP. If you examined the pet, use a SOAP."

**Note for the narrator:** the code also has a "Quick SOAP" type that a licensed tech may sign. No screen I found starts one, so this video uses the medical note **[check on screen: whether a Quick SOAP can be started]**.

**Common mistakes**
- **Using a medical note for a doctor exam.** Click **Switch to SOAP** before signing (step 5).
- **Leaving it unsigned.** If you're not licensed, hand it off the same day.

**Demo data needed**
- Harold Benning's visit with Lee Demo as provider, a nail trim and the refill from V11.

---

## V13. The pet's History tab (2 min)

Goal: find who entered or changed a record. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open Rocket's record. In **Timeline**, click **History** | "Staff only. Who entered or changed prescriptions, vaccine doses after sign-off and lab results. Not part of the medical record." | "The History tab is our own audit trail. It's never part of the medical record." |
| 2 | Read the table: **When**, **Record**, **What happened** | Rows like "Prescription · Rx #…", "Lab result · …", "Vaccine dose · …" | "Newest first. Every script, every lab, and every dose changed after sign-off, with who did it." |
| 3 | Print the record | The printout has no History | "It never prints, it's not in records we send out, and families never see it in the portal." |

**Common mistakes**
- **Looking for clinical notes here.** History is who-did-what, not the chart itself.
- **Sending a screenshot to a client.** It's staff only.

**Demo data needed**
- Rocket's chart after V7 and V8 (a lab result, a prescription entered by Lee for Dr. Dana Demo), plus one vaccine dose edited after signing.

---

## V14. Working in the field with weak signal (2 to 3 min)

Goal: keep charting when the connection drops, and never double charge. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Turn off Wi-Fi on the demo tablet | A brown banner across the top: "Offline — not saved. Your changes are kept on this page and will save when the connection returns." | "Driveways and farms lose signal. When that happens, this banner comes up." |
| 2 | Keep typing in the SOAP | "Not saved yet — your text is kept here and will save when the connection returns." | "Keep going. Your text stays on the page and saves when the signal is back." |
| 3 | Reload the page while offline, then reconnect | "Restored unsaved chart text from this device. It will save again in a few seconds." | "Even if the page reloads, Scout brings your text back on this device." |
| 4 | Try a payment while offline | "Not charged — check the connection and try again. If the card was charged, it will show here when the connection returns." | "If a payment doesn't go through because of the signal, this is what you'll see." |
| 5 | Reconnect and wait | The invoice updates. Paid, or still open | "Wait for the signal, then look at the invoice. If it says paid, you're done." |
| 6 | Voice-over | — | "Never press charge again and again. Once is enough. Check the invoice first. If it's still open, try once more." |

**Also on screen sometimes:** "{Name} also edited {section}. Your version is still on screen — click out to save it." That means a colleague changed the same chart. Your text is safe.

**Common mistakes**
- **Closing the tab while offline.** Stay on the page until it saves.
- **Running the card again and again.** Check the invoice first.
- **Moving to another device.** Unsaved text lives on the device you typed it on.

**Demo data needed**
- A demo tablet you can switch to airplane mode. An open SOAP with some text, and an invoice with a balance.

---

## V15. Pay links, refunds, and why a paid invoice can't be voided (3 to 4 min)

Goal: collect a balance by link, give money back the right way, and fix a paid bill without voiding it. **Everyone. Liaisons most often.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | **Clients**, open Gus Okafor, scroll to **Ledger** | **Email pay link**, **Text pay link**, and "Sends $… for the unpaid invoice" | "When a family owes a balance, send a pay link from the ledger." |
| 2 | Click **Text pay link** | "Pay link ready for $…." and the text to send | "Click once. The text has a secure link for the exact balance." |
| 3 | Click **Email pay link** too | The same link | "If you send it by text and email, it's the same link for the same balance, so the family can't pay twice." |
| 4 | Show an overpayment | A Billing task: "$… overpaid by Gus Okafor: now account credit" | "If a family ever pays more than they owe, the extra stays on their account as credit. Billing gets a task to keep it or refund it with the family." |
| 5 | Open a paid invoice. Under **Payments**, click **Refund** | **Refund payment**, **Amount (partial or full)**, a reason ("e.g. Client request") | "To give money back on a card, refund the payment. Partial is fine." |
| 6 | Click **Process refund** | "Refunded $… via Stripe." | "It goes back to the same card through Stripe." |
| 7 | Show **Void invoice** on a card-paid invoice (manager login) | "This bill was paid by card ($… still taken). Refund the card payment first, then void the invoice." | "A paid bill can't just be voided. That would leave the money taken and give the family nothing back. Refund first." |
| 8 | Items came back instead: **Return items** | **Return & refund?**, "Return the selected items and refund $… to the client's card via Stripe?" | "If the family returned something, use Return items. After a return, the invoice shows 'This invoice has returns. Make a correction instead.'" |
| 9 | Something was missed: **New invoice** | A new open invoice | "Forgot to charge for something on a paid bill? Add a new invoice. Don't reopen or void the old one." |

**Who can do what:** "Anyone on a visit can send pay links and refund card payments. Voiding an invoice is only for lead client liaisons, billing and managers. If you need one voided, ask them."

**Common mistakes**
- **Making a new link every time the family asks.** It's the same link while the balance is the same. Just resend it.
- **Voiding to give money back.** Refund instead.
- **Refunding more than the card took.** Scout stops you. "Refund cannot exceed $…".

**Demo data needed**
- Gus Okafor with one unpaid invoice (for the pay link), one card-paid invoice (for the refund and the void refusal), and one paid invoice with a returnable product.
- A **Casey Demo** login (to show the pay link) and a manager login (to show the void refusal). Stripe test mode.
