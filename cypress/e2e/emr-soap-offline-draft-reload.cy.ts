/// <reference types="cypress" />
/**
 * SOAP text typed with no signal survives a reload. The page writes to the chart as it opens (check-in
 * block), which used to make the device copy look older than the server and get thrown away.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';

describe('SOAP: offline text survives a reload', () => {
  it('puts the unsent text back on screen', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    const client = w.households.B.clientId;
    let offline = false;
    const api = String(Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000'));
    // "No signal": every API request from the page is dropped.
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
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId: client, patientId: biscuit,
      appointmentTypeId: w.types.recheck, appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(), description: 'Ear recheck', bookedViaRouting: true,
    }).then((res) => {
      apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: w.practiceId, appointmentId: apptId, patientId: biscuit, clientId: client, mode: 'comprehensive',
      }).then((enc) =>
        schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
          practiceId: w.practiceId, subjective: { history: 'Ear recheck. Finished his Mometamax.' },
        })
      );
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${biscuit}?clientId=${client}`));
    const editor = () => cy.contains('.soap-rich__editor', 'Ear recheck').first();
    editor().should('exist');
    cy.wait(4000);
    network(false);
    editor().click().type('{moveToEnd} Typed with no signal.');
    cy.contains('Not saved yet', { timeout: 20000 }).should('exist');
    // Signal back only for the reload (no "online" event, so the page never re-sent the edit).
    cy.then(() => (offline = false));
    cy.reload();
    cy.contains('Typed with no signal.', { timeout: 60000 }).should('exist');
  });
});
