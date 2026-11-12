# OSV-25. Cancel requests

- **Audience:** Mail order team, CLs.
- **Who is on screen:** a CL (on the bill), Riley.
- **Spec:** `cypress/training/osv-25-cancel-requests.cy.ts`; narration `cypress/training/narration/osv-25-cancel-requests.json` (Nova, 1.25x).
- **Demo data:** Juniper’s heartworm chewable from today’s visit, bill paid, already filled.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `n01-why` | Sometimes a client asks to cancel a mail item after the mail team has started. The CL asks; the mail team decides. |
| `n02-bill` | On Juniper's visit bill, the heartworm chewable is already filled in the mail queue. |
| `n03-request` | Click Request cancellation. |
| `n04-reason` | Choose why, |
| `n05-note` | add a note for the mail team, |
| `n06-send` | and send it. |
| `n07-waiting` | The bill shows it's waiting on the mail team. |
| `n08-queue` | In the queue, Cancel requests shows it. Check it first thing. |
| `n09-open` | Open it to see who asked, and why. |
| `n10-choices` | Choose what fits: cancel and refund, cancel without a refund, already shipped, or keep the order. |
| `n11-cancel` | It's filled but not shipped, and the bill was paid, so cancel and refund. |
| `n12-done` | Scout opens the return on the bill. Back on the shelf is ticked, so it goes back into stock. |
| `n12b-shelf` | It was paid in cash, so the refund goes on Maria's account as credit. A card payment would go back to the card. Confirm it. |
| `n12c-refunded` | Returned. The bill now shows the refund. |
| `n13-mistakes` | The most common mistakes: pulling the item off the bill after the mail team started, and leaving cancel requests waiting. |
| `n14-remember` | Remember: once the mail team has started, request the cancellation. The mail team decides, first thing each day. |
