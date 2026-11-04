/**
 * SCH-01-4: a technician cannot change their own role from Settings, and a forced request is refused.
 * docs/test-plans/scheduling-and-routing.md (vayd-api), section 4.
 *
 * Needs the seeded scheduling world (see cypress/support/schedulingWorld.ts):
 *   CYPRESS_SCHEDULING_WORLD="$(cat sch-world.json)" npx cypress run --spec cypress/e2e/scheduling-sch-01-role-changes.cy.ts
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

describe('SCH-01-4: staff roles screen, technician login', () => {
  it('hides the role editor and refuses a forced role change', () => {
    const w = schedulingWorld();

    technicianAssignments().then((before) => {
      // The screen: no role editor for a technician.
      signInAsScheduling('technician', '/schedule/settings?tab=roles');
      cy.contains('Access Denied', { timeout: 15000 }).should('be.visible');
      cy.get('.settings-section-title').should('not.exist');
      cy.contains('button', /save/i).should('not.exist');
      cy.get('input[type="checkbox"]').should('not.exist');

      // A forced request: give themselves the Practice Manager role.
      schedulingApi<RoleRow[]>('technician', 'GET', '/employees/roles?owner=scout').then(
        (rolesRes) => {
          const manager = rolesRes.body.find((r) => r.slug === 'practice_manager');
          expect(manager, 'Practice Manager role').to.not.equal(undefined);
          const roleAssignments = [
            ...before,
            { roleId: manager!.id, branchId: manager!.isBranchSpecific ? w.branchId : null },
          ];
          schedulingApi(
            'technician',
            'PUT',
            `/employees/${w.employees.technician}/roles`,
            { roleAssignments },
            false
          ).then((res) => {
            expect(res.status).to.eq(403);
          });
        }
      );

      // Role unchanged in the database.
      technicianAssignments().should('deep.equal', before);
    });
  });
});
