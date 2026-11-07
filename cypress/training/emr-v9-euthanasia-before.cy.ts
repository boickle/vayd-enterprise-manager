/// <reference types="cypress" />
/**
 * Training video, EMR V9: euthanasia, before the visit: estimate, consent and card
 * (docs/training/emr-visit-workflow-video-script.md). TEST stack on Stripe TEST mode (TRAINING_STRIPE=test), demo
 * names: June Whitfield's cat Clementine (setup/emr-euth.sql), Dr. Avery Lane, signed in as the client liaison.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

const TZ = 'America/New_York';
const ymdNy = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

describe('Training: EMR V9 euthanasia before the visit', () => {
  it('V9', () => {
    const w = schedulingWorld();
    loadNarration();
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const sql = (q: string) => cy.exec(`psql -qAt -d ${db} -c "${q.replace(/"/g, '\\"')}"`).its('stdout');
    let clientId = 0;
    let petId = 0;
    let apptId = 0;
    cy.exec(`psql -qAt -d ${db} -f cypress/training/setup/emr-euth.sql`).then((r) => {
      const [c, p] = r.stdout.trim().split('\n').pop()!.split(' ').map(Number);
      clientId = c;
      petId = p;
    });
    // In two days, mid-morning.
    const day = new Date(Date.now() + 2 * 86400_000);
    const start = new Date(`${ymdNy(day)}T10:00:00-05:00`);
    cy.then(() =>
      sql(`SELECT id FROM appointment_types WHERE name='Euthanasia' AND "practiceId"=1 AND "isDeleted"=false ORDER BY id LIMIT 1`).then((typeId) =>
        schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
          practiceId: w.practiceId,
          primaryProviderId: w.doctors.A,
          clientId,
          patientId: petId,
          appointmentTypeId: Number(typeId),
          appointmentStart: start.toISOString(),
          appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
          description: 'Family would like private cremation and a paw print.',
          bookedViaRouting: true,
        }).then((res) => (apptId = res.body.id))
      )
    );
    // The practice's Euthanasia Group package; the estimate is built on camera from it.
    cy.exec(`psql -qAt -d ${db} -f cypress/training/setup/emr-euth-package.sql`);
    cy.then(() =>
      signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymdNy(day)}&provider=${w.doctors.A}`)
    );
    cy.contains('button', /^Day$/, { timeout: 30000 }).click();
    const visit = () => cy.get(`[data-appt-id="${apptId}"]`).first();
    const onScreen = () =>
      visit().should(($el) => {
        $el[0].scrollIntoView({ block: 'center' });
        expect($el[0].getBoundingClientRect().top, 'visit on screen').to.be.within(150, 780);
      });
    cy.then(() => cy.get(`[data-appt-id="${apptId}"]`, { timeout: 30000 }).should('exist'));
    cy.then(onScreen);
    cy.wait(1500);
    const modal = () => cy.get('.euth-estimate-modal');
    const openMenu = (prepLine: string, pickLine: string) => {
      cy.then(() => pointAt(visit, 1200));
      cy.task('trainingClick', null, { log: false });
      cy.then(() => visit().rightclick());
      cy.wait(400);
    };

    startClock();
    line('v9-01');
    line('v9-02', () => openMenu('', ''));
    line('v9-03', () => {
      pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', 'Visit Prep'), 1500);
      cy.contains('.scheduler-ctx-parent-wrap', 'Visit Prep').trigger('mouseover');
      cy.wait(300);
    });
    line('v9-04', () => {
      tap(() => cy.contains('button[role="menuitem"]', 'Send Euthanasia Consent'));
      modal().contains('Quoted to the family', { timeout: 30000 }).should('exist');
    });
    const pickerOption = (text: string) => cy.contains('.bsp-option', text);
    line('v9-05', () => pointAt(() => modal().find('input[placeholder^="Search services"]'), 4000));
    line('v9-05a', () => typeSlowly(() => modal().find('input[placeholder^="Search services"]'), 'Euthanasia Group'));
    line('v9-05b', () => {
      tap(() => modal().contains('button', 'Euthanasia Group'));
      cy.get('.bsp-modal', { timeout: 30000 }).should('exist');
    });
    line('v9-05c', () => tap(() => pickerOption('Euthanasia Procedure - Feline')));
    line('v9-05d', () => tap(() => cy.get('.bsp-modal').contains('button', /^Next$/)));
    line('v9-05e', () => tap(() => pickerOption('Private cremation (Ashes Returned) - Feline')));
    line('v9-05f', () => tap(() => cy.get('.bsp-modal').contains('button', /^Next$/)));
    line('v9-05g', () => {
      tap(() => cy.get('.bsp-modal .bsp-btn--primary'));
      cy.get('.bsp-modal').should('not.exist');
      modal().contains('Private cremation (Ashes Returned) - Feline', { timeout: 30000 }).should('exist');
    });
    line('v9-06', () => {
      pointAt(() => modal().contains('Euthanasia Procedure - Feline'), 1800);
      pointAt(() => modal().find('.euth-estimate-quote'), 3000);
    });
    line('v9-07', () => pointAt(() => modal().contains('.euth-estimate-fact', 'Weight'), 1500));
    line('v9-08', () => pointAt(() => modal().contains('.euth-estimate-fact', 'Aftercare the family will confirm'), 4500));
    line('v9-08b', () => pointAt(() => modal().find('[data-testid="euth-estimate-card-status"]'), 3500));
    line('v9-09', () => {
      tap(() => modal().contains('button', 'Email consent'));
      modal().find('.euth-estimate-sent', { timeout: 30000 }).should('contain', 'Emailed');
    });
    line('v9-10', () => pointAt(() => modal().find('.euth-estimate-sent'), 3000));
    offCamera(() => {
      cy.then(() =>
        sql(`SELECT token FROM consent_invite WHERE "appointmentId"=${apptId} ORDER BY id DESC LIMIT 1`).then((token) => {
          cy.visit(`/consent/euthanasia?token=${encodeURIComponent(String(token).trim())}`);
        })
      );
      cy.contains('h1', 'Euthanasia Consent Form', { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    line('v9-11', () => {
      pointAt(() => cy.contains('Step 1 of 4'), 2500);
      pointAt(() => cy.contains('h1', 'Euthanasia Consent Form').parent().find('p').first(), 3000);
    });
    offCamera(() => {
      cy.visit(`/schedule/scheduler?fromMyDay=1&date=${ymdNy(day)}&provider=${w.doctors.A}`);
      cy.contains('button', /^Day$/, { timeout: 30000 }).click();
      cy.then(() => cy.get(`[data-appt-id="${apptId}"]`, { timeout: 30000 }).should('exist'));
      cy.then(onScreen);
      cy.wait(1500);
    });
    line('v9-13');
    line('v9-14', () => openMenu('', ''));
    line('v9-15', () => {
      pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', 'Visit Prep'), 1500);
      cy.contains('.scheduler-ctx-parent-wrap', 'Visit Prep').trigger('mouseover');
      cy.wait(300);
      pointAt(() => cy.contains('button[role="menuitem"]', 'Re-send Euthanasia Consent'), 3000);
    });
    line('v9-16', () => {
      tap(() => cy.contains('button[role="menuitem"]', 'Re-send Euthanasia Consent'));
      modal().contains('Quoted to the family', { timeout: 30000 }).should('exist');
    });
    line('v9-17', () => {
      tap(() => modal().contains('button', 'Take card by phone'));
      cy.contains('h3', 'Take card over the phone').should('exist');
    });
    line('v9-18', () => pointAt(() => cy.contains('p', 'With the client on the line'), 5000));
    line('v9-19', () => {
      cy.get('.estimate-card-element iframe', { timeout: 60000 }).should('exist');
      pointAt(() => cy.get('.estimate-card-element'), 1500);
      cy.get('.estimate-card-element iframe')
        .its('0.contentDocument.body')
        .should('not.be.empty')
        .then(cy.wrap)
        .find('input[name="cardnumber"]', { timeout: 30000 })
        .type('4242424242424242', { delay: 70 })
        .then(() =>
          cy
            .get('.estimate-card-element iframe')
            .its('0.contentDocument.body')
            .then(cy.wrap)
            .within(() => {
              cy.get('input[name="exp-date"]').type('1230', { delay: 90 });
              cy.get('input[name="cvc"]').type('123', { delay: 90 });
              cy.get('input[name="postal"]').type('27513', { delay: 90 });
            })
        );
    });
    line('v9-20', () => {
      tap(() => cy.contains('button', /^Authorize \$/));
      cy.contains('h3', 'Take card over the phone', { timeout: 60000 }).should('not.exist');
    });
    line('v9-21', () => {
      modal().find('[data-testid="euth-estimate-card-status"].is-on-file', { timeout: 30000 }).should('contain', 'held');
      pointAt(() => modal().find('[data-testid="euth-estimate-card-status"]'), 4500);
    });
    line('v9-21b', () => {
      tap(() => modal().find('.soap-modal-head button.soap-icon-btn'));
      modal().should('not.exist');
    });
    line('v9-21c', () => {
      const badge = () => cy.get(".scheduler-appt-payment-badge--held").filter(":visible").first();
      cy.then(() => badge().should('exist'));
      pointAt(badge, 4000);
    });
    line('v9-22');
    line('v9-23');
    line('v9-24');
    finish();
  });
});
