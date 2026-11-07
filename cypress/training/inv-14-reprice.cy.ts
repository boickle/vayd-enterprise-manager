/// <reference types="cypress" />
/**
 * Training video, INV-14: reprice a bill after a membership signup
 * (docs/training/scripts/invoicing/INV-14-reprice.md). TEST stack, demo names only: Juniper Rivera, signed in as the
 * client liaison (Casey Morgan). The bill has Office exam, Nail trim and Dental chews at full price; Juniper is then
 * enrolled on the Adult plan (the same plan Maple has) before the take starts. Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, openVisit, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-14 reprice', () => {
  it('INV-14', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const juniper = w.households.A.activePetIds[1];
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    // Juniper starts with no plan (an earlier take may have enrolled her).
    sql(`DELETE FROM wellness_plan_items WHERE "wellnessPlanId" IN (SELECT id FROM wellness_plans WHERE "pimsType"='inv-train-j')`);
    sql(`DELETE FROM wellness_plans WHERE "pimsType"='inv-train-j'`);

    let appt = 0;
    openVisit(juniper, client, 'Annual exam', 90).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() => {
        setBillBranch(client);
        const order = (name: string, unitPrice: number) =>
          catalogId(name).then((c) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: pid, name, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice,
            })
          );
        order('Office exam', 75);
        order('Nail trim', 25);
        order('Dental chews', 24);
      });
    });
    // Maria signs Juniper up for the plan after the lines are on the bill.
    cy.then(() =>
      sql(
        `INSERT INTO wellness_plans ("wellnessPlanStatusValue","patientId","packageId","practiceId","startDate","pimsType") SELECT 1,${juniper},id,1,now(),'inv-train-j' FROM packages WHERE "pimsType"='inv-train' LIMIT 1`
      )
    );
    cy.then(() =>
      sql(
        `INSERT INTO wellness_plan_items ("wellnessPlanId","packageItemId","includedQuantity",coverage,"practiceId","pimsType") SELECT (SELECT id FROM wellness_plans WHERE "pimsType"='inv-train-j' LIMIT 1), pi.id, 1, 'included', 1, 'inv-train-j' FROM package_items pi WHERE pi."packageId"=(SELECT id FROM packages WHERE "pimsType"='inv-train' LIMIT 1)`
      )
    );
    cy.then(() => signInAsScheduling('cl', `/schedule/soap/${appt}/${juniper}?clientId=${client}`));
    cy.contains('.soap-invoice-line', 'Dental chews', { timeout: 60000 }).should('exist');
    cy.contains('.soap-invoice-line', 'Nail trim').should('exist');
    cy.wait(1500);

    const ln = (name: string) => cy.contains('.rpm-row', name);
    startClock();
    line('inv14-01', () => pointAt(() => cy.get('.soap-invoice-lines'), 4000));
    line('inv14-02', () => pointAt(() => cy.get('.soap-invoice-row.total'), 3000));
    line('inv14-03');
    line('inv14-04', () => {
      tap(() => cy.get('.soap-checkout-reprice'));
      cy.contains('Reprice this bill', { timeout: 30000 }).should('exist');
      cy.contains('.rpm-row', 'Nail trim', { timeout: 30000 }).should('exist');
    });
    line('inv14-05', () => pointAt(() => cy.get('.rpm-modal__hint'), 4500));
    line('inv14-06', () => pointAt(() => ln('Office exam'), 4000));
    line('inv14-07', () => pointAt(() => ln('Nail trim'), 4000));
    line('inv14-08', () => pointAt(() => cy.get('.rpm-totals'), 3500));
    line('inv14-09', () => {
      tap(() => cy.contains('.rpm-btn--primary', /^Reprice \d+ lines?$/));
      cy.contains('Reprice this bill').should('not.exist');
    });
    line('inv14-10', () => pointAt(() => cy.get('.soap-invoice-lines'), 4000));
    line('inv14-11', () => pointAt(() => cy.get('.soap-invoice-row.total'), 3500));
    line('inv14-12');
    line('inv14-13');
    finish();
  });
});
