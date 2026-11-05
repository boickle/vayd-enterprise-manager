/// <reference types="cypress" />
/**
 * Training video, EMR V6: Wrap-up, the client recap, and who signs what
 * (docs/training/emr-visit-workflow-video-script.md). TEST stack and demo names only: Maria Rivera,
 * Juniper (ear infection) and Maple (weight check), Dr. Avery Lane. The Riveras are marked Do not email,
 * so the recap is recorded as "no recap" and nothing is emailed.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: EMR V6 wrap-up', () => {
  it('V6', () => {
    const w = schedulingWorld();
    const [maple, juniper] = w.households.A.activePetIds;
    loadNarration();

    // Setup, before the clock: today's visit for both pets, each pet's SOAP charted, weights confirmed.
    resetSeededHouseholdsInDb();
    // Problems a past take added (signing saves them) come off, so the video adds Juniper's fresh.
    [juniper, maple].forEach((patientId) =>
      schedulingApi<any>('manager', 'GET', `/patient-problems?practiceId=${w.practiceId}&patientId=${patientId}`).then(
        (res) =>
          (Array.isArray(res.body) ? res.body : (res.body?.items ?? [])).forEach((p: { id: number }) =>
            schedulingApi('manager', 'DELETE', `/patient-problems/${p.id}?practiceId=${w.practiceId}`, undefined, false)
          )
      )
    );
    const start = new Date(Math.floor((Date.now() - 90 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    const appt: Record<number, number> = {};
    const chart: Record<number, Record<string, unknown>> = {
      [juniper]: {
        subjective: { history: 'Shaking her head and scratching the left ear for 4 days. Eating and drinking normally.' },
        objectiveVitals: { tempF: '101.6', weight: '9.8', weightUnit: 'lb', weightConfirmed: true },
        objectiveNotes: 'Left ear canal red with brown debris. Right ear normal. Rest of exam normal.',
        assessmentReasoning: 'Left otitis externa. Cytology: yeast.',
        planNotes: 'Clean and treat the left ear twice daily for 10 days. Recheck in 2 weeks.',
      },
      [maple]: {
        subjective: { history: 'Here for a weight check. Doing well at home.' },
        objectiveVitals: { tempF: '101.2', weight: '48.2', weightUnit: 'lb', weightConfirmed: true },
        objectiveNotes: 'Body condition 6 of 9. Otherwise normal exam.',
        assessmentReasoning: 'Mildly overweight; down 1.5 lb since spring.',
        planNotes: 'Keep the current diet amount. Annual exam and DHPP due later this month.',
      },
    };
    [juniper, maple].forEach((patientId) =>
      schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
        practiceId: w.practiceId,
        primaryProviderId: w.doctors.A,
        clientId: w.households.A.clientId,
        patientId,
        appointmentTypeId: w.types.medical,
        appointmentStart: start.toISOString(),
        appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
        description: patientId === juniper ? 'Ear infection, left ear' : 'Weight check',
        bookedViaRouting: true,
      }).then((res) => {
        appt[patientId] = res.body.id;
        schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
          practiceId: w.practiceId,
          appointmentId: res.body.id,
          patientId,
          clientId: w.households.A.clientId,
          mode: 'comprehensive',
        }).then((enc) =>
          schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
            practiceId: w.practiceId,
            ...chart[patientId],
          })
        );
      })
    );
    cy.then(() =>
      signInAsScheduling(
        'doctorA',
        `/schedule/soap/${appt[juniper]}/${juniper}?clientId=${w.households.A.clientId}`
      )
    );
    cy.contains('button', 'Wrap up visit', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    startClock();

    const card = () => cy.contains('section.soap-wrapup-pet-card', 'Juniper');
    const nameToggle = () => cy.contains('button.soap-wrapup-pet-head-toggle', 'Juniper');

    line('v6-01');
    line('v6-02', () => {
      tap(() => cy.contains('button', 'Wrap up visit'));
      cy.contains('Client recap', { timeout: 60000 }).should('be.visible');
    });
    line('v6-03', () => {
      pointAt(() => card().find('.soap-wrapup-pet-soap-meta'));
    });
    line('v6-04', () => {
      tap(nameToggle);
      card().find('.soap-wrapup-chart-section').should('have.length', 4);
    });
    line('v6-05', () => {
      ['Subjective', 'Objective', 'Assessment', 'Plan'].forEach((h) =>
        pointAt(() => card().contains('.soap-wrapup-chart-section', h), 1000)
      );
    });
    line('v6-06', () => {
      tap(nameToggle);
      card().find('.soap-wrapup-chart-section').should('not.exist');
    });
    line('v6-07', () => {
      typeSlowly(() => card().find('input[aria-label="New problem"]'), 'Otitis externa, left ear');
    });
    line('v6-08', () => {
      tap(() => card().find('[data-testid="problem-add-control"]').contains('button', 'Acute'));
      card().should('contain.text', 'Otitis externa, left ear');
    });
    line('v6-09', () => {
      pointAt(() => card().find('input[placeholder^="Search inventory or type a medication"]'));
    });
    line('v6-10', () => {
      pointAt(() => card().contains('button', 'Add a callback'));
    });
    line('v6-11', () => {
      pointAt(() => cy.contains('h2', 'Client recap'), 3500);
    });
    line('v6-12', () => {
      pointAt(() => cy.contains(/Do not email/i).first());
    });
    line('v6-13', () => {
      tap(() => cy.contains('button', "Don't email"));
    });
    line('v6-14', () => {
      typeSlowly(() => cy.get('input[placeholder^="e.g. client asked"]'), 'Family asked for no email; Dr. Lane called them');
    });
    line('v6-15', () => {
      tap(() => cy.contains('button', 'Record: no recap'));
      cy.contains('No recap sent', { timeout: 30000 }).should('be.visible');
    });
    line('v6-16', () => {
      pointAt(() => cy.get('.soap-wrapup-gate'), 4000);
    });
    line('v6-17', () => {
      tap(() => cy.get('.soap-wrapup-footer button.primary'));
      card().find('.soap-wrapup-chart-locked', { timeout: 60000 }).should('be.visible');
      cy.wait(1200);
    });
    line('v6-18', () => {
      pointAt(() => cy.contains('button', /Write a recap after all|Redo client email/));
    });
    line('v6-19', () => {
      cy.then(() =>
        cy.visit(`/schedule/soap/${appt[juniper]}/${juniper}?clientId=${w.households.A.clientId}`)
      );
      cy.contains('button', /Write addendum/, { timeout: 60000 }).scrollIntoView();
      cy.wait(800);
      pointAt(() => cy.contains('button', /Write addendum/), 4000);
    });
    line('v6-20');
    finish();
  });
});
