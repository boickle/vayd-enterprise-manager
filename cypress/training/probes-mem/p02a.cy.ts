/// <reference types="cypress" />
import '../../support/e2e';
import { pets, resetMembershipWorld, sql } from '../memKit';

const mark = (s: string) => cy.writeFile(Cypress.env('PROBE_OUT') + '/progress.txt', `${new Date().toISOString()} ${s}\n`, { flag: 'a+' });
describe('probe p02a', () => {
  it('setup only', () => {
    mark('start');
    const p = pets();
    mark('pets ' + JSON.stringify(p));
    resetMembershipWorld();
    mark('reset done');
    sql(`UPDATE clients SET "stripeCustomerId"='cus_memtrain_maria' WHERE id=${p.maria}`);
    mark('update done');
  });
});
