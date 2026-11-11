# OSV-18. Rx and bag labels: how they print and where each goes

- **Audience:** Mail order team.
- **Who is on screen:** Riley.
- **Spec:** `cypress/training/osv-18-labels.cy.ts`; narration `cypress/training/narration/osv-18-labels.json` (Nova, 1.25x).
- **Demo data:** Juniper’s thyroid order, paid and approved. The print dialog is caught in the video and both labels are shown over the page.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `l01-why` | Every fill prints two labels: the prescription label for the medicine, and a bag label for the check. |
| `l02-order` | Juniper's thyroid tablets are ready to fill. |
| `l03-notes` | Type your notes for the checker first. They print on the bag label. |
| `l04-print` | Then print the Rx and bag labels. |
| `l05-review` | Check the directions, refills and doctor before printing. |
| `l06-dymo` | With the DYMO plugged in, Print on DYMO prints both labels, one after the other. |
| `l07-dialog` | No DYMO? Use the system print dialog. It prints the same two labels. |
| `l08-rx` | The first is the prescription label. It goes on the medicine. |
| `l09-bag` | The second is the bag label: the order number, client, pet, the pet’s weight when we have one, and your notes. |
| `l10-where` | Set the bag label in front of the filled medicine and the stock bottle, so the checker can compare them. |
| `l11-only` | Bag label only reprints just the bag label. |
| `l12-mistakes` | The most common mistakes: printing before typing the checker notes, and sticking the bag label on the medicine. |
| `l13-remember` | Remember: notes first, then print. Rx label on the medicine, bag label in front of it for the check. |
