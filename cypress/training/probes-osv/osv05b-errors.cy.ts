/// <reference types="cypress" />
/** OSV-05 probe, part 2: record every failed API reply while the tech sends a bill line to the mail queue. */
import '../../support/e2e';
import { schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { osv, shot, signIn, sql } from './osvKit';

describe('OSV-05 errors', () => {
  it('Add to mail queue as the tech, pickup and then ship', () => {
    const w = schedulingWorld();
    const o = osv();
    const fails: Array<{ method: string; url: string; status: number; body: unknown }> = [];
    cy.intercept({ url: 'http://localhost:3240/**' }, (req) => {
      req.on('response', (res) => {
        if (res.statusCode >= 400) fails.push({ method: req.method, url: req.url, status: res.statusCode, body: res.body });
      });
    });
    
    schedulingApi<{ id: string }>('technician', 'POST', '/visit-invoices/counter', {
      practiceId: w.practiceId,
      patientId: o.pets.juniper,
      clientId: o.clients.rivera,
    }).then((res) => {
      const id = res.body.id;
      schedulingApi('technician', 'POST', `/visit-invoices/${id}/lines`, {
        practiceId: w.practiceId,
        patientId: o.pets.juniper,
        description: 'Joint support chews (60 ct)',
        qty: 1,
        unitPrice: 36,
        catalogItemId: o.items.joint,
        catalogItemType: 'inventory',
        providerEmployeeId: w.doctors.A,
      });
      signIn('technician', `/schedule/clients?clientId=${o.clients.rivera}&tab=financial&invoice=${id}`);
      cy.contains('Joint support chews', { timeout: 40000 });
      cy.wait(2500);
      cy.get('.mail-mode__toggle').contains('button', /^Mail order/).first().scrollIntoView().click();
      cy.contains('Send to mail queue', { timeout: 10000 });
      cy.wait(1000);
      shot('osv05b-01-default');
      cy.contains('Shipping / pick-up type').parent().find('select').then(($sel) => {
        const opts = [...$sel.find('option')].map((o) => ({ v: (o as HTMLOptionElement).value, t: (o as HTMLOptionElement).text }));
        cy.writeFile(`${Cypress.env('OSV_OUT')}/osv05b-options.json`, opts);
        const pick = opts.find((x) => x.v && /Brunswick/.test(x.t)) || opts.find((x) => x.v);
        if (pick) cy.wrap($sel).select(pick.v);
      });
      cy.wait(800);
      cy.contains('button', 'Add to mail queue').click();
      cy.wait(5000);
      shot('osv05b-02-after');
      cy.then(() => cy.writeFile(`${Cypress.env('OSV_OUT') || 'cypress/training-out'}/osv05b-fails.json`, fails));
    });
  });
});
