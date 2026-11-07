# SR-24. Request records from the previous vet

- **Audience:** CLs.
- **Length:** 2 minutes.
- **Watch first:** SR-01.
- **The one thing to remember:** request records from the visit as soon as it's booked, and tick the authorization box only when the family has said yes.

## Why (opening)

"Our doctors arrive at the house with no chart from the old vet. Records requested early mean the history is there when we arrive."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home | Right-click Biscuit's visit | "Biscuit is new to us. Tom says his old vet was Maplewood Animal Hospital." | Biscuit Chen booked with Dr. Lane in 2 days. A hospital in the directory (Settings → Practice → Outside Hospitals), or a one-off one. Signed in as Casey Morgan (CL) |
| 2 | Menu | Point at the one thing to remember | "Request records as soon as the visit is booked, and tick authorization only when the family has said yes." | — |
| 3 | Menu | Hover **Visit Prep**, click **Request Records** | "Visit Prep, Request Records." | — |
| 4 | **Request Records** | Point at **WHO SHOULD WE ASK?** and **Search hospitals…** | "Search our directory of practices." | — |
| 5 | Request Records | Type "Maplewood Animal Hospital" in **One-off hospital** and their email in **Their email** | "If they're not in the directory, type the name and their records email." | — |
| 6 | Request Records | Tick "Client has authorized us to request records from this practice." | "Tick this only when the family has said yes. It's saved with your name and today's date." | — |
| 7 | Request Records | Click **Send 1 request** | "Send." | — |
| 8 | Request Records | Point at "Emailed 1 hospital." and **ALREADY ASKED**: "Maplewood Animal Hospital · Asked …" | "Done. It's listed under Already asked." | — |
| 9 | Request Records | Click **Done** | "Done." | — |
| 10 | Calendar | Point at the **RR** badge on Biscuit's card | "The RR badge shows records are on their way: yellow while waiting, green when everything is in." | — |
| 11 | Voice-over | — | "Families who list their old vet on the online form don't need this. Scout sends those requests by itself." | — |

## What else you can do here

- **Resend**, **Mark received** and **Cancel** under **Already asked**.
- **Add a hospital to the directory**, so the next CL can just search for it.
- **Notes (internal only)**.
- Once a request is open, the **Visit Prep** menu adds **Call** or **Email** for that hospital.

## What other roles see

- **Every scheduling role** can request records.

## Closing

"The most common mistakes: waiting until the day before the visit to ask, and ticking authorization without asking the family. Remember: request records from the visit as soon as it's booked, and tick the authorization box only when the family has said yes."

## Notes from the check in the app (Nov 7, 2026)

- **Checked as a CL, end to end.** The email was captured on the training stack: "[TEST] Records request: Biscuit (Tom Chen)", redirected to deirdre@vetatyourdoor.com. The **RR** badge appeared on the card.
- **The window's header says "FORMS"** while the menu group is called **Visit Prep**.
- **The authorization text says** "Not mentioned in the email to the hospital." (The design note in `docs/records-retrieval.md` said it is quoted in the email.) The app is the source of truth here.
- **Demo data:** add Maplewood Animal Hospital to the Outside Hospitals directory, so step 4 shows a search hit.
