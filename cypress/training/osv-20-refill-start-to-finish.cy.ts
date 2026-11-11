/// <reference types="cypress" />
/**
 * Training video OSV-20: an online refill from start to finish. TEST stack, Stripe TEST mode, EasyPost test key.
 * Setup: Maria's saved test Visa (a store order bought and removed before the clock); Maple's heartworm Rx has 3 refills.
 * Maria reorders it from the portal; Riley fills and ships it; Robin checks it and emails Maria (email captured).
 */
import '../support/e2e';
import { buyAsMaria, look, osv, press, resetStoreData, signIn, sql } from './osvTraining';
import { openOrder, openOrderQuietly, waitForLabel, resetRefills, selectByText } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-20 refill start to finish', () => {
  it('OSV-20', () => {
    const o = osv();
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    buyAsMaria({ tab: 'Dental', item: 'Dental chews', pet: 'Maple', autoship: false }).then((id) =>
      sql(`DELETE FROM mail_orders WHERE id=${id} AND "clientId"=${o.clients.rivera}`)
    );
    signIn('client', '/client-portal');
    cy.contains('.pp-greeting-name', 'Maria', { timeout: 40000 });
    cy.contains('button.pp-switch', 'Maple', { timeout: 30000 }).click();
    cy.get('section[aria-label="Medications"]', { timeout: 30000 }).then(($s) => $s[0].scrollIntoView({ block: 'center' }));
    cy.wait(1500);
    startClock();

    line('r01-why');
    line('r02-portal', () => look(() => cy.contains('.pp-med', 'Heartworm'), 4000));
    line('r03-reorder', () => tap(() => cy.contains('.pp-med', 'Heartworm').contains('button', /Reorder/)));
    line('r04-cart', () => {
      cy.contains('button', /^Place order$/, { timeout: 30000 });
      cy.get('body').then(($b) => {
        if ($b.text().includes('Yes — send it here')) cy.contains('label', 'Yes — send it here').click();
      });
      look(() => cy.contains(/^Total$/).parent(), 3500);
    });
    line('r05-place', () => {
      press(() => cy.contains('button', /^Place order$/).should('not.be.disabled'));
      cy.contains('h1', 'Thank you', { timeout: 60000 });
    });
    offCamera(() => {
      sql(`SELECT max(id) FROM mail_orders WHERE "clientId"=${o.clients.rivera}`).then((v) => (orderId = Number(String(v).trim())));
      signIn('mailteam', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.wait(1500);
    });
    line('r06-queue', () => tap(() => cy.contains('button', /^Fill$/)));
    line('r07-refill', () => {
      openOrder(() => orderId);
      look(() => cy.contains(/left on prior Rx/, { timeout: 20000 }).first(), 3000);
      look(() => cy.contains('Give one chewable by mouth once a month with food.').first(), 3000);
    });
    line('r08-office', () => selectByText(/^Filling from office/, /Raleigh/));
    line('r08b-location', () => selectByText(/^Location/, /Office shelf/));
    line('r09-filled', () => press(() => cy.contains('button', /^Mark filled$/)));
    line('r10-ship', () => {
      tap(() => cy.contains('button', /^Ship \/ pickup/, { timeout: 30000 }));
      openOrder(() => orderId);
    });
    line('r11-weight', () => typeSlowly(() => cy.contains('label', 'Package weight (oz)', { timeout: 20000 }).find('input'), '6'));
    line('r12-rates', () => {
      press(() => cy.contains('button', /^Get cheapest rates$/));
      cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled');
    });
    line('r13-label', () => press(() => cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled')));
    offCamera(() => {
      waitForLabel(() => orderId);
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.contains('button', /^Check$/).click();
      cy.wait(1000);
      openOrderQuietly(() => orderId);
      cy.contains(/Filled by Riley Brooks/, { timeout: 20000 });
      cy.wait(600);
    });
    line('r14-check', () => look(() => cy.contains(/Filled by Riley Brooks/).first(), 3500));
    line('r15-checked', () => press(() => cy.contains('button', /^I checked Maple$/)));
    line('r16-tell', () => {
      tap(() => cy.contains('button', /^Contacted$/, { timeout: 30000 }));
      openOrder(() => orderId);
      look(() => cy.contains('button', /^Email client$/, { timeout: 20000 }), 2500);
    });
    line('r17-email', () => {
      tap(() => cy.contains('button', /^Email client$/));
      cy.contains('button', /^Send email$/, { timeout: 20000 });
    });
    line('r17b-send', () => press(() => cy.contains('button', /^Send email$/)));
    line('r18-done', () => look(() => cy.contains('Client was emailed.', { timeout: 30000 }).parent(), 3000));
    line('r19-mistakes');
    line('r20-remember');
    finish();
  });
});
