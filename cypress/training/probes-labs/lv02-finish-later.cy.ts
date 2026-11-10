/// <reference types="cypress" />
/**
 * Training video LV-02: finish later and the Waiting to run list (docs/training/scripts/labs/LV-02-waiting-to-run.md).
 * TEST stack, demo names: Tom Chen's dog Biscuit, Maria Rivera's Maple, Dr. Avery Lane, Jordan Pike (tech).
 * The end-of-day task is made in the setup: the scheduled job that makes it is off on the test stack.
 */
import '../../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';

import { asList, labsApi, labsDb, labsSetup, soapPath, visitToday } from '../labsTraining';

describe('probe LV-02 finish later', () => {
  it('LV-02', () => {
    const w = schedulingWorld();
    const pid = w.practiceId;
    const biscuit = w.households.B.petId;
    const maple = w.households.A.activePetIds[0];
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
    const dialog = () => cy.get('[role="dialog"]').filter(':contains("Ear Cytology")').first();

    cy.viewport(1600, 900);
    lineFor('Ear cytology').find('button.soap-invoice-line-expand').click({ force: true });
    editor().should('exist');
    editor().click().type('Right ear: many cocci. ', { delay: 20 });
    const status = (label: string) =>
      cy.exec(`psql -qAt -d ${labsDb()} -c "SELECT status FROM in_house_lab_results WHERE \\"patientId\\"=${biscuit} AND \\"isDeleted\\"=false ORDER BY id DESC LIMIT 1"`).then((r) =>
        cy.writeFile(`${Cypress.env('PROBE_OUT')}/lv02-status-${label}.txt`, r.stdout));
    status('before');
    cy.get('.soap-invoice-line-drawer.is-open .lab-result-form').then(($f) =>
      cy.writeFile(`${Cypress.env('PROBE_OUT')}/lv02-buttons.txt`, [...$f.find('button')].map((b) => b.innerText).join('|')));
    cy.get('.soap-invoice-line-drawer.is-open .lab-result-form').contains('button', 'Save, finish later').click();
    cy.wait(3000);
    status('after-finish-later');
    cy.contains('nav a, header a', /^Labs$/).click();
    cy.wait(3000);
    status('after-leaving-soap');
    cy.contains('.settings-tab', 'In-house labs', { timeout: 30000 }).click();
    cy.contains('.pending-labs__row', 'Biscuit', { timeout: 60000 }).should('exist');
    status('on-worklist');
    cy.contains('.pending-labs__row', 'Biscuit').find('.pending-labs__row-btn').click();
    cy.wait(4000);
    status('after-row-click');
    cy.document().then((d) => cy.writeFile(`${Cypress.env('PROBE_OUT')}/lv02-after-click.txt`, d.body.innerText));
  });
});
