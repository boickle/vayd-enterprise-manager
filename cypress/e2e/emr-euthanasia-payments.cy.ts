/// <reference types="cypress" />
import '../support/e2e';
import { chooseCheckoutInventoryShelf, cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-01-6, EMR-02-5, EMR-02-6: euthanasia money on screen.
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-euthanasia-payments.cy.ts
 *
 * The dev API must use the same test database. The world's saved card is the Stripe test reference
 * pm_card_visa on cus_emr_world (see cypress/support/emrWorld.ts): against Stripe test mode that customer
 * must exist first. Amounts are checked on what Scout recorded (card tenders), which is what was
 * captured or charged.
 */

const db = () => String(Cypress.env('EMR_DB') || '');

/** One SQL statement on the EMR test database (refuses anything not named "test"). */
function emrSql(statement: string): Cypress.Chainable<string> {
  if (!/test/i.test(db()) || /vayd_api_local|prod/i.test(db())) {
    throw new Error(`Set CYPRESS_EMR_DB to the EMR test database (got "${db()}")`);
  }
  return cy
    .exec('psql -h localhost -U vayd -d ' + db() + ' -tA -c "$EMR_SQL"', {
      env: { PGPASSWORD: 'vayd', EMR_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

function signIn(world: EmrWorld, path: string) {
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', world.staff.token);
  });
  cy.visit(path);
}

const checkoutPath = (appointmentId: number, patientId: number, clientId: number) =>
  `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${clientId}`;

type Tender = { method: string; amount: string | number; stripePaymentIntentId?: string | null; voidedAt?: string | null };

function invoiceById(world: EmrWorld, id: string) {
  return emrApi(world, 'GET', `/visit-invoices/${id}?practiceId=${world.practiceId}`).then((res) => {
    expect(res.status).to.eq(200);
    return res.body as { id: string; status: string; total: string | number; amountPaid: string | number; tenders?: Tender[]; lines?: Array<{ description: string; isDeleted?: boolean }> };
  });
}

const cardTenders = (inv: { tenders?: Tender[] }) =>
  (inv.tenders ?? []).filter((t) => !t.voidedAt && t.stripePaymentIntentId);

describe('EMR-01-6: Run Payment from Authorization captures the new total (legacy prepay invoice)', () => {
  let world: EmrWorld;
  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('staff removes a line, converts, and the bill shows Paid at the new total', () => {
    const { appointmentId, patientId, invoiceId } = world.visit;
    // An invoice that already uses the old prepay path: flagged prepay with a card saved at booking.
    emrSql(`UPDATE visit_invoices SET "isEuthanasiaPrepay" = true, "stripeSetupIntentId" = 'seti_emr01_6' WHERE id = '${invoiceId}'`);
    emrApi(world, 'POST', '/soap-encounters', { practiceId: world.practiceId, appointmentId, patientId, clientId: world.client.id });
    // The hold on 150.00, placed the old way (checkout "Authorize card").
    emrApi(world, 'POST', `/visit-payments/${invoiceId}/authorize`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(res.body.lastChargeStatus).to.eq('requires_capture');
    });

    signIn(world, checkoutPath(appointmentId, patientId, world.client.id));
    cy.contains('Vaccine - FVRCP', { timeout: 40000 })
      .closest('.soap-invoice-line')
      .find('button[title="Remove from checkout"]')
      .click();
    cy.on('window:confirm', () => true);
    // Wait until the removal has saved (the screen total updates after the DELETE returns).
    cy.contains('Total', { timeout: 20000 }).parent().should('contain.text', '$90.00');
    invoiceById(world, invoiceId).its('total').then((t) => expect(Number(t)).to.eq(90));

    // Pick the inventory branch and location explicitly: the shared test DB may hold several.
    chooseCheckoutInventoryShelf();
    cy.get('[data-testid="prepay-run-payment-from-authorization"]')
      .should('contain.text', 'Run Payment from Authorization')
      .and('not.be.disabled')
      .click();
    // The Paid badge is present but can sit under a fixed header, so check it exists.
    cy.contains(/paid/i, { timeout: 30000 }).should('exist');

    invoiceById(world, invoiceId).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.total)).to.eq(90);
      expect(Number(inv.amountPaid)).to.eq(90);
      // What was captured from the 150 hold is the new total, not the hold.
      const cards = cardTenders(inv);
      expect(cards).to.have.length(1);
      expect(Number(cards[0].amount)).to.eq(90);
    });
  });
});

/** None of the old prepay controls (D1) appear for a visit paid through its estimate. */
function noPrepayButtons() {
  // The old prepay button now has the estimate flow's wording, so look for it by its test id.
  cy.get('[data-testid="prepay-run-payment-from-authorization"]').should('not.exist');
  cy.contains('button', 'Authorize card').should('not.exist');
  cy.contains('button', /^\s*Save card\s*$/).should('not.exist');
}

function invoiceForAppointment(world: EmrWorld, appointmentId: number) {
  return emrApi(world, 'GET', `/visit-invoices/by-appointment/${appointmentId}?practiceId=${world.practiceId}`).then((res) => {
    expect(res.status).to.eq(200);
    return invoiceById(world, res.body.id);
  });
}

describe('EMR-02-5: euthanasia visit start to finish, one charge equal to the bill', () => {
  let world: EmrWorld;
  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('consent hold, doctor charts, End Visit, settle: one charge, no duplicate lines', () => {
    const { appointmentId, patientId, estimateId, estimateTotal } = world.euthanasia;
    // The hold the signed consent form places (the same authorize the form calls once the card is
    // attached; the public form itself is covered by the EMR-03 specs).
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/accept`, { practiceId: world.practiceId });
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/authorize`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(Number(res.body.authorizedAmount)).to.eq(estimateTotal);
    });

    // The doctor opens and charts the SOAP (a note; the quoted items are the bill).
    emrApi(world, 'POST', '/soap-encounters', { practiceId: world.practiceId, appointmentId, patientId, clientId: world.client.id }).then((enc) => {
      expect(enc.status).to.be.lessThan(300);
      emrApi(world, 'PATCH', `/soap-encounters/${enc.body.id}`, {
        practiceId: world.practiceId,
        subjective: 'Family present. Peaceful passing at home.',
      });
    });

    // End Visit (what the scheduler's End Visit saves): no charge happens here, the estimate owns it.
    emrApi(world, 'POST', `/visits/${appointmentId}/completed`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status).to.be.lessThan(300);
      expect(res.body.euthanasiaCharge?.attempted ?? false).to.eq(false);
    });

    signIn(world, checkoutPath(appointmentId, patientId, world.client.id));
    cy.contains('Estimate given to the family', { timeout: 40000 }).should('be.visible');
    noPrepayButtons();
    // Nov 3, 2026: no per-item Accept / Decline. No consent form was signed here, so the bubble has no date.
    cy.get('[data-testid="estimate-authorization-bubble"]', { timeout: 20000 }).should(
      'have.text',
      `This owner approved $${estimateTotal.toFixed(2)} — it will be charged when you click "Run Payment from Authorization".`,
    );
    cy.contains('button', 'Run Payment from Authorization').should('not.be.disabled').click();
    cy.contains('Estimate given to the family', { timeout: 30000 }).should('not.exist');

    invoiceForAppointment(world, appointmentId).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.total)).to.eq(estimateTotal);
      expect(Number(inv.amountPaid)).to.eq(estimateTotal);
      const live = (inv.lines ?? []).filter((l) => !l.isDeleted);
      expect(live.map((l) => l.description).sort()).to.deep.eq(['Euthanasia - at home', 'Private cremation - small']);
      const cards = cardTenders(inv);
      expect(cards).to.have.length(1);
      expect(Number(cards[0].amount)).to.eq(estimateTotal);
    });
    noPrepayButtons();
  });
});

describe('EMR-02-6: phone path for families who cannot use the online form', () => {
  let world: EmrWorld;
  let secondWitnessId: number;
  before(() =>
    seedEmrWorld().then((w) => {
      world = w;
      // More than a day out, and no card yet: the liaison takes it by phone.
      emrSql(`UPDATE appointments SET "appointmentStart" = now() + interval '3 days', "appointmentEnd" = now() + interval '3 days 1 hour' WHERE id = ${w.euthanasia.appointmentId}`);
      emrSql(`UPDATE visit_estimates SET "savedPaymentMethodId" = NULL WHERE id = '${w.euthanasia.estimateId}'`);
      // A second staff member to witness oral consent (invented).
      emrSql(
        `INSERT INTO employees ("firstName","lastName",email,"isProvider","practiceId","pimsId","pimsType","isActive","isDeleted")
         VALUES ('Tamsin','Reedly','${w.tag}+witness@vayd.test',false,${w.practiceId},'${w.tag}-witness','EMRTEST',true,false) RETURNING id`,
      ).then((id) => (secondWitnessId = Number(id)));
    }),
  );
  after(() => {
    if (secondWitnessId) emrSql(`DELETE FROM employees WHERE id = ${secondWitnessId}`);
    cleanEmrWorld();
  });

  it('card by phone, hold only inside 24 h, oral consent with two witnesses, one charge equal to the bill', () => {
    const { appointmentId, patientId, estimateId, estimateTotal } = world.euthanasia;

    // The liaison opens the estimate from the scheduler's Euthanasia consent and sees "Take card".
    signIn(world, checkoutPath(appointmentId, patientId, world.client.id));
    cy.contains('Estimate given to the family', { timeout: 40000 }).should('be.visible');
    // The checkout panel scrolls inside the fixed page shell and Wave 4's estimate list pushes this button below the
    // fold; bring it into view in that scroll area first (centred, clear of the fixed header).
    cy.contains('button', 'Take card', { timeout: 20000 })
      .should('exist')
      .scrollIntoView({ offset: { top: -250, left: 0 } })
      .should('be.visible');
    noPrepayButtons();

    // "Take card" saves the card on the estimate (EstimateCardModal confirms it in Stripe, then saves it).
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/payment-method`, {
      practiceId: world.practiceId,
      paymentMethodId: world.savedCard.paymentMethodId,
    }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(res.body.savedPaymentMethodId).to.eq(world.savedCard.paymentMethodId);
      // Three days out: no hold yet.
      expect(res.body.lastChargeStatus).not.to.eq('requires_capture');
    });

    // The visit moves inside 24 h; the sweep places the hold (the same authorize it calls).
    emrSql(`UPDATE appointments SET "appointmentStart" = now() - interval '30 minutes', "appointmentEnd" = now() + interval '30 minutes' WHERE id = ${appointmentId}`);
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/authorize`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(res.body.lastChargeStatus).to.eq('requires_capture');
    });

    // At the visit the doctor records oral consent heard by two staff.
    emrApi(world, 'POST', '/consent/euthanasia/witness', {
      appointmentId,
      patientId,
      method: 'oral',
      witnessEmployeeIds: [world.staff.employeeId, secondWitnessId],
    }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(JSON.stringify(res.body)).to.match(/oral/i);
      expect(JSON.stringify(res.body)).to.match(/Tamsin|Reedly|Oakhollow/);
    });

    emrApi(world, 'POST', `/visits/${appointmentId}/completed`, { practiceId: world.practiceId });
    signIn(world, checkoutPath(appointmentId, patientId, world.client.id));
    cy.contains('Estimate given to the family', { timeout: 40000 }).should('be.visible');
    noPrepayButtons();
    // Nov 3, 2026: the bubble names the day the oral consent was recorded (today); the click charges.
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    cy.get('[data-testid="estimate-authorization-bubble"]', { timeout: 20000 }).should(
      'contain.text',
      `This owner approved $${estimateTotal.toFixed(2)} on ${today} — it will be charged when you click "Run Payment from Authorization".`,
    );
    cy.contains('button', 'Run Payment from Authorization').should('not.be.disabled').click();
    cy.contains('Estimate given to the family', { timeout: 30000 }).should('not.exist');

    invoiceForAppointment(world, appointmentId).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.amountPaid)).to.eq(estimateTotal);
      const cards = cardTenders(inv);
      expect(cards).to.have.length(1);
      expect(Number(cards[0].amount)).to.eq(Number(inv.total));
    });
    noPrepayButtons();
  });
});
