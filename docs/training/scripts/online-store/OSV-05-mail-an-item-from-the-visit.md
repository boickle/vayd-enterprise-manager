# OSV-05. Send an item by mail from the visit checkout

- **Audience:** doctors and techs.
- **Length:** 2 to 3 minutes.
- **Watch first:** INV-01 (charges onto the invoice).
- **The one thing to remember:** in the medicine's line on Checkout, choose **Mail order**, and the mail queue does the rest.

## Why (opening)

"When a family wants a refill mailed instead of handed over, you set it up right on the visit's Checkout panel. Nobody re-types the order."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Juniper's SOAP, **Checkout** panel | Point at **Checkout OPEN** on the right | "We're at checkout for Juniper's visit." | Rivera visit today for Juniper, with a SOAP encounter (Dr. Avery Lane) |
| 2 | Checkout | Point at the one thing to remember | "To mail a medicine, choose Mail order on its line. The mail queue does the rest." | — |
| 3 | Checkout | Type "Heartworm" in **Type here to add a charge…** and pick **Heartworm & flea chewable, 22-44 lb (6 doses)** | "Add the medicine as usual." | Catalog: Heartworm & flea chewable, $89, Rx |
| 4 | Checkout line | Point at the red "Enter the directions (sig)" | "A prescription needs directions first." | — |
| 5 | Checkout line | Click the arrow (tooltip **Enter dose / Rx details**) | "Open the line." | — |
| 6 | Line drawer | Point at **DIRECTIONS (SIG)**, **# REFILLS**, **ACUTE OR CHRONIC**, **DISCARD AFTER** and **Approve** | "The doctor writes the directions and approves the script here." | — |
| 7 | Line drawer | Click **Mail order** (next to **Dispense at visit**) | "Then, instead of Dispense at visit, choose Mail order." | — |
| 8 | **Send to mail queue** | Choose **Shipping — $4.99** under **Shipping / pick-up type** | "Ship it, or pick it up at an office." | Fulfillment options from Settings |
| 9 | Send to mail queue | Point at **Payment**: **Take payment now**, **Doctor approves first, then collect payment**, **Send without payment** | "Usually, take payment now with the rest of the visit." | — |
| 10 | Send to mail queue | Click **Add to mail queue** | "Add it to the queue." | — |
| 11 | Checkout | Point at the **Mail order** tag, the "Shipping — $4.99" line, and the status **Waiting on doctor** | "The line is tagged Mail order, and shipping is on the bill." | — |
| 12 | Checkout | Point at "Mail order: the mail team picks the lot and fill location." | "You don't pick a lot: the mail team fills it." | — |
| 13 | Checkout | Point at **Total $131.97** | "Then check out as usual." | — |

## What else you can do here

- **Pick up at Brunswick Office** or **Biddeford Office** instead of shipping ($0).
- **Request cancellation** from the line once the mail team has started; before that, switch back to **Dispense at visit**.
- **Open this order in the mail queue** from the line's status.

## What other roles see

- The **Mail order** button only shows on prescription-labelled lines. Vaccines and controlled drugs can't be mailed.
- The mail team sees the order as **Staff mail from visit** in the **Mail Order Queue** (OSV-08).

## Closing

"The most common mistakes: dispensing at the visit and then mailing a second one, and picking a lot for a mailed item. Remember: in the medicine's line on Checkout, choose Mail order, and the mail queue does the rest."

## Notes from the check in the app (Nov 7, 2026)

- **Walked** as Jordan Pike (tech) on a visit for Juniper, Stripe test mode: the drawer, **Mail order**, the **Send to mail queue** window, **Add to mail queue**, then the tag, the $4.99 shipping line and **Waiting on doctor · Approval task not sent yet**.
- **Totals:** joint chews $36 + heartworm $89 + shipping $4.99 = $129.99, tax $1.98, **total $131.97**. Only the chews are taxed; **shipping isn't taxed here, but it is in the online store** (question Q3).
- **Bug B1:** the same **Mail order** button on the client's **Financial** tab fails. Choosing any shipping or pickup type gives "Request failed with status code 400" ("Provider is required on invoice line items."), because the shipping line is added without a provider. **Record only from visit checkout until it's fixed.**
- **The status said "Approval task not sent yet"** even though the doctor is in the visit. In the video the doctor clicks **Approve** in the drawer before **Mail order** (not walked; walk it in the dry run). See OSV-07 for the task route.
