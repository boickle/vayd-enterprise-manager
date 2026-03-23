# Membership Multi-Pet $75 Credit – Email Content

## Requirement
When a client signs up **more than one pet** for a membership, include the following message in the membership confirmation/welcome emails sent to **both the client and the Client Liaison (CL)**.

**Add this text (only when the client enrolled 2+ pets in membership):**

> You will be receiving a $75 credit in your VAYD account to be used at any visit of your choosing — this won't expire.

## When to Include
- **Include** when the enrollment (or batch of enrollments in the same session) includes **2 or more pets** for that client.
- **Do not include** when the client enrolled only one pet.

## Emails Affected
- Membership confirmation/welcome email sent to the **client**
- Membership confirmation/welcome email (or internal notification) sent to the **Client Liaison (CL)**

## Implementation Notes
- The backend should determine “multi-pet” from the enrollment context (e.g. multiple membership transactions created in the same session, or a single request that enrolls multiple patients).
- If the trigger is “payment success” or “membership created,” check whether this client has just completed enrollment for a second (or more) pet in the same flow/session and add the paragraph only in that case.
