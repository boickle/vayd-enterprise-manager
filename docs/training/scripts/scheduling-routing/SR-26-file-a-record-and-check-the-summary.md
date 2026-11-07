# SR-26. File a received record and check the summary

- **Audience:** CLs, techs, doctors and practice managers (anyone can enter a received record; owner, Nov 7, 2026).
- **Length:** 2 to 3 minutes.
- **Watch first:** SR-25.
- **The one thing to remember:** Scout drafts the summary and the reminders, but nothing goes in the medical record until a person checks them against the document and clicks Enter.

## Why (opening)

"Twenty pages from the old vet become a short summary and the right reminders. But a computer wrote the draft, so a person checks it before it goes on the chart."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Scheduling Tools → Records** | Point at Biscuit's row, **Waiting** | "Maplewood faxed Biscuit's records." | Biscuit Chen booked with Dr. Lane; a records request to Maplewood Animal Hospital; the fictional record `cypress/training/setup/maplewood-biscuit-records.pdf`. Signed in as Casey Morgan (CL) |
| 2 | Records | Point at the one thing to remember | "Scout drafts the summary and reminders, but nothing goes in the record until a person checks them and clicks Enter." | — |
| 3 | Row | Click the upload button ("File a document you received") and choose the PDF | "File the document on the request." | — |
| 4 | Records | Point at "Filed maplewood-biscuit-records.pdf on Biscuit's chart. Open Received → Review & summarize to name them and add a summary." | "It's on Biscuit's chart now, and the request moves to Received." | — |
| 5 | Records | Click **Received**, then **Review & summarize** | "Open Received, then Review & summarize." | — |
| 6 | **Review received records · Biscuit** | Point at the document name and **Preview** | "Give the document a clear name, like the hospital and what it is." | — |
| 7 | Review | Click **Save names & summarize records** | "Save names and summarize." | — |
| 8 | **Review previous records · Biscuit** | Point at "Check the summary and reminders against the documents, then enter them in the medical record." | "The draft is ready. The document is beside it." | — |
| 9 | **Reminders** tab | Point at the six reminders: DHPP, Leptospirosis and Bordetella **Overdue**, Rabies 3 yr **Up to date**, Heartworm test, Dental cleaning | "Scout found what's due, with when it was last done." | — |
| 10 | Reminders | Point at Dental cleaning's due date, 04/02/2025 | "Check each date against the record. The record says a cleaning within 12 months of April 2025, so fix the date." | — |
| 11 | Reminders | Change the date to 04/02/2026 | "Fix it here." | — |
| 12 | Click **Review Summary First**, then the **Summary** tab | Point at "Add this summary to the medical record. Goes on the Timeline as 'Previous Medical Records'. Edit as needed." | "Read the summary. Edit anything that's wrong." | — |
| 13 | Summary | Point at the behavior caution (snapped once at an ear exam) | "Make sure warnings like this one made it in. The doctor needs it before the visit." | — |
| 14 | Review | Click **Enter Reminders & Summary in Record** | "Then enter them in the record." | — |
| 15 | **Enter in medical record?** | Point at "This adds the Previous Medical Records summary note, 6 reminders to Biscuit's chart. Reminders show under Upcoming and on the client portal." and click **Enter Reminders & Summary in Record** | "Scout says exactly what it will add, including that the family sees the reminders in their portal. Confirm." | — |
| 16 | Biscuit's chart | Point at the six reminders under Upcoming and the Previous Medical Records note | "They're on Biscuit's chart now." | — |

## What else you can do here

- **Save names only**, to file without summarizing yet.
- **Add a reminder** that was missed. Untick any reminder that's wrong.
- **Link a catalog item (optional)** on a reminder, so it books as the right service.
- **Close out** the request once the summary is in.
- **Open in a new tab** to read the document full size.

## What other roles see

- **Every scheduling role** can file and review. A doctor or tech should check the reminders and summary.

## Closing

"The most common mistakes: entering the reminders without checking the dates, and missing a behavior warning in the summary. Remember: Scout drafts it, a person checks it, and nothing goes in the record until you click Enter."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL** on the training stack with the fictional record: filing, **Review & summarize**, and the review window with 6 reminders and the summary.
- **Entered end to end as Dr. Lane (Nov 7):** the summary note was created and finalized, 6 reminders were added to Biscuit's chart (Dental cleaning, DHPP 1 yr, Leptospirosis 1 yr, Heartworm test, Bordetella intranasal 1 yr, Rabies 3 yr) and the records request was updated.
- **Who can enter:** owner decision Nov 7, 2026: CLs, techs, doctors, practice managers and admins (vayd-api `6a1e8e91`). Before that, only a vet or licensed tech could. Re-check as Casey once frontend `6a4ede2` is pushed and merged into `training/videos`.
- **Reminders reliability (B10) fixed Nov 7 (vayd-api `882ed47f`):** records summaries now run at medium effort, and 10 of 10 test runs returned the full reminders. A summary takes about 10 seconds; wait for it in the video.
- **The dental date varies between runs** (04/02/2025 or 04/30/2025); it always needs fixing. That's the point of step 10.
- **Not walked:** **Close out**.
- **The document preview** on the left of the review window was blank on the test stack. Use **Open in a new tab**, or check the preview on the recording stack.
- **Where things go on the test stack:**
  - **The file** goes to the dev bucket `vayd-chart-documents-local-deirdre`, not production.
  - **The summary** is written by Anthropic ("Jot outside-record summarize … model=claude-sonnet-5-5"); the earlier note about OpenAI was wrong.
  - **The record** is fictional.
