# Vet At Your Door — telephony API requirements for Schultz

**To:** Schultz Technology  
**From:** Vet At Your Door  
**Re:** APIs needed to replace our current phone/SMS provider (Quo / OpenPhone)

We are planning to move our practice phone and texting from Quo (OpenPhone) to Schultz (ClearVoice / ClearText). Our staff application already sends texts, shows message history, tracks delivery failures, reports on calls, and coaches receptionists from call transcripts.

This document lists the Schultz APIs and webhooks we need so that product can work the same way after the switch. We can integrate in phases: **texting first**, then **call analytics and coaching**.

Please confirm which of these you already support, share API docs and sandbox credentials where available, and note anything that would require a custom build.

Our webhook endpoints (already reserved on our API):

- `POST https://<our-api-host>/webhooks/schultz/message`
- `POST https://<our-api-host>/webhooks/schultz/call`

---

## Must have — texting (staff outreach, reminders, client history)

These are required for day-to-day operations. Without them we cannot send client texts from our app.

### 1. Send SMS

A REST endpoint to send a text message.

We need to:

- Send to one US mobile number (E.164, e.g. `+12075551212`)
- Send **from a specific Schultz number we own** (doctor line, reminders line, or main practice line)
- Receive a **stable message ID** in the response
- Receive a **clear error** when the recipient has opted out of SMS

Typical body length: up to ~1,600 characters.

**Optional but important:** a way to mark the conversation as done / archived after an automated send (appointment reminders, health reminders). Without this, automated traffic will clutter the shared inbox.

### 2. List SMS history

A REST endpoint to retrieve messages involving a client’s phone number.

We need to:

- Look up by client phone (E.164)
- Search across **all of our Schultz numbers**, not only one line
- Filter by date (we typically load the last 6 months)
- Paginate results

Each message should include:

- Message ID  
- Body  
- From and to (E.164)  
- Direction (inbound / outbound)  
- Status  
- Created timestamp (ISO 8601)

### 3. Delivery status webhooks

HTTP POST to our ` /webhooks/schultz/message` URL when an outbound text is delivered or fails.

The payload must include:

- The **same message ID** returned from Send SMS  
- Outcome: delivered vs failed  
- Failure reason when failed (landline, undeliverable, carrier rejection, etc.)

We use this to alert staff when a text did not go through.

### 4. List our phone numbers

A REST endpoint that returns every Schultz number on our account.

Each number should include:

- Stable line ID  
- E.164 number  
- Display label (e.g. “Dr. Smith”, “Reminders”, “Main”)

We assign doctors and tools to specific from-lines. Staff texts should continue to come from the correct number after the switch.

---

## Should have — inbox and click-to-call

### 5. Archive / close conversation after send

As noted in Send SMS: a parameter or follow-up API to mark a thread done after reminder and outreach sends.

### 6. Click-to-call and click-to-text URLs

Our scheduler has Call and Text buttons. Today those open the Quo app with the client number and the doctor’s from-line.

Please provide:

- A URL or app scheme to start a call to a number, preferably specifying which of our lines to call from  
- A URL or app scheme to open an SMS thread the same way  

If you do not have this, we can fall back to standard `tel:` and `sms:` links, but those cannot force the correct from-line.

---

## Full parity — call analytics, staffing, and coaching

These match reporting and coaching we have with Quo. Texting can go live without them; call dashboards, Client Liaison scorecards, and CSR coaching cannot.

### 7. List users (staff)

A REST endpoint of Schultz users on our account.

Each user should include:

- Stable user ID  
- Email address  

We match email to our employee records so calls and texts can be attributed to the right person.

### 8. Call event webhooks (and/or list-calls API)

HTTP POST to `/webhooks/schultz/call` as calls progress, **or** a REST API to list calls for a date range. Webhooks are preferred so dashboards stay current.

Each call should include:

- Call ID  
- Our line ID and E.164  
- Other party / participants  
- Direction (inbound / outbound)  
- Status, including **missed / no-answer / abandoned**  
- Created, answered, and completed timestamps  
- Duration in seconds  
- Staff user ID for who answered (inbound) and who placed the call (outbound)

We use this for:

- Inbound, outbound, and missed call totals  
- Missed during vs outside business hours  
- Per-line and per-employee breakdowns  
- Staff performance scoring that includes answered inbound, outbound, and missed in-hours calls

### 9. Call transcripts

A webhook or REST API that provides a **voice transcript** after a call completes.

We need:

- Call ID (same as the call event)  
- Speaker-labeled dialogue (staff vs caller)  
- Duration  

We send transcripts to our coaching pipeline so managers can review receptionist calls.

### 10. Inbound / outbound SMS events for reporting

In addition to delivery webhooks for messages **we** send, we need events (or list APIs) for **all** SMS on our numbers — including inbound client texts — with direction, line, staff user, and timestamps. That keeps SMS volume on the same dashboards as calls.

---

## Suggested rollout

| Phase | What we need from Schultz | What it unlocks for us |
| --- | --- | --- |
| 1 | Items 1–4 (send, history, delivery webhooks, number list) | Reminders, outreach, compose, message history, failed-text alerts |
| 2 | Items 5–6 (archive, click-to-call URLs) | Cleaner inbox, Call/Text buttons with the right from-line |
| 3 | Items 7–10 (users, call webhooks, transcripts, SMS events) | Call analytics, performance scorecards, CSR coaching |

---

## Technical notes

- **Authentication:** an API key (or equivalent) we can store server-side. Please document header format (Bearer vs raw key, etc.).
- **Phone numbers:** E.164 (`+1…`) on all APIs and webhooks.
- **Retries:** we will return HTTP 200 from webhook URLs as soon as we accept the payload. Please retry on 5xx with backoff.
- **Idempotency:** the same call ID or message ID may be posted more than once; we will upsert on that ID.
- **Sandbox:** a test account and a few test numbers would let us integrate before cutover. We will keep Quo running until Schultz texting is verified.
- **Documentation:** OpenAPI/Swagger or equivalent, plus example JSON for send, list, and each webhook type, would speed this up.

---

## Questions for Schultz

1. Which of the items above are available today vs. would need custom work?  
2. Is there public or partner API documentation for ClearText / ClearVoice?  
3. Can you POST webhooks to customer HTTPS URLs, including a signing secret we can verify?  
4. Can one account have many numbers (main, reminders, per-doctor) and send from a chosen number on each request?  
5. Do you support 10DLC / A2P for application-originated SMS at the volumes of appointment reminders plus staff outreach?  
6. What is the click-to-call / click-to-text story for desktop and mobile?  
7. Are call recording and transcription included, and can transcripts be delivered by webhook?

Thank you. We are happy to jump on a call and walk through example payloads from our current provider if that helps map fields.

Vet At Your Door
