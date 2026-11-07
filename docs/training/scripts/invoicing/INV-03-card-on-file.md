# INV-03. Save a card and charge the card on file

- **Audience:** doctors, techs and CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** EMR V5.
- **The one thing to remember:** ask before you save a card, then charge it once.

## Why (opening)

"A saved card makes the next visit, refills and memberships easy. But only with the family's OK."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maple's Checkout page | Point at **Card on file**, greyed out | "The Riveras don't have a card saved yet." | Rivera visit for Maple: Nail trim $22.50 and Dental X-rays $162 (procedures, so no lot is needed). Total $184.50 |
| 2 | Checkout | Point at the box above the payment buttons: "Owner is happy for us to keep this card on file… Ask before you tap — uncheck if they say no." (it only shows while no card is saved, so it is shown here, not at the end) | "Ask first, then charge once. With the card reader, the question is this box. Untick it if they say no." | — |
| 3a | Checkout | Point at **Tap to Pay** (no click) | "In the field, you'll usually take a new card with Tap to Pay on the Stripe reader." | — |
| 3b | Checkout | (nothing to click) | "This demo has no reader connected, so we'll use Card over phone. It works the same way." | — |
| 3 | Checkout | Click **Card over phone** (tooltip: "Virtual terminal — key in a card the owner reads out over the phone") | "Maria reads her card out over the phone." | — |
| 4 | **Card over the phone** | Type the name in **Name on card** | "Type the name on the card." | — |
| 5 | **Card over the phone** | Type 4242 4242 4242 4242, 12/34, 123 and the ZIP | "Then the card number, expiry, security code and ZIP." | Stripe test card |
| 6 | **Card over the phone** | Tick **Owner agreed to keep this card on file** ("Ask first. Leave unticked to use the card for this payment only.") | "Maria says yes to keeping it on file, so tick this. If they say no, leave it unticked." | — |
| 7 | **Card over the phone** | Click **Charge $184.50** | "Charge it once. The button shows the exact amount." | — |
| 8 | Checkout | Point at "Card charged over the phone — invoice marked paid." and **Paid** | "Paid, and the card is saved." | — |
| 9 | Maple's Checkout page, later | Point at **Card on file**, now clickable | "Later, Card on file is ready to click." | A second Rivera bill: Nail trim $22.50 |
| 10 | Checkout | Click **Card on file** | "One click charges the whole balance." | — |
| 11 | Checkout | Point at "Charged the card on file." | "Wait for this note. Don't click again." | — |
| 12 | Checkout | Point at the box above the payment buttons: "Owner is happy for us to keep this card on file… Ask before you tap — uncheck if they say no." | "With the card reader, the same question is this box. Untick it if they say no." | — |

## What else you can do here

- **Tap to Pay** with the reader (EMR V5).
- **Cash** and **Check** (EMR V5).
- **Gift card** and **Account credit** (INV-04).

## What other roles see

- Every visit role can take payment and charge a card on file.

## Closing

"The most common mistakes: saving a card without asking, and clicking Card on file again because the screen is slow. Remember: ask before you save a card, then charge it once."

## Notes from the check in the app (Nov 6, 2026)

- **Saving from Card over phone:** this saves the card when the box is ticked. The next bill showed "Visa •••• 4242".
- **Consent is required:** a card saved without the owner's consent (for example, added in Stripe directly) can't be charged. Scout says: "The client must re-consent to the current card-on-file agreement before their saved card can be charged for a visit."
- **No saved card:** on a household with no card, Card on file is greyed out with "No card saved on file".
- **Not checked:** the "This household said no to keeping a card on file last time…" reminder, because it needs a recorded refusal.
- **Demo email on the shared Stripe test account:** saved cards are found in Stripe by the client's email. Use the Riveras' own demo email, but don't save a declining card to it, because other training videos use the same Stripe test account.
- **Status (Nov 7):** ready to record. None of the Nov 6 to 7 commits changes these screens; not re-walked on Nov 7.

## Pass 1 dry run (Nov 7, 2026)

- **Script changes:** the video uses Maple (on the plan) so $22.50 and $162 are real member prices (Juniper has no plan). Old step 12 (the consent box) moved to step 2, because the box only shows while no card is saved. Tooltips ("No card saved on file", "Visa •••• 4242") don't show on a screen recording, so they are no longer narrated.
- **Stack notes:** Stripe finds saved cards by email, and the shared Stripe test account already knows maria.rivera@example.com, so the spec gives Maria a fresh email for the take (the spec puts the demo email back afterwards). The card form needs `VITE_STRIPE_PUBLISHABLE_KEY` in the worktree's `.env` (it was missing; I copied only that test key and the payment-provider line from another worktree's `.env`; the file is git-ignored).
- **Checked:** Card over phone with 4242, the tick box, the paid note, then Card on file on a second bill.
- Spec: `cypress/training/inv-03-card-on-file.cy.ts`.
