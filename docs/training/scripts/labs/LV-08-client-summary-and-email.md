# LV-08. Client summary and emailing results

- **Audience:** doctors (approve); techs and CLs (send).
- **Length:** 3 minutes.
- **Watch first:** LV-06.
- **The one thing to remember:** a doctor reads, finishes and approves the summary before it goes out. If an email button is grey, the line under it says why.

## Why (opening)

"Families want to know what the numbers mean. Scout drafts a plain-language summary, but a doctor always approves the words."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's CBC result | Point at "Reviewed … by Dr. Avery Lane" | "Juniper's CBC is final and reviewed." | From LV-06; logged in as Dr. Avery Lane; Maria Rivera's email is an example.com address |
| 2 | Result | Point at "Email lab summary & report: Write and approve a client summary first." | "The email button is grey, and Scout says why." | — |
| 3 | Result | Click **Draft client summary** | "Click Draft client summary." | AI draft allowed on the test stack (owner, Nov 8) |
| 4 | **Client summary** | Point at **Draft, not approved** and "Dear Maria," | "Scout drafts it from the result and Juniper's chart, to Maria by first name. It's a draft until you approve it." | — |
| 5 | Client summary | Point at "Next steps: [doctor to add]" | "The next steps are yours to write." | — |
| 6 | Client summary | Click **Edit** | "Click Edit." | — |
| 6b | Client summary | Point at "Replace [doctor to add] with your own words before approving." and the grey **Approve wording** | "Scout won't let you approve it with the gap still there." | — |
| 7 | Client summary | Replace "[doctor to add]" with the plan | "Write the next steps, and change anything you'd say differently." | — |
| 8 | Client summary | Click **Approve wording** | "Then Approve wording." | — |
| 9 | Client summary | Point at "Approved … by Dr. Avery Lane" | "Approved, with your name." | — |
| 10 | Client summary | Click **Email lab summary & report**, beside the approved summary | "Once the wording is approved, Email lab summary and report appears right beside it. It sends the summary, with IDEXX's report attached." | — |
| 11 | Email window | Point at **To**, **Subject** and the message | "Check who it's going to, and read it once more." | — |
| 12 | Email window | Click **Send** | "Send." | Captured on the test stack, never sent |
| 13 | Result | Point at **Email lab report** | "Email lab report sends just IDEXX's report with a short note, no summary. It only needs the result reviewed." | — |
| 13b | Result | Click **Medical note**, add a plan line, click **Wrap up** | "Medical note opens on top of the result. Write your read of it. Wrap up puts it on Juniper's chart, and you're still on the result." | — |
| 14 | Voice-over | — | "If IDEXX updates a result after you approved, the summary goes back to needing approval. Draft it again and approve it." | — |

## What else you can do here

- **Draft again** replaces the summary with a new draft.
- **Copy** to paste it into a text.
- For a pet who has died, the email window warns you and uses a gentler subject.

## What other roles see

- A tech approving a summary is asked for a reason (LV-07).
- Techs and CLs can send once a doctor has approved.

## Closing

"The most common mistakes: approving the draft without reading it, and leaving [doctor to add] in. Remember: a doctor reads, finishes and approves the summary before it goes out."

## Notes from the check in the app (Nov 8, 2026)

- **Checked with the fake IDEXX and a real AI draft:** **Draft client summary** gives "Client summary · Draft, not approved" with **Edit** and **Copy**; **Edit** shows **Approve wording**; after approval, "Approved Nov 8, 5:47 PM by …" with **Edit**, **Email** and **Copy**. The reasons for grey buttons are printed under the buttons ("Email lab results: The summary needs approving first.", "Email lab report: Mark the result reviewed first.").
- The email window has **To**, **From**, **Subject**, **Include in patient EMR**, **Put on these patient charts** and the message.
- **Changed from the first draft:** **Approve wording** only appears after **Edit**; the reasons are text under the buttons, not on hover; the draft ends "Next steps: [doctor to add]".
- **Fixed Nov 8 (owner):** Approve wording stays off while "[doctor to add]" (or anything in square brackets) is left; the greeting is always "Dear {first name},"; the email window says "Choose every pet this email is about."
- **Not checked:** clicking Send, and the subject line ("Lab results for …").
