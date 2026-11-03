/// <reference types="cypress" />
import '../support/e2e';
import {
  emrApi,
  emrRequest,
  emrSql,
  emrWorld,
  itemName,
  seedRecapDraft,
  signInEmr,
  soapPath,
  stubGmailCapture,
  stubRecapDraft,
  waitForRecapDraft,
  waitForRecapMailbox,
} from '../support/emrCoreVisitWorld';

/**
 * EMR-07-9: clinical sign-off follows roles, start to finish (owner decision D2, Nov 2, 2026).
 *
 * A licensed technician runs the visit: opens the SOAP, enters the vitals and the rabies dose naming the
 * visit's vet. The technician cannot sign the SOAP (the button is disabled with the reason, and the API
 * refuses). The vet signs and locks it, then the rabies certificate shows the vet's name and license.
 *
 * Seed: vayd-api test/scripts/emr-core-visit-seed.ts (household "signoff", pet Fennel, whose visit's
 * provider is the seeded licensed vet). See emrCoreVisitWorld.ts for how to run. Nothing reaches Stripe;
 * Gmail and the AI recap writer are stubbed.
 */
describe('EMR-07-9: tech records, vet signs, certificate names the vet', () => {
  it('tech enters vitals and a rabies dose naming the vet; tech cannot sign; vet signs; certificate shows the vet and license', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.signoff;
    const [dog] = pets;
    stubGmailCapture();
    stubRecapDraft(() => dog.name);
    const next = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);

    // The technician opens the SOAP (which creates the encounter, as check-in does).
    emrApi<{ id: string; mode: string }>('technician', 'POST', '/soap-encounters', {
      practiceId: w.practiceId,
      appointmentId: dog.appointmentId,
      patientId: dog.patientId,
      clientId,
    }).then((enc) => {
      expect(enc.mode).to.eq('comprehensive');

      // Vitals and follow-up, entered by the technician (the same save the SOAP page makes).
      emrApi('technician', 'PATCH', `/soap-encounters/${enc.id}`, {
        practiceId: w.practiceId,
        objectiveVitals: { weight: '44', weightUnit: 'lb', weightConfirmed: true },
        forwardBookingDisposition: { mode: 'not_appropriate' },
      });

      // The rabies vaccine as an order, added by the technician.
      emrApi<{ id: string }>('technician', 'POST', `/soap-encounters/${enc.id}/orders`, {
        practiceId: w.practiceId,
        name: itemName('Rabies vaccine'),
        kind: 'treatment',
        catalogItemId: w.items.rabiesId,
        catalogItemType: 'inventory',
        qty: 1,
        unitPrice: 28,
        state: 'accepted',
      }).then((order) => {
        const dose = (employeeId: number) =>
          emrRequest('technician', 'PUT', `/soap-encounters/${enc.id}/orders/${order.id}/vaccination`, {
            practiceId: w.practiceId,
            nextVaccinationDate: next,
            inventoryLotBalanceId: w.lots.rabies.lotBalanceId,
            lotNumber: w.lots.rabies.lotNumber,
            tagNumber: 'R-0907',
            employeeId,
          });
        // The technician can't be the vet of record on a rabies dose…
        dose(w.employees.technician).then((res) => {
          expect(res.status).to.eq(400);
          expect(String(res.body.message)).to.match(/vet of record must be a licensed veterinarian/);
        });
        // …so they name the visit's vet.
        dose(w.employees.veterinarian).its('status').should('eq', 200);
      });

      seedRecapDraft(enc.id, 'Visit recap', `<p><strong>${dog.name}</strong>: rabies vaccine today.</p>`);

      // On the SOAP page the technician sees who signs.
      signInEmr('technician', soapPath(dog, clientId));
      cy.contains(dog.name, { timeout: 40000 });
      cy.get('[data-testid="sign-off-notice"]', { timeout: 30000 }).should(
        'contain.text',
        'Only a licensed veterinarian can sign and lock a SOAP.',
      );

      // At wrap-up, Sign & lock is disabled for the technician, with the reason.
      cy.contains('button', 'Wrap up visit').click();
      cy.contains('h1', 'Wrap up visit', { timeout: 30000 });
      cy.contains('button', 'Sign & lock SOAP')
        .should('be.disabled')
        .and('have.attr', 'title', 'Only a licensed veterinarian can sign and lock a SOAP.');
      cy.contains('[role="note"]', 'Only a licensed veterinarian can sign and lock a SOAP.').should('exist');

      // The API refuses the technician too; the chart stays a draft.
      emrRequest('technician', 'POST', `/soap-encounters/${enc.id}/complete`, { practiceId: w.practiceId })
        .its('status')
        .should('eq', 403);
      emrSql(`SELECT status FROM soap_encounters WHERE id = '${enc.id}'`).should('eq', 'draft');

      // The vet wraps up: no recap email this time, then sign and lock.
      signInEmr('veterinarian', soapPath(dog, clientId, '/wrap-up'));
      cy.contains('h1', 'Wrap up visit', { timeout: 40000 });
      waitForRecapMailbox();
      waitForRecapDraft();
      cy.contains('button', "Don't email").click();
      cy.contains('label', 'Why no recap?').find('input').type('Client prefers a phone call');
      cy.contains('button', 'Record: no recap').click();
      cy.contains('button', 'Sign & lock SOAP', { timeout: 30000 }).should('not.be.disabled').click();
      cy.contains('SOAP signed & locked', { timeout: 30000 });
      emrSql(`SELECT status || ',' || coalesce("completedByEmployeeId"::text,'') FROM soap_encounters WHERE id = '${enc.id}'`).should(
        'eq',
        `completed,${w.employees.veterinarian}`,
      );

      // The dose carries the vet's name and license; the certificate prints them.
      emrSql(`SELECT "licenseNumber" FROM employees WHERE id = ${w.employees.veterinarian}`).then((license) => {
        expect(license, 'seeded vet license number').to.match(/^WI-VET-/);
        emrSql(
          `SELECT "veterinarianName" || '|' || coalesce("veterinarianLicense",'') FROM vaccination_logs WHERE "patientId" = ${dog.patientId} AND "isDeleted" = false`,
        ).should('eq', `Emr veterinarian|${license}`);

        cy.visit(`/schedule/patients?patientId=${dog.patientId}`);
        cy.contains('button', 'Print document', { timeout: 40000 }).click();
        cy.contains('button', 'Rabies certificate').click();
        cy.contains('.chart-print-doc__fact', 'Veterinarian').find('dd').should('contain.text', 'Emr veterinarian');
        cy.contains('.chart-print-doc__fact', 'License').find('dd').should('have.text', license);
      });
    });
  });
});
