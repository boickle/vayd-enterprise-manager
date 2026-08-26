# Referral Email Template Changes

## Requirement
Update the email sent to the referred person when someone submits a referral through the Client Portal.

## Endpoint Affected
- `POST /referral` - Referral submission (body: `{ email, name }`)

## Backend Changes Needed

### Email Template Update
Replace the current referral email content with the following template. The email is sent **to the referred person** (the friend being referred).

### Dynamic Placeholders
- `{{referral name}}` - The referred person's name (from the `name` field in the request)
- `{{referrer name}}` - The name of the client who made the referral (from the authenticated user's client info)
- `{{Request appointment button}}` - A clickable button/link that goes to the appointment request page (e.g., `https://www.vetatyourdoor.com` or the client portal appointment request URL)

### New Email Content

```
Subject: [Your friend's name] thought you might like Vet At Your Door

Hi {{referral name}},

{{referrer name}} thought you might be interested in learning more about Vet At Your Door and asked us to reach out.

Vet At Your Door is a house call veterinary practice that brings comprehensive medical care directly to your home. Our One Team model means your pet is supported by a dedicated veterinarian and veterinary technician — a small team that stays with you over time — so care stays proactive, personal, and continuous. We provide wellness care, sick visits, diagnostics, end-of-life care, and more, all in the comfort of your home.

You can learn more about our approach here:
https://www.vetatyourdoor.com

If you would like to get started, you may request an appointment here:
{{Request appointment button}}

As a thank you for being referred, we'll waive your first trip visit fee — so you can experience the difference firsthand. Curious about our Membership plans too? We're happy to tell you more.

If you have any questions, we would be happy to help.

Warmly,
The Vet At Your Door Team
```

### Implementation Notes
- The **Request appointment button** should be a clickable link/button that goes to the appointment request form (e.g., `https://www.vetatyourdoor.com` or the full URL for the client portal appointment request page)
- Ensure `{{referral name}}` and `{{referrer name}}` are properly escaped for HTML/plain text email
- If referrer name is not available from the user/client record, consider a fallback such as "A friend" or "One of our clients"

### Update (2026-07-15)
Replaced the old "$50 credit / $25 credit" incentive copy with the "waive first trip visit fee" wording to match
the redesigned `/refer-a-friend` page. Implemented in `vayd-api`'s `ReferralService.sendReferredPersonEmail`
(`src/referral/referral.service.ts`), covering both the HTML and plain-text bodies.

**Not changed (flagged for follow-up):** `ReferralSuccessCron`'s internal staff notification email
(`src/referral/referral-success.cron.ts` in `vayd-api`) still references "$50 credit" / "$25 credit" when
instructing staff to award referrer/referral bonuses after an appointment completes or a membership is created.
That logic is about the *referrer's* bonus (and a separate staff-manual credit process), not the referred
person's directly-sent email, so it was left as-is — but it may now be inconsistent with the new fee-waiver
policy and could need a matching update.

## Frontend Status
The frontend sends `email` and `name` in the referral request. No frontend changes are needed for this requirement.
