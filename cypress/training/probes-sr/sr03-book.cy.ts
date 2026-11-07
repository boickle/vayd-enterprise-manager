/// <reference types="cypress" />
/** Probe for SR-03: book the Chens through Get Best Route (+ Appointment). */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo, srBook } from './srKit';
import { clearSeededHouseholdVisits } from '../../support/schedulingWorld';

describe('SR-03 book with Get Best Route', () => {
  it('Chen recheck', () => {
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/routing');
    cy.get('input[placeholder="Type doctor name..."]', { timeout: 30000 }).type('Lane');
    cy.wait(1500);
    dump('sr03-doctor-suggest', 'body');
    cy.contains('button, li, [role="option"]', 'Avery Lane').click({ force: true });
    cy.wait(1000);
    cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…').first().select('Recheck');
    cy.wait(800);
    cy.get('input[placeholder="Type last name..."]').type('Chen');
    cy.wait(2000);
    cy.contains('button', 'Chen, Tom').click();
    cy.wait(2000);
    cy.contains('button', /^Biscuit$/).click();
    cy.wait(800);
    cy.wait(1500);
    dump('sr03-form-filled', 'body');
    cy.screenshot('sr03-form-filled', { capture: 'viewport' });
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(1500);
    cy.get('body').then(($b) => {
      if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
    });
    cy.contains('button', 'View Placement', { timeout: 30000 }).first();
    cy.wait(2000);
    dump('sr03-results', 'body');
    cy.screenshot('sr03-results', { capture: 'viewport' });
    cy.contains('button', 'View Placement').first().click();
    cy.wait(3000);
    dump('sr03-placement', 'body');
    cy.screenshot('sr03-placement', { capture: 'viewport' });
    cy.contains('button', /^Book$/).click();
    cy.wait(3000);
    dump('sr03-book-modal');
    cy.screenshot('sr03-book-modal', { capture: 'viewport' });
    dump('sr03-book-modal-chip');
    cy.get('[role="dialog"] textarea[placeholder="Notes for this visit…"]:enabled').first().type('Ear recheck');
    cy.contains('[role="dialog"] button', 'Book appointment').click();
    cy.wait(3000);
    dump('sr03-after-book', 'body');
    cy.screenshot('sr03-after-book', { capture: 'viewport' });
  });
});
