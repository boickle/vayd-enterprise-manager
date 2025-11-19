# Welcome Email Changes

## Requirement
For the welcome email sent after a user signs up, only show the password reset link. Do NOT show:
- Temporary password
- Reset ID

## Endpoints Affected
1. `POST /users/create` - Admin user creation
2. `POST /users/create-client` - Client self-service user creation

## Backend Changes Needed

### Email Template Update
The welcome email template should be updated to:

**REMOVE:**
- Temporary password field/value
- Reset ID field/value

**KEEP:**
- Password reset link (with token in URL, e.g., `https://yourdomain.com/reset-password?token=abc123`)
- Welcome message
- Instructions to click the link to set their password

### Example Email Content
```
Subject: Welcome to [Your Service] - Set Your Password

Welcome!

To complete your account setup, please click the link below to set your password:

[Password Reset Link]

This link will expire in [X] hours.

If you didn't create an account, please ignore this email.
```

### Implementation Notes
- The token should still be included in the reset link URL (e.g., `?token=...`)
- Users should never see the token value displayed in the email body
- The link should be clickable and take users directly to the password reset page
- No temporary password should be generated or displayed
- No reset ID should be shown

## Frontend Status
The frontend is already configured to:
- Extract tokens from URL query parameters automatically
- Hide token fields from users in the UI
- Handle password reset via links only

No frontend changes are needed for this requirement.

---

## Membership Welcome Email Formatting

### Requirement
For the membership welcome email sent to clients after they enroll a pet in a membership plan, ensure that dynamic content (such as pet names) is NOT displayed in bold.

### Current Issue
The email contains text like:
> "Thank you for making **Newey** a VAYD Member! We are truly honored to have you and **Newey** as part of this exclusive community..."

Currently, all text appears to be in bold, including the dynamic pet name.

### Required Change
The dynamic content (pet name) should be displayed in regular (non-bold) text, while static text can remain bold if desired.

**Example of correct formatting:**
> "Thank you for making Newey a VAYD Member! We are truly honored to have you and Newey as part of this exclusive community..."

Or if static text should be bold:
> "**Thank you for making** Newey **a VAYD Member! We are truly honored to have you and** Newey **as part of this exclusive community...**"

### Email Content Affected
The membership welcome email that includes:
- "Thank you for making [pet name] a VAYD Member!"
- Any other dynamic content (pet names, client names, etc.)

### Backend Changes Needed
- Review the email template for membership welcome emails
- Ensure dynamic variables (pet names, client names) are inserted without bold formatting
- Verify that `<strong>` or `<b>` tags are not wrapping dynamic content
- Test with various pet names to ensure formatting is correct

---

## Membership Welcome Email - Team Assignment Message

### Requirement
The membership welcome email contains a message about team assignment. This message should be conditional based on whether the pet has a primary provider assigned.

### Current Text (When Primary Provider Exists)
> "You are now officially part of Dr. Abigail Messina's team. You'll soon hear from Newey's assigned Client Liaison Maggie so they can (re-)introduce themselves."

### Required Change (When NO Primary Provider)
If the pet does NOT have a primary provider, the text should be:

> "We are actively working on finding you the right veterinary team for [pet name]. Your assigned Client Liaison will reach out to introduce themselves shortly."

**Note:** The Client Liaison name should NOT be included when there is no primary provider.

### Implementation Details
- Check if `primaryProvider` or `primaryProviderName` exists for the pet
- If primary provider exists: Use the current text with doctor name and Client Liaison name
- If NO primary provider: Use the new text above
- Replace `[pet name]` with the actual pet name dynamically
- The Client Liaison name should only be included if a primary provider exists

### Email Content Affected
The membership welcome/confirmation email that includes team assignment information.

### Backend Changes Needed
- Add conditional logic to check for primary provider existence
- Update email template to use different text based on primary provider status
- Ensure pet name is dynamically inserted in both cases
- Only include Client Liaison name when primary provider exists

