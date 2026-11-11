# PERM-03. Set a license (vets and licensed technicians)

- **Audience:** managers (practice admins and the medical director).
- **Length:** 2 minutes.
- **Watch first:** PERM-02.
- **The one thing to remember:** only a practice admin or the medical director sets a license, and never their own.

## Why (opening)

"A license is what lets someone sign medical records and prescriptions. It's a legal question, so only two people can set it, and every change is logged."

## Steps

Logged in as **Quinn Parker** (Practice Admin). Sam Chen just passed his LVT exam.

| Step | Screen | Action | Narration | Demo data needed |
|---|---|---|---|---|
| 1 | Settings → Staff | Pick **Sam Chen**, click the **Access** tab | "Sam passed his LVT exam. Open his Access tab." | Sam Chen: Technician at Raleigh office, not licensed |
| 2 | Access | Point at **License** and its note: "Signing a SOAP needs a veterinary license. A licensed technician may sign quick visits and medical notes…" | "The License box says what each license allows." | — |
| 3 | Voice-over | — | "The one thing to remember: only a practice admin or the medical director sets a license, and never their own." | — |
| 4 | Access | Click **Licensed technician** | "Click Licensed technician." | — |
| 5 | Access | Point at **Recent changes** at the bottom: the license change, by Quinn Parker | "It saves straight away, and the change is logged at the bottom." | — |
| 6 | Voice-over | — | "A vet gets Veterinarian here. A role alone never lets someone sign: they need the license too." | — |
| 7 | Settings → Staff | Pick **Quinn Parker** (yourself), **Access** tab | "Now look at your own Access tab." | — |
| 8 | Access | Point at the greyed-out license choices and "Ask a practice admin to change your own access." | "Your own license is greyed out. Nobody changes their own access." | — |

## What other roles see

- **Practice managers:** the License choices are greyed out. The reason, "Only a practice admin or the medical director can set someone's license", shows only when you hover over them.
- **The medical director** can set licenses for others, not for themselves.

## Closing

"The most common mistake is giving someone the Veterinarian role and forgetting the license, so they can't sign. Remember: only a practice admin or the medical director sets a license, and never their own."

## Notes from the check in the app (Nov 9, 2026)

- Walked as Quinn Parker: clicking **Licensed technician** saved at once; **Recent changes** showed "License: not licensed → technician · Quinn Parker". The audit log shows "isLicensed: false → true, licenseType: — → technician".
- Fixed Nov 9 (RP-A15): the medical director opens Settings → Staff (Access tab only) and sets licenses.
