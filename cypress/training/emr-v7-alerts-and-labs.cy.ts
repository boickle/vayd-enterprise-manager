/// <reference types="cypress" />
/**
 * Training video, EMR V7: a sick visit, the patient alert, and an in-house ear cytology
 * (docs/training/emr-visit-workflow-video-script.md). TEST stack and demo names only: Tom Chen's dog Biscuit,
 * Dr. Avery Lane, and Jordan Pike (tech) who wrote the alert. Maple (Riveras) has a skin cytology waiting
 * from yesterday, so the worklist shows more than one pet.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

const asList = (body: any): any[] => (Array.isArray(body) ? body : (body?.items ?? body?.data ?? []));

describe('Training: EMR V7 alerts and in-house labs', () => {
  it('V7', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    const maple = w.households.A.activePetIds[0];
    const pid = w.practiceId;
    loadNarration();

    // Setup, before the clock.
    resetSeededHouseholdsInDb();
    // Clear lab results a past take left on these pets.
    [biscuit, maple].forEach((patientId) =>
      schedulingApi('manager', 'GET', `/in-house-labs/results?practiceId=${pid}&patientId=${patientId}`).then((res) =>
        asList(res.body).forEach((r: { id: number }) =>
          schedulingApi('technician', 'DELETE', `/in-house-labs/results/${r.id}?practiceId=${pid}`, undefined, false)
        )
      )
    );
    // The "Describe what you saw" forms on each cytology come from stack/demo-names.sh.
    const forms: Record<string, number> = {};
    schedulingApi<any[]>('manager', 'GET', `/in-house-labs/templates?practiceId=${pid}`).then((tpl) =>
      ['Ear cytology', 'Skin cytology'].forEach((name) => {
        const found = asList(tpl.body).find((t) => t.name === name);
        expect(found, `${name} lab form (stack/demo-names.sh)`).to.exist;
        forms[name] = found.id;
      })
    );
    // Maple's skin cytology, ordered yesterday and not run.
    cy.then(() =>
      schedulingApi('technician', 'POST', `/in-house-labs/results?practiceId=${pid}`, {
        patientId: maple,
        labFormTemplateId: forms['Skin cytology'],
        serviceDate: new Date(Date.now() - 24 * 3600_000).toISOString(),
      })
    );
    // The alert, written by the tech.
    schedulingApi('technician', 'PATCH', `/patients/${biscuit}`, {
      alerts: 'Bites when his ears are handled. Muzzle for ear exams.',
    });
    // Today's sick visit, with the history charted.
    const start = new Date(Math.floor((Date.now() - 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    let apptId = 0;
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: pid,
      primaryProviderId: w.doctors.A,
      clientId: w.households.B.clientId,
      patientId: biscuit,
      appointmentTypeId: w.types.medical,
      appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
      description: 'Head shaking, right ear',
      bookedViaRouting: true,
    }).then((res) => {
      apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: pid,
        appointmentId: apptId,
        patientId: biscuit,
        clientId: w.households.B.clientId,
        mode: 'comprehensive',
      }).then((enc) =>
        schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
          practiceId: pid,
          subjective: { history: 'Shaking his head and pawing at the right ear for 3 days.' },
        })
      );
    });
    cy.then(() =>
      signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${biscuit}?clientId=${w.households.B.clientId}`)
    );
    cy.get('[data-testid="soap-patient-alerts"]', { timeout: 60000 }).should('be.visible');
    cy.get('input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const labLine = () => cy.contains('.soap-invoice-line, li, tr', 'Ear cytology').filter(':visible').last();
    const editor = () => cy.get('.lab-result-form .soap-rich__editor').filter(':visible').first();
    const dialog = () => cy.get('[role="dialog"][aria-label="Ear cytology results"]');

    startClock();

    line('v7-01');
    line('v7-02', () => pointAt(() => cy.contains('Shaking his head').first(), 3000));
    line('v7-03', () => pointAt(() => cy.get('[data-testid="soap-patient-alerts"]'), 3000));
    line('v7-05', () => {
      typeSlowly(() => cy.get('input[placeholder^="Type here to add a charge"]'), 'Ear cyto');
    });
    line('v7-06', () => {
      tap(() => cy.contains('.soap-plan-result-name', 'Ear cytology', { timeout: 20000 }).closest('button'));
      cy.contains('.lab-chip', 'Not run', { timeout: 30000 }).should('be.visible');
    });
    line('v7-07', () => pointAt(() => cy.contains('.lab-chip', 'Not run'), 3500));
    line('v7-08', () => {
      tap(() => cy.get('button.soap-invoice-line-expand[title="Run the lab / view results"]').first());
      editor().should('be.visible');
    });
    line('v7-09', () => {
      typeSlowly(editor, 'Right ear: many yeast, a few rods. ');
    });
    line('v7-10', () => {
      tap(() => cy.contains('.lab-result-form button', 'Save, finish later'));
      cy.wait(1200);
    });
    line('v7-10b', () => {
      cy.get('.soap-checkout-goto button', { timeout: 30000 }).should('not.be.disabled');
      pointAt(() => cy.get('.soap-checkout-goto button'), 3500);
    });
    line('v7-10c');
    line('v7-11', () => {
      tap(() => cy.contains('nav a, header a', /^Labs$/));
      cy.contains('.settings-tab', 'In-house labs', { timeout: 30000 }).should('be.visible');
    });
    line('v7-11b', () => {
      tap(() => cy.contains('.settings-tab', 'In-house labs'));
      cy.contains('.pending-labs__row', 'Biscuit', { timeout: 30000 }).should('be.visible');
    });
    line('v7-12', () => {
      pointAt(() => cy.contains('[role="tab"]', 'Waiting to run'), 2000);
      pointAt(() => cy.contains('.pending-labs__row', 'Biscuit'), 2200);
      pointAt(() => cy.contains('.pending-labs__row', 'Maple'), 2200);
    });
    line('v7-13', () => {
      tap(() => cy.contains('.pending-labs__row', 'Biscuit').find('.pending-labs__row-btn'));
      dialog().should('be.visible');
    });
    line('v7-14', () => {
      dialog().find('.soap-rich__editor').click('bottomRight');
      typeSlowly(() => dialog().find('.soap-rich__editor'), '{moveToEnd} No mites. Otitis externa, yeast.');
    });
    line('v7-15', () => {
      tap(() => dialog().contains('button', 'Save results'));
      dialog().should('not.exist');
    });
    line('v7-16', () => {
      tap(() => cy.contains('[role="tab"]', 'Recently resulted'));
      cy.contains('.pending-labs__row', 'Biscuit', { timeout: 30000 }).should('be.visible');
      pointAt(() => cy.contains('.pending-labs__row', 'Biscuit'), 2000);
    });
    const chartLab = () => cy.contains('.pims-patient-detail__mr-table tbody tr', /Ear cytology/, { timeout: 30000 });
    line('v7-17', () => {
      tap(() => cy.contains('.pending-labs__row', 'Biscuit').find('.pending-labs__chart-link'));
      cy.contains('[role="tab"]', /^By date$/, { timeout: 60000 }).should('have.attr', 'aria-selected', 'true');
      chartLab().should('exist');
    });
    line('v7-18', () => pointAt(chartLab, 3500));
    line('v7-18b', () => {
      tap(() => chartLab().find('.pims-patient-detail__run-lab'));
      cy.get('.pims-patient-detail__expand-row', { timeout: 30000 }).should('exist');
    });
    line('v7-18c', () => {
      tap(() => cy.get('.pims-patient-detail__expand-row button.line-labs__head').first());
      cy.contains('No mites', { timeout: 30000 }).should('exist');
      cy.wait(600);
      pointAt(() => cy.get('.pims-patient-detail__expand-row .line-labs__form.is-open').first(), 2500);
    });
    line('v7-19', () => {
      tap(() => cy.contains('[role="tab"]', /^Labs \(/));
      chartLab().should('exist');
      pointAt(chartLab, 2500);
    });
    line('v7-19b', () => {
      tap(() => cy.contains('[role="tab"]', /^History$/));
      cy.contains('Lab result', { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('Lab result').first(), 3000);
    });
    line('v7-20');
    line('v7-21');
    finish();
  });
});
