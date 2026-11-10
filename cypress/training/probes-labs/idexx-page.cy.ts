/// <reference types="cypress" />
// Probe (not a video): what IDEXX's sandbox order page shows inside Scout's order window.
import '../../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';

const OUT = Cypress.env('PROBE_OUT') as string;
const dumpFrame = (name: string) =>
  cy.get('iframe[title="IDEXX VetConnect PLUS order"]', { timeout: 60000 }).then(($f) => {
    const doc = ($f[0] as HTMLIFrameElement).contentDocument;
    const text = doc?.body?.innerText ?? '(no access)';
    const controls = doc
      ? [...doc.querySelectorAll('input, select, textarea, button, a, [role="button"], label')]
          .map((e) => `${e.tagName} type=${e.getAttribute('type') ?? ''} name=${e.getAttribute('name') ?? ''} id=${e.id} aria=${e.getAttribute('aria-label') ?? ''} text=${(e as HTMLElement).innerText?.trim().slice(0, 60) ?? ''}`)
      : [];
    cy.writeFile(`${OUT}/${name}.txt`, `${doc?.location?.href ?? ''}\n\n${text}\n\n=== CONTROLS\n${controls.join('\n')}`);
  });

describe('probe: IDEXX order page', () => {
  it('opens Finish in IDEXX and dumps the page', () => {
    cy.viewport(1600, 900);
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    void juniper;
    signInAsScheduling('technician', '/schedule/idexx-results');
    cy.contains('[role="tab"]', 'Ordered, not at IDEXX yet', { timeout: 60000 }).click();
    cy.contains('button', 'Finish in IDEXX', { timeout: 60000 }).first().click({ force: true });
    cy.wait(15000);
    dumpFrame('idexx-01-open');
    cy.screenshot('idexx-01-open', { capture: 'viewport' });
    const frameBody = () => cy.get('iframe[title="IDEXX VetConnect PLUS order"]').its('0.contentDocument.body').should('not.be.empty').then(cy.wrap);
    frameBody().contains('Notes').click({ force: true });
    cy.wait(2000);
    dumpFrame('idexx-03-notes');
    cy.screenshot('idexx-03-notes', { capture: 'viewport' });
    frameBody().find('#notes-instr').type('Drinking more for two weeks.', { force: true });
    frameBody().find('#doneButton').click({ force: true });
    cy.wait(1500);
    frameBody().contains('Search All Tests').click({ force: true });
    cy.wait(3000);
    frameBody().find('#searchBarInput').type('Urinalysis', { force: true });
    cy.wait(3000);
    frameBody().contains('Search all IDEXX Tests').click({ force: true });
    cy.wait(5000);
    dumpFrame('idexx-05-all');
    frameBody().contains(/\(910\)/).click({ force: true });
    cy.wait(4000);
    frameBody().contains('Specimen Details').click({ force: true });
    cy.wait(3000);
    dumpFrame('idexx-06-specimen');
    frameBody().find('#P0_UC2_COLLECTION_METHOD_INPUT').select('Cystocentesis', { force: true });
    frameBody().find('#P0_UC2_PATIENT_ON_MEDICATION_INPUT').select('No', { force: true });
    frameBody().find('#P0_UC2_NOTES_INPUT').type('Drinking and urinating more for two weeks.', { force: true });
    frameBody().find('button:visible').filter(':contains("Done")').last().click({ force: true });
    cy.wait(2000);
    dumpFrame('idexx-07-before-order');
    cy.screenshot('idexx-07-before-order', { capture: 'viewport' });
    frameBody().find('#orderButton').click({ force: true });
    cy.wait(12000);
    cy.screenshot('idexx-08-after-order', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(`${OUT}/idexx-08-scout.txt`, d.body.innerText));
    cy.get('body').then(($b) => {
      if ($b.find('iframe[title="IDEXX VetConnect PLUS order"]').length) dumpFrame('idexx-08-after-order');
    });
    dumpFrame('idexx-04-search');
    cy.screenshot('idexx-04-search', { capture: 'viewport' });
  });
});
