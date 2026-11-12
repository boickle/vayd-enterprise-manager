/// <reference types="cypress" />
import '../../support/e2e';
import { schedulingWorld } from '../../support/schedulingWorld';
import { dumpPage, PermKey, permWorld, signInAsPerm } from './permKit';

/** B7 check (Nov 11) and chart writes (Nov 12): who can save a client or write on a chart, and what the Executive sees. */
describe('Permissions probe: Executive sign-in and client saves', () => {
  it('Executive: client page and pet page', () => {
    const w = schedulingWorld();
    signInAsPerm('executive', `/schedule/clients?clientId=${w.households.B.clientId}`);
    cy.contains(/Tom Chen/, { timeout: 60000 }).should('exist');
    cy.wait(4000);
    dumpPage('exec-client');
    cy.screenshot('exec-client', { capture: 'viewport' });
    cy.get('button[aria-label^="Edit "]').should('not.exist');
    cy.contains('button', 'Save household defaults').should('not.exist');
    cy.contains('button', '+ Add pet').should('not.exist');
    cy.then(() => cy.visit(`/schedule/patients?patientId=${w.households.B.petId}`));
    cy.get('.pims-emr-title__name', { timeout: 120000 }).should('be.visible');
    cy.contains('Loading patient', { timeout: 60000 }).should('not.exist');
    cy.wait(4000);
    dumpPage('exec-pet');
    cy.screenshot('exec-pet', { capture: 'viewport' });
    cy.get('button[aria-label^="Edit "]').should('not.exist');
    cy.contains('button', /^(Deactivate|Reactivate)$/).should('not.exist');
    cy.contains('Upload records').should('not.exist');
    // Nov 12: the rest of the chart's write buttons.
    cy.get('[role="toolbar"][aria-label="Chart actions"]').should('not.exist');
    cy.contains('button', /^Appointment$/).should('not.exist');
    cy.contains('button', 'Add photo').should('not.exist');
    cy.contains('Mark as needing pre-meds').should('not.exist');
    cy.contains('button', /^\+ ?(Problem|Medication)$/).should('not.exist');
    cy.contains('button', /^Stop$/).should('not.exist');
  });

  it('technician still sees the chart write buttons', () => {
    const w = schedulingWorld();
    signInAsPerm('technician', `/schedule/patients?patientId=${w.households.B.petId}`);
    cy.get('.pims-emr-title__name', { timeout: 120000 }).should('be.visible');
    cy.get('[role="toolbar"][aria-label="Chart actions"]', { timeout: 60000 }).should('exist');
    cy.contains('button', 'Medical note').should('exist');
    cy.contains('button', /^Appointment$/).should('exist');
    cy.screenshot('tech-pet', { capture: 'viewport' });
  });

  it('server: chart writes refused for Executive and Observer, open to a technician; reads still work', () => {
    const w = schedulingWorld();
    const p = permWorld();
    const api = Cypress.env('API_URL');
    const petId = w.households.B.petId;
    const clientId = w.households.B.clientId;
    const routes: [string, string][] = [
      ['POST', '/scout-chart/notes'],
      ['POST', '/scout-chart/communications'],
      ['POST', '/soap-encounters'],
      ['POST', '/patient-problems'],
      ['POST', '/patient-prescriptions'],
      ['POST', '/visit-invoices'],
      ['POST', '/reminders'],
      ['POST', '/records-requests'],
      ['POST', '/forms/invites'],
      ['POST', `/sms/client/${clientId}`],
      ['POST', `/patients/${petId}/images`],
      ['POST', '/tasks'],
    ];
    const lines: string[] = [];
    for (const k of ['executive', 'observer', 'technician'] as PermKey[]) {
      for (const [method, path] of routes) {
        cy.request({
          method,
          url: `${api}${path}`,
          headers: { Authorization: `Bearer ${p.staff[k].token}` },
          body: {},
          failOnStatusCode: false,
        }).then((res) => {
          lines.push(`${k} ${method} ${path}: ${res.status}`);
          if (k === 'technician') expect(res.status, `${k} ${path}`).not.to.eq(403);
          else expect(res.status, `${k} ${path}`).to.eq(403);
        });
      }
      cy.request({
        url: `${api}/patient-problems?practiceId=${w.practiceId}&patientId=${petId}`,
        headers: { Authorization: `Bearer ${p.staff[k].token}` },
        failOnStatusCode: false,
      }).then((res) => {
        lines.push(`${k} GET /patient-problems: ${res.status}`);
        expect(res.status, `${k} read problems`).to.eq(200);
      });
    }
    cy.then(() => cy.writeFile(`${Cypress.env('PROBE_OUT')}/exec-chart-writes.txt`, lines.join('\n') + '\n'));
  });

  it('server: who may save the client', () => {
    const w = schedulingWorld();
    const p = permWorld();
    const id = w.households.B.clientId;
    const api = Cypress.env('API_URL');
    const results: string[] = [];
    const who: PermKey[] = ['executive', 'observer', 'inventory_manager', 'mail_order_team', 'controlled_substances_director', 'client_liaison', 'technician'];
    cy.request({ url: `${api}/clients/${id}`, headers: { Authorization: `Bearer ${p.staff.practice_admin.token}` } }).then((r) => {
      const referralSource = r.body?.referralSource ?? null;
      for (const k of who) {
        cy.request({
          method: 'PATCH',
          url: `${api}/clients/${id}`,
          headers: { Authorization: `Bearer ${p.staff[k].token}` },
          body: { referralSource },
          failOnStatusCode: false,
        }).then((res) => {
          results.push(`${k}: ${res.status}${res.status >= 400 ? ` ${JSON.stringify(res.body?.message)}` : ''}`);
        });
      }
    });
    cy.then(() => cy.writeFile(`${Cypress.env('PROBE_OUT')}/exec-saves.txt`, results.join('\n') + '\n'));
  });
});
