/// <reference types="cypress" />
/** OSV-05 probe, visit path: Juniper's visit today; the tech adds joint chews in Checkout and sends them by mail. */
import '../../support/e2e';
import { schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { osv, shot, signIn, sql } from './osvKit';

describe('OSV-05 at the visit', () => {
  it('Checkout panel: Mail order', () => {
    const w = schedulingWorld();
    const o = osv();
    const fails: Array<{ method: string; url: string; status: number; body: unknown }> = [];
    cy.intercept({ url: 'http://localhost:3240/**' }, (req) => {
      req.on('response', (res) => {
        if (res.statusCode >= 400) fails.push({ method: req.method, url: req.url, status: res.statusCode, body: res.body });
      });
    });
    
    const start = new Date(Math.floor((Date.now() - 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    sql(`SELECT id FROM appointments WHERE "patientId"=${o.pets.juniper} AND "isDeleted"=false AND "appointmentStart"::date = (now() AT TIME ZONE 'America/New_York')::date ORDER BY id DESC LIMIT 1`).then((existing) => {
    if (String(existing).trim()) {
      const apptId = Number(String(existing).trim());
      openVisit(apptId);
      return;
    }
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: w.practiceId,
      primaryProviderId: w.doctors.A,
      clientId: o.clients.rivera,
      patientId: o.pets.juniper,
      appointmentTypeId: w.types.medical,
      appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
      description: 'Stiff after naps',
      bookedViaRouting: true,
    }).then((res) => {
      const apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: w.practiceId,
        appointmentId: apptId,
        patientId: o.pets.juniper,
        clientId: o.clients.rivera,
        mode: 'comprehensive',
      });
      openVisit(apptId);
    });
    });
    function openVisit(apptId: number) {
      signIn('technician', `/schedule/soap/${apptId}/${o.pets.juniper}?clientId=${o.clients.rivera}`);
      cy.contains(/Checkout/i, { timeout: 60000 });
      cy.wait(4000);
      shot('osv05c-01-soap');
      cy.get('input[placeholder*="add a charge" i], input[placeholder*="Type here" i]', { timeout: 30000 })
        .first()
        .scrollIntoView()
        .type('Joint support');
      cy.wait(2000);
      shot('osv05c-02-search');
      cy.contains(/Joint support chews \(60 ct\)/).first().click({ force: true });
      cy.wait(3000);
      shot('osv05c-03-added');
      // A prescription item too (the mail control sits with the Rx label).
      cy.get('input[placeholder*="add a charge" i], input[placeholder*="Type here" i]').first().type('Heartworm');
      cy.wait(2000);
      cy.contains(/Heartworm & flea chewable, 22-44 lb/).first().click({ force: true });
      cy.wait(3000);
      shot('osv05c-04-rx-added');
      cy.get('button[title="Enter dose / Rx details"]').first().click();
      cy.wait(2000);
      shot('osv05c-05-rx-row-open');
      cy.get('body').then(($b) => {
        const n = $b.find('.mail-mode__toggle').length;
        cy.writeFile(`${Cypress.env('OSV_OUT')}/osv05c-toggles.json`, { toggles: n });
        if (n) {
          cy.get('.mail-mode__toggle').first().scrollIntoView();
          shot('osv05c-06-toggle');
          cy.get('.mail-mode__toggle').first().contains('button', /^Mail order/).click();
          cy.contains('Send to mail queue', { timeout: 10000 });
          cy.contains('Shipping / pick-up type').parent().find('select').select('ship-499');
          cy.wait(800);
          shot('osv05c-07-prompt');
          cy.contains('button', 'Add to mail queue').click();
          cy.wait(5000);
          shot('osv05c-08-after');
        }
      });
      cy.then(() => cy.writeFile(`${Cypress.env('OSV_OUT')}/osv05c-fails.json`, fails));
    }
  });
});
