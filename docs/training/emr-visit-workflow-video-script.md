# EMR and visit workflow training videos: VAYD doctors and technicians

Seventeen short videos, 2 to 4 minutes each, one task per video. One series that everyone on a visit watches. Where a step is different for your role, there is a short **Doctors:** / **Techs:** / **Liaisons:** line in the table. Written from the code on Nov 3, 2026, using the owner decisions of Nov 2 and 3, 2026. Follow-ups (V5, V5b, V5c) updated Nov 4, 2026 for the Schedule follow-ups window and the shared labs-pending task. Screen names, tabs, buttons and messages come from the app source. Do a dry run on the demo database first. Places that need a visual check on the first take are marked **[check on screen]**.

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
| Plan follow-ups in **Schedule follow-ups** (book, send to the CLs, labs pending) | Yes | Yes | Yes **[check on screen]** | Yes, from **+ Forward Booking** **[check on screen]** |
| Close or reopen their own copy of a shared labs-pending task | Yes | Yes | Yes | Yes, if it's on their list |

**Which videos matter most for each role** (everyone can watch all of them; the steps are the same for everyone):

| Role | Core videos | Also useful |
|---|---|---|
| Doctor | V1–V5c, V6–V8, V10, V13, V14 | V9, V11, V12, V15 |
| Licensed tech | V1–V5c, V6–V8, V11, V12, V14 | V9, V10, V13, V15 |
| Tech | V1–V5c, V7, V8, V14 | V6 (what you can't sign), V11, V13 |
| Client liaison | V9, V15 | V5, V5b, V11 (refills), V14 |

**How to get to every screen**
- **The visit:** **Home** is the calendar. Pick the doctor in the list at the top right (**Dana Demo** in the demo) and click **Today**. Right-click the appointment (long-press on a tablet) **[check on screen]**. Under **On Visit Day** there is **Start Encounter** (it says **Edit Encounter** once one exists) and **Start / End Visit**. **Start Encounter** asks **SOAP** ("Doctor exam — history, exam, assessment, and plan.") or **Medical note** ("Tech visit write-up — history, plan, and invoice. Not a SOAP.").
- **From the pet's chart:** **Patients**, open the pet, then use the chart toolbar (**Medical note**, **Send form**, **Print document**, **Communicate**, **Invoice**). The chart also offers to continue an open SOAP or start one on a booked visit.
- **The SOAP page** has the tabs **Subjective**, **Objective**, **Assessment**, **Plan** and **Checkout prep**. The **Checkout** panel is on the right. **Wrap up visit** is top right.
- **Checkout** (the whole household pays once): the **Checkout** button at the bottom of the SOAP's Checkout panel.
- **Schedule follow-ups:** the **Schedule follow-ups** button under **Follow-up** on the Checkout page (it becomes **Review follow-ups** once a plan is saved). The same window opens from **Start / End Visit**, from **+ Forward Booking** in the left menu or **+ Forward Book** in the header (find a pet or owner first), and from a labs-pending task.
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
| 2 | Click **SOAP** | The SOAP page. Header: **Biscuit · View details · Rivera**, the signalment, and "Exam: … · Visit #… · Comprehensive SOAP" | "For a doctor exam, pick SOAP. Up top you'll see the pet, the family, and the visit number." |
| 3 | Click **Biscuit** in the header (or **View details** next to it), look, then click **Close**. Then click the client name, **Rivera** | A large pop-up over the SOAP with Biscuit's whole chart: reminders, declined items, tasks, past due, problems and eVet suggestions, prescriptions, vaccines, History. Then the client record in the same kind of pop-up | "Click the pet's name or View details to see the whole chart without leaving the SOAP; click the client's name for the client record. Esc or Close brings you right back, and your SOAP is just as you left it." |
| 4 | Point at the pet tabs: **Biscuit**, **Maple**, **Pepper** | One tab per pet. A heart shows on any pet with a membership | "The Riveras have three pets on this visit, so there's a tab for each one. Each pet gets its own chart. Click a tab to switch." |
| 5 | Click **Maple** | Maple's SOAP opens. Same visit number | "Switching pets keeps you on the same visit. Anything you typed for Biscuit is already saved." |
| 6 | Point at the right side | The **Checkout** panel with the household's charges | "The bill builds on the right while you work. The whole household shares one invoice." |
| 7 | Point at a presence chip, if a colleague is on the visit | A chip with their name, or that they're recording | "If someone else is in this visit, you'll see their name here, so you know you're working together." |

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
| 3 | Under **Follow-up**, click **Schedule follow-ups** and give every pet a plan (that's V5b) | "Ask now while they are still here, or leave it for Start/End Visit — payment does not wait on it." Afterwards: "✓ Biscuit · Booked at appointment" for each pet, and **Review follow-ups**. The pets' reminders sit under this section | "Ask about the next visit while they're still here. That has its own video. It's not required to take payment: if there isn't time, plan it later from Start / End Visit." |
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

## V5b. Follow-ups: the Schedule follow-ups window (3 to 4 min)

Goal: give every pet a plan: booked now, sent to the CLs, labs pending, or no follow-up needed. Best done at checkout while the family is there, but never required to take payment or sign the chart. If there isn't time, do it later from **Start / End Visit**. **Everyone. Liaisons** use the same window from **+ Forward Booking**.

**Why it matters:** most importantly, the best care for our patients: rechecks and vaccines happen on time because the next visit is set before the family's day moves on. It also fills our future schedule with secure bookings, and booking early lets routing group visits, so future days have shorter drives.

**Say at the start:** "Booking the next visit before we leave is the best thing we can do for the pet. Rechecks and vaccines stay on time. It also keeps our future days full, and lets us plan shorter drives."

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | On the Checkout page, under **Follow-up**, click **Schedule follow-ups** | **Schedule follow-ups · Rivera**: "Group pets that should be seen together. One card is one future visit." On the left, **Today's visit · needs a plan** with Biscuit, Maple and Pepper, and **Rest of household · optional** with Olive | "Every pet should leave with a plan. One card is one future visit." |
| 2 | Click **Biscuit**, choose the **"In 1 year" card**. Do the same for **Maple** | Both pets on the card | "Put pets that should be seen together on the same card." |
| 3 | Click the **2 weeks** chip. Leave **Keep Dr. Dana Demo** ticked | "Target around …" | "Pick when. Keep Dr. keeps the same doctor for the household." |
| 4 | For each pet, pick a **Visit type**. Point at **Needs pre-meds** | Pre-meds is already ticked for a pet that needed it last time | "Each pet needs its own visit type. If any pet needs pre-meds, the whole household gets the pre-meds arrival window." |
| 5 | Point at the reminders under each pet | Reminders colored by whether they fall around the card's date **[check on screen]** | "Reminders due around that date show on the card, so you can catch them at the same visit." |
| 6 | Click **Find a time now** | **Find a time · Biscuit, Maple**, "In 2 weeks · about 60 min · target … · Dr. Demo". Slot cards: "Wed, … · 8:00–10:00 AM arrival", a **Best fit**, **Great** or **Good** tag, a short reason, **Review** and **Book** | "Find a time searches the doctor's days near the target date, and ranks the best fits by drive time and how full each day is." |
| 7 | Under **What works for the owner?**, tap **Mornings**, a weekday, **Earliest available** or **Any doctor in zone** | The list refreshes | "Ask the owner what works. Each choice runs the search again." |
| 8 | Fill **What does Biscuit need?** and **What does Maple need?**, then click **Book** | A short "Booked …", then the card shows **Booked** with the day, arrival window and doctor, and **Undo** | "What you type becomes the visit description. Book books it right here, with no calendar step." |
| 9 | Booked the wrong time? Click **Undo** within 10 seconds | "Booking undone" | "Undo removes the visits and the follow-ups. After ten seconds, change it on the calendar instead." |
| 10 | Click **Review** on a slot, or **Open the full calendar in a new tab** | The calendar opens in a new tab on that day and doctor, with the visit in place | "Want the whole day in front of you? Review opens the calendar in a new tab. Book there and this card updates." |
| 11 | Under **Rest of household**, add **Olive** to the household's visit next Tuesday with **Add Olive** | "Added Olive". If a later stop would run late: **Add anyway** and **Send to CLs** | "A pet can join a visit the household already has. If that would make the doctor late for the next stop, add anyway, or send it to the CLs to sort out." |
| 12 | For a later visit: click **+ 1 year**, put a pet on that card, click **Send to CLs to book** | "Goes to the CLs when you press Done. Target …" with **Undo** | "Not booking it now? Send it to the CLs. It joins their call list when you press Done." |
| 13 | A pet that needs nothing: put it on **No follow-up needed** and type the reason | "A reason is required." | "No follow-up is a choice too. Say why." |
| 14 | Type in **Note for the CLs about this household** | "Saved with every forward booking row for this household when you press Done." | "Anything the CLs should know, like 'call the cell' or a gate code, goes here once for the whole household." |
| 15 | Click **Done · next: text the owner** | **Text the owner · Rivera**: **What was set up today**, then the **Confirmation text** with **To**, "from Dr. Demo's line", **Reset wording**, "… characters · sends as 2 texts" and "Turn the screen around so the owner can check dates and pet names before you send." | "Scout writes one text with everything set up today. Turn the screen around so the owner can check it." |
| 16 | Click **Send text & finish**, or **Finish without texting** | Back on Checkout: "✓ Biscuit · Booked at appointment" for each pet, and **Review follow-ups** | "One text, sent once. Review follow-ups opens the window again if you need to change something." |

**Liaisons:** "Pets sent to the CLs land on the Forward Booking list with the household note. On the phone, use **+ Forward Booking**: find the pet or owner and the same window opens, with every pet optional."

**Common mistakes**
- **Skipping the visit type.** Find a time and Send to CLs refuse until each pet has one: "Pick a visit type for …".
- **Waiting more than 10 seconds to undo.** After that, change the visit on the calendar.
- **Add anyway when a later stop will run late,** without telling anyone. Send it to the CLs instead.
- **Finishing without the text** when the owner wanted it.

**Demo data needed**
- The Rivera visit today (Biscuit, Maple, Pepper) with Dr. Dana Demo, plus a fourth Rivera pet, **Olive** (cat), not on today's visit and booked for a nail trim next Tuesday.
- Dr. Dana Demo's weekly hours and zone covering the Riveras' address, and drive times working on the demo system (OSRM or the test fake).
- Texting turned on for the Rivera household with a test phone number, and texts captured by the demo system, so nothing reaches a real phone.

---

## V5c. Labs pending: the task shared by the doctor and tech (2 to 3 min)

Goal: when you'll book after lab results come back, the doctor and their tech both have the task, and it gets closed the right way. **Doctors and techs.**

**Why it matters:** results that change the plan get acted on quickly, and no pet is forgotten while the team waits on a lab. With two people holding the task, it still moves when one of them is out.

**Say at the start:** "When we're waiting on labs, the next visit can't be booked yet, but it can't be forgotten either. The doctor and the tech both hold the task until the pet has a plan."

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | In Schedule follow-ups, put **Maple** on **Labs pending** | "Book once results are back. Creates a task for each pet." **Who reviews** already shows Dr. Dana Demo and Lee Demo | "If you'll book once labs are back, put the pet here." |
| 2 | Point at **Who reviews** and **Watching** | "Starts with the visit's doctor and the techs who work with them. Each person gets their own linked copy." | "It starts with the doctor and every tech who works with them. That's set on the tech's profile, under Works with. Add or remove people, or add someone under Watching to keep them informed without the work." |
| 3 | Press **Done**. Sign in as Lee Demo and open **Tasks** | The task to forward book Maple once labs are back, with **Shared with Dr. Dana Demo** in its heading | "Each person has their own copy, and the heading shows who else has it." |
| 4 | Labs are back: on the task, click **Schedule follow-ups** | The window opens with Maple under **Labs are back · needs a plan** | "The task opens the same window. Book Maple, add her to a visit already on the books, send her to the CLs, or mark no follow-up." |
| 5 | Book or send to the CLs, then press **Done** | The task closes with a note of what was done, for example "Maple: sent to the CLs (around …)", on every copy | "Finishing the plan closes everyone's copy." |
| 6 | Or close it without booking: **Mark complete** | "Also close it for Dr. Dana Demo?" with **Close for everyone** and **Just me** | "Closing your copy asks about the others. Just me leaves it on the doctor's list." |
| 7 | On the doctor's copy after **Close for everyone** | "Closed because Lee Demo closed their copy" | "Everyone can see who closed it." |
| 8 | Click **Reopen** | Reopen for everyone, or for one person. If nobody on it still works here, assign it to someone else | "Reopening also restarts the overdue reminders." |

**Doctors:** "If you're the relief doctor on the visit, the task comes to you, and all of our doctors are watching it."

**Techs:** "You're added automatically when your profile says you work with that doctor. If you weren't added and should have been, ask a manager to check Works with on your profile."

**Common mistakes**
- **Just me when you meant everyone.** The doctor still has it open. Open your copy and close it for everyone, or ask them to close theirs.
- **Closing the task instead of planning.** If the results are back, plan the follow-up from the task. That closes every copy and leaves a note.

**Demo data needed**
- Lee Demo's profile: **Works with** Dr. Dana Demo. Tess Demo not linked, to show she isn't added.
- Maple on the Rivera visit, with Labs pending used once before recording step 3.

---

## V6. Wrap-up: the client recap, and who signs what (3 to 4 min)

Goal: send the recap and lock the charts, and know who's allowed to sign. **Everyone (signing is for doctors on a SOAP).**

**Wrap-up and checkout are completely separate.** Wrap-up is for the charts: review, recap and signing. Checkout is for the family: payment, and planning follow-ups. Neither waits on the other. Signing doesn't need a follow-up plan, and it can happen later, outside the visit.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | On the SOAP, click **Wrap up visit** | **Wrap up visit**. A card for each pet, then **Client recap** | "When the exam is charted, click Wrap up visit." |
| 2 | Point at a pet's "4 of 4 sections charted", plus **Weight needed**, **Dose needed: …** or **Rx needed: …** if anything is missing | The pet's card | "Each pet has a card. Four of four means all four SOAP sections have notes. A red button takes you straight to whatever's missing." |
| 2a | Click the pet's name to open the card, point at each section, then click the name again to close it | **Subjective**, **Objective**, **Assessment**, **Plan**, each editable | "Read them over, and fix anything right here. It saves when you click away." |
| 2b | In **Problems**, type a problem, then click **Acute** or **Chronic** | The problem shows with "acute" or "chronic" | "Add a problem here. It goes on the problem list when the chart is signed." |
| 2c | Point at **Medications** and **Add a callback** | Medication search; the callback form | "Medications work the same way. Add a callback if someone should check in with the family." |
| 3 | In **Client recap**, read the draft | **To**, **Subject**, **Message**. The recap is written from the charts | "Scout writes the recap from the charts. Read it like the family will, and fix anything you'd say differently." |
| 4 | Show a client marked Do not email | "This client is marked "Do not email", so their address was not filled in. Type an address only if the client asked for this email." | "If the family asked us not to email, the address stays blank. Only type one in if they asked for this email." |
| 5 | Click **Send to client**. Or click **Don't email**, type why, and click **Record: no recap** (one action per sentence: "So click Don't email, say why, and record it.") | "Sent … to …. Filed on each covered pet's EMR under Communications." | "Either send it, or record why you didn't. One of the two has to happen before signing." |
| 6 | Point at the footer: **Client recap**, **Dose & Rx**, **Weight** | Each turns into a check when done | "These three checks have to be done before you can sign." |
| 7 | Click **Sign & lock SOAP (3 charts)** | **SOAP signed & locked**. Each pet: "Signed & locked by Dr. Dana Demo — …" | "One click signs and locks all the charts. Only a licensed veterinarian can sign a full SOAP." |
| 8 | After signing, click **Redo client email** (it reads **Write a recap after all** when no recap was sent) | The recap opens again | "Made a mistake in the email, or decided to send one after all? You can still do it after signing. The draft keeps saving, and anything already sent stays on the record." |
| 9 | Back on a locked SOAP, point at **Write addendum** | "Append a dated note without unlocking the signed SOAP" | "Need to add something later? Write an addendum. The signed chart stays as it was." |

**Doctors:** "Only a licensed veterinarian can sign and lock a full SOAP. That's you."

**Techs:** "On a full SOAP the sign button is greyed out for you, with 'Only a licensed veterinarian can sign and lock a SOAP.' Get the recap and doses ready, then hand it to the doctor. Licensed techs can sign a medical note (see V12). Unlicensed staff don't sign anything."

**What happens if nobody signs (say once, plain language):** "If a SOAP is still open a day later, Scout gives the visit's doctor a task called 'Finish the chart for Biscuit'. The medical director can see it too. It goes away when the chart is signed. **End Visit** on the calendar only records the visit times, and its follow-up section opens the same Schedule follow-ups window. It doesn't sign anything."

**Common mistakes**
- **Thinking End Visit or payment signs the chart.** They don't.
- **Sending the recap to a Do not email client** because the address was on file.
- **Leaving charts open overnight.** That's what the Unfinished chart task is for, but don't rely on it.

**Demo data needed**
- The Rivera visit, all three pets charted. A second household marked **No Email** (to show the warning). A connected practice mailbox.

---

## V7. A sick visit: patient alerts and an in-house lab (2 to 3 min)

Goal: run an ear cytology in-house, keep checkout moving, and find the result on the chart afterward. The patient alert gets a brief mention. **Everyone except client liaisons.**

**Why it matters:** starting in-house labs during the visit puts every result on the chart, and a lab that's ordered but not finished never gets lost, because it stays on the worklist. You don't have to finish the lab before checkout.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open the SOAP for **Biscuit** (Tom Chen) | A banner at the top: **Patient alerts — Biscuit**, "Bites when his ears are handled. Muzzle for ear exams. — Jordan P." | "If a pet has an alert, it shows up top, with who wrote it. Give it a glance before you start." |
| 2 | In **Checkout**, type **Ear cyto** in "Type here to add a charge…" and pick **Ear cytology** | The line shows a **Not run** chip | "The line says Not run. The lab is ordered, but nobody has done it yet." |
| 3 | Click the arrow at the start of the line (its tooltip is "Run the lab / view results") | The result form. For cytology: a notes box, "Describe what you saw." | "Click the arrow to open the result. Write what you saw under the microscope." |
| 4 | Click **Save, finish later**, then point at **Checkout** | Saved, still **Not run**. The Checkout button is still enabled | "Not done yet? Save, finish later keeps what you have. You don't have to finish the lab to keep going. Checkout still works, so the family can pay and you can head out. Finish the result back at the office, or in the car while a 4Dx runs." |
| 5 | Click **Labs** in the top bar, then **In-house labs** | **Waiting to run (2)**, grouped by day, filter **All providers** | "Waiting to run lists every in-house lab that's ordered but not done, for the whole practice." |
| 6 | Click Biscuit's row, finish the notes, click **Save results** | The lab moves to **Recently resulted** | "Open one, finish the notes, and click Save results." |
| 7 | Click **Chart** on the row | The chart's Timeline opens on **By date**, with a **Lab** row for Ear cytology | "By date shows today's lab in line with the rest of his record." |
| 8 | Click **View results** on the row, then the lab card (its label is **View**) | The finished notes | "Click View results to open it, then View to read the notes." |
| 9 | Click the **Labs** tab | Only his labs | "The Labs tab lists only his labs." |
| 10 | Click **History** | "Result entered by …" and "Result completed by …" rows, with times | "And History shows who entered the result, who finished it, and when." |

**Techs:** "You can enter and finish in-house results yourself. No license is needed."

**Closing line:** "The mistake to avoid: leaving a lab on Save, finish later and forgetting it. Check Waiting to run before your day ends. Start labs in the visit, and finish every one you start."

**Common mistakes**
- **Leaving labs on Save, finish later and forgetting them.** They stay on **Waiting to run** until someone saves the results.
- **Blank rows on a panel.** Scout asks for "a value or a comment on each row."

**Demo data needed** (made by `cypress/training/stack/demo-names.sh` and the V7 spec)
- Tom Chen's dog **Biscuit**, with the alert written by Jordan Pike (tech). A sick visit today with Dr. Avery Lane.
- In-house **Ear cytology** and **Skin cytology** catalog items, each with a "Describe what you saw" lab form. A skin cytology for **Maple** (Riveras) ordered yesterday and not run, so the worklist shows more than one pet.

---

## V8. Prescriptions: directions, approval, the label and Rx history (2 to 3 min)

Goal: get Biscuit's ear medication written, approved and labelled. **Everyone except client liaisons.**

**Why it matters:** every medication that goes home needs directions the family can follow, and an approval before it's dispensed. That keeps the label right and the pet safe.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | In **Checkout**, add **Mometamax otic 15 g** | The line opens by itself and says **Approve the sig** | "The line opens by itself, and says Approve the sig. Checkout waits until it's approved." |
| 2 | Read **Directions (sig)**, add to them, click **Save sig** | The item's default directions; then "Entered by Avery Lane" | "The directions start from the item's default. Read them, and fit them to this pet." |
| 3 | Type **# Refills** (0 if none), pick **Acute or chronic**, check **Discard after**. Then **Approve** saves them with the script (two clicks: **Save sig**, **Approve**; owner, Nov 6, 2026. Save Rx only shows for staff who can't approve) | Refill expiration appears only when refills are above 0 | "Discard after is filled in for you. Change it if the medication expires sooner." |
| 4 | Click **Approve** | The line closes with a check mark; Checkout says "Everything is recorded" | "It means the script is checked, and ready to dispense." |
| 5 | Open the line again, click **Send label to DYMO** | **Print prescription label**: practice letterhead, pet and owner, the doctor and license, then **Print on DYMO** | "Review it first." |
| 6 | Click **History** on the line | "Directions entered by Avery Lane (vet) for Dr. Avery Lane: …" and "Approved for dispensing by … Rx #…" | "It's for staff only, and never printed." |

**Doctors and techs:** "Doctors are the prescriber. Techs can enter directions and approve too, and Scout saves them for the visit's doctor."

**Liaisons:** "Client liaisons can't write directions. A new script waits for a doctor or tech, or goes to Mail order." (On screen: "A doctor or technician must approve — or switch to Mail order".)

**Closing line:** "Two mistakes to avoid: typing directions and walking away without saving, and approving without reading them. Check the directions, save, then approve."

**Common mistakes**
- **Typing directions and walking away.** Press **Save sig**, then **Approve**, before you leave the line.
- **Saving without Acute or chronic.** "Choose acute or chronic for this prescription."
- **Refills past a year.** "Refill expiration cannot be more than 1 year from today."

**Not in this video:** the "Sig carried over from this patient's last fill" note and the two-people edit warning ("Changed by …, reload") belong to the dose section used for vaccines and non-label orders. A medication line with a label doesn't show them.

**Demo data needed** (made by `cypress/training/stack/demo-names.sh` and the V8 spec)
- Biscuit's ear visit with Dr. Avery Lane. **Mometamax otic 15 g** with default directions (lot tracking off on the test stack).
- Stock locations **Car** (default) and **Office shelf** for the Raleigh office, and the practice letterhead for the label.

---

## V9. Euthanasia, before the visit: estimate, consent and card (3 to 4 min)

Goal: price the visit, get consent, and get a card on file before the family's hardest day. **Everyone. The phone-card path is usually a client liaison task.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 0 | (Nov 6 video) The estimate is usually built when the visit is booked. If it's empty: search **Euthanasia Group**, pick the euthanasia for the pet, **Next**, the aftercare, **Next**, the same-day fee only if same-day, **Add** | The package's three steps | "Type Euthanasia Group in the search, and pick the package. It walks you through the choices." |
| 1 | On the Scheduler, right-click Clementine's visit, **Visit Prep**, **Send Euthanasia Consent** | **Estimate for Clementine**: "The consent form quotes one total and asks for a card against it. Nothing is charged until after the visit." | "We always price the visit first, because the consent form shows the family one total." |
| 2 | Check the lines, **Weight**, and **Aftercare the family will confirm** | The estimate, with any aftercare warnings | "Make sure the aftercare matches what the family asked for. The form asks them to confirm it." |
| 3 | Family can use the form: click **Email consent**, **Text consent**, or **Have them sign here** | Toast "Consent sent to …. Link copied." | "Most families sign the online form. They choose their items, sign, and enter a card." |
| 4 | Show the family's view (step 1 of 4 of the form) **[recorded Nov 6: the Card authorization paragraph is on step 4, which needs a Google-matched address, so the video shows step 1 and says the hold wording as voice-over]** | "About 24 hours before the visit (or right away, if the visit is sooner), we'll place a hold … A hold is not a charge. If the visit is rescheduled, we'll move the hold to the new date. If it's cancelled, we'll release it." | "This is what the family reads. We hold, we don't charge, and we charge the final amount on the day." |
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
| 9 | Open the old consent link after checkout | "This visit has already been checked out. Please contact the practice." (After printed or oral consent the link says "This consent form has already been submitted." instead; the Nov 6 video shows that one.) | "Once checkout is done, the form can't be signed any more. That's why consent comes first." |

**Doctors:** "Check the consent badge before you start. If it says needed, record printed or oral consent first."

**Common mistakes**
- **Checking out before consent is recorded.** The family can't sign the online form afterwards. **[check on screen: whether Scout also blocks Run Payment without consent]**
- **Clicking Run Payment twice.** Wait for the screen.
- **Oral consent with one witness.** It needs two different staff members.

**Demo data needed**
- Clementine's visit today, with the estimate held on the test card (from V9) and one extra item added at the visit (to show the difference line).
- A second euthanasia demo visit with consent not yet signed (for printed/oral), and Lee Demo and Tess Demo as witnesses.

**After the visit (say once):** "When Clementine is marked as passed, the wrap-up lists everything still open for her and closes it: future visits, follow-ups waiting for the CLs, open text offers and waitlist entries, as well as memberships, auto-ships, reminders, refills and pharmacy orders. Nobody will call or text the family about her."

---

## V11. Refills of eVet prescriptions, eVet vaccines and the rabies certificate (about 2 min)

Goal: fill Maple's refill from her eVet script and reprint her rabies certificate. **Everyone. Refills are often a liaison task.**

**Why it matters:** a refill copies the doctor's directions exactly, and keeps the count of refills right.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open Maple's recheck (Maria Rivera). In **Checkout**, click **Refills** | **Refills for Maple**: "Rx #971204 · Carprofen 75 mg caplets · 2 refills left · Prescribed … by Avery Lane", the sig, **Use this refill**; Apoquel with "No refills left" | "Every prescription on file is listed, including the ones that came over from eVet." |
| 2 | Point at Apoquel | No refills left | "That one needs a new script from the doctor, so it isn't a refill." |
| 3 | Click **Use this refill** on Carprofen, then open the line | A **Refill** tag and "No production"; "Refill of Rx #971204 · Prescribed by Avery Lane · 1 refill left after this · through …", the **Directions** (read-only), "Directions are locked to the prescription." | "The doctor's directions are right here, and they're locked, so nobody can change them on a refill." |
| 3b | New directions needed: click **New directions…**, then **Stop refills and write a new script** | "A refill can't change the directions. To change them, stop Rx #971204: its 2 refills left go to 0…"; the line becomes a new script for the visit's doctor (production), with the item's catalog directions and **Approve the sig** | "This stops the old prescription. Its refills go to zero. This line becomes a new script for the visit's doctor, and the doctor gets the production." (Owner decision Nov 6, 2026. Doctors and techs only: `rx.sig.draft`.) |
| 4 | Click **View details** next to Maple's name | Her medical record; the **By date** timeline lists the eVet Carprofen, Apoquel and **Rabies 3yr Vaccine** rows | "Here's her rabies dose from eVet, with the vet who gave it." |
| 5 | **Print document**, then the **Rabies certificate** card | "Only for a rabies vaccine we administered. Signed by the veterinarian who gave it…", **Veterinarian: Avery Lane · NC-VET-00417**, the tag and lot | "It's signed by the vet who gave the dose, and shows their license number." |

**Liaisons:** "Refills are the one script you can add yourself, because you're only copying directions a vet already wrote."

**Closing line:** "Two mistakes to avoid: changing directions on a refill, and changing the vet on a certificate. For new directions, stop the old script and write a new one, and let the dose decide the vet."

**Not shown (check before adding back):** **Undo refill** and **Check refills** didn't appear on the SOAP checkout line in this build. The refill panel only shows Undo when the line can be edited there.

**Demo data needed** (`cypress/training/setup/emr-v11.sql`, run by the spec)
- Maple's eVet prescriptions: Carprofen 75 mg (2 refills left) and Apoquel 16 mg (none left), both by Dr. Avery Lane. An eVet rabies dose 8 months ago by Dr. Lane, tag R-20417.
- The recheck exam is charged before the video starts. (Opening Refills on a visit with no charges yet fails; see the bug list.)

---

## V12. A medical note signed by a licensed tech (about 2 min)

Goal: write up a tech visit and sign it. **Licensed techs and doctors. Unlicensed techs watch to know what to hand off.**

**Why it matters:** not every visit needs a doctor's exam. A tech visit is a medical note, and a licensed tech can sign it.

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Signed in as **Jordan Pike** (licensed tech). Scheduler, right-click Maple's nail trim, **On Visit Day**, **Start Encounter**, **Medical note** | "Maple · Maria Rivera · Medical note · Visit #…" | "Pick Medical note, not SOAP." |
| 2 | Type in **History**, click **Plan**, type the plan as one line per item ("- Nail trim, no bleeding." / "- Discussed a nail grinder for home.") | "Why they are here…" / "What was given today and what happens next…" | "A medical note has two parts." |
| 3 | Point at **Start AI scribe** and **Write up visit** | | "You can also record the room, and Write up visit drafts both parts for you." |
| 4 | Click **Checkout prep**: match "Nail trim" to its charge; point at **Declined / Add Callback / Add Reminder** and the trash icon on the grinder row. Optional: rows can be trashed or skipped; nothing has to be cleared before wrap-up. Then **Client email** | One row per plan line (and per AI scribe item); a subject and message | "Checkout prep isn't where you check out. It catches each line of your plan, and anything the AI scribe heard, so you charge for what you did, cover what you talked about, and add any callback. You can trash or skip a row; it's a double check, not a step you must finish." Then: "Client email is for a short note to the family." |
| 5 | Click **Switch to SOAP**, then **Cancel** | "Switch this medical note to a SOAP?" | "What you wrote moves into the SOAP. It works until the note is signed." |
| 6 | Click **Wrap up** | The note is signed; back on the schedule | "It signs and locks the note." |
| 7 | Biscuit's note, opened by a tech who isn't licensed | **Wrap up** is grey: "Only a licensed veterinarian or licensed technician can sign this record." | "Write it up, and ask a licensed tech or the doctor to sign it the same day." |

**Doctors:** "Doctors can sign these too. But if you examined the pet, use a SOAP."

**Closing line:** "Two mistakes to avoid: using a medical note for a doctor's exam, and leaving it unsigned. Pick the right record, and get it signed today."

**Note:** the code also has a "Quick SOAP" type that a licensed tech may sign. No screen I found starts one, so this video uses the medical note.

**Demo data needed** (made by the V12 spec)
- Jordan Pike licensed as a technician (NC-RVT-01188) for the main part; the license is removed before step 7 and that page reload is cut from the video.
- Maple's nail trim today with Dr. Avery Lane. Biscuit's nail trim, with its medical note already started. (Two Rivera visits on one day open as one household note, so the second pet is from the Chens.)

---

## V13. The pet's History tab (about 1 min)

Goal: find who entered or changed a record. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Open Maple's chart, scroll to **Timeline**, click **History** | "Staff only. Who entered or changed prescriptions, vaccine doses after sign-off and lab results, and who switched a visit between a medical note and a SOAP. Not part of the medical record." | "It's for staff only, and it isn't part of the medical record." |
| 2 | Read the table: **When**, **Record**, **What happened** | Newest first: "Result completed by Avery Lane (vet)", "Result entered by Jordan Pike (tech)", "Dose changed by Avery Lane (vet): tag R-20471 → R-20417", "Label printed…", "Approved for dispensing…", "Directions entered by Jordan Pike (tech) for Dr. Avery Lane: …" | "Each row says when, which record, and what happened." |
| 3 | Voice-over | | "It never prints, it isn't in the records we send out, and families never see it in the portal." |

**Closing line:** "Two mistakes to avoid: looking here for clinical notes, and sending it to a client. History is who did what, and it's for staff only."

**Demo data needed** (`cypress/training/setup/emr-v13.sql`, which runs V11's setup first)
- Maple's eVet Carprofen script and rabies dose, and six logged steps: directions entered by Jordan for Dr. Lane, approved, label printed; the rabies tag fixed after sign-off; a skin cytology entered by Jordan and completed by Dr. Lane.

---

## V14. Working in the field with weak signal (about 1.5 min)

Goal: keep charting when the connection drops, and never double charge. **Everyone.**

| Step | What to click | What's on screen | What I say |
|---|---|---|---|
| 1 | Biscuit's SOAP; the signal drops | A brown banner across the top: "Offline — not saved. Your changes are kept on this page and will save when the connection returns." | "This brown banner comes up." |
| 2 | Keep typing in Subjective | "Not saved yet — your text is kept here and will save when the connection returns." | "Your text is kept right here." |
| 2b | Still offline: click **Objective**, then **Subjective** | The text is still there | "Moving between tabs doesn't lose anything, even with no signal." (Checked Nov 6, 2026: cypress/e2e/emr-soap-offline-tab-switch.cy.ts.) |
| 3 | The signal comes back | The banner goes away and the text saves by itself | "Nothing to retype. Just stay on the page until it's saved." |
| 4 | Click **Checkout**; the signal drops; click **Card on file** | "Not charged — check the connection and try again. If the card was charged, it will show here when the connection returns." | "If the card was charged after all, it will show here when the connection returns." |
| 5 | The signal comes back | The invoice is still **OPEN** | "If it's still open, like this one, try once more. If it says paid, you're done." |

**Closing line:** "Two mistakes to avoid: closing the tab while you're offline, and running the card again and again. Stay on the page until it saves, and check the invoice before you charge again."

**Common mistakes**
- **Closing the tab or reloading while offline.** Stay on the page until it saves. (See the bug below: a reload can lose the unsaved text today.)
- **Running the card again and again.** Check the invoice first.
- **Moving to another device.** Unsaved text lives on the device you typed it on.

**Left out (fixed Nov 6 in 74ae048, not yet in the video):** "Restored unsaved chart text from this device" after a reload. Today the SOAP page writes to the note as it loads (POST /soap-encounters twice, then two PATCHes of the history), which makes the local copy look older than the server's, so the page throws it away.

**Demo data needed** (made by the V14 spec)
- Biscuit's ear recheck with an Office exam charge, and a test card reference on the invoice so **Card on file** is offered. The video drops the signal by blocking API requests in the browser; nothing reaches Stripe.

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
| 6 | Click **Process refund** | "Refunded $… via Stripe."; a **Refund: <reason>** line (−$…) on the bill, still Paid, nothing due | "It goes back to the same card, and the bill comes down by the same amount, so the family doesn't owe it again." (Nov 6, 2026. Check "They'll pay this another way" only when re-charging a different card.) |
| 7 | Show **Void invoice** on a card-paid invoice (manager login) | "This bill was paid by card ($… still taken). Refund the card payment first, then void the invoice." | "A paid bill can't just be voided. That would leave the money taken and give the family nothing back. Refund first." |
| 8 | Items came back instead: **Return items** | **Return & refund?**, "Return the selected items and refund $… to the client's card via Stripe?" | "If the family returned something, use Return items. After a return, the invoice shows 'This invoice has returns. Make a correction instead.'" |
| 9 | Something was missed: **New invoice** | A new open invoice | "Forgot to charge for something on a paid bill? Add a new invoice. Don't reopen or void the old one." |

**Recorded Nov 6, 2026 (Tom Chen and Biscuit):** text pay link, $20 partial refund, Return items and New invoice pointed at, the manager's void refused. Not shown: the overpayment task and a real return. The take found a bug (a partly refunded card bill could be voided with the rest still taken), fixed in the API the same day.

**Who can do what:** "Anyone on a visit can send pay links and refund card payments. Voiding an invoice is only for lead client liaisons, billing and managers. If you need one voided, ask them."

**Common mistakes**
- **Making a new link every time the family asks.** It's the same link while the balance is the same. Just resend it.
- **Voiding to give money back.** Refund instead.
- **Refunding more than the card took.** Scout stops you. "Refund cannot exceed $…".

**Demo data needed**
- Gus Okafor with one unpaid invoice (for the pay link), one card-paid invoice (for the refund and the void refusal), and one paid invoice with a returnable product.
- A **Casey Demo** login (to show the pay link) and a manager login (to show the void refusal). Stripe test mode.
