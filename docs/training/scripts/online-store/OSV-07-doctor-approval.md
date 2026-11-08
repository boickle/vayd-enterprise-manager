# OSV-07. Approve, send back or decline a prescription mail order

- **Audience:** doctors (and lead techs, who can also approve).
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-05.
- **The one thing to remember:** nothing prescription ships until a doctor approves it, on the approval task.

## Status

**Ready for a dry run.** B3 is fixed (vayd-api `2a2efb9f`). The lower-quantity step (step 9) is new (owner, Nov 7) and ships with the next push to build-doctor-flow. Walked live on Nov 8: Robin sent the task, Dr. Lane approved 1 of 3 thyroid bottles, and Scout refunded $76.00 (2 × $38) in Stripe test mode.

## Why (opening)

"When a family orders a prescription and there's no refill left, a doctor decides. That decision happens on a task, not in the mail queue."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Mail Order Queue**, Robin | Click **Needs approval**, then order **#… Maria Rivera · Juniper · Thyroid tablets 0.4 mg (90 ct) × 3** (**✓ Paid**, **Needs approval**) | "Maria ordered Juniper's thyroid tablets. There are no refills left, so it needs a doctor." | Juniper's thyroid Rx with 0 refills; Maria orders **3** bottles from the store |
| 2 | Order | Point at "Approval decisions live on the assigned task, not here." | "The queue doesn't approve it. It sends a task." | — |
| 3 | Order | Choose **Avery Lane** in **Send to** | "Choose the doctor." | — |
| 4 | Order | Click **Send task** | "Send the task." | — |
| 5 | Dr. Lane's **Tasks** (**Active (1)**) | Open **Approve mail order #… — Juniper** (**APPROVAL PENDING**) | "Dr. Lane opens the task." | — |
| 6 | Task | Point at the one thing to remember | "Nothing prescription ships until a doctor approves it, here on the task." | — |
| 7 | Task | Point at "Thyroid tablets 0.4 mg (90 ct) × 3 · One-time fill · 0 refills remaining on the prior Rx", then click **Summarize Case** | "What's ordered, and a short summary of Juniper's record." | Juniper's chart |
| 8 | Task | Check **Directions** (filled from the last script: "Give one tablet by mouth twice daily."), **Acute or chronic**, **Refill expiration**, **Refills** | "Check the directions, and set refills if it's ongoing." | — |
| 9 | Task | In **Quantity to approve**, change 3 to **1**. Point at "Lower it if fewer are right; Scout refunds the difference to the family. For more, they place a new order." | "Juniper's recheck is due, so I'll approve one bottle now. Scout refunds the other two to Maria's card. You can lower the quantity, never raise it." | — |
| 10 | Task | Click **Approve** | "Approve sends it to the mail team to fill." | — |
| 11 | Mail Order Queue, Robin (optional) | Open the order: the line now reads **× 1**, and the activity says "Doctor approved 1 of 3 Thyroid tablets 0.4 mg (90 ct): Stripe refund $76.00" | "The refund is noted on the order." | — |
| 12 | Task | Point at **Send back** and the reject note ("Required when you reject") | "Or send it back for changes, or decline it with a note." | — |

## What else you can do here

- **Approve here…** in the queue lets a manager approve with a reason (the task shows why it was closed).
- **Re-send…** a task to someone else.
- **Lower the quantity** only on online store orders. On an order that came from a visit or a direct invoice, change the quantity on that bill, then approve. To approve more than the family ordered, they place a new order.
- **The refund for a lower quantity** is the item price × the units taken off, plus the sales tax on them, the same as rejecting an item (owner, Nov 8). The demo thyroid tablets aren't taxed, so the demo refund is $76.00. Scout records the refunded units as a return on the order's bill, so they come off the Sales & Tax report.

## What other roles see

- **Mail order team:** the line shows **Waiting on doctor**, then **Approved**.
- **CLs and doctors** can't open the Mail Order Queue; doctors work from the task.

## Closing

"The most common mistakes: approving without writing directions, and approving in the queue instead of on the task. Remember: nothing prescription ships until a doctor approves it, on the approval task."

## Notes from the check in the app (Nov 7 and 8, 2026)

- **Nov 8, lower quantity:** Quantity to approve 1 of 3 → reply 201, line × 1, order total $42.99, activity note "Doctor approved 1 of 3 … Stripe refund $76.00". Probe: `probes-osv/osv-qtycheck.cy.ts`.

- **Walked:** Maria's store order for Juniper's thyroid tablets (no refills) arrived as **Needs approval**, with **✓ Paid**, "No doctor on script", **Send task** (disabled until **Send to** is chosen) and **Approve here…**.
- **B3 was the cause, now fixed:** staff logins carry no office ids, so a task sent by a staff member failed Scout's task office check and the error was hidden. Every staff-sent approval task failed this way (Send task, staff mail from a visit, auto-ship changes). Now the task is created as the system, and if it ever fails the sender sees why.
- **Walked after the fix:** Send task (201), Dr. Lane's **Active (1)**, and the task screen labels in steps 5, 7 and 8.
- **Q2 done (vayd-api `ef3621f6`):** inventory managers no longer approve prescription mail orders.
- **Demo data:** the **Doctor** picker shows "Avery Lane" twice (a blank default option labelled with her name, then her real entry), and **Send to** lists dozens of leftover test staff. Clean these up in the demo setup before recording (review file, section 4).
