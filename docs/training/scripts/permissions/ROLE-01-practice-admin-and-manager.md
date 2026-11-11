# ROLE-01. What a Practice Admin and a Practice Manager see

- **Audience:** managers.
- **Length:** 2 to 3 minutes.
- **Watch first:** PERM-01.
- **The one thing to remember:** both run the practice day to day. Only the Practice Admin sets licenses, grants individual permissions and changes what a role can do, and neither can change their own access.

## Why (opening)

"These are the two roles that run the practice. They see almost the same Scout. Here's the small part that's different, and why."

## Steps

Part 1 logged in as **Quinn Parker** (Practice Admin); part 2 as **Jamie Brooks** (Practice Manager).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Home (Quinn Parker) | Point at the top bar: **Home, Scheduling, Catalog, Pharmacy, Labs, Tasks, Marketing, Settings** | "This is the Practice Admin's Scout. Every menu is here except Admin, which is only for platform logins." | perm-seed.ts |
| 2 | Home | Click **Marketing** and point at **Promotions** and **Email campaigns** | "Marketing has promotions and email campaigns." | — |
| 3 | Home | Click **Analytics** in the left panel | "Analytics shows every report, for every doctor." | — |
| 4 | Analytics | Point at the tab row (Payments, Veterinary Services Delivered, Memberships, Gift Cards…) | "Payments, production, memberships, gift cards and more." | Some payments in the last 7 days |
| 5 | Voice-over | — | "The one thing to remember: both roles run the practice day to day. Only the Practice Admin sets licenses, grants individual permissions and changes what a role can do. And neither can change their own access." | — |
| 6 | Settings → Staff → Tess Holt → Access | Point at **License** (live) and **Individual permissions** with **Grant** | "On someone's Access tab, the admin can set the license and grant extra permissions." | — |
| 7 | Settings → Roles → Client Liaison | Point at **What can a Client Liaison do?** | "And on the Roles page, the admin can change what a role can do." | — |
| 8 | Home (Jamie Brooks) | Point at the same top bar | "Now the Practice Manager. Same menus." | — |
| 9 | Settings → Staff → Tess Holt → Access | Point at the greyed **License** choices (hover one to show "Only a practice admin or the medical director can set someone's license"), and at **Individual permissions** with no Grant controls | "On the Access tab, the license is greyed out, and there's no Grant." | — |
| 10 | Settings → Roles → Client Liaison | Point at **Who has Client Liaison?** and **Save assignees**, with no role editor below | "The manager gives and removes roles, but can't change what a role can do." | — |
| 11 | Analytics | Point at the tabs, the same as the admin's | "In Analytics, the manager sees every report, for every doctor, like the admin." | — |
| 12 | Settings → Staff → Jamie Brooks → Access | Point at "Ask a practice admin to change your own access." | "And like everyone, the manager can't change their own access." | — |

## What else they can do

- Both: offboard staff (PERM-04), give roles (PERM-02), read the Permission Audit Log (PERM-05), create bank deposits, edit the catalog, settings, marketing.
- **Practice Admin only:** delete a membership payment record, apply plan changes to existing members.
- The **Practice Admin**, **Practice Manager** and **Medical Director** roles themselves can only be given by a platform superadmin.

## Closing

"The most common mistake is making a manager a practice admin just to set one license. Ask the practice admin or the medical director instead. Remember: both roles run the practice day to day. Only the Practice Admin sets licenses, grants and role permissions, and nobody changes their own access."

## Notes from the check in the app (Nov 9, 2026)

- Fixed Nov 9: a link straight to /schedule/analytics/vsd now opens that report (RP-A10).
- Fixed Nov 9 (RP-A16): the Practice Manager's Roles page shows the role, its people and **Save assignees**, without **Add** or the name/slug form.
- The Practice Manager's greyed license reason is a hover tooltip only.
- Owner, Nov 9 (RP-A18): the Practice Manager sees analytics for every doctor.
