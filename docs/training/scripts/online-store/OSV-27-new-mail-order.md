# OSV-27. New mail order: ashes and other packages

- **Audience:** Mail order team, CLs.
- **Who is on screen:** Riley.
- **Spec:** `cypress/training/osv-27-new-mail-order.cy.ts`; narration `cypress/training/narration/osv-27-new-mail-order.json` (Nova, 1.25x).
- **Demo data:** Maria Rivera's dog Pepper, marked inactive for this video (restored after). A second package goes to Jenna Rivera, who isn't a client, at 215 Glenwood Ave, Raleigh NC 27603 (made up). Both ship from the default office; labels are EasyPost test labels.
- **Written:** Nov 12, 2026, from the owner's request (ash returns: find the client's address, or send with no client). Ship from, Packages filter and no-client Send to were added the same day.

## Narration

| Line | Says |
|---|---|
| `p01-why` | New mail order is for packages that aren't a pharmacy fill, like returning a pet's ashes. There's no approval, fill, or check. |
| `p02-open` | Click New mail order. |
| `p03-client` | Find the client. |
| `p04-inactive` | Pepper has passed, so tick Include inactive to find her. |
| `p05-pet` | Choose Pepper. |
| `p06-info` | Say what's in the package. |
| `p07-from` | Ship from is the office it leaves from. Choose another office, or Another address to type any return address. |
| `p08-add` | Add to queue. |
| `p09-ship` | It goes straight to Ship, already addressed to Maria. |
| `p10-weight` | Weigh the package, |
| `p11-rates` | get rates, |
| `p12-label` | and print the cheapest label. |
| `p13-tell` | Then let Maria know it's on the way, like any order. |
| `p14-noclient` | Sending to someone who isn't a client? Open New mail order, leave Client empty, |
| `p15-sendto` | and type their name in Send to. Here, Maria's daughter Jenna. |
| `p16-info` | Say what's in it, |
| `p17-add` | and add it to the queue. |
| `p18-open` | Open it. There's no address yet. |
| `p19-address` | Click Add address. |
| `p19b-type` | Choose Type it in, |
| `p19c-fields` | and type the address. |
| `p20-save` | Save the address. |
| `p21-weight` | Weigh it, |
| `p21b-rates` | get rates, |
| `p21c-label` | and print the label, the same as before. |
| `p22-contact` | With no client on the order, there's no one to email. Choose Do not contact client. |
| `p23-find` | To find a package later, click Packages. It lists every package, shipped ones too. |
| `p23b-search` | Or search for a name, or a word like ashes. |
| `p24-mistakes` | The most common mistakes: using this for medicine, which needs a pharmacy fill and a check, and shipping from the wrong office. |
| `p25-remember` | Remember: New mail order is for packages only. Check where it ships from before you add it. |
