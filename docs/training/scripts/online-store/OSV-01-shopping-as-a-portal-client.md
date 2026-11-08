# OSV-01. Shopping the store as a portal client

- **Audience:** CLs.
- **Length:** 2 to 3 minutes.
- **Watch first:** INV-09 (what the client sees in the portal).
- **The one thing to remember:** saved cards, pets, member prices and auto-ship only appear after the client logs in.

## Why (opening)

"Families order refills and supplies from the store in their portal. When they call with a question, you need to know what they see."

## Steps

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Maria's client portal | Point at the greeting "Good evening, Maria" | "This is Maria Rivera's portal, logged in." | Maria's portal login (seeded `client`) |
| 2 | Portal | Point at the one thing to remember | "Logged in is the key: her cards, her pets, member prices and auto-ship only show up after she logs in." | — |
| 3 | Store top bar | Click **Shop** | "Shop opens the store." | — |
| 4 | **Shop Online Pharmacy** | Point at the tabs **Featured**, **All**, **Dental**, **Prescriptions**, **Supplements**, **Gift Cards** | "Products are grouped here. Featured shows first." | Demo catalog (setup script) |
| 5 | Store home | Click **Joint support chews** ($36.00, tags **Featured**, **Autoship**) | "Maria wants joint chews for Maple." | — |
| 6 | Product page | Click **Maple** under **Pet** | "She picks the pet. Every auto-ship belongs to a pet." | Riveras: Juniper, Maple, Pepper |
| 7 | Product page | Point at **Auto-ship** (with **Free shipping**) next to **Buy once** | "Auto-ship is picked for her, and auto-ship ships free." | — |
| 8 | Product page | Click **every month (recommended)** | "Every month is our recommended timing for this one." | Item's recommended frequency: every month |
| 9 | Product page | Click **Add to cart** | "Add to cart." | — |
| 10 | Store home | Click **Dental chews**, then **Maple**, then **Buy once**, then **Add to cart** | "She adds dental chews as a one-time buy." | — |
| 11 | **Cart** | Point at the two lines: the chews on **Auto-ship** "every month (recommended)", **For** Maple; the dental chews on **Buy once** | "Each line shows how it's bought and who it's for." | — |
| 12 | Cart | Point at **Fulfillment**: **Ship — $4.99 handling**, **Pick up at Brunswick Office**, **Pick up at Biddeford Office**, and "This order includes a one-time item, so shipping is charged now. Later auto-ship renewals use free auto-ship shipping." | "Shipping is $4.99 today because of the one-time item. The renewals ship free." | — |
| 13 | Cart | Click **Yes — send it here** under "Is this the mailing address you want us to send this to?" | "She confirms the address on file." | Maria's address: 100 Test Lane, Raleigh, NC 27601 |
| 14 | Cart, **Total** | Point at Subtotal $60.99, Shipping $4.99, Sales Tax $3.35, **Total $69.33** | "The total is here before she pays." | — |
| 15 | Cart | Type the card: **Name on card**, test card 4242 4242 4242 4242, 12/34, 123, billing address | "She enters her card." | Stripe test card |
| 16 | Cart | Point at **Save my card on file to make future purchases easier**, ticked, and "Auto-ship items ship and charge this card every month until you cancel. One-time items are charged only for this order." | "Saving the card is her choice. The auto-ship charges this card every month." | — |
| 17 | Cart | Click **Place order** | "Place order, once." | — |
| 18 | **Thank you** | Point at "Order #… is in our mail queue. You'll get a receipt in your email." | "The order goes straight to our mail queue, and she gets an email receipt." | — |
| 19 | **Auto-ship items** (top bar **Auto-ship**) | Point at the chews: "For Maple", "$36.00 each", next bill date, **Pause**, **Cancel** | "Her auto-ships live here." | — |
| 20 | Cart, next visit | Point at **Card on file**: "Visa •••• 4242 · exp 12/34 · last used" | "Next time, her saved card is ready." | — |

## What else the client can do here

- **Coupon** and **Have a gift card?** in the Total box (OSV-16, OSV-02).
- **Pick up at Brunswick Office** or **Biddeford Office** instead of shipping.
- **Pay the balance with this order**, when she owes on a bill (OSV-04).
- Prescription items: the store shows "Prescription — we'll verify" and a doctor checks every one (OSV-07).

## What other roles see

- Staff see the same order in the **Mail Order Queue** (OSV-08) and on Maria's page under **History** ("Thanks for your Vet At Your Door order #…").

## Closing

"The most common mistakes: telling a family to check out as a guest when they want their saved card or auto-ship, and promising a pet discount before they log in. Remember: saved cards, pets, member prices and auto-ship only appear after the client logs in."

## Notes from the check in the app (Nov 7, 2026)

- **B5 fixed (Nov 8):** **Place order** stays greyed out for a moment while Scout loads Maria's details. Wait for it to turn green before clicking.

- **Walked end to end** as Maria, on the training stack in Stripe test mode, with every label above. The order went to the queue, the auto-ship showed on **Auto-ship items**, and the saved card showed on the next cart.
- **Every item asks for a pet** when the client is logged in. That's by design: every store item can be put on auto-ship, and auto-ships belong to a pet. So step 10 picks Maple for the dental chews too.
- **Totals:** Joint chews $36.00 + Dental chews $24.99 = $60.99, shipping $4.99, tax $3.35 (5.5% of the items only), total $69.33. Shipping stopped being taxed on Nov 7 (Q3); the walk on Nov 7 still showed $3.63 / $69.61 before that fix. **Confirm $69.33 in the dry run.**
- **The emailed receipt** ("Thanks for your Vet At Your Door order #…") showed under Maria's **History** on her client page with the same items and totals.
- **Before recording:** let the portal finish loading before step 1. The first frame showed the login's email instead of "Maria" while loading (demo data, review section 4).
- **Wording to confirm:** the frequency buttons show both **Monthly** and **every month (recommended)**. The **Auto-ship items** page shows "every month · next bill 2026-12-07" and "$36.00 each · qty 1 · 36.00 before tax" (no $ on the second amount). See section 3 of the review.
