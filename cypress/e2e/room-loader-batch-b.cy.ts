/// <reference types="cypress" />

/**
 * Room Loader go-live plan (vayd-api docs/test-plans/room-loader.md), batch B, end-to-end:
 * RL-03-1, RL-03-4 to RL-03-15, RL-02b-5, RL-11-3.
 *
 * Each case seeds one sent room loader with the cypress task `seedRoomLoader` (cypress.config.ts,
 * "H-RL") and opens the public form from the returned link. The task currently seeds one plain
 * dog; the scenario columns of section 4 are passed as a `scenario` object so the task can grow
 * to honour them:
 *   { species, ageMonths, history: [{ code, monthsAgo, declined? }], membership: 'foundations' | 'golden',
 *     visit: 'wellness' | 'qol', labs: 'yes' | 'no', settings: { <path>: value }, pets: n,
 *     reminders: [{ code, quantity }] }
 * Stripe and email are the API's fakes; nothing real is sent or charged. Needs the API on
 * vayd_api_test and the dev server pointed at it.
 *
 * Status: run against the test stack. The seed task reads `scenario`. RL-03-10 (open question) and
 * RL-03-13/14 (no Stripe fake) are skipped; RL-02b-5 fails on a real product gap (no price breaks in the form).
 */
type Seeded = { loaderId: number; token: string; petName: string; path: string };

const seed = (scenario: Record<string, unknown> = {}) =>
  cy.task<Seeded>('seedRoomLoader', { scenario });

const openForm = (scenario?: Record<string, unknown>) =>
  seed(scenario).then((s) => {
    cy.visit(s.path);
    cy.contains(s.petName, { timeout: 20000 }).should('be.visible');
    return cy.wrap(s);
  });

const answerBasics = () => {
  // Every pet on the form (pet0_, pet1_, ...).
  cy.get('input[name$="_eatingDrinkingNormal"][value="yes"]').each(($el) => cy.wrap($el).check());
  cy.get('body').then(($b) => {
    $b.find('input[name$="_foodAllergies"][value="no"]').each((_, el) => {
      cy.wrap(el).check();
    });
  });
  cy.get('body').then(($b) => {
    $b.find('textarea[placeholder^="Please describe"]').each((_, el) => {
      cy.wrap(el).type('Friendly');
    });
  });
};

/**
 * Care plan -> labs -> summary for every pet: answers the outdoor question "no" and every lab panel
 * "Not this time" / "No thank you" on the way (the labs page needs an answer), until Submit Form shows.
 */
const toSummary = (): void => {
  cy.get('body').then(($b) => {
    $b.find('input[name$="_outdoorAccess"][value="no"]').each((_, el) => {
      cy.wrap(el).check();
    });
    $b.find('label:contains("Not this time"), label:contains("No thank you")').each((_, el) => {
      cy.wrap(el).click();
    });
  });
  cy.get('body').then(($b) => {
    const click = (re: RegExp) => cy.contains('button', re).click();
    if ($b.find('button:contains("Submit Form")').length) return;
    if ($b.find('button:contains("Next pet")').length) {
      click(/Next pet/i);
      return toSummary();
    }
    if ($b.find('button:contains("Next: Labs")').length) {
      click(/Next: Labs/i);
      return toSummary();
    }
    click(/Next: Summary/i);
    return toSummary();
  });
};

/** Fills the visible pet's check-in answers, then goes to the next pet or on to the care plan. */
const toCarePlan = (): void => {
  answerBasics();
  cy.get('body').then(($b) => {
    if ($b.find('button:contains("Continue to Care Plan")').length) {
      cy.contains('button', /Continue to Care Plan/i).click();
    } else {
      cy.contains('button', /Next pet/i).click();
      toCarePlan();
    }
  });
};

after(() => {
  cy.task('cleanRoomLoader');
});

describe('RL-03: settings-driven form (end to end)', () => {
  it('RL-03-1: a changed offer display name in Settings reaches the form (needs scenario)', () => {
    openForm({ settings: { 'universalOffers.u_ped.displayName': 'Nail spa (QA)' } });
    answerBasics();
    toCarePlan();
    toSummary();
    // Universal add-ons are on the summary page ("Would you like to add anything else").
    cy.contains('Nail spa (QA)').should('be.visible');
  });

  it('RL-03-4: the medications answer shows in the submitted PDF answers', () => {
    openForm().then(() => {
      answerBasics();
      cy.get('textarea[placeholder^="List any medications"]').type('Apoquel 16mg daily');
      cy.intercept('POST', '**/public/room-loader/submit').as('submit');
      toCarePlan();
      toSummary();
      cy.contains('button', /Submit Form/i).click();
      cy.wait('@submit').its('request.body.formData.formAnswersForPdf').then((a) => {
        expect(JSON.stringify(a)).to.contain('Apoquel 16mg daily');
      });
    });
  });

  it('RL-03-5: puppy gets the comprehensive fecal, lepto, Lyme, Bordetella and no senior screen (needs scenario)', () => {
    openForm({ species: 'dog', ageMonths: 3, history: [] });
    answerBasics();
    toCarePlan();
    cy.contains(/Leptospirosis/i).should('exist');
    cy.contains(/Lyme/i).should('exist');
    cy.contains(/Bordetella/i).should('exist');
    cy.contains(/senior/i).should('not.exist');
    // The fecal is a lab, so it is on the Labs page.
    cy.contains('button', /Next: Labs/i).click();
    cy.contains(/Comprehensive Fecal/i).should('exist');
    cy.contains(/senior/i).should('not.exist');
  });

  it('RL-03-6: indoor kitten sees the kitten FeLV offer and no outdoor pitch (needs scenario)', () => {
    openForm({ species: 'cat', ageMonths: 4 });
    answerBasics();
    toCarePlan();
    // The outdoor question is asked on the care plan page.
    cy.get('input[name$="_outdoorAccess"][value="no"]').check();
    cy.contains(/Leukemia|FeLV/i).should('exist');
    // The outdoor question itself is always asked; the outdoor pitch text must be absent.
    cy.contains(/not started the FeLV/i).should('not.exist');
  });

  it('RL-03-7: adult cat FeLV is pitched on outdoor yes and gone on no (needs scenario)', () => {
    openForm({ species: 'cat', ageMonths: 36, history: [] });
    answerBasics();
    toCarePlan();
    cy.get('input[name$="_outdoorAccess"][value="yes"]').check();
    cy.contains(/FeLV/i).should('exist');
    cy.get('input[name$="_outdoorAccess"][value="no"]').check();
    cy.contains(/not started the FeLV/i).should('not.exist');
  });

  it('RL-03-8: crossing out Early Detection on an adult dog asks the 4Dx sub-question (needs scenario)', () => {
    openForm({ species: 'dog', ageMonths: 48 });
    answerBasics();
    toCarePlan();
    cy.contains('button', /Next: Labs/i).click();
    cy.contains(/Early Detection/i).should('exist');
    // Crossing the panel out is "Not this time" on its Yes/No choice.
    cy.contains(/Not this time/i).click();
    cy.contains(/4Dx/i).should('exist');
  });

  it('RL-03-9: senior dog sees the senior screen and no Early Detection (needs scenario)', () => {
    openForm({ species: 'dog', ageMonths: 120 });
    answerBasics();
    toCarePlan();
    cy.contains('button', /Next: Labs/i).click();
    // The senior screen (FIL8659999 / FIL25659999) shows to clients as the Standard/Extended Comprehensive Panel.
    cy.contains(/Standard Comprehensive Panel/i).should('exist');
    cy.contains(/Early Detection Panel/).should('not.exist');
  });

  // OPEN (owner/plan): the form hides the membership pitch for any household with a member (API clientHasMembership), so a
  // Foundations member sees no "Golden recommended". The plan lists this as an open question (section 7). Expected result unchanged.
  it.skip('RL-03-10: senior Foundations member sees Golden recommended with member prices (needs scenario)', () => {
    openForm({ species: 'dog', ageMonths: 120, membership: 'foundations' });
    answerBasics();
    toCarePlan();
    toSummary();
    cy.contains(/Golden/i).should('exist');
    cy.contains(/Recommended/i).should('exist');
  });

  it('RL-03-11: Golden member cat shows "Included in membership" on covered lines (needs scenario)', () => {
    openForm({ species: 'cat', ageMonths: 132, membership: 'golden' });
    answerBasics();
    toCarePlan();
    cy.get('input[name$="_outdoorAccess"][value="no"]').check();
    // Accept the senior screen (the Golden plan covers it).
    cy.contains('button', /Next: Labs/i).click();
    cy.contains('label', /Standard Comprehensive Panel/i).click();
    cy.contains('button', /Next: Summary/i).click();
    cy.contains(/Included in membership/i).should('exist');
  });

  it('RL-03-12: mixed household pitches only the non-member cat (needs scenario)', () => {
    openForm({ pets: [{ species: 'dog', membership: 'foundations' }, { species: 'cat' }] });
    answerBasics();
    toCarePlan();
    toSummary();
    cy.contains(/membership could change/i).should('exist');
    cy.contains(/Rlcat/i).should('exist');
  });

  // BLOCKED: enrolling goes through Stripe from the browser (m.stripe.com) and the test API has no Stripe fake.
  it.skip('RL-03-13: enrolling one pet from the pitch refreshes to member prices (needs scenario, Stripe fake)', () => {
    openForm({ species: 'dog', ageMonths: 48 });
    answerBasics();
    toCarePlan();
    cy.contains(/membership could change/i).click();
    cy.contains('button', /enroll|sign up/i).click();
    cy.contains(/member price|You save/i, { timeout: 20000 }).should('exist');
  });

  // BLOCKED: same as RL-03-13 (no Stripe fake on the test API).
  it.skip('RL-03-14: enrolling two pets posts the $75 credit once and shows no -$75 pre-visit line (needs scenario, Stripe fake)', () => {
    openForm({ pets: [{ species: 'dog' }, { species: 'dog' }] });
    cy.contains(/\$75 .*credit/i).should('exist');
  });

  it('RL-03-15: a QOL visit with labs = no shows no pitch and no vaccine section (needs scenario)', () => {
    openForm({ visit: 'qol', labs: 'no' });
    answerBasics();
    toCarePlan();
    cy.contains(/membership could change/i).should('not.exist');
    cy.contains(/Optional vaccines/i).should('not.exist');
  });
});

describe('RL-02b-5: the PDF matches the summary page (needs scenario)', () => {
  it('shows the same line total on screen and in the downloaded PDF data', () => {
    openForm({ species: 'dog', ageMonths: 48, reminders: [{ code: 'INTERYELLOW', quantity: 6 }] });
    answerBasics();
    toCarePlan();
    cy.intercept('POST', '**/public/room-loader/submit').as('submit');
    toSummary();
    cy.contains('$79.14').should('exist');
    cy.contains('button', /Submit Form/i).click();
    cy.wait('@submit').its('request.body.formData.summaryForPdf.pets.0.rows').then((rows) => {
      const row = (rows as Array<{ name: string; lineTotal: number }>).find((r) => /interceptor/i.test(r.name));
      expect(row?.lineTotal).to.be.closeTo(79.14, 0.005);
    });
  });
});

describe('RL-11-3: store item is charged at the visit price, with no ship wording (needs scenario)', () => {
  it('adds a store item and submits; the summary has the visit price and the PDF data has no ship wording', () => {
    openForm({ species: 'dog', ageMonths: 48 });
    answerBasics();
    toCarePlan();
    cy.intercept('POST', '**/public/room-loader/submit').as('submit');
    toSummary();
    cy.get('input[placeholder="Type to search products..."]').type('Bravecto Chew');
    cy.contains('li', /Bravecto Chew/i, { timeout: 15000 }).scrollIntoView().click();
    cy.contains(/Bring to the visit \(clinic price\)/).should('be.visible');
    cy.contains(/ship to me/i).should('not.exist');
    cy.contains('button', /^Add/i).click();
    cy.contains('button', /Submit Form/i).click();
    cy.wait('@submit').its('request.body.formData.summaryForPdf').then((summary) => {
      expect(JSON.stringify(summary)).not.to.match(/ship/i);
    });
  });
});
