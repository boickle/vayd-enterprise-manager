# Membership email / Ecwid copy changes (backend)

Backend updates live in `vayd-api`. This note tracks the membership revision that was applied there.

## Done in vayd-api

### Pre-visit email
`src/notifications/membership-promotion-email.service.ts`
- Replaced after-hours live chat paragraph with 7-day support + 50% off additional exams copy (HTML + text).

### Post-visit signup email
`src/notifications/post-appointment-membership-email.service.ts`
- Priority scheduling (reserve slots) wording
- Real support / seven days a week wording
- Added 50% off additional exams bullet (HTML + text)

### Ecwid store codes
`src/paymentProcessing/paymentProcessing.service.ts`
- 10% Ecwid coupon is now created for **all** successful memberships (not PLUS-gated)
- Methods renamed to `createEcwidCouponForMember` / `createEcwidCouponForMemberWithPetName`

### Welcome + staff emails
`src/paymentProcessing/membership-email.service.ts`
- Store discount section shown whenever a code exists; PLUS-only wording removed
- Staff note: all members get a store discount code
- After-hours section rebranded to Priority 7-Day Support

### Related blurbs
- `src/roomLoader/room-loader.service.ts` — pre-visit check-in membership blurb (no PLUS add-on framing)
- `src/appointments/public-appointment-request.service.ts` — “priority scheduling with your One-Team”

## Frontend
Client portal / signup UI changes live in `vayd-enterprise-manager` (separate from this API).
