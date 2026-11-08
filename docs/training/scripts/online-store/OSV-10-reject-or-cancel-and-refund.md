# OSV-10. Reject or cancel an order, and refund

- **Audience:** mail order manager, practice manager, lead CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-09.
- **The one thing to remember:** refund through the order in Scout, never in the Stripe dashboard, so the order, the auto-ship and the books stay in step.

## Why (opening)

"Sometimes an order can't go out: the doctor declines it, or the family changes their mind. Scout refunds the card, stops any auto-ship, and tells the family, all from the order."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Mail Order Queue**, Robin | Open Maria's heartworm order for Maple (**✓ Approved**, **✓ Paid**) | "Maria asks us to cancel Maple's heartworm order." | Maria's paid heartworm auto-ship order |
| 2 | Order | Point at the one thing to remember | "Refund through the order, never in the Stripe dashboard." | — |
| 3 | Order | Click **Reject + refund + email** | "Reject, refund and email, in one step." | — |
| 4 | **Reject, refund, and email** | Type in **Internal reason (staff only)** | "Say why, for staff." | — |
| 5 | Dialog | Point at the email to Maria | "Maria gets an email." | — |
| 6 | Dialog | Click **Send email** | "Send." | Stripe test mode |
| 7 | Order | Point at **Rejected** and the refund | "The card is refunded in full, and the order's auto-ship stops." | — |
| 8 | **Cancel requests** | Point at the filter | "When a doctor or tech asks to cancel from a visit bill, it lands here." | A cancellation requested from a visit line |

## What else you can do here

- **Reject + refund + text** sends a text instead of an email.
- **Keep the order**: "Keeps the order and creates a task to call the client about a return."
- A **paid guest order** refunds the same way, back to the card it was paid with.

## What other roles see

- **Mail order team:** the buttons show, but a refund needs the manager role (D5).
- **Techs and doctors** ask from the visit line with **Request cancellation**.

## Closing

"The most common mistakes: refunding in the Stripe dashboard, which leaves the order and the auto-ship running, and cancelling without telling the family. Remember: refund through the order in Scout, never in the Stripe dashboard."

## Notes from the check in the app (Nov 7, 2026)

- **Walked to the dialog** as Robin Hale: **Reject + refund + email** opened "Reject, refund, and email" with **Internal reason (staff only)**, **Cancel** and **Send email**.
- **Not confirmed:** **Send email**, which refunds in Stripe test mode. Do it in the dry run, then check the order shows **Rejected**, the refund shows in Stripe test mode, and the auto-ship is cancelled on **Auto-ships**.
- **Not walked:** the **Cancel requests** flow from a visit line (OS-A3). Add a requested cancellation in the setup if it goes in the video.
- **Question Q5:** "Mark paid" is in the D5 role list but isn't in this series. Should it be (managers only)?
