# OSV-06. Take a phone order

- **Audience:** CLs and the mail order team.
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-05.
- **The one thing to remember:** a phone order is a bill with the item on it, sent by **Mail order**, then paid, so nothing is filled before it's paid.

## Status

**Ready for a dry run.** Owner (Nov 7, Q1): CLs take phone orders on a direct invoice with **Mail order**. B1 is fixed (vayd-enterprise-manager `511d26f`): **Add to mail queue** from a direct invoice was walked live as Jordan Pike (tech) and created the mail order.

## Why (opening)

"When a family calls to order a refill, you put it on a bill and send it to the mail queue. Then it's packed only after it's paid."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maria's client page, **Financial** | Click **New invoice** | "Maria calls for joint chews. Start a bill on her Financial tab." | Riveras |
| 2 | Open invoice | Type in **Add a charge for Juniper** and pick **Joint support chews (60 ct)** | "Add the item." | Joint support chews, $36 |
| 3 | Invoice line | Point at the one thing to remember | "A phone order is a bill with the item on it, sent by Mail order, then paid." | — |
| 4 | Invoice line | Click **Mail order** (next to **Dispense at visit**) | "Choose Mail order." | — |
| 5 | **Send to mail queue** | Choose **Shipping — $4.99**, keep **Take payment now** | "Ship it, and take payment now." | — |
| 6 | Send to mail queue | Click **Add to mail queue** | "Add it to the queue." | — |
| 7 | Invoice | Charge **Card on file** (INV-03), or click **Text pay link** | "Then charge her saved card, or text her a pay link." | Maria's saved card |
| 8 | Invoice | Point at the line's status | "Once it's paid, the mail team fills it." | — |

## What else you can do here

- **Pick up at Brunswick Office** or **Biddeford Office**.
- **Email pay link** / **Text pay link** on the Ledger.

## What other roles see

- **Mail order team:** **New mail order** in the queue is for "ashes and other packages that are not a pharmacy fill". It skips approval, fill and the second check, so it's never used for medicine.
- **CLs and doctors:** opening Pharmacy → Mail Orders sends them to Pharmacy → counts. They have no queue access.

## Closing

"The most common mistakes: using New mail order for medicine, and promising a ship date before the payment goes through. Remember: a phone order is a bill with the item on it, sent by Mail order, then paid."

## Notes from the check in the app (Nov 7, 2026)

- **Walked through step 6** after the B1 fix: **Add to mail queue** with **Shipping — $4.99** created the mail order. Walk step 7 (charge or text a pay link) in the dry run as Casey Morgan (CL).
- **New mail order** was opened as Riley Brooks: Client, Patient, "Package info (e.g. Ashes — small urn for Maple)", **Add to queue**.
- **As Casey Morgan (CL):** Pharmacy → Mail Order Queue redirected to Pharmacy → counts.
