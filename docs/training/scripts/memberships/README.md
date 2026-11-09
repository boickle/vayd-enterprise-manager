# Membership training videos

Scripts for the Scout go-live series on memberships. Each video is 2 to 3 minutes and covers one task. Record them
with `cypress/training/README.md`. Approval status for each video is in `docs/training/memberships.md`.

**Demo world:**
- **Households:** the Riveras (Maria; Maple, a 4-year-old dog; Juniper, a 6-year-old cat; Pepper, a 10-year-old dog)
  and the Chens (Tom; Biscuit, a 2-year-old dog).
- **Staff:**
  - Dr. Avery Lane, licensed veterinarian;
  - Dr. Priya Shah, veterinarian;
  - Jordan Pike, technician;
  - Casey Morgan, client liaison;
  - Robin Hale, practice manager (stands in for lead client liaisons; the demo world has no lead CL login).
- **Plans:** the practice's 12 live plans (Canine and Feline Foundations, Golden and Puppy/Kitten, monthly and annual),
  copied from the real setup with `cypress/training/setup/mem-plans.py`. No client data is copied.
- **Stripe:** fake by default. Card entry steps run in Stripe test mode (`TRAINING_STRIPE=test`) with Stripe's test
  cards.

The series builds on these videos:
- MEM-01 (reading the Membership section) comes first;
- INV-02 (review the invoice before checkout) and INV-14 (reprice) for the bill;
- RL-V1 (Room Loader) for the membership pitch the owner sees before the visit.

| ID | Title | Audience | Priority |
|---|---|---|---|
| [MEM-01](MEM-01-is-this-pet-a-member.md) | Is this pet a member? Reading the Membership section | All | Must |
| [MEM-02](MEM-02-enroll-at-the-visit.md) | Enroll a pet at the visit | CLs, techs, doctors | Must |
| [MEM-03](MEM-03-post-appointment-sign-up.md) | Post-appointment sign-up: re-price the visit and refund (owner here, or email the agreement) | CLs | Must |
| [MEM-05](MEM-05-owner-paid-online.md) | Owner signed up online: refund the visit | CLs | Must |
| [MEM-06](MEM-06-online-signup.md) | Walk a client through online signup in the portal | CLs | Must |
| [MEM-07](MEM-07-second-pet-credit.md) | Second pet: the $75 credit | CLs | Must |
| [MEM-08](MEM-08-covered-services-at-the-visit.md) | Covered services during the visit | Doctors, techs | Must |
| [MEM-09](MEM-09-member-invoice-check.md) | Check a member's invoice before checkout | CLs | Must |
| [MEM-10](MEM-10-how-many-left.md) | How many exams are left? Benefits and the audit trail | CLs, techs | Must |
| [MEM-13](MEM-13-change-plan.md) | Change a pet's plan | Lead CLs, managers; others in the first month | Must |
| [MEM-14](MEM-14-cancel-and-settle.md) | Cancel a membership and settle paid vs used | Lead CLs, billing, managers | Must |
| [MEM-15](MEM-15-when-a-pet-passes.md) | When a pet passes: the euthanasia estimate and death wrap-up | Doctors, techs, CLs | Must |
| [MEM-17](MEM-17-paused-benefits.md) | Paused benefits: failed payments and card disputes | CLs; managers resume | Must |
| [MEM-19](MEM-19-renewals.md) | Renewals: the 14-day notice and what the client can choose | CLs | Must |
| [MEM-20](MEM-20-portal.md) | What members see in the portal | CLs | Must |
| [MEM-21](MEM-21-staff-tasks.md) | Membership staff tasks | Lead CLs | Must |
| [MEM-24](MEM-24-common-mistakes.md) | The most common membership mistakes | All | Must |
| [MEM-11](MEM-11-add-or-edit-a-benefit.md) | Add or edit a benefit for one pet | Lead CLs, managers | Nice |
| [MEM-16](MEM-16-owner-changed.md) | Pet changed owners: "Owner changed" | Lead CLs, billing | Nice |
| [MEM-22](MEM-22-plan-settings.md) | Settings → Memberships | Managers, admins | Nice |
| [MEM-23](MEM-23-discount-codes.md) | Discount codes and share links | Managers, admins | Nice |
| [MEM-25](MEM-25-analytics-and-stripe-link.md) | Membership analytics, and linking a Stripe subscription by hand | Managers | Nice |

MEM-04 is folded into MEM-03, and MEM-18 into MEM-17 (owner, Nov 8, 2026).
