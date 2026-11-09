/// <reference types="cypress" />
/**
 * Training video, MEM-21: membership staff tasks (docs/training/scripts/memberships/MEM-21-staff-tasks.md).
 * TEST stack, demo names only. These tasks come from Stripe webhooks and scheduled jobs, which are off on the test
 * stack, so setup opens the same three tasks through the tasks API with Scout's own titles and wording. The test
 * database has no Lead Client Liaison role, so setup adds it (copied from the practice's role list). Filmed as Robin
 * Hale (practice manager), who watches the queue.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { enrolPet, fileAgreement, pets, PLAN, resetMembershipWorld, settle, sql, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const TITLES = {
  payment: "Follow up on Maple's failed membership payment by",
  email: "Tell Juniper's owner about the renewal: email not delivered",
  refund: "Refund Juniper's visit — owner enrolled online",
};

describe('Training: MEM-21 staff tasks', () => {
  it('MEM-21', () => {
    const p = pets();
    const w = schedulingWorld();
    const robin = w.employees.manager;
    loadNarration();
    trace('setup');
    resetMembershipWorld([
      `INSERT INTO employee_role (name,"roleValue",slug,"isBranchSpecific","pimsType") SELECT 'Lead Client Liaison',7,'lead_client_liaison',false,'mem-train' WHERE NOT EXISTS (SELECT 1 FROM employee_role WHERE slug='lead_client_liaison' AND "isDeleted"=false)`,
      `UPDATE tasks SET "isDeleted"=true WHERE "practiceId"=${w.practiceId} AND title LIKE 'Consent signed for %: not filed to the chart'`,
      `UPDATE tasks SET "isDeleted"=true WHERE "practiceId"=${w.practiceId} AND (title LIKE 'Follow up on Maple''s failed membership payment%' OR title LIKE 'Tell Juniper''s owner about the renewal%' OR title LIKE 'Refund Juniper''s visit%')`,
    ]);
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 75 });
    fileAgreement(p.maple, p.maria, 75);
    const deadline = new Date(Date.now() + 10 * 86_400_000);
    const label = deadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const links = (pet: number) => [
      { entityType: 'patient', entityId: pet },
      { entityType: 'client', entityId: p.maria },
    ];
    const open = (title: string, body: string, role: string, pet: number, dueAt: Date) =>
      sql(`SELECT id FROM employee_role WHERE slug='${role}' AND "isDeleted"=false ORDER BY id LIMIT 1`).then((rid) =>
        schedulingApi('manager', 'POST', '/tasks', {
          title, body, queueRoleId: Number(String(rid).trim()), branchIds: [],
          watcherEmployeeIds: [robin], priority: 1, startAt: new Date().toISOString(), dueAt: dueAt.toISOString(),
          source: 'system', links: links(pet),
        })
      );
    open(`${TITLES.refund}`,
      'Juniper was enrolled online within the post-visit window. Refund the covered part of that visit from the chart (Membership → "Owner paid — refund visit").',
      'client_liaison', p.juniper, new Date(Date.now() + 3_600_000));
    open(TITLES.email,
      "Juniper's renewal email could not be sent to maria.rivera@example.com: the owner opted out of email or the address bounced or was marked as spam.\n\nCall or text the owner to let them know, or update their email and contact preferences.",
      'lead_client_liaison', p.juniper, new Date(Date.now() + 2 * 3_600_000));
    open(`${TITLES.payment} ${label}`,
      "Stripe has stopped retrying Maria Rivera's card for Maple's Canine Foundations membership. Maple's benefits are paused until it is paid.\n\nScout emailed maria.rivera@example.com asking her to update her card. If the payment goes through, Scout closes this task on its own.",
      'lead_client_liaison', p.maple, deadline);
    signInAsScheduling('manager', '/schedule/tasks');
    cy.get('.pims-tasks__tabs', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    const card = (t: string) => cy.contains('.pims-task-card__title', t).closest('.pims-task-card');
    trace('clock');
    startClock();
    trace('m21-01'); line('m21-01');
    trace('m21-02'); line('m21-02');
    trace('m21-03'); line('m21-03', () => {
      tap(() => cy.get('.pims-tasks__tab--unassigned'));
      cy.contains('.pims-task-card__title', TITLES.payment, { timeout: 60000 }).should('be.visible');
      cy.wait(800);
    });
    trace('m21-04'); line('m21-04', () => {
      settle(() => card(TITLES.payment));
      pointAt(() => card(TITLES.payment).find('.pims-task-card__title'), 4000);
    });
    trace('m21-04b'); line('m21-04b', () => pointAt(() => card(TITLES.payment).find('.pims-task-card__assignee'), 3500));
    trace('m21-05'); line('m21-05', () => pointAt(() => card(TITLES.payment).contains('.pims-task-card__link', 'Maple'), 4500));
    trace('m21-06'); line('m21-06', () => {
      settle(() => card(TITLES.email));
      pointAt(() => card(TITLES.email), 5000);
    });
    trace('m21-07'); line('m21-07', () => {
      settle(() => card(TITLES.refund));
      pointAt(() => card(TITLES.refund), 5000);
    });
    trace('m21-08'); line('m21-08', () => {
      tap(() => card(TITLES.refund).contains('button', 'Assign to me'));
      cy.wait(1500);
    });
    // The Active list doesn't reload after "Assign to me" (count updates, list stays empty): reload off camera.
    offCamera(() => {
      cy.reload();
      cy.get('.pims-tasks__tabs', { timeout: 60000 }).should('exist');
      cy.wait(1000);
    });
    trace('m21-08b'); line('m21-08b', () => {
      tap(() => cy.get('.pims-tasks__tab--assigned'));
      settle(() => card(TITLES.refund).contains('button', 'Mark done'));
    });
    trace('m21-09'); line('m21-09', () => {
      tap(() => card(TITLES.refund).contains('button', 'Mark done'));
      cy.wait(1500);
    });
    trace('m21-10'); line('m21-10');
    trace('done');
    finish();
  });
});
