/**
 * RP-02-5: Settings → Staff saves never move a technician's office roles.
 * docs/test-plans/roles-and-permissions.md (vayd-api), section 4.
 *
 * Before RP-02, Edit, Deactivate and Reactivate on Settings → Staff sent the whole employee back, roleIds
 * included, and the office rows came back practice-wide. Here an admin-level login (the seeded practice
 * manager, who holds staff.employee.manage) edits the technician's phone and saves, then deactivates and
 * reactivates them. After each step the technician's Technician assignment must still be tied to the same
 * office, read back from the API.
 *
 * The seeded world (cypress/support/schedulingWorld.ts) has one office, so the technician's office is the
 * world's branchId. The regression shows as branchId turning into null (practice-wide).
 *
 * Needs the seeded scheduling world (a vayd_api_test* database only):
 *   CYPRESS_SCHEDULING_WORLD="$(cat sch-world.json)" npx cypress run --spec cypress/e2e/roles-rp-02-5-staff-save-office-roles.cy.ts
 */
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';

type RoleRow = { id: number; slug: string | null; isBranchSpecific: boolean };
type Assignment = { roleId: number; branchId: number | null };

const sortAssignments = (list: Assignment[] = []) =>
  list
    .map((a) => ({
      roleId: Number(a.roleId),
      branchId: a.branchId == null ? null : Number(a.branchId),
    }))
    .sort((a, b) => a.roleId - b.roleId || (a.branchId ?? 0) - (b.branchId ?? 0));

/** The technician's role assignments, read back as the manager. */
const technicianAssignments = () => {
  const w = schedulingWorld();
  return schedulingApi<{ roleAssignments?: Assignment[] }>(
    'manager',
    'GET',
    `/employees/${w.employees.technician}`
  ).then((res) => sortAssignments(res.body.roleAssignments));
};

/** The technician's employee record, read back as the manager. */
const technicianRecord = () => {
  const w = schedulingWorld();
  return schedulingApi<{ isActive?: boolean; phone1?: string | null }>(
    'manager',
    'GET',
    `/employees/${w.employees.technician}`
  ).then((res) => res.body);
};

describe('RP-02-5: Settings → Staff saves keep office roles', () => {
  it('edit phone, deactivate, reactivate: the technician stays tied to the office', () => {
    const w = schedulingWorld();
    const techId = w.employees.technician;
    const forwarderId = w.employees.manager; // an active person to receive the technician's open tasks
    const newPhone = '(919) 555-0142';

    schedulingApi<RoleRow[]>('manager', 'GET', '/employees/roles?owner=scout').then((rolesRes) => {
      const technicianRole = rolesRes.body.find((r) => r.slug === 'technician');
      expect(technicianRole, 'Technician role').to.not.equal(undefined);
      const technicianRoleId = technicianRole!.id;

      const officeOnly = (list: Assignment[]) => list.filter((a) => a.roleId === technicianRoleId);

      technicianAssignments().then((before) => {
        expect(officeOnly(before), 'Technician role before').to.deep.equal([
          { roleId: technicianRoleId, branchId: w.branchId },
        ]);

        cy.intercept('POST', '**/employees*').as('saveEmployee');

        // Step 1: edit the phone and save the profile.
        signInAsScheduling('manager', `/schedule/settings?tab=employee-directory&employee=${techId}&section=profile`);
        cy.contains('button', /^Save profile$/, { timeout: 15000 }).should('be.visible');
        cy.contains('span.label', /^Phone$/).closest('label').find('input').clear().type(newPhone);
        cy.contains('button', /^Save profile$/).click();
        cy.wait('@saveEmployee');

        technicianRecord().should((rec) => {
          expect(String(rec.phone1 ?? '').replace(/\D/g, '')).to.match(/5550142$/);
        });
        technicianAssignments().should('deep.equal', before);

        // Step 2: deactivate, handing open tasks to the practice manager.
        cy.contains('button', /^Deactivate$/).click();
        cy.get('.settings-employee-modal').within(() => {
          cy.get('select').select(String(forwarderId));
          cy.contains('button', /^Deactivate$/).click();
        });
        cy.wait('@saveEmployee');

        technicianRecord().should((rec) => {
          expect(rec.isActive).to.eq(false);
        });
        technicianAssignments().should('deep.equal', before);

        // Step 3: reactivate.
        cy.contains('button', /^Reactivate$/, { timeout: 15000 }).click();
        cy.wait('@saveEmployee');

        technicianRecord().should((rec) => {
          expect(rec.isActive).to.eq(true);
          expect(String(rec.phone1 ?? '').replace(/\D/g, '')).to.match(/5550142$/);
        });
        technicianAssignments().should('deep.equal', before);
        technicianAssignments().should((after) => {
          expect(officeOnly(after)).to.deep.equal([{ roleId: technicianRoleId, branchId: w.branchId }]);
        });
      });
    });
  });
});
