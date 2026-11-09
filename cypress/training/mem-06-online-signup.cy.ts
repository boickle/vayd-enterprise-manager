/// <reference types="cypress" />
/**
 * Training video, MEM-06: walk a client through online signup (docs/training/scripts/memberships/MEM-06-online-signup.md).
 * TEST stack on Stripe TEST mode, demo names only. Maria's portal login; Juniper (cat, 6 y) has a wellness visit
 * booked in 3 days (the signup page asks for a booked visit first). She joins Feline Foundations monthly with
 * Stripe's test Visa. The last line shows Juniper's chart as staff see it.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { openVisit, stripeField } from './invKit';
import { chartUrl, pets, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-06 online signup', () => {
  it('MEM-06', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    openVisit(p.juniper, p.maria, 'Wellness visit', -60 * 24 * 3);
    signInAsScheduling('client', '/client-portal/membership-signup');
    cy.contains('Choose a pet', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    const card = () => cy.contains('h3', /^Foundations$/).closest('.cp-plan-card');
    trace('clock');
    startClock();
    trace('m06-01'); line('m06-01');
    trace('m06-02'); line('m06-02');
    trace('m06-03'); line('m06-03', () => pointAt(() => cy.contains('Choose a pet').parent(), 6000));
    trace('m06-04'); line('m06-04', () => {
      tap(() => cy.contains('Juniper'));
      cy.contains('Available Membership Plans', { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    trace('m06-05'); line('m06-05', () => {
      const rec = () => cy.contains('We recommend the').parent();
      settle(rec);
      pointAt(rec, 5000);
    });
    trace('m06-06'); line('m06-06', () => {
      settle(card);
      pointAt(card, 5000);
    });
    trace('m06-07'); line('m06-07', () => {
      tap(() => card().contains('button', 'Add to Cart'));
      settle(() => cy.contains('button', 'Pay Monthly'));
    });
    trace('m06-08'); line('m06-08', () => tap(() => cy.contains('button', 'Pay Monthly')));
    trace('m06-09'); line('m06-09', () => pointAt(() => cy.contains('Cost Summary').parent(), 4500));
    trace('m06-10'); line('m06-10', () => {
      const ag = () => cy.contains('h3', 'Vet At Your Door Membership Agreement').parent();
      settle(ag);
      pointAt(ag, 3000);
      settle(() => cy.contains('h3', 'Vet At Your Door Membership Agreement').parent().find('input[type="checkbox"]').first());
    });
    trace('m06-11'); line('m06-11', () => tap(() => cy.contains('h3', 'Vet At Your Door Membership Agreement').parent().find('input[type="checkbox"]').first()));
    trace('m06-12'); line('m06-12', () => typeSlowly(() => cy.get('input[placeholder="Type your full name"]'), 'Maria Rivera'));
    trace('m06-13'); line('m06-13', () => {
      tap(() => cy.contains('button', 'Continue to Payment'));
      cy.get('#card-container iframe', { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    trace('m06-13b'); line('m06-13b', () => {
      settle(() => cy.get('input[placeholder="Full name on card"]'));
      typeSlowly(() => cy.get('input[placeholder="Full name on card"]'), 'Maria Rivera');
    });
    trace('m06-13c'); line('m06-13c', () => {
      typeSlowly(() => cy.get('input[placeholder="Address line 1"]'), '100 Test Lane');
      typeSlowly(() => cy.get('input[placeholder="City"]'), 'Raleigh');
      typeSlowly(() => cy.get('input[placeholder="State"]'), 'NC');
      typeSlowly(() => cy.get('input[placeholder="Postal Code"]'), '27601');
    });
    trace('m06-14'); line('m06-14', () => {
      settle(() => cy.get('#card-container'));
      pointAt(() => cy.get('#card-container'), 1500);
      stripeField('#card-container', 'cardnumber', '4242424242424242');
      stripeField('#card-container', 'exp-date', '1234');
      stripeField('#card-container', 'cvc', '123');
      stripeField('#card-container', 'postal', '27606');
    });
    trace('m06-15'); line('m06-15', () => tap(() => cy.contains('button', 'Pay & Enroll')));
    offCamera(() => cy.contains(/Sign up another pet/i, { timeout: 120000 }).should('exist'));
    trace('m06-16'); line('m06-16', () => {
      const ok = () => cy.contains('Payment Successful').parent();
      settle(ok);
      pointAt(ok, 5000);
    });
    offCamera(() => {
      signInAsScheduling('cl', chartUrl(p.juniper));
      quietChart();
      cy.get('.pmp-summary__plan', { timeout: 60000 }).should('be.visible');
      cy.wait(1000);
    });
    trace('m06-17'); line('m06-17', () => pointAt(() => cy.get('.pmp-summary'), 5000));
    trace('m06-18'); line('m06-18');
    trace('done');
    finish();
  });
});
