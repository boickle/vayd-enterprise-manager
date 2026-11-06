/// <reference types="cypress" />

/**
 * RL-09-4 (written, not yet run): the public check-in form's item search always sends the link token,
 * so the API can tell it which pets and clients may be priced; a call without the token gets list prices.
 *
 * Needs the API on vayd_api_test and the dev server pointed at it (see cypress.config.ts, "H-RL").
 * TODO: the `seedRoomLoader` task seeds a non-member pet and no catalog item. To also assert the
 * member price on screen, extend test/scripts/room-loader-e2e-seed.ts (vayd-api) with a member pet and an
 * item the membership includes, then assert that item's member price after searching and adding it.
 */
describe('RL-09-4: public form item search and member pricing', () => {
  after(() => {
    cy.task('cleanRoomLoader');
  });

  it('sends the link token with every item search and never prices an id without it', () => {
    cy.task<{ path: string; petName: string; token: string }>('seedRoomLoader').then(({ path, petName, token }) => {
      cy.intercept('GET', '**/public/room-loader/items/search*').as('search');
      cy.visit(path);
      cy.contains(petName, { timeout: 20000 }).should('be.visible');

      // The same call the form makes, without the token: list prices only (no membership/discount fields).
      const api = (Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000');
      cy.request(`${api}/public/room-loader/items/search?q=exam&practiceId=1`).then((res) => {
        expect(res.status).to.eq(200);
        (res.body as Array<Record<string, unknown>>).forEach((row) => {
          expect(row.wellnessPlanPricing, 'wellnessPlanPricing').to.be.undefined;
          expect(row.discountPricing, 'discountPricing').to.be.undefined;
        });
      });

      // Any search the form fired on its own carries the token.
      cy.get('@search.all').then((calls) => {
        (calls as unknown as Array<{ request: { url: string } }>).forEach((c) => {
          expect(new URL(c.request.url).searchParams.get('token')).to.eq(token);
        });
      });
    });
  });
});
