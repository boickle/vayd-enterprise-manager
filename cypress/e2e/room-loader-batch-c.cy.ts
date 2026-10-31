/// <reference types="cypress" />

/**
 * Room Loader go-live plan (vayd-api docs/test-plans/room-loader.md), batch C end-to-end cases that
 * have no component-level twin: RL-04-7 (a recent panel is hidden, staff "labs = yes" brings panels
 * back after a resend) and RL-05-8 (the VAYD settings document uses one 10-month window).
 *
 * Seeds with the cypress tasks `seedRoomLoader` (scenario object, see room-loader-batch-b.cy.ts),
 * `resendRoomLoader` (staff change the labs answer) and `cleanRoomLoader` (cypress.config.ts, "H-RL").
 */
type Seeded = { loaderId: number; token: string; petName: string; path: string };

const answerBasics = () => {
  cy.get('input[name$="_eatingDrinkingNormal"][value="yes"]').each(($el) => cy.wrap($el).check());
  cy.get('body').then(($b) => {
    $b.find('input[name$="_foodAllergies"][value="no"]').each((_, el) => {
      cy.wrap(el).check();
    });
    $b.find('textarea[placeholder^="Please describe"]').each((_, el) => {
      cy.wrap(el).type('Friendly');
    });
  });
};

/** Opens the form, answers the check-in and lands on the care plan. */
const openToCarePlan = (s: Seeded) => {
  cy.visit(s.path);
  cy.contains(s.petName, { timeout: 20000 }).should('be.visible');
  answerBasics();
  cy.contains('button', /Continue to Care Plan/i).click();
  cy.contains(/Veterinary Care Plan/i, { timeout: 20000 });
};

/** Text of the labs page for the open care plan: its "Next: Labs" page if the form has one. */
const labsPageText = () => {
  cy.get('body').then(($b) => {
    if ($b.find('button:contains("Next: Labs")').length) cy.contains('button', /Next: Labs/i).click();
  });
  return cy.get('body').invoke('text');
};

after(() => {
  cy.task('cleanRoomLoader');
});

describe('RL-04-7: a panel done last month is hidden until staff say labs = yes', () => {
  it('no Early Detection panel first; panels after the resend', () => {
    cy.task<Seeded>('seedRoomLoader', {
      scenario: { species: 'dog', ageMonths: 48, history: [{ code: 'FIL48719999', monthsAgo: 1 }], labs: 'no' },
    }).then((s) => {
      openToCarePlan(s);
      labsPageText().should('not.match', /Early Detection Panel/);

      // Staff set "labs would be helpful" = yes and send the loader again.
      cy.task('resendRoomLoader', { loaderId: s.loaderId, labs: 'yes' });
      openToCarePlan(s);
      labsPageText().should('match', /Comprehensive Panel/);
    });
  });
});

describe('RL-05-8: one decline window everywhere', () => {
  it('every vaccine, sub-ask and the outdoor FeLV pitch re-offers after 10 months (cat fecal no longer 11)', () => {
    cy.task<Seeded>('seedRoomLoader', { scenario: { species: 'cat', ageMonths: 48, settings: {} } }).then((s) => {
      const api = Cypress.env('API_URL') || 'http://localhost:3001';
      cy.request(`${api}/public/room-loader/form?token=${encodeURIComponent(s.token)}`).then((res) => {
        const config = res.body.config as Record<string, any>;
        const windows: Array<{ where: string; months: unknown }> = [];
        (config.gatedOffers ?? []).forEach((o: any) =>
          windows.push({ where: `gatedOffers.${o.id}`, months: o.history?.reofferDeclinedAfterMonths }),
        );
        (config.panelRules ?? []).forEach((r: any) =>
          (r.options ?? []).forEach((opt: any) =>
            (opt.subAsks ?? []).forEach((a: any) =>
              windows.push({ where: `panelRules.${r.id}.${opt.id}.${a.id}`, months: a.history?.reofferDeclinedAfterMonths }),
            ),
          ),
        );
        windows.push({ where: 'outdoor', months: config.outdoor?.history?.reofferDeclinedAfterMonths });
        expect(windows.length, 'windows found').to.be.greaterThan(5);
        windows.forEach((w) => expect(w.months, w.where).to.eq(10));
      });
    });
  });
});
