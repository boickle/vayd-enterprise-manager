# ROLE-05. What a Client Liaison and a Lead Client Liaison see

- **Audience:** managers.
- **Length:** 2 to 3 minutes.
- **Watch first:** PERM-01.
- **The one thing to remember:** client liaisons book, check out and take payments. Voids, account credits, membership cancellations and bank deposits belong to the lead client liaison.

## Why (opening)

"Client liaisons are the front desk: booking, checking out and taking payments. Anything that reverses money or a membership goes to the lead."

## Steps

Part 1 logged in as **Lou Bennett** (Client Liaison). Part 2 as **Dana Cole** (Lead Client Liaison).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home (Lou Bennett) | Point at the top bar: **Home, Scheduling, Catalog, Pharmacy, Labs, Tasks, Settings** | "This is Lou, a client liaison." | perm-seed.ts |
| 2 | Voice-over | — | "The one thing to remember: CLs book, check out and take payments. Voids, credits, membership cancellations and bank deposits belong to the lead CL." | — |
| 3 | Home | Point at the left panel: **+ Appointment, + New Client, Send Room Loader, + Forward Booking**, and no **Create deposit** | "Booking and new clients are right here. There's no Create deposit." | — |
| 4 | Clients → Tom Chen, financial tab | Point at the paid bill's payment, with no **Void** | "Lou sees the payment, but there's no Void." (Pay-link buttons show only when a balance is due.) | Paid $75 cash bill on the Chens |
| 5 | Home | Click **Analytics** | "Analytics…" | — |
| 6 | Analytics | Point at the tabs: **Appointments, Communication, Memberships, Patients** | "…shows appointments, communication and membership reports. No payments." | — |
| 7 | Home (Dana Cole) | Point at **Create deposit** in the left panel | "Now Dana, our lead CL. She has Create deposit." | — |
| 8 | Clients → Tom Chen, financial tab | Point at **Void** on the payment, **Void invoice** and **Add credit** | "On the same bill she can void the payment, void the invoice, or add account credit." | — |
| 9 | Analytics | Point at **Financial** with the payments report | "Her Analytics adds the payments report." | — |
| 10 | Voice-over | — | "A lead CL can also cancel or change a membership, issue gift cards, reopen an invoice, and manage message templates and CL seats in Settings." | — |

## What they can't do

- **Plain CL:** bank deposits ("Bank deposits isn't part of your access"), voids, credits, membership cancellations, the payments report.
- **Both:** Marketing ("You do not have permission to: See Marketing…").

## Notes to check before recording

- **Owner decision Nov 9:** plain CLs do not create bank deposits (deposit.create reverted to D3).
- Fixed Nov 9 (RP-A17): the refusal now says "Ask a practice admin if you need it — they can add it on your Access tab in Settings → Staff."

## Closing

"The most common mistake is giving a CL the lead role just to void one payment. Ask the lead CL, or grant one permission for a set time (PERM-06). Remember: CLs book, check out and take payments; reversing money or memberships belongs to the lead."
