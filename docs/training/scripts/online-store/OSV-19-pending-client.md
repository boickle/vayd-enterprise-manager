# OSV-19. Pending client: when we’re waiting on the client

- **Audience:** Mail order team, CLs.
- **Who is on screen:** Riley.
- **Spec:** `cypress/training/osv-19-pending-client.cy.ts`; narration `cypress/training/narration/osv-19-pending-client.json` (Nova, 1.25x).
- **Demo data:** Maple’s heartworm order in Fill. Texts are captured on the training stack, never sent.
- **Written:** Nov 11, 2026, from the owner’s request for a full Mail Order series.

## Narration

| Line | Says |
|---|---|
| `p01-why` | Pending client is for one thing: we asked the client a question, and we're waiting on their answer. |
| `p02-order` | Maple's order is ready to fill, but we need to confirm her address. |
| `p03-panel` | Text or email the client right from the order. |
| `p04-type` | Ask your question. |
| `p05-send` | Send text puts the order on hold, waiting on the client. |
| `p06-tag` | It leaves Fill and moves to Pending client. |
| `p07-list` | This list shows every order waiting on a client. |
| `p07b-reply` | When Maria texts back, a red number shows here, and on the Mail Order Queue tab. |
| `p08-answer` | Open it. It says Client replied, and her text is marked New. |
| `p09-clear` | She confirmed the address, so clear the hold. It goes back to its step. |
| `p10-mark` | If you asked by phone, Mark pending puts it on hold without a text. |
| `p11-not` | Waiting on a doctor or a manager is not pending. Leave the order in its step, add a note, and ask them. |
| `p12-mistakes` | The most common mistakes: marking an order pending while waiting on a manager, and forgetting to clear the hold when the client answers. |
| `p13-remember` | Remember: pending means the ball is in the client's court. Clear the hold as soon as they answer. |
