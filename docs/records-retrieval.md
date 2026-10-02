# Records retrieval

Requesting medical records from a patient's previous veterinary practice ahead of a visit,
tracking which requests are still outstanding, and getting the received records onto the
patient chart.

## Why this shape

No PIMS pulls records from another PIMS — ezyVet, Vetspire, and Shepherd all leave this as
manual PDF-by-email or fax. What is mature in the industry is the *referral portal*
(IDEXX rVetLink, Provet Cloud Referral Portal, VetLoop, Instinct's share links): the
requesting hospital publishes a link, the outside clinic uploads, and both sides see status.
rVetLink's "guest electronic referral form" confirms the no-password upload link is normal
practice, not a shortcut.

Those products all serve specialists *receiving* referrals. Nobody has built the GP-side
version — getting the previous vet's records before a routine visit. For a mobile practice
where the doctor arrives in a driveway with no chart, that gap is the opportunity.

## Constraints discovered up front

**`records@vetatyourdoor.com` is an alias of `info@`, not a separate mailbox.** Domain-wide
delegation impersonates a *user account*, and an alias isn't one, so `records@` can never be
delegated on its own. It doesn't need to be: mail sent to `records@` lands in the `info@`
mailbox, which the server already reads, and the existing `users.watch` → Pub/Sub → history
sync on `info@` already fires for those messages. A Gmail filter already labels `to:records@`
as **Records**, so the server-side query is `label:Records`. No new Google Admin
configuration is required.

**Caveat on how `info@` is authenticated.** The service-account path exists in code, but the
local environment boots with `Gmail shared-inbox SA NOT configured — info@/field@ will require
OAuth`. Background access still works (the watch starts, and
`getOAuthClientForGrantedMailbox` falls back to any stored refresh token for that address),
but an OAuth grant can be revoked when the granting user changes their password or removes
app access, whereas a service account cannot. Confirm `GMAIL_SERVICE_ACCOUNT_*` is set in
production before Phase 3 depends on unattended `info@` reads.

**Outbound must set `Reply-To: records@`.** SES sends with `From: records@vetatyourdoor.com`,
but the hospital's PIMS reply follows Reply-To. Getting this wrong silently breaks the whole
inbound loop.

`vetatyourdoor.com` is verified in SES as a **domain** identity with sending enabled
(`aws sesv2 list-email-identities`), so `records@` sends with no further AWS setup — no
per-address verification needed. Note `SesMailService` defaults to `SES_FROM`
(`Vet At Your Door <info@vetatyourdoor.com>`) and `SES_REPLY_TO` (`support@`), so the records
sender must pass `from` and `replyTo` explicitly rather than relying on those defaults.

**Scout cannot attach a file to a patient chart today.** `chart_documents` is populated only
by eVet import and the euthanasia consent PDF writer. `BriefRecordReview` extracts text, saves
an AI summary as a note, and discards the original PDF. This missing upload endpoint is the
foundation everything else writes through.

**Client authorization is not a Maine legal requirement.** The Maine Veterinary Practice Act
(32 M.R.S. ch. 71-A) requires maintaining records but prescribes no release procedure between
veterinarians; 22 M.R.S. §1711-B's written-authorization rule applies to human health care
practitioners. Consent is an AVMA professional standard, not a Maine statute. So the UI uses a
self-attested checkbox — "Client has authorized us to request records from this practice" —
recorded with staff name and date and quoted in the request email. Not a hard block.

## Data model

**`outside_hospital`** — the directory of other practices.
`practiceId`, `name`, `email`, `phone`, `address`, `notes`, `isActive`,
`created`, `createdByEmployeeId`.
Maintained in Settings, importable from XLS/CSV, and creatable inline from both the
request modal and the records table.

**`records_request`** — one row per hospital asked, not per appointment. Per-row status is
what makes the partial "some received, some pending" state expressible; a column on
`appointments` cannot represent it. Modeled on `consent_invite`.
`practiceId`, `appointmentId`, `patientId`, `clientId`,
`outsideHospitalId` (nullable) or `freeTextHospital`,
`status` (`pending` | `received` | `declined` | `cancelled`),
`requestedAt`, `requestedByEmployeeId` (null when system), `source` (`staff` |
`appointment_request` | `system`), `authorizationAttestedAt`,
`authorizationAttestedByEmployeeId`, `receivedAt`, `receivedByEmployeeId`,
`chartDocumentId`, `notes`.

**`records_request_extraction`** — the AI pass over a received record. Kept separate so
re-running extraction never touches the request row's status.
`recordsRequestId`, `chartDocumentId`, `summary`, `suggestedReminders` (jsonb),
`behaviorFlags` (jsonb), `hospitalsMentioned` (jsonb), `extractedAt`,
`reviewedByEmployeeId`.

## Phase 1

### Step 1 — chart-document upload (the missing primitive) — DONE

`POST /patients/:id/chart-documents` with `FileInterceptor`, writing to the existing
chart-documents S3 bucket and inserting a `chart_documents` row with `pimsType: 'SCOUT'`.
Mirrors how `ConsentService` already writes the euthanasia consent PDF.

`documentTypePimsId: '285'` makes `documentChartLabel()` in
`src/utils/patientChartFromMedicalRecord.ts` render it as **"Previous Medical Records"** with
no frontend change — that mapping already existed. `PimsChartPdfModal` renders the file as-is.

`chart_documents.uploadedByEmployeeId` (migration `1789001370000`) records who uploaded;
EVET-imported rows leave it null.

`BriefRecordReview` now stores the original file on the chart *before* summarizing, so a
failed extraction can no longer lose the record and discarding a bad summary keeps the file.

The `outside-record` prompt leads with **From:** (the originating practice or shelter, read off
the letterhead rather than the file name) and **Reminders / due dates:**, since those are what
staff act on. The prompt forbids deriving a due date from general vaccine knowledge — only from
an interval the record itself states — so Step 6 can promote these to real reminders without
first having to distrust them. Accepting a summary still only writes a Timeline note; nothing
in Phase 1 touches the reminder or vaccine tables.

### Step 2 — hospital directory — DONE

`outside_hospital` (migration `1789001400000`) extends `BaseEntity`, so `isActive` covers
"stopped using them" and `isDeleted` covers "shouldn't be here at all". `GET/POST/PATCH/DELETE
/outside-hospitals` plus `POST /outside-hospitals/import`, on `AuthGuard` like the rest.

Duplicates are stopped in two places that must agree. Postgres holds a partial unique index on
`(practiceId, lower(btrim(name)), lower(coalesce(btrim(email), '')))`, and `dedupeKey()` in the
service additionally folds punctuation and the abbreviations in the practice's own sheet
(`Hosp`→`Hospital`, `Vet`→`Veterinary`, `Mem`→`Memorial`). The service key is deliberately
*looser* than the index: anything the index rejects the service has already caught, so an
import reports a skip instead of a 500. `outsideHospitalImport.ts` mirrors the same key on the
client so the preview's skip count matches what the server will do.

`SettingsOutsideHospitals` sits on Settings → Practice under the euthanasia card, with search,
show-inactive, inline edit, deactivate, and remove. `OutsideHospitalForm` is split out as its
own component because Steps 4 and 5 both need to add a hospital inline.

Import takes a **paste** as well as a CSV drop. Copying cells out of Google Sheets or Excel
yields TSV, which is the same parse — so the practice's existing sheet needs no "save as" step,
and no spreadsheet dependency was added. The parser is RFC4180-ish (quoted fields may contain
delimiters and newlines), sniffs tab/comma/semicolon, and matches header synonyms; with no
recognizable header it falls back to the sheet's own column order (name, address, phone, email,
notes). Preview flags per row: missing name and already-in-directory block the row, a malformed
address is dropped with a warning, and **no email at all** is called out, since that is exactly
the row that can't be emailed in Phase 2.

### Step 3 — request tracking and the calendar badge — DONE

Entity, `POST /records-requests`, `PATCH /records-requests/:id`, and a batch
`GET /records-requests/statuses?appointmentIds=`.

The batch shape is deliberate — it copies how Room Loader and euthanasia consent statuses
load, so it slots into `loadRange()` in `Scheduler.tsx` next to
`loadEuthanasiaConsentStatuses()` without touching the cached `GET /appointments/range`
payload or its invalidation.

Badge renders in the existing `scheduler-appt-card-icons-tr` corner alongside RL and EC.
No rows → no badge. All pending → yellow. Mixed → purple. All received → green.

### Step 4 — Request Records modal — DONE

`{ kind: 'recordsRequest' }` in `SchedulerContextMenu.tsx` under the Forms group, opening
`SchedulerRecordsRequestModal`. Multi-select from the directory, free-text entry, inline
add-hospital via the shared `OutsideHospitalForm`, and the authorization checkbox.

Hospitals already asked for this patient are filtered out of the picker and listed under
"Already asked" with resend / mark received / cancel.

Built but not wired: the appointment staff-note line via `appendStaffNoteLine`. The modal
history panel covers the same need for now.

### Step 5 — CL records table — DONE

`records` tab in `SCHEDULING_TOOL_WORKFLOW_TABS` next to Booked, page registered in
`scheduling-tools-tabs.tsx`; routing wires itself through `getSchedulingToolsTabPages()`.

Two nav badges: grey for open requests, red for any still open with the visit three days out
or closer. Urgency is deliberately keyed to the **appointment date, not how long we have
waited** — a request sent yesterday for a visit on Friday matters more than one sent a month
ago for a visit in October. Shared rule in `src/utils/recordsRequestUrgency.ts` so the page and
the nav badge cannot disagree.

A red row expands a nudge strip with the two things the CL would do next: **Resend records
request** (disabled when we hold no email) and **Call {hospital}** as a `tel:` link. Phone
comes from the directory via `h.phone AS "hospitalPhone"` on the list join; all 59 directory
entries currently have one.

Every pending row also has a **Gmail** button that opens `RecordsEmailLookup` inline — see
Phase 3.

The calendar's **RR** badge follows the same rule: yellow while waiting, purple for partial,
green once everything is back, and **red** whenever records are still out and the visit is
within `RECORDS_URGENT_DAYS_BEFORE_VISIT`. The scheduler context-menu group holding it is
**Visit Prep** (formerly Forms).

That menu item renames itself the way Room Loader's does — "Request records" becomes "Re-send
records request" once something is outstanding — via `schedulerRecordsRequestMenuLabel`. Under
it sit **Call {hospital}** (an OpenPhone/Quo deep link through `buildPhoneDialHref`, dialling
from the practice line rather than the visit doctor's, since this is the records desk calling)
and **Email {hospital}** when we hold no phone number. Those rows are driven by
`pendingContacts` on the statuses endpoint, which now returns one entry per still-outstanding
hospital alongside the badge status.

`GET /records-requests` returns a flattened row (patient, client, visit date, hospital,
requester) built by one query builder join rather than entity relations, so the table renders
without fanning out into per-row lookups.

Row actions: resend, mark received, cancel, reopen, and a per-row file picker that files a
faxed or posted document through the Step 1 staff upload endpoint and flips the status.

Not built: the inline document viewer and Step 6 enrichment in an expanded row.

### Step 6 — AI enrichment — PARTIALLY DONE

Done: records arriving through the public link (or filed by staff from the records table)
are summarized automatically. Text extraction moved server-side into
`src/recordsRequests/extract-record-text.ts` using `unpdf` — a WASM pdfjs build with no
native dependencies, unlike the `canvas` a page-rendering port would have needed.

The summary is persisted the same way a staff Accept persists one: a finalized Scout chart
note next to the PDF, so both routes land in the same place on the timeline. It runs
detached from the upload response — the hospital shouldn't wait tens of seconds, and a
summary failure must never lose a record already filed. A note is always written, even on
failure, so the CL sees something rather than silence.

`ScribeStructuringService` is now exported from `ScribeModule` so `RecordsRequestModule` can
inject it directly rather than going through the JWT-guarded HTTP endpoint.

Known gap: scanned PDFs with no text layer. Extraction reports `kind: 'scanned'` and the note
says to open the PDF by hand. Closing that needs either OCR or server-side page rendering to
images for the vision model.

Still open: structured JSON instead of a plain string — suggested reminders that can be
accepted into real reminders, and aggression flags mapped to a patient alert field.

`POST /scribe/extract-outside-record` returning structured JSON rather than the plain string
`summarizeChartText` returns today: summary, suggested reminders (vaccine plus due date),
behavior and aggression flags, and other hospitals mentioned in the record — the last of which
feeds back into "who else should we ask."

Text extraction currently lives client-side in `src/utils/extractUploadText.ts`. Records
arriving by public link or Gmail attachment never touch a browser, so extraction moves
server-side in this step rather than being duplicated later.

Open: whether accepting a suggested reminder can write a real reminder depends on how
reminders are created, and whether aggression flags map to an existing patient alert field.
Both need checking before this step.

## Phase 2 — close the loop — DONE except the client-facing form

Public tokenized upload page at `/records/upload?token=`, copying the `consent_invite` token
pattern (32 hex chars, 30-day expiry, `@Public()` GET and POST, path registered in
`publicClientLinkPaths.ts`). The token lives on the `records_request` row itself rather than a
separate invite table, so an upload can only ever file against the request it was issued for.

`POST /public/records-request/upload` runs the same S3 + `chartDocumentService.createUpload()`
path as the staff upload, tagged `documentTypePimsId = 285` (Previous Medical Records) with
`uploadedByEmployeeId: null`, then flips the request to received — which flips the badge.
The page also offers "We have no records for this patient", which sets status `declined` so
the CL stops chasing it.

SES sends from `records@vetatyourdoor.com` with `Reply-To: records@` explicitly set, since
`SesMailService` defaults to `info@` / `support@` and the Phase 3 inbound loop depends on
replies landing at `records@`.

### Client-facing hospital picker — DONE

`OutsideHospitalPicker` replaces the two free-text textareas on the appointment request form:
`previousVeterinaryPractices` and `previousVeterinaryHospitals` (existing client, behind the
"care elsewhere?" Yes). Searchable, multi-select, with an "Add … — not in our list" fallback
so an unlisted hospital is still captured.

**Each hospital carries the pets it saw** (`petIds`). One practice that saw three pets stays
one entry, so the CL sends one email rather than three. With a single pet the question is
skipped and the pet assigned silently; with several, all start checked, since the household
going to the same ER together is the common case and unchecking is less work.

That mapping forced a step move for new clients. Previous practices used to be asked on the
intro step, but no pet has a name there, so the whole question now lives at the end of
`new-client-pet-info` once every pet is entered. Existing clients keep it in place — their
pets come from the chart via `selectedPetIds`.

**We state rather than ask.** The "May we ask for records from the above hospitals?" Yes/No is
gone; the form now says "We will contact the practice(s) listed above to obtain your pet's
prior medical records" to new and existing clients alike, and `okayToContactPreviousVets` is
recorded as `Yes` on submit. Staff detail rows for `mayWeAskForRecords` are conditional, so
older submissions keep theirs and newer ones simply omit the row.

### Automatic request on submission — DONE

Submitting the form now raises and sends the records requests itself, for new and existing
clients alike. Records take days to come back, so waiting for a CL to read the request is
often the difference between having history at the visit and not.

This works because `ensureScoutHouseholdFromRequest` already creates real `clients` and
`patients` rows *before* `requestData` is saved, stamping `dbId` onto each pet. So by the time
`raiseRecordsRequestsFromSubmission` runs there is a real `patients.id` to file against, even
for a brand-new client. Pet ids on the form are UI keys (PIMS id for chart pets, a generated id
for new ones), so `recordsRequestTargetsFromRequest` resolves them through those stamped pets.

Consent is an **opt-out**, not a permission question: the form explains why history matters and
offers "Please hold off — I would rather you did not contact these practices for now."
`optOutOfRecordsRequest` suppresses the whole thing. The default that helps the pet is the one
that takes no effort.

Safety rails, because this sends mail unattended from an unauthenticated form:

- `AUTO_REQUEST_MAX_HOSPITALS = 6` per submission bounds what one bad submission can send.
- Any hospital already asked about that patient is skipped, so nobody gets asked twice.
- A hospital with no email still gets a row — it lands on the CL's list as a phone call.
- The whole thing is wrapped: a records failure can never fail a submission.
- Lower environments still route through `SURVEY_TEST_EMAIL`.

**One email per hospital, however many pets it saw.** `sendGroupedRequestEmail` lists each pet
with its own upload link, since a returned PDF files against one chart, but the practice should
not get three near-identical emails about one family on the same day.

Requests raised here have no `appointmentId` — the visit is booked afterwards. Both booking
paths (`bookAppointmentRequestSubmission` for staff, `linkSubmissionToBookedAppointment` for
auto-book) call `attachAppointment` to backfill it, otherwise they would never badge the
calendar and never gain the three-days-out urgency, since both key off the visit date.

Known imprecision: for a multi-pet household the backfill points every pet's request at the
first booked appointment, so the badge lands on one visit rather than each.

### Records milestones on the appointment request — DONE

`logToSubmission` appends timestamped lines to `appointment_request_submission.notes` — the
staff notes field — reusing the existing `appendStaffNoteLine` helper. Requested, re-sent,
received, declined, and cancelled all log, whether they came from the form, the calendar, or
the records table. The submission is found by id when known, else by `bookedAppointmentId`.
Best-effort: a note that fails to save never fails the records work.

Backed by `GET /public/outside-hospitals?practiceId=&q=` — a new `@Public()` controller that
returns **name and address only**. The directory's emails and phone numbers stay behind auth;
an unauthenticated endpoint handing them out is a scraping target.

Submission stays backward compatible. The picker writes both the joined string into the
existing key *and* a parallel `…Picked` array of `{ outsideHospitalId?, name }`. Every staff
screen, notification email, and PDF that reads the string keeps working untouched, while the
ids are there for raising `records_request` rows straight off a submission later.

## Phase 3 — inbound Gmail matching

### On-demand lookup — DONE

`RecordsEmailLookup`, opened from the Gmail button on any pending row, searches the shared
inbox for mail that might be this patient's records and lists candidates with their
attachments and a deep link into the inbox. Read-only by design: it surfaces, the CL decides.
Nothing is filed automatically, because a wrong auto-match puts another animal's history on a
chart.

The query ORs patient name, client surname, and hospital name across all mail rather than
requiring all three or restricting to `label:Records` — outside practices often reply to a
person rather than to `records@`, and requiring every term misses records filed under just the
pet. Mailbox is whatever `defaultSharedMailbox` resolves to, normally `info@`.

There is **no local table of inbound messages** — `gmail-history-sync` only advances a history
cursor — so this has to hit the Gmail API live.

### Automatic queue — still open

On the existing `info@` history sync, scan `label:Records` for messages with attachments and
score candidates against open requests by sender domain (against the hospital directory),
patient name, and client surname. Drop them into a review queue.

Staff confirm before anything reaches a chart — never auto-import. Confirming imports the
attachment through the Step 1 endpoint and flips the request status, which flips the badge.

## What is left

Roughly in the order the pain shows up:

1. **Scanned PDFs get no summary.** Extraction returns `kind: 'scanned'` for a PDF with no text
   layer and the note tells the CL to open it by hand. Every other route now auto-summarizes,
   so this is the one hole in the loop. Needs OCR or server-side page rendering to images for
   the vision model. Worth waiting to see how many real hospitals send scans before paying for
   it.
2. **Step 6 — structured summaries.** `summarizeChartText` returns prose. Returning JSON would
   let suggested reminders become real reminders, aggression flags become a patient alert, and
   "other hospitals mentioned" feed straight back into a records request instead of being read
   by a human. Blocked on checking how reminders are created and whether an alert field exists.
3. **Phase 3 automatic Gmail queue.** The on-demand lookup exists; the unattended version that
   scans `label:Records` on the `info@` history sync and scores candidates into a review queue
   does not. Staff must still confirm before anything reaches a chart.
4. **Per-pet appointment linking.** The booking backfill points a whole household's requests at
   the first booked appointment. Fine for one pet, imprecise for three.
5. **Client-visible status.** The client portal does not show whether their old practice has
   sent records. It would cut "did you get them yet?" calls.

## Prior art referenced

- Appointment-scoped magic link: `consent_invite` / `ConsentService.sendEuthanasiaInvite()`
- Batch per-appointment status for calendar badges: euthanasia consent statuses, Room Loader
- Chart document write from Scout: `ConsentService` euthanasia PDF path
- Context menu action plus modal: `SchedulerEuthanasiaConsentModal`
- Task with entity links: `MailOrderService.createApprovalTask()`
