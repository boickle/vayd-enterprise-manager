# OSV-02. Guests: gift cards and items without a login

- **Audience:** CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** OSV-01.
- **The one thing to remember:** a guest pays with a new card and can buy gift cards and one-time items; prescriptions, pets and auto-ship need the portal login.

## Why (opening)

"Not everyone who visits the store has a portal login, like a friend buying a gift card. Here's what a guest can and can't do."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | **Shop Online Pharmacy**, logged out | Point at **Log in** in the top bar (no account menu) | "This is the store with nobody logged in." | Demo catalog |
| 2 | Store | Point at the one thing to remember | "A guest uses a new card. Gift cards and one-time items are fine. Prescriptions, pets and auto-ship need the login." | — |
| 3 | Store | Click **Gift Cards**, then **Gift card** | "Gift cards first." | Gift card product |
| 4 | **Gift card** | Click **$50** (the others: **$25**, **$100**, **Other amount**) | "Pick the amount." | — |
| 5 | Gift card | Point at **Who is it for?**: **Send it to someone** / **It's for me — email it to me** | "It can go to someone else, or to the buyer." | — |
| 6 | Gift card | Type **Recipient name**, **Recipient email**, **From** and a **Message (optional)** | "Who it's for, who it's from, and a note." | Recipient: Tom Chen, tom.chen@example.com |
| 7 | Gift card | Point at **When should we send it?**: **Right away** / **On a date** | "It can be emailed now or on a birthday." | — |
| 8 | Gift card | Click **Add to cart**, then open **Cart** | "Add it to the cart." | — |
| 9 | Cart | Type **Name** and **Email** under **Your details**, then the test card 4242 and the billing address | "The guest types their own name and email, and a new card." | Stripe test card |
| 10 | Cart | Point at "No tax or shipping on gift cards." | "No tax or shipping on a gift card." | — |
| 11 | Cart | Click **Pay $50.00** | "Pay." | — |
| 12 | **Thank you** | Point at "Your gift cards are on their way by email." | "The card is emailed, with a printable copy." | — |
| 13 | Store | Click **Dental chews**, **Add to cart**, then open **Cart** | "A guest can also buy a one-time item, like dental chews." | — |
| 14 | Cart | Point at the banner "Checking out as a guest with a new card. Prescription and auto-ship items need your client portal login: log in to order those." | "The cart tells the guest what needs a login." | — |
| 15 | Cart | Point at **Total $31.35** (Subtotal $24.99, Shipping $4.99, Sales Tax $1.37) | "Shipping and tax are added." | — |
| 15a | Store | Click **Prescriptions**, then **Heartworm & flea chewable** | "A prescription is different." | — |
| 15b | Product page | Point at "This is a prescription item. Log in to your client portal to order it — a doctor checks every order before we mail it." and **Log in to order** | "A guest is asked to log in. There's no Add to cart." | — |
| 16 | **Gift card** page | Click **Check gift card balance**, type the code, click **Check balance** | "Anyone with a code can check its balance." | Gift card RVRA-GKCD-HMNP-2345, $50 |
| 17 | **Check a gift card balance** | Point at "Gift card ••••2345: $50.00 available. Use it at checkout in this store, at your visit, or toward a bill in the client portal." | "It works in the store, at a visit, or on a bill." | — |

## What else a guest can do here

- **Have a gift card?** in the cart applies a code to products (not to buying another gift card).
- **Pick up at Brunswick Office** or **Biddeford Office**.

## What other roles see

- A guest order has no client. Staff see it in the **Mail Order Queue** with the buyer's name and email. A paid guest order can be refunded from the cancel screen (OSV-10).

## Closing

"The most common mistakes: telling a family with a portal login to check out as a guest, so they lose their saved card and member price, and promising a guest a prescription without a login. Remember: a guest pays with a new card and can buy gift cards and one-time items; prescriptions, pets and auto-ship need the portal login."

## Notes from the check in the app (Nov 7, 2026)

- **Walked** (logged out on the training stack): store home, the gift card page, the guest cart with its banner and $31.63 total, and the balance check ($50.00 available).
- **Gift card checkout to payment:** this exact flow passed in the OS-01-11 Cypress run on Nov 7 with test card 4242 (one charge, no client). It was not paid again on this stack. **Do it in the dry run.** Use an `example.com` email; Stripe refuses `.test` addresses.
- **B2 fixed (Nov 7, vayd-enterprise-manager `4bbcf9c`, `c679eed`):** a guest on a prescription or pet item now sees the login note and **Log in to order** (walked live); guests are never offered **Auto-ship**, on the product page or in the cart.
- **Totals after Q3:** shipping isn't taxed any more: dental chews $24.99 + $4.99 shipping + $1.37 tax = **$31.35** (the Nov 7 walk showed $31.63 before the fix; confirm in the dry run).
- **Before recording:** the gift card emails go to the capture file on the training stack, not to anyone.
