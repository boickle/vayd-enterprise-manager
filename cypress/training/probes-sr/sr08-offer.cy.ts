/// <reference types="cypress" />
/** Probe for SR-08 and SR-09: waitlist Juniper (no visit), Recommend slot, Text offer, Texted offers list. */
import '../../support/e2e';
import { signInAsScheduling, includeSeededDoctorsInProviderList } from '../../support/schedulingWorld';
import { dump, resetDemo, srBook } from './srKit';

describe('SR-08 text offer', () => {
  it('waitlist Juniper and text an offer', () => {
    resetDemo();
    srBook('biscuit', 9, 0, 'recheck', 45, 'A', 'Ear recheck');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/waitlist');
    cy.wait(4000);
    cy.contains('button', /^Add to waitlist$/).first().click();
    cy.wait(1500);
    cy.get('[role="dialog"] input').first().type('Rivera');
    cy.wait(2500);
    dump('sr09-add-search');
    cy.get('[role="dialog"]').contains(/Juniper|Rivera/).first().click({ force: true });
    cy.wait(1500);
    cy.get('[role="dialog"]').then(($d) => { const cb = $d.find('label:contains("Maple") input[type=checkbox]'); if (cb.length && (cb[0] as HTMLInputElement).checked) cy.wrap(cb).uncheck(); });
    cy.get('[role="dialog"]').then(($d) => { const cb = $d.find('label:contains("Juniper") input[type=checkbox]'); if (cb.length && !(cb[0] as HTMLInputElement).checked) cy.wrap(cb).check(); });
    cy.get('[role="dialog"] select').first().select('Wellness');
    cy.contains('[role="dialog"] *', 'Next 2 weeks').click({ force: true });
    dump('sr09-add-filled');
    cy.contains('[role="dialog"] button', /^Add to waitlist$/).click({ force: true });
    cy.wait(3000);
    dump('sr09-list', 'body');
    cy.contains('Juniper').parents().filter((_, el) => el.innerText.includes('Recommend slot')).first().within(() => cy.contains('button', 'Recommend slot').click({ force: true }));
    cy.wait(5000);
    dump('sr08-recommend', 'body');
    cy.get('input[placeholder="Type doctor name..."]').type('Lane');
    cy.contains('button, li', 'Avery Lane').click({ force: true });
    cy.wait(800);
    cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…').first().select('Wellness');
    cy.wait(800);
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(2000);
    cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
    cy.contains('button', 'View Placement', { timeout: 40000 }).first().click();
    cy.wait(2500);
    dump('sr08-preview', 'body');
    cy.contains('button', /^Next$/).click();
    cy.wait(2500);
    dump('sr08-book-modal');
    cy.screenshot('sr08-book-modal', { capture: 'viewport' });
    cy.contains('[role="dialog"] button', /^Text offer$/).click();
    cy.wait(2000);
    dump('sr08-offer-window');
    cy.screenshot('sr08-offer-window', { capture: 'viewport' });
    cy.get('[role="dialog"]').last().within(() => cy.contains('button', /^Send|Send text|Send offer/).first().click({ force: true }));
    cy.wait(3000);
    dump('sr08-after-send', 'body');
    signInAsScheduling('cl', '/schedule/scheduling-tools/texted-offers');
    cy.wait(5000);
    dump('sr08-texted-offers', 'body');
    cy.screenshot('sr08-texted-offers', { capture: 'viewport' });
  });
});
