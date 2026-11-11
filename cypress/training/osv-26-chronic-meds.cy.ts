/// <reference types="cypress" />
/**
 * Training video OSV-26: chronic medications, refills and portal reorders. TEST stack, Stripe TEST mode.
 * Setup: Maple's heartworm Rx (chronic, 1 refill left) and a free-text chronic "Dental chews" (no catalog link);
 * Maria's saved test Visa. Dr. Lane adds joint chews from inventory, adds refills, and links the dental chews;
 * Maria reorders the heartworm chewable; it lands in Fill.
 */
import '../support/e2e';
import { buyAsMaria, look, osv, press, resetStoreData, schedulingWorld, signIn, sql } from './osvTraining';
import { openOrder, openOrderQuietly, resetRefills } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-26 chronic medications', () => {
  it('OSV-26', () => {
    const o = osv();
    const w = schedulingWorld();
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    sql(`UPDATE prescriptions SET refill=1 WHERE "patientId"=${o.pets.maple} AND "inventoryItemId"=${o.items.hw} AND "isDeleted"=false`);
    // Earlier takes: the joint chews Dr. Lane added, and the dental chews she linked.
    sql(`UPDATE prescriptions SET "isDeleted"=true WHERE "patientId"=${o.pets.maple} AND "pimsId" IS NULL AND name ILIKE 'Joint support chews%'`);
    sql(`DELETE FROM prescriptions WHERE "pimsId"='osv-demo-ft-dental'`);
    sql(
      `INSERT INTO prescriptions ("practiceId","patientId",name,acuity,refill,"startDate","expirationPeriodValue","isOwned","isActive","isDeleted","pimsId","pimsType") ` +
        `VALUES (${w.practiceId},${o.pets.maple},'Dental chews','chronic',0,now(),0,true,true,false,'osv-demo-ft-dental','scout')`
    );
    buyAsMaria({ tab: 'Featured', item: 'Joint support chews', pet: 'Maple', autoship: false }).then((id) =>
      sql(`DELETE FROM mail_orders WHERE id=${id} AND "clientId"=${o.clients.rivera}`)
    );
    signIn('doctorA', `/schedule/patients?patientId=${o.pets.maple}`);
    cy.contains('button', /Medication$/, { timeout: 60000 });
    cy.wait(2500);
    startClock();

    const chip = (name: RegExp) => cy.contains('.pims-emr-story__chip--med', name, { timeout: 20000 });
    line('c01-why');
    line('c02-chart', () => look(() => chip(/Heartworm/).parent(), 3500));
    line('c03-add', () => tap(() => cy.contains('button', /Medication$/)));
    line('c04-search', () => typeSlowly(() => cy.focused(), 'joint'));
    line('c05-pick', () => tap(() => cy.contains('Joint support chews (60 ct)', { timeout: 20000 })));
    line('c06-catalog', () => look(() => chip(/Joint support chews/).find('.pims-emr-story__chip-catalog'), 3000));
    line('c07-refills', () => look(() => chip(/Heartworm/).find('.chronic-rx-refills-btn'), 2500));
    line('c08-window', () => tap(() => chip(/Heartworm/).find('.chronic-rx-refills-btn')));
    line('c09-add', () => {
      cy.contains('label', 'Refills left').find('input').clear();
      typeSlowly(() => cy.contains('label', 'Refills left').find('input'), '5');
    });
    line('c09b-save', () => press(() => cy.contains('button', /^Save refills$/)));
    line('c10-saved', () => look(() => cy.contains('Saved: 5 refills left.', { timeout: 20000 }), 2500));
    line('c11-free', () => {
      cy.get('.chronic-rx-modal__close').click();
      tap(() => chip(/Dental chews/).find('.chronic-rx-refills-btn'));
      look(() => cy.get('[data-testid="chronic-rx-unlinked"]', { timeout: 20000 }), 3000);
    });
    line('c12-link', () => {
      typeSlowly(() => cy.get('input[placeholder="Search inventory to link…"]'), 'dental');
      cy.contains('.chronic-rx-modal__result', /Dental chews/, { timeout: 20000 });
    });
    line('c12b-pick', () => tap(() => cy.contains('.chronic-rx-modal__result', /Dental chews/).first()));
    line('c13-linked', () => look(() => cy.get('[data-testid="chronic-rx-linked"]', { timeout: 20000 }), 3500));
    offCamera(() => {
      cy.get('.chronic-rx-modal__close').click();
      signIn('client', '/client-portal');
      cy.contains('.pp-greeting-name', 'Maria', { timeout: 40000 });
      cy.contains('button.pp-switch', 'Maple', { timeout: 30000 }).click();
      cy.get('section[aria-label="Medications"]', { timeout: 30000 }).then(($s) => $s[0].scrollIntoView({ block: 'center' }));
      cy.wait(1500);
    });
    line('c14-portal', () => look(() => cy.get('section[aria-label="Medications"]'), 4500));
    line('c15-reorder', () => {
      tap(() => cy.contains('.pp-med', 'Heartworm').contains('button', /Reorder/));
      cy.contains('button', /^Place order$/, { timeout: 30000 });
      cy.wait(800);
      cy.get('body').then(($b) => {
        if ($b.text().includes('Yes — send it here')) cy.contains('label', 'Yes — send it here').click();
      });
      cy.contains('button', /^Place order$/).should('not.be.disabled');
    });
    line('c16-place', () => {
      press(() => cy.contains('button', /^Place order$/));
      cy.contains('h1', 'Thank you', { timeout: 60000 });
    });
    offCamera(() => {
      sql(`SELECT max(id) FROM mail_orders WHERE "clientId"=${o.clients.rivera}`).then((v) => (orderId = Number(String(v).trim())));
      signIn('mailteam', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.contains('button', /^Fill$/).click();
      cy.wait(1000);
      openOrderQuietly(() => orderId);
      cy.contains('Give one chewable by mouth once a month with food.', { timeout: 20000 });
      cy.wait(600);
    });
    line('c17-queue', () => look(() => cy.contains('Give one chewable by mouth once a month with food.').first(), 4000));
    line('c18-mistakes');
    line('c19-remember');
    finish();
  });
});
