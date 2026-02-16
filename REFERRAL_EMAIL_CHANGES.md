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

Vet At Your Door is a house call veterinary practice that brings comprehensive medical care directly to your home. Our dedicated One Team model means you have a consistent veterinarian, technician, and client liaison caring for your pet in a proactive, personal, and continuous way. We provide wellness care, sick visits, diagnostics, end-of-life care, and more, all in the comfort of your home.

You can learn more about our approach here:
https://www.vetatyourdoor.com

If you would like to get started, you may request an appointment here:
{{Request appointment button}}

As a thank you for being referred, you will receive a $50 credit after completing your first appointment. If you choose to enroll in one of our Membership plans, you will receive an additional $25 credit.

If you have any questions, we would be happy to help.

Warmly,
The Vet At Your Door Team
```

### Implementation Notes
- The **Request appointment button** should be a clickable link/button that goes to the appointment request form (e.g., `https://www.vetatyourdoor.com` or the full URL for the client portal appointment request page)
- Ensure `{{referral name}}` and `{{referrer name}}` are properly escaped for HTML/plain text email
- If referrer name is not available from the user/client record, consider a fallback such as "A friend" or "One of our clients"

## Frontend Status
The frontend sends `email` and `name` in the referral request. No frontend changes are needed for this requirement.
