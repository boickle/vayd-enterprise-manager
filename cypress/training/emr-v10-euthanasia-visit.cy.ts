/// <reference types="cypress" />
/**
 * Training video, EMR V10: euthanasia at the visit: consent first, then Run Payment
 * (docs/training/emr-visit-workflow-video-script.md). TEST stack on Stripe TEST mode (TRAINING_STRIPE=test): the hold
 * is a real test-mode hold on Stripe's test Visa. Demo names: June Whitfield's cat Clementine (setup/emr-euth.sql),
 * Dr. Avery Lane; Jordan Pike and Casey Morgan hear the oral consent.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: EMR V10 euthanasia at the visit', () => {
  it('V10', () => {
    const w = schedulingWorld();
    loadNarration();
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const apiDir = String(Cypress.env('SCH_API_DIR'));
    const sql = (q: string) => cy.exec(`psql -qAt -d ${db} -c "${q.replace(/"/g, '\\"')}"`).its('stdout');
    let clientId = 0;
    let petId = 0;
    let apptId = 0;
    let estimateId = '';
    let token = '';
    cy.exec(`psql -qAt -d ${db} -f cypress/training/setup/emr-euth.sql`).then((r) => {
      [clientId, petId] = r.stdout.trim().split('\n').pop()!.split(' ').map(Number);
    });
    const start = new Date(Math.floor((Date.now() - 30 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    cy.then(() =>
      sql(`SELECT id FROM appointment_types WHERE name='Euthanasia' AND "practiceId"=1 AND "isDeleted"=false ORDER BY id LIMIT 1`).then((typeId) =>
        schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
          practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId, patientId: petId,
          appointmentTypeId: Number(typeId), appointmentStart: start.toISOString(),
          appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
          description: 'Family would like private cremation.', bookedViaRouting: true,
        }).then((res) => (apptId = res.body.id))
      )
    );
    // The estimate the family approved: euthanasia and private cremation, $515, held on a Stripe test card taken by
    // phone (as in V9), which is what lets this visit charge the extra on the same card.
    cy.then(() =>
      cy.exec(`bash cypress/training/setup/stripe-test-card.sh "${apiDir}" june.whitfield@example.com "June Whitfield"`).then((r) => {
        const [cus, pm] = r.stdout.trim().split(' ');
        sql(
          `WITH e AS (INSERT INTO visit_estimates ("practiceId","appointmentId","patientId","clientId",title,status,subtotal,total,"stripeCustomerId","savedPaymentMethodId","sentAt","cardAuthorizedVia","cardAuthorizedPaymentMethodId")
             VALUES (1,${apptId},${petId},${clientId},'Euthanasia visit — Clementine','sent',515,515,'${cus}','${pm}',now(),'staff_phone','${pm}') RETURNING id)
           INSERT INTO visit_estimate_lines ("practiceId","estimateId","patientId",description,qty,"unitPrice",amount,"taxableAmount","catalogItemId","catalogItemType")
           SELECT 1, e.id, ${petId}, p.name, 1, p.price, p.price, 0, p.id, 'procedure' FROM e, procedures p
            WHERE p."pimsId" IN ('training-euth-euth','training-euth-cremation') RETURNING "estimateId"`
        ).then((id) => (estimateId = String(id).trim().split('\n')[0]));
      })
    );
    cy.then(() => schedulingApi('cl', 'POST', `/visit-estimates/${estimateId}/accept`, { practiceId: w.practiceId }));
    cy.then(() =>
      schedulingApi<{ authorizedAmount: number }>('cl', 'POST', `/visit-estimates/${estimateId}/authorize`, { practiceId: w.practiceId })
        .its('body.authorizedAmount')
        .should('satisfy', (n: unknown) => Number(n) === 515)
    );
    // The consent form went out but isn't signed.
    cy.then(() => {
      token = `training${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
      sql(
        `INSERT INTO consent_invite ("formType","appointmentId","patientId","clientId","providerEmployeeId","practiceId",token,email,"sentAt","expiresAt","pimsType")
         VALUES ('euthanasia',${apptId},${petId},${clientId},${w.doctors.A},1,'${token}','june.whitfield@example.com',now(),now() + interval '7 days','scout')`
      );
    });
    cy.then(() =>
      schedulingApi('doctorA', 'POST', '/soap-encounters', {
        practiceId: w.practiceId, appointmentId: apptId, patientId: petId, clientId, mode: 'comprehensive',
      })
    );
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${petId}?clientId=${clientId}`));
    // Added at the visit: a clay paw print, so the bill is more than the hold.
    cy.get('input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).type('Clay paw print');
    cy.contains('.soap-plan-result-name', 'Clay paw print', { timeout: 20000 }).closest('button').click();
    cy.contains('.soap-invoice-line', 'Clay paw print', { timeout: 30000 }).should('exist');
    cy.wait(1500);

    const panel = () => cy.contains('.soap-checkout', 'Euthanasia consent');
    startClock();
    line('v10-01');
    line('v10-02', () => pointAt(panel, 4000));
    line('v10-03', () => pointAt(() => panel().find('.soap-invoice-badge'), 3000));
    line('v10-04', () => pointAt(() => panel().contains('button', 'Signed printed consent'), 3000));
    line('v10-05', () => {
      tap(() => panel().contains('button', 'Gave oral consent'));
      panel().find('.soap-witness-pick').should('exist');
    });
    line('v10-06', () => choose(() => panel().contains('label', 'First staff member').find('select'), 'Jordan Pike'));
    line('v10-07', () => choose(() => panel().contains('label', 'Second staff member').find('select'), 'Casey Morgan'));
    line('v10-08', () => {
      tap(() => panel().contains('button', 'Record consent'));
      panel().find('.soap-invoice-badge', { timeout: 30000 }).should('have.text', 'oral');
    });
    line('v10-09', () => {
      pointAt(() => panel().find('.soap-invoice-badge'), 1500);
      pointAt(() => panel().contains('p', 'Heard by'), 2500);
    });
    line('v10-10', () => {
      cy.get('.soap-checkout-goto button', { timeout: 30000 }).should('not.be.disabled');
      tap(() => cy.get('.soap-checkout-goto button'));
      cy.get('[data-testid="estimate-authorization-bubble"]', { timeout: 60000 }).should('exist');
    });
    const bubble = () => cy.get('[data-testid="estimate-authorization-bubble"]');
    line('v10-11', () => pointAt(() => bubble().find('p').first(), 4000));
    line('v10-12', () => pointAt(() => bubble().contains('p', 'An additional'), 6000));
    line('v10-13', () => pointAt(() => cy.contains('button', 'Family declined'), 6000));
    line('v10-14', () => tap(() => cy.contains('button', 'Run Payment from Authorization')));
    // Stripe test mode sometimes takes a minute to answer; that wait is cut from the video.
    offCamera(() => cy.contains('Estimate given to the family', { timeout: 150000 }).should('not.exist'));
    line('v10-15', () => pointAt(() => cy.contains(/^paid$/i).filter(':visible').first(), 3000));
    offCamera(() => {
      cy.then(() => cy.visit(`/consent/euthanasia?token=${token}`));
      cy.contains(/already been (submitted|checked out)/, { timeout: 60000 }).should('exist');
      cy.wait(1000);
    });
    line('v10-16', () => pointAt(() => cy.contains(/already been (submitted|checked out)/), 4000));
    line('v10-17');
    line('v10-18');
    line('v10-19');
    finish();
  });
});
