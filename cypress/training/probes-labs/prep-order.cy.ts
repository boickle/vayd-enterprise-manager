/// <reference types="cypress" />
// Prep (not a video): a CBC for one pet sent to IDEXX's sandbox and ordered in IDEXX's page, so results
// come back before the video that needs them. CYPRESS_PET=biscuit|juniper|pepper, CYPRESS_SUBMIT=1 to click Order,
// CYPRESS_TEST=cbc|ua (default cbc).
import '../../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';
import { labId, labsApi, labsDb, soapPath, visitToday } from '../labsTraining';

describe('prep: IDEXX order', () => {
  it('orders', () => {
    cy.viewport(1600, 900);
    const w = schedulingWorld();
    const pid = w.practiceId;
    const pets: Record<string, { id: number; hh: 'A' | 'B' }> = {
      biscuit: { id: w.households.B.petId, hh: 'B' },
      juniper: { id: w.households.A.activePetIds[1], hh: 'A' },
      pepper: { id: w.households.A.inactivePetId, hh: 'A' },
    };
    const pet = pets[String(Cypress.env('PET'))];
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE patients SET dob=COALESCE(dob,'2019-05-01') WHERE id=${pet.id}"`);
    const test = String(Cypress.env('TEST') || 'cbc');
    const lineName = test === 'ua' ? 'Urinalysis' : 'CBC - standard';
    const price = test === 'ua' ? 115.37 : 186.36;
    labId(test).then((cbc) =>
      visitToday({ household: pet.hh, petId: pet.id, reason: 'Recheck bloodwork.', startsMinutesAgo: 120 + Math.floor(Math.random() * 60) }).then((v) => {
        labsApi('doctorA', 'POST', `/soap-encounters/${v.encounterId}/orders`, {
          practiceId: pid, name: lineName, kind: 'treatment', catalogItemType: 'lab', catalogItemId: cbc, qty: 1, unitPrice: price, state: 'accepted',
        });
        labsApi<{ id: string }>('doctorA', 'GET', `/visit-invoices/by-appointment/${v.apptId}?practiceId=${pid}`).then((bill) =>
          labsApi('technician', 'POST', `/idexx/invoices/${bill.body.id}/orders`, { patientId: pet.id })
        );
        if (String(Cypress.env('SUBMIT')) === '1') signInAsScheduling('technician', soapPath(v.apptId, pet.id, v.clientId));
      })
    );
    if (String(Cypress.env('SUBMIT')) !== '1') return;
    cy.contains('[id^="checkout-line-"]', String(Cypress.env('TEST') || 'cbc') === 'ua' ? 'Urinalysis' : 'CBC - standard', { timeout: 90000 }).find('button.soap-invoice-line-expand').click({ force: true });
    cy.get('.soap-invoice-line-drawer.is-open').contains('button', 'Finish in IDEXX', { timeout: 60000 }).click({ force: true });
    const frame = () => cy.get('iframe[title="IDEXX VetConnect PLUS order"]', { timeout: 60000 }).its('0.contentDocument.body').should('not.be.empty').then(cy.wrap);
    frame().find('#orderButton', { timeout: 60000 }).should('exist');
    cy.wait(3000);
    if (String(Cypress.env('TEST') || 'cbc') === 'ua') {
      // IDEXX requires the collection method and medication answer for a urinalysis (Specimen Details).
      frame().find('#specimen-link-910').click({ force: true });
      frame().find('#P0_UC2_COLLECTION_METHOD_INPUT', { timeout: 30000 }).select('Cystocentesis', { force: true });
      frame().find('#P0_UC2_PATIENT_ON_MEDICATION_INPUT').select('No', { force: true });
      frame().find('#doneButton').click({ force: true });
      cy.wait(1500);
    }
    frame().find('#orderButton').click({ force: true });
    cy.get('iframe[title="IDEXX VetConnect PLUS order"]', { timeout: 90000 }).should('not.exist');
  });
});
