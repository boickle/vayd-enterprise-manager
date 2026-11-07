/// <reference types="cypress" />
/**
 * SOAP text typed with no signal survives moving between the S/O/A/P tabs, and saves when the signal returns.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';

describe('SOAP: offline text survives a tab switch', () => {
  it('keeps Subjective text after visiting Objective, then saves it', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    const client = w.households.B.clientId;
    let offline = false;
    const api = String(Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000'));
    cy.intercept({ url: `${api}/**` }, (req) => { if (offline) req.destroy(); else req.continue(); });
    const network = (on: boolean) => {
      cy.then(() => (offline = !on));
      cy.window().then((win) => {
        Object.defineProperty(win.navigator, 'onLine', { configurable: true, get: () => on });
        win.dispatchEvent(new Event(on ? 'online' : 'offline'));
      });
    };
    resetSeededHouseholdsInDb();
    const start = new Date(Math.floor((Date.now() - 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    let apptId = 0;
    let encId = '';
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId: client, patientId: biscuit,
      appointmentTypeId: w.types.recheck, appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(), description: 'Ear recheck', bookedViaRouting: true,
    }).then((res) => {
      apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: w.practiceId, appointmentId: apptId, patientId: biscuit, clientId: client, mode: 'comprehensive',
      }).then((enc) => {
        encId = enc.body.id;
        schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
          practiceId: w.practiceId, subjective: { history: 'Ear recheck. Finished his Mometamax.' },
        });
      });
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${biscuit}?clientId=${client}`));
    const editor = () => cy.contains('.soap-rich__editor', 'Ear recheck').first();
    editor().should('exist');
    cy.wait(4000);
    network(false);
    editor().click().type('{moveToEnd} Typed with no signal.');
    cy.contains('button.soap-tab', 'Objective').click();
    cy.contains('Objective notes').should('exist');
    cy.screenshot('tab-switch-objective-offline', { capture: 'viewport' });
    cy.contains('button.soap-tab', 'Subjective').click();
    cy.contains('Typed with no signal.', { timeout: 10000 }).should('exist');
    cy.contains('Not saved yet').should('exist');
    network(true);
    cy.contains('Not saved yet', { timeout: 30000 }).should('not.exist');
    cy.then(() =>
      schedulingApi<{ subjective?: { history?: string } }>('doctorA', 'GET', `/soap-encounters/${encId}?practiceId=${w.practiceId}`)
        .its('body.subjective.history')
        .should('contain', 'Typed with no signal.')
    );
  });
});
