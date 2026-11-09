/// <reference types="cypress" />
/**
 * Training video LV-02: finish later and the Waiting to run list (docs/training/scripts/labs/LV-02-waiting-to-run.md).
 * TEST stack, demo names: Tom Chen's dog Biscuit, Maria Rivera's Maple, Dr. Avery Lane, Jordan Pike (tech).
 * The end-of-day task is made in the setup: the scheduled job that makes it is off on the test stack.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { asList, labsApi, labsDb, labsSetup, soapPath, visitToday } from './labsTraining';

describe('Training: LV-02 Waiting to run', () => {
  it('LV-02', () => {
    const w = schedulingWorld();
    const pid = w.practiceId;
    const biscuit = w.households.B.petId;
    const maple = w.households.A.activePetIds[0];
    loadNarration();
    labsSetup([biscuit, maple]);
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE tasks SET \\"isDeleted\\"=true WHERE title LIKE 'Enter results for %'"`);
    const forms: Record<string, number> = {};
    labsApi<any[]>('manager', 'GET', `/in-house-labs/templates?practiceId=${pid}`).then((res) =>
      ['Ear Cytology', 'Skin Cytology'].forEach((n) => (forms[n] = asList(res.body).find((t) => t.name === n).id))
    );
    // Maple's skin cytology from yesterday, not run, and its end-of-day task.
    cy.then(() =>
      labsApi('technician', 'POST', `/in-house-labs/results?practiceId=${pid}`, {
        patientId: maple,
        labFormTemplateId: forms['Skin Cytology'],
        serviceDate: new Date(Date.now() - 24 * 3600_000).toISOString(),
      })
    );
    labsApi('manager', 'POST', '/tasks', {
      title: 'Enter results for Skin Cytology on Maple',
      body: 'This in-house lab was charged today and no results have been entered. Enter them from the invoice or the pet\'s chart.',
      assignedToEmployeeId: w.employees.technician,
    });
    // Biscuit's visit with the ear cytology charged.
    cy.exec(`psql -qAt -d ${labsDb()} -c "SELECT id FROM procedures WHERE name='Ear cytology' AND \\"isDeleted\\"=false ORDER BY id LIMIT 1"`).then((r) => {
      const earCyto = Number(r.stdout.trim());
      visitToday({ household: 'B', petId: biscuit, reason: 'Shaking his head, right ear, 3 days.' }).then((v) => {
        labsApi('doctorA', 'POST', `/soap-encounters/${v.encounterId}/orders`, {
          practiceId: pid, name: 'Ear cytology', kind: 'treatment', catalogItemType: 'procedure', catalogItemId: earCyto, qty: 1, unitPrice: 35, state: 'accepted',
        });
        labsApi('doctorA', 'GET', `/visit-invoices/by-appointment/${v.apptId}?practiceId=${pid}`);
        signInAsScheduling('technician', soapPath(v.apptId, biscuit, v.clientId));
      });
    });
    const lineFor = (text: string) => cy.contains('[id^="checkout-line-"]', text, { timeout: 60000 });
    const editor = () => cy.get('.soap-invoice-line-drawer.is-open .lab-result-form .soap-rich__editor').first();
    lineFor('Ear cytology').should('exist');
    cy.wait(1500);
    const dialog = () => cy.get('[role="dialog"][aria-label="Ear Cytology results"]');

    startClock();
    line('lv02-01');
    line('lv02-02');
    line('lv02-03', () => {
      tap(() => lineFor('Ear cytology').find('button.soap-invoice-line-expand'));
      editor().should('exist');
    });
    line('lv02-04', () => typeSlowly(editor, 'Right ear: many cocci, few yeast. '));
    line('lv02-05', () => {
      tap(() => cy.get('.soap-invoice-line-drawer.is-open .lab-result-form').contains('button', 'Save, finish later'));
      cy.wait(1200);
    });
    line('lv02-06', () => pointAt(() => cy.get('.soap-checkout-goto button').first(), 3000));
    line('lv02-07', () => {
      tap(() => cy.contains('nav a, header a', /^Labs$/));
      cy.contains('.settings-tab', 'In-house labs', { timeout: 30000 }).should('be.visible');
    });
    line('lv02-08', () => {
      tap(() => cy.contains('.settings-tab', 'In-house labs'));
      cy.contains('.pending-labs__row', 'Biscuit', { timeout: 30000 }).should('be.visible');
    });
    line('lv02-09', () => {
      pointAt(() => cy.contains('[role="tab"]', 'Waiting to run'), 2000);
      pointAt(() => cy.contains('.pending-labs__row', 'Biscuit'), 2000);
      pointAt(() => cy.contains('.pending-labs__row', 'Maple'), 2000);
    });
    line('lv02-10', () => pointAt(() => cy.get('select[aria-label="Provider"]'), 3000));
    line('lv02-11', () => {
      tap(() => cy.contains('.pending-labs__row', 'Biscuit').find('.pending-labs__row-btn'));
      dialog().should('be.visible');
    });
    line('lv02-12', () => {
      dialog().find('.soap-rich__editor').click('bottomRight');
      typeSlowly(() => dialog().find('.soap-rich__editor'), '{moveToEnd} Rods present. Otitis externa.');
    });
    line('lv02-13', () => {
      tap(() => dialog().contains('button', 'Save results'));
      dialog().should('not.exist');
    });
    line('lv02-14', () => {
      tap(() => cy.contains('[role="tab"]', 'Recently resulted'));
      cy.contains('.pending-labs__row', 'Biscuit', { timeout: 30000 }).should('be.visible');
      pointAt(() => cy.contains('.pending-labs__row', 'Biscuit'), 2000);
    });
    line('lv02-15', () => {
      tap(() => cy.contains('nav a, header a', /^Tasks/));
      cy.contains('Enter results for Skin Cytology on Maple', { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('Enter results for Skin Cytology on Maple').first(), 3500);
    });
    line('lv02-16');
    line('lv02-17');
    finish();
  });
});
