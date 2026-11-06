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
 * Status: run against the test stack. The seed task reads `scenario`. RL-03-13/14 enrol with the Stripe TEST card 4242 (sk_test/pk_test; the API confirms the subscription itself, no webhook); they need `clientEmail` (the sign-up email must match the client's on file) and `stripePackages` (test-mode membership packages) in the scenario. RL-03-14 fails on a real product gap (-$75 line shown); RL-02b-5 fails on a real product gap (no price breaks in the form).
 */
type Seeded = { loaderId: number; token: string; petName: string; path: string };

type SeededVisit = Seeded & {
  patients: Array<{ id: number; name: string; appointmentId: number }>;
  staff: { email: string; password: string };
};
const apiUrl = () =>
  Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000';
const checkoutPath = (pet: { id: number; appointmentId: number }) => `/schedule/soap/${pet.appointmentId}/${pet.id}/checkout`;
/** Opens the visit as staff the way the app does: creating the encounter runs the pre-visit preload. */
const startVisit = (s: SeededVisit, pet: { id: number; appointmentId: number }) =>
  cy.request('POST', `${apiUrl()}/auth/login`, s.staff).then((login) => {
    cy.request({
      method: 'POST',
      url: `${apiUrl()}/soap-encounters`,
      headers: { Authorization: `Bearer ${login.body.accessToken}` },
      body: { practiceId: 1, appointmentId: pet.appointmentId, patientId: pet.id, mode: 'comprehensive' },
    }).its('status').should('be.oneOf', [200, 201]);
  });

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

/**
 * Stripe TEST MODE only (sk_test / pk_test): picks the plan, signs the agreement, fills billing and the
 * Stripe card iframe with the 4242 test card, then clicks Pay & Enroll. Needs chromeWebSecurity: false
 * (cypress.config.ts) to reach the cross-origin Stripe iframe. The API confirms the Stripe subscription itself (no webhook needed).
 */
const watchEnrolments = () => cy.intercept({ method: 'POST', url: /stripe\/payment-processing\/payments$/ }).as('enrol');
const ENROL_EMAIL = 'rl-enrol@vayd.test';
const enrolFromSignup = (): void => {
  cy.contains('button', /Add to Cart/i, { timeout: 20000 }).click();
  cy.contains('label', /agree|accept|read/i).find('input[type="checkbox"]').check();
  cy.get('input[placeholder="Type your full name"]').type('Test Client');
  cy.contains('button', /Continue to Payment/i).should('not.be.disabled').click();
  cy.get('input[placeholder="Full name on card"]');
  cy.get('body').then(($b) => {
    // The email box only shows when the form has no address for the client.
    if ($b.find('input[placeholder="you@example.com"]').length) cy.get('input[placeholder="you@example.com"]').clear().type(ENROL_EMAIL);
  });
  cy.get('input[placeholder="Full name on card"]').type('Test Client');
  cy.get('input[placeholder="Address line 1"]').type('1 Test St');
  cy.get('input[placeholder="City"]').type('Portland');
  cy.get('input[placeholder="State"]').type('ME');
  cy.get('input[placeholder="Postal Code"]').type('04101');
  const stripeField = (name: string, value: string) =>
    cy
      .get('#card-container iframe', { timeout: 30000 })
      .its('0.contentDocument.body')
      .should('not.be.empty')
      .then(cy.wrap)
      .find(`input[name="${name}"]`, { timeout: 30000 })
      .type(value);
  stripeField('cardnumber', '4242424242424242');
  stripeField('exp-date', '1234');
  stripeField('cvc', '123');
  stripeField('postal', '04101'); // appears once the card number is valid
  cy.wait(1500); // let Stripe report the card complete to the form
  cy.contains('button', /Pay & Enroll/i).click();
  cy.wait('@enrol', { timeout: 60000 }).its('response.statusCode').should('eq', 201);
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

  // Owner decision Oct 31, 2026: a member pet is never pitched (no Golden upgrade wording or cards).
  it('RL-03-10: senior Foundations member sees no pitch and no upgrade wording', () => {
    openForm({ species: 'dog', ageMonths: 120, membership: 'foundations' });
    answerBasics();
    toCarePlan();
    toSummary();
    cy.contains(/membership could change/i).should('not.exist');
    cy.contains(/upgrade/i).should('not.exist');
    cy.contains(/Golden/i).should('not.exist');
  });

  it('RL-03-10b: mixed household pitches the non-member cat only and shows the $75 credit offer', () => {
    openForm({ pets: [{ species: 'dog', ageMonths: 120, membership: 'foundations' }, { species: 'cat', ageMonths: 48 }] });
    answerBasics();
    toCarePlan();
    toSummary();
    cy.contains(/membership could change/i).should('exist');
    cy.contains(/Rlcat/i).should('exist');
    cy.contains(/upgrade/i).should('not.exist');
    cy.contains(/\$75/).should('exist');
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

  it('RL-03-13: enrolling one pet from the pitch refreshes to member prices', () => {
    openForm({ species: 'dog', ageMonths: 48, clientEmail: ENROL_EMAIL, stripePackages: true });
    answerBasics();
    toCarePlan();
    toSummary();
    cy.contains('button', /See the full comparison/i).click();
    cy.contains('button', /^Enroll .* in Membership$/i).click();
    cy.contains('button', /Explore Membership Options/i).click();
    watchEnrolments();
    enrolFromSignup();
    cy.get('@enrol.all').should('have.length', 1);
    cy.contains(/Congratulations on becoming a member/i, { timeout: 30000 }).should('be.visible');
    cy.contains(/^member$/i).should('be.visible');
    cy.contains(/updated the prices below to the member rates/i).should('be.visible');
    cy.contains(/membership could change/i).should('not.exist');
    cy.screenshot('rl0313-member');
  });

  it('RL-03-14: enrolling two pets posts the $75 credit once and shows no -$75 pre-visit line', () => {
    cy.task('cleanRoomLoader'); // plans left by earlier cases would muddy the credit count
    openForm({ pets: [{ species: 'dog' }, { species: 'dog' }], clientEmail: ENROL_EMAIL, stripePackages: true }).then((seeded) => {
    const s = seeded as unknown as SeededVisit;
    answerBasics();
    toCarePlan();
    toSummary();
    cy.contains('button', /See the full comparison/i).click();
    cy.contains(/\$75/).should('exist');
    cy.contains('button', /Enroll your pets in Membership/i).click();
    watchEnrolments();
    cy.get('input[type="radio"]').first().check({ force: true });
    cy.contains('button', /Explore Membership Options/i).click();
    enrolFromSignup();
    cy.contains(/Payment successful/i, { timeout: 30000 }).should('exist');
    cy.contains('button', /Sign up another pet/i).click();
    cy.contains('button', /Explore Membership Options/i).click();
    enrolFromSignup();
    // With no pet left to enrol the form closes the dialog and returns to the summary by itself.
    cy.contains(/Congratulations on becoming a member/i, { timeout: 60000 }).should('exist');
    cy.get('@enrol.all').should('have.length', 2);
    // The $75 credit is posted once (second pet only); the first pet earns none.
    cy.task<Array<{ amount: string | null }>>('roomLoaderPlans').then((plans) => {
      expect(plans, 'two enrolments: ' + JSON.stringify(plans)).to.have.length(2);
      const credits = plans.filter((p) => Number(p.amount) > 0);
      expect(credits, 'one credit').to.have.length(1);
      expect(Number(credits[0].amount)).to.eq(75);
    });
    // The client form's own "-$75" line is intended (FE-RL-006); Pre-visit accepts is the staff checkout.
    cy.intercept('POST', '**/public/room-loader/submit').as('submit');
    cy.contains('button', /Submit Form/i).click();
    cy.wait('@submit').its('response.statusCode').should('be.oneOf', [200, 201]);
    s.patients.forEach((pet) => {
      startVisit(s, pet);
      if (pet === s.patients[0]) cy.apiLogin('employee', { ...s.staff, startPath: checkoutPath(pet) });
      else cy.visit(checkoutPath(pet));
      cy.contains(/Payment locks the invoice/i, { timeout: 30000 }).should('exist'); // checkout loaded
      cy.wait(6000); // let the pre-visit panel (if any) render
      cy.get('body').then(($body) => {
        // The panel is absent when nothing is pending; the credit must not appear there or anywhere on the checkout.
        const pre = $body.text();
        expect(pre, 'Pre-visit accepts for ' + pet.name).not.to.match(/multi-pet membership credit/i);
        expect(pre, 'Pre-visit accepts for ' + pet.name).not.to.match(/-\$75/);
      });
    });
    });
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
