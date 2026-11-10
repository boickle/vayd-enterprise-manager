/// <reference types="cypress" />
// Prep (not a video): asks IDEXX for new results now, as "Check IDEXX now" does (the training stack runs no jobs),
// and re-reads order 1's status.
import '../../support/e2e';
import { labsApi } from '../labsTraining';

describe('prep: sync IDEXX results', () => {
  it('syncs', () => {
    labsApi('doctorA', 'POST', '/idexx/results/sync', {}).then((r) => cy.writeFile(Cypress.env('PROBE_OUT') + '/sync.json', r.body));
    labsApi('doctorA', 'GET', '/idexx/orders/1?refresh=true').then((r) =>
      cy.writeFile(Cypress.env('PROBE_OUT') + '/order.json', { status: r.status, s: r.body?.status, d: r.body?.statusDetail })
    );
  });
});
