/// <reference types="cypress" />
/**
 * Training video OSV-27: + New mail order for packages that are not a pharmacy fill (ash returns).
 * TEST stack, EasyPost test key. Riley sends Pepper's ashes (Pepper marked inactive for this video) to Maria, then
 * a second package to Jenna Rivera, who isn't a client, with the address typed in. Ships from the default office.
 */
import '../support/e2e';
import { look, press, resetStoreData, schedulingWorld, signIn, sql } from './osvTraining';
import { openOrder, openOrderQuietly, waitForLabel } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

const latestPackage = () =>
  sql(`SELECT max(id) FROM mail_orders WHERE "packageShipment" = true`).then((v) => Number(String(v).trim()));

describe('Training: OSV-27 new mail order (ashes and other packages)', () => {
  const pepper = () => schedulingWorld().households.A.inactivePetId;
  after(() => {
    sql(`UPDATE patients SET "isActive"=true WHERE id=${pepper()}`);
  });

  it('OSV-27', () => {
    let maria = 0;
    let jenna = 0;
    loadNarration();
    resetStoreData();
    sql(`UPDATE patients SET "isActive"=false WHERE id=${pepper()}`);
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();

    line('p01-why', () => look(() => cy.contains('button', '+ New mail order'), 3000));
    line('p02-open', () => {
      tap(() => cy.contains('button', '+ New mail order'));
      cy.contains('h3', 'New mail order');
    });
    line('p03-client', () => {
      typeSlowly(() => cy.get('input[placeholder="Search client"]'), 'Rivera');
      cy.contains('.mail-queue__hits button', 'Maria Rivera', { timeout: 20000 }).click();
    });
    line('p04-inactive', () => {
      press(() => cy.get('.mail-queue__inactive input').eq(1));
      cy.get('input[placeholder="Search patient"]').type('Pep', { delay: 80 });
      cy.contains('.mail-queue__hits button', 'Pepper', { timeout: 20000 });
    });
    line('p05-pet', () => press(() => cy.contains('.mail-queue__hits button', 'Pepper')));
    line('p06-info', () => typeSlowly(() => cy.get('textarea[placeholder^="e.g. Ashes"]'), 'Ashes – cedar urn for Pepper'));
    line('p07-from', () => look(() => cy.get('[data-testid="new-mail-ship-from"]'), 4500));
    line('p08-add', () => press(() => cy.contains('button', 'Add to queue').should('not.be.disabled')));
    offCamera(() => {
      cy.contains('h3', 'New mail order').should('not.exist');
      latestPackage().then((id) => (maria = id));
    });
    line('p09-ship', () => {
      openOrder(() => maria);
      look(() => cy.contains('100 Test Lane', { timeout: 20000 }).first(), 3000);
    });
    line('p10-weight', () => typeSlowly(() => cy.contains('label', 'Package weight (oz)', { timeout: 20000 }).find('input'), '48'));
    line('p11-rates', () => {
      press(() => cy.contains('button', /^Get cheapest rates$/));
      cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled');
    });
    line('p12-label', () => press(() => cy.contains('button', /^Print cheapest label$/).should('not.be.disabled')));
    offCamera(() => waitForLabel(() => maria));
    line('p13-tell');

    line('p14-noclient', () => {
      tap(() => cy.contains('button', '+ New mail order'));
      cy.contains('h3', 'New mail order');
    });
    line('p15-sendto', () => typeSlowly(() => cy.get('[data-testid="new-mail-send-to"]'), 'Jenna Rivera'));
    line('p16-info', () => typeSlowly(() => cy.get('textarea[placeholder^="e.g. Ashes"]'), 'Ashes – cedar urn for Pepper'));
    line('p17-add', () => press(() => cy.contains('button', 'Add to queue').should('not.be.disabled')));
    offCamera(() => {
      cy.contains('h3', 'New mail order').should('not.exist');
      latestPackage().then((id) => (jenna = id));
    });
    line('p18-open', () => {
      openOrder(() => jenna);
      look(() => cy.contains('No shipping address yet', { timeout: 20000 }), 2500);
    });
    line('p19-address', () => press(() => cy.contains('button', /^Add address$/)));
    line('p19b-type', () => press(() => cy.contains('button', 'PO Box or not listed? Type it in')));
    line('p19c-fields', () => {
      typeSlowly(() => cy.get('input[aria-label="Address line 1"]'), '215 Glenwood Ave');
      cy.get('input[aria-label="City"]').type('Raleigh', { delay: 60 });
      cy.get('input[aria-label="State"]').type('NC', { delay: 60 });
      cy.get('input[aria-label="ZIP"]').type('27603', { delay: 60 });
    });
    line('p20-save', () => {
      press(() => cy.contains('button', /^Save address$/).should('not.be.disabled'));
      cy.contains('215 Glenwood Ave', { timeout: 20000 });
    });
    line('p21-weight', () => typeSlowly(() => cy.contains('label', 'Package weight (oz)', { timeout: 20000 }).find('input'), '48'));
    line('p21b-rates', () => {
      press(() => cy.contains('button', /^Get cheapest rates$/));
      cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled');
    });
    line('p21c-label', () => press(() => cy.contains('button', /^Print cheapest label$/).should('not.be.disabled')));
    offCamera(() => {
      waitForLabel(() => jenna);
      cy.contains('button', /^Contacted$/).click();
      cy.wait(1000);
      openOrderQuietly(() => jenna);
      cy.contains('button', /^Do not contact client$/, { timeout: 20000 });
      cy.wait(600);
    });
    line('p22-contact', () => press(() => cy.contains('button', /^Do not contact client$/)));
    line('p23-find', () => {
      tap(() => cy.contains('button', /^Packages$/));
      cy.then(() => look(() => cy.contains(`#${jenna}`, { timeout: 20000 }).closest('.mail-queue__card'), 3000));
    });
    line('p23b-search', () => typeSlowly(() => cy.get('input[placeholder^="Order #"]'), 'ashes'));
    line('p24-mistakes');
    line('p25-remember');
    finish();
  });
});
