/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-A12-3: a pet with 20 imported eVet vaccinations shows all 20 on the chart, newest first, each with the
 * vaccine name, the lot and the vet. The seeded doses are stored the way the eVet importer stores them (the vaccine
 * only on the treatment item, the vet only as the linked employee). The rabies certificate reprint then carries the
 * vet's name and license, though the dose itself has neither (lot and tag are covered by the vitest in
 * src/utils/patientDocuments.evetRabies.test.ts).
 *
 *   EMR_DB=<test db> CYPRESS_EMR_DB=<test db> npx cypress run --spec cypress/e2e/emr-a12-evet-vaccination-history.cy.ts
 *
 * The dev API must use the same test database. Nothing is charged or sent.
 */
describe('EMR-A12-3: eVet vaccination history', () => {
  let world: EmrWorld;

  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  beforeEach(() => {
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', world.staff.token);
    });
    cy.viewport(1440, 1000);
    cy.visit(`/schedule/patients?patientId=${world.evetVaccines.patientId}`);
  });

  it('shows all 20 doses, newest first, each with its vaccine, lot and vet', () => {
    const { doses, vetName } = world.evetVaccines;
    cy.get('tr[data-chart-row-id^="vaccination:"]', { timeout: 40000 }).should('have.length', doses.length);
    cy.get('tr[data-chart-row-id^="vaccination:"]').then(($rows) => {
      $rows.each((i, row) => {
        // Name and vet are on the row; the lot is in the row's detail text once opened.
        expect(row.textContent, `row ${i} vaccine`).to.contain(doses[i].name.split(' ')[0]);
        expect(row.textContent, `row ${i} vet`).to.contain(vetName.split(' ')[1]);
      });
    });
    // Newest is dose 0 (Rabies 3yr): open it and read the lot.
    cy.get('tr[data-chart-row-id^="vaccination:"]').first().click();
    cy.contains(`Lot: ${doses[0].lot}`, { timeout: 20000 }).should('exist');
  });

  it('reprints the rabies certificate with the vet name and license', () => {
    const { vetName, vetLicense } = world.evetVaccines;
    cy.contains('button', 'Print document', { timeout: 40000 }).click();
    cy.contains('button', 'Rabies certificate').click();
    cy.contains('.chart-print-doc__fact', 'Veterinarian').find('dd').should('contain.text', vetName);
    cy.contains('.chart-print-doc__fact', 'License').find('dd').should('have.text', vetLicense);
  });
});
