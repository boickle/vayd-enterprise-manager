# OSV-24. Ordered on another site (e.g. My Royal Canin)

- **Audience:** Mail order team.
- **Who is on screen:** Riley.
- **Spec:** `cypress/training/osv-24-ordered-elsewhere.cy.ts`; narration `cypress/training/narration/osv-24-ordered-elsewhere.json` (Nova, 1.25x).
- **Demo data:** A dental chews order stands in for a vendor-shipped item; vendor “My Royal Canin”, their order # RC-48211.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `x01-why` | Some items aren't on our shelf. We order them on the vendor's site, like Royal Canin food through My Royal Canin, and the vendor ships it straight to the client. |
| `x02-order` | Open the order in Fill. |
| `x03-source` | Choose Ordered on another site. |
| `x04-vendor` | Name the site. |
| `x05-ref` | Place the order on their site, then type their order number here. |
| `x06-filled` | Mark filled. |
| `x07-noship` | Nothing leaves our building, so there's no label to buy. It goes straight to check. |
| `x08-default` | Items we always order this way can be set in the catalog to pass through by default, with the vendor filled in. |
| `x09-tell` | Then tell the client when to expect it, as for any order. |
| `x10-mistakes` | The most common mistakes: marking it filled before ordering on the vendor's site, and leaving out their order number. |
| `x11-remember` | Remember: order on their site first, then record the site and their order number. |
