import {
  clearSeededHouseholdVisits,
  schedulingApi,
  schedulingWorld,
} from './schedulingWorld';

/** Household A's existing-client form, up to (not including) Submit, with the given pets checked. */
export function fillExistingClientForm(petIndexes: number[]) {
  // The household's saved details prefill once the client record has loaded.
  cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
  cy.contains('Is this the place we are doing the visit?')
    .parent()
    .find('input[value="Yes"]')
    .check();
  cy.contains('Is your mailing address the same as this location?')
    .parent()
    .find('input[type="radio"]')
    .first()
    .check();
  cy.get('input[type="checkbox"]', { timeout: 10000 });
  for (const i of petIndexes) {
    // The pet's own checkbox is the first one in its card (a calming-medication box appears after it).
    cy.get('[data-pet-id]').eq(i).find('input[type="checkbox"]').first().check();
    // Only a checked pet's card shows its reason buttons, so look inside that pet's card.
    cy.get('[data-pet-id]').eq(i).find('[data-visit-reason="not-feeling-well"]').click();
  }
  cy.get('textarea').first().type('Limping since yesterday');
  cy.contains('How soon do you need to be seen?').scrollIntoView();
  cy.get('[data-how-soon="Flexible"]').click();
  // Submit is not accepted while the form is still checking online scheduling options.
  cy.contains('Checking online scheduling options', { timeout: 30000 }).should('not.exist');
  // The slot picker is not driven here (the POST is rewritten to the seeded slot), so the form is in its
  // manual-scheduling mode, which wants a note about timing before it will submit.
  cy.get('textarea[placeholder^="For example: mornings"]').type('Any time works');
}

/** A made-up visitor address: the form endpoint allows 3 submissions an hour per IP, and the API trusts X-Forwarded-For from loopback. */
export function freshVisitorIp(): string {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
}

/** Scrolls an element clear of the portal's sticky header so Cypress sees it as visible. */
export function showOnScreen(subject: Cypress.Chainable<JQuery<HTMLElement>>) {
  return subject.scrollIntoView({ offset: { top: -160, left: 0 } });
}

/** Call from beforeEach: clean calendar, visit history, and the stubs the public form needs. */
export function setUpPortalForm() {
    // The portal header is sticky and would cover fields scrolled to the top.
    Cypress.config('scrollBehavior', 'center');
    clearSeededHouseholdVisits();
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
    // Reference data the form loads; the client's own pets and contact come from the real API.
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', {
      fixture: 'species-breeds.json',
    }).as('getSpecies');
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', {
      fixture: 'breeds.json',
    }).as('getBreeds');
    // Appointment types come from the real API; the seeded Medical Visit is not flagged for the request form, so
    // flag it in the response (display setup only) to make it a pickable reason card.
    cy.intercept('GET', '**/appointment-types*', (req) => {
      // No conditional GET: a 304 has no body to patch.
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
      req.continue((res) => {
        const rows: any[] = Array.isArray(res.body) ? res.body : (res.body?.items ?? []);
        const patched = rows.map((t) =>
          Number(t.id) === schedulingWorld().types.medical
            ? { ...t, showInApptRequestForm: true, newPatientAllowed: true }
            : t
        );
        res.send(200, Array.isArray(res.body) ? patched : { ...res.body, items: patched }, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        });
      });
    });
    cy.intercept('GET', '**/public/appointments/find-zone-by-address*', { statusCode: 200 }).as(
      'checkZone'
    );
    cy.intercept('POST', '**/public/appointments/availability', {
      fixture: 'availability-slots.json',
    }).as('getAvailability');
    cy.intercept('GET', '**/public/appointments/veterinarians*', {
      fixture: 'veterinarians.json',
    }).as('getPublicVeterinarians');
    cy.intercept('GET', '**/employees/veterinarians*', { fixture: 'veterinarians.json' }).as(
      'getVeterinarians'
    );
}

/**
 * Waits for the form submit's response. The API takes a while to answer (it renders the request PDF), the form
 * gives up on a slow first try and sends it again with the same session, and the API returns the saved submission
 * for the repeat. The first try then has no response, so keep waiting until one does.
 */
export function waitForFormResponse(alias: string): Cypress.Chainable<any> {
  return cy.wait(alias, { timeout: 90000 }).then((interception: any) =>
    interception.response ? interception : waitForFormResponse(alias)
  );
}
