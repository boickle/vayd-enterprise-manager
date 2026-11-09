/// <reference types="cypress" />
/**
 * Training video LV-04: finish the order in IDEXX's page (docs/training/scripts/labs/LV-04-finish-in-idexx.md).
 * TEST stack with IDEXX's sandbox practice (a demo, not live). Juniper's CBC is sent in the setup (as in LV-03);
 * the video answers IDEXX's questions, adds a urinalysis and orders. Demo names: Maria Rivera's cat Juniper,
 * Dr. Avery Lane, Jordan Pike (tech).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { labId, labsApi, labsDb, labsSetup, soapPath, visitToday } from './labsTraining';

describe('Training: LV-04 finish in IDEXX', () => {
  it('LV-04', () => {
    const w = schedulingWorld();
    const pid = w.practiceId;
    const juniper = w.households.A.activePetIds[1];
    loadNarration();
    labsSetup([juniper]);
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE patients SET dob='2019-05-01' WHERE id=${juniper}"`);
    labId('cbc').then((cbc) =>
      visitToday({ household: 'A', petId: juniper, reason: 'Drinking more for two weeks.', startsMinutesAgo: 45 }).then((v) => {
        labsApi('doctorA', 'POST', `/soap-encounters/${v.encounterId}/orders`, {
          practiceId: pid, name: 'CBC - standard', kind: 'treatment', catalogItemType: 'lab', catalogItemId: cbc, qty: 1, unitPrice: 186.36, state: 'accepted',
        });
        labsApi<{ id: string }>('doctorA', 'GET', `/visit-invoices/by-appointment/${v.apptId}?practiceId=${pid}`).then((bill) =>
          labsApi('technician', 'POST', `/idexx/invoices/${bill.body.id}/orders`, { patientId: juniper })
        );
        signInAsScheduling('technician', soapPath(v.apptId, juniper, v.clientId));
      })
    );
    const lineFor = (text: string) => cy.contains('[id^="checkout-line-"]', text, { timeout: 60000 });
    lineFor('CBC - standard').find('.idexx-chip').should('contain.text', 'Finish in IDEXX');
    cy.wait(1500);
    const frame = () =>
      cy.get('iframe[title="IDEXX VetConnect PLUS order"]', { timeout: 60000 }).its('0.contentDocument.body').should('not.be.empty').then(cy.wrap);
    const inFrame = (selector: string) => () => frame().find(selector).filter(':visible').first();
    const textInFrame = (text: string | RegExp) => () => frame().contains(text);
    // One cursor at a time: Scout's is hidden while the clicks are inside IDEXX's page.
    const scoutCursor = (show: boolean) =>
      cy.document({ log: false }).then((doc) => {
        const el = doc.getElementById('training-pointer');
        if (el) el.style.visibility = show ? 'visible' : 'hidden';
      });

    startClock();
    line('lv04-01');
    line('lv04-02');
    line('lv04-03', () => {
      tap(() => lineFor('CBC - standard').find('button.soap-invoice-line-expand'));
      cy.get('.soap-invoice-line-drawer.is-open').contains('button', 'Finish in IDEXX').should('exist');
    });
    line('lv04-04', () => {
      tap(() => cy.get('.soap-invoice-line-drawer.is-open').contains('button', 'Finish in IDEXX'));
      frame().contains('Veterinarian', { timeout: 60000 });
      cy.wait(1500);
    });
    line('lv04-05', () => {
      pointAt(() => cy.contains('IDEXX · Juniper'), 1800);
      scoutCursor(false);
      pointAt(inFrame('#personnel'), 2000);
    });
    line('lv04-06', () => {
      tap(textInFrame(/^Notes$/));
      frame().find('#notes-instr').should('be.visible');
    });
    line('lv04-07', () => typeSlowly(inFrame('#notes-instr'), 'PU/PD two weeks.'));
    line('lv04-08', () => tap(inFrame('#doneButton')));
    line('lv04-09', () => {
      tap(textInFrame('Search All Tests'));
      frame().find('#searchBarInput').should('be.visible');
    });
    line('lv04-10', () => typeSlowly(inFrame('#searchBarInput'), 'Urinalysis'));
    line('lv04-11', () => {
      tap(textInFrame('Search all IDEXX Tests'));
      frame().contains(/Urinalysis \(910\)/, { timeout: 30000 });
    });
    line('lv04-12', () => {
      tap(textInFrame(/^Urinalysis \(910\)$/));
      frame().contains('Specimen Details', { timeout: 30000 });
    });
    line('lv04-13', () => {
      tap(textInFrame('Specimen Details'));
      frame().find('#P0_UC2_COLLECTION_METHOD_INPUT').should('be.visible');
    });
    line('lv04-14', () => choose(inFrame('#P0_UC2_COLLECTION_METHOD_INPUT'), 'Cystocentesis'));
    line('lv04-15', () => choose(inFrame('#P0_UC2_PATIENT_ON_MEDICATION_INPUT'), 'No'));
    line('lv04-16', () => typeSlowly(inFrame('#P0_UC2_NOTES_INPUT'), 'Drinking more for two weeks.'));
    line('lv04-17', () => tap(() => frame().find('button:visible').filter(':contains("Done")').last()));
    line('lv04-18', () => {
      tap(inFrame('#orderButton'));
      cy.get('iframe[title="IDEXX VetConnect PLUS order"]', { timeout: 90000 }).should('not.exist');
      scoutCursor(true);
      lineFor('Urinalysis').should('exist');
    });
    // The tag shows once the page reloads its IDEXX data (possible bug in docs/training/labs.md); cut from the video.
    offCamera(() => {
      cy.reload();
      lineFor('Urinalysis').find('.idexx-added-tag', { timeout: 90000 }).should('exist');
      cy.wait(1500);
    });
    line('lv04-19', () => {
      lineFor('Urinalysis').find('.idexx-added-tag', { timeout: 60000 }).should('exist');
      pointAt(() => lineFor('Urinalysis').find('.idexx-added-tag'), 3500);
    });
    line('lv04-20', () => pointAt(() => lineFor('CBC - standard').find('.idexx-chip'), 3000));
    line('lv04-21', () => pointAt(() => cy.get('.idexx-requisition-link').filter(':visible').first(), 3000));
    line('lv04-22');
    line('lv04-23');
    finish();
  });
});
