# PERM-07. Change what a role can do (the role editor)

- **Audience:** practice admins.
- **Length:** 2 to 3 minutes.
- **Watch first:** PERM-01.
- **The one thing to remember:** a change to a role applies to everyone with that role. "Not enforced yet" means that switch does nothing today.

## Why (opening)

"If every client liaison should be able to do something, change the role once instead of granting it person by person. But be sure it's meant for all of them."

## Steps

Logged in as **Quinn Parker** (Practice Admin).

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Settings → Staff ▾ → Roles | Click **Client Liaison** | "Open the role you want to change." | — |
| 2 | Roles → Client Liaison | Scroll to **What can a Client Liaison do?** and point at "Changes apply to everyone with this role at this practice." | "Every change here applies to everyone with this role." | — |
| 3 | Voice-over | — | "That's the one thing to remember: a role change applies to everyone with that role. And Not enforced yet means the switch does nothing today." | — |
| 4 | Role editor | Type "deposit" in **Search permissions** | "Search for the permission." | — |
| 5 | Role editor | Point at **Create a bank deposit** with **No (default)** | "Each permission says Yes, No, or Their own only. Default is what Scout ships with." | — |
| 6 | Role editor | Clear the search, tick **Only show changes from default** | "Only show changes lists what this practice has changed." | — |
| 7 | Role editor | Untick it; type "export" in **Search permissions** and point at the **Not enforced yet** tag on **Export or download data in bulk** | "Some permissions say Not enforced yet. Scout doesn't check them yet, so changing them does nothing. Don't rely on them." | — |
| 8 | Role editor | Hover the **Not enforced yet** tag | "Hover the tag for the reason." | — |
| 9 | Voice-over | — | "To make a change, pick the new setting, then Save. Reset puts one back to the default; Discard throws away unsaved changes." | — |
| 10 | Role editor | Point at **No unsaved changes** | "We'll leave this one as it is." | — |

## What else you can do here

- Each role shows its people (**Who has …?**) and **Recent changes**.
- A role's **Slug** is locked on built-in roles, because permissions are attached to it.
- A **custom role** (added with **Add**) carries no permissions. Use it for scheduling and task routing only.

## What other roles see

- **Practice managers** see the Roles page and can assign people, but not the **What can a … do?** editor.
- The Practice Admin role always keeps the permissions that run the practice; those can't be switched off.

## Closing

"The most common mistakes: changing a role to fix one person, which changes it for everyone; and switching off a permission marked Not enforced yet and thinking it's blocked. Remember: a role change applies to everyone with that role."
