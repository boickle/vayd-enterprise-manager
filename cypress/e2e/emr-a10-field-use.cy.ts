/// <reference types="cypress" />
import '../support/e2e';
import {
  addOrder,
  emrApi,
  emrWorld,
  giveInvoiceItsShelf,
  openEncounter,
  signInEmr,
  soapPath,
  stubCardPayments,
  visitInvoice,
} from '../support/emrCoreVisitWorld';

/**
 * EMR-A10: working in the field (weak or no signal).
 *
 * The network is cut with cy.intercept(..., { forceNetworkError: true }), which makes the browser see a dropped
 * connection (no HTTP answer), the same as a lost signal. Nothing reaches Stripe or email: the card and reader are
 * the browser stubs from stubCardPayments.
 *
 * Uses the "twostaff" household (a dog, Basil): its chart is only used by EMR-13-5 for a dose, so a plan note and a
 * charge do not disturb it. These specs do not sign or lock the chart.
 */
const OFFLINE_BANNER = 'Offline — not saved. Your changes are kept on this page and will save when the connection returns.';
const PLAN_BOX = 'textarea[data-soap-field="planNotes"]';

function openPlan() {
  cy.get('body', { timeout: 40000 }).then(($b) => {
    const tab = $b.find('[role="tab"]:contains("Plan")');
    if (tab.length) cy.wrap(tab.first()).click();
  });
  return cy.get(`${PLAN_BOX}:visible`, { timeout: 30000 }).first();
}

describe('EMR-A10-1: SOAP save while offline', () => {
  it('shows the offline banner, keeps the typed plan, and saves it when the network returns', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.twostaff;
    const [dog] = pets;
    const text = `Recheck in two weeks ${Date.now()}`;

    openEncounter(dog, clientId).then((enc) => {
      signInEmr('veterinarian', soapPath(dog, clientId));
      cy.contains(dog.name, { timeout: 40000 });
      openPlan();

      // The network drops: every save is a network error.
      cy.intercept('PATCH', '**/soap-encounters/*', { forceNetworkError: true }).as('offlinePatch');
      openPlan().clear().type(text).blur();
      cy.wait('@offlinePatch');

      cy.get('[data-testid="offline-banner"]').should('contain.text', OFFLINE_BANNER);
      cy.get('[data-testid="soap-not-saved"]').should('contain.text', 'Not saved yet');
      // The text is still on the page, and in this browser under the encounter's id.
      openPlan().should('have.value', text);
      cy.window().then((win) => {
        const raw = win.localStorage.getItem(`scout.soap.chartDraft:${enc.id}`);
        expect(raw, 'local copy of the chart').to.be.a('string');
      });
      // Nothing reached the server.
      emrApi<{ planNotes?: string }>('veterinarian', 'GET', `/soap-encounters/${enc.id}?practiceId=${w.practiceId}`).then((e) => {
        expect(e.planNotes ?? '').to.not.contain(text);
      });

      // The connection returns: the page saves by itself and the notices clear.
      cy.intercept('PATCH', '**/soap-encounters/*', (req) => req.continue()).as('onlinePatch');
      cy.window().then((win) => win.dispatchEvent(new win.Event('online')));
      cy.wait('@onlinePatch', { timeout: 30000 });
      cy.get('[data-testid="soap-not-saved"]').should('not.exist');
      cy.get('[data-testid="offline-banner"]').should('not.exist');
      emrApi<{ planNotes?: string }>('veterinarian', 'GET', `/soap-encounters/${enc.id}?practiceId=${w.practiceId}`).then((e) => {
        expect(e.planNotes).to.contain(text);
      });
    });
  });
});

describe('EMR-A10-2: charge while offline', () => {
  it('says "Not charged", does not retry by itself, and one manual retry makes one charge', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.twostaff;
    const [dog] = pets;
    const stub = stubCardPayments(dog);

    openEncounter(dog, clientId).then((enc) => {
      addOrder(enc.id, w.items.examId, 'Wellness exam', 65, { confirmDuplicate: true });
      giveInvoiceItsShelf(dog);
      signInEmr('veterinarian', soapPath(dog, clientId, '/checkout'));
      cy.contains('h1', 'Checkout', { timeout: 40000 });

      // Declared after the stub, so it wins for the first charge only.
      cy.intercept({ method: 'POST', url: '**/visit-payments/*/charge-saved-card', times: 1 }, { forceNetworkError: true }).as('offlineCharge');
      cy.contains('button', 'Card on file', { timeout: 30000 }).should('not.be.disabled').click();
      cy.wait('@offlineCharge');
      cy.contains('Not charged — check the connection and try again. If the card was charged, it will show here when the connection returns.');
      cy.get('[data-testid="offline-banner"]').should('exist');

      // No automatic retry: wait, then confirm nothing was charged.
      cy.wait(3000);
      cy.wrap(null).should(() => expect(stub.calls(), 'no charge yet').to.have.length(0));
      visitInvoice(dog).then((inv) => expect(inv.status).to.not.eq('paid'));

      // Connection back: the staff member tries again by hand; exactly one charge.
      cy.window().then((win) => win.dispatchEvent(new win.Event('online')));
      cy.contains('button', 'Card on file').should('not.be.disabled').click();
      cy.contains(/Charged the card on file|Paid/i, { timeout: 30000 });
      cy.wrap(null).should(() => expect(stub.calls()).to.deep.eq(['saved']));
      visitInvoice(dog).then((inv) => {
        expect(inv.status).to.eq('paid');
        const cardTenders = ((inv as any).tenders ?? []).filter((t: any) => t.method === 'card' && !t.isDeleted);
        if (cardTenders.length) expect(cardTenders).to.have.length(1);
      });
    });
  });
});

describe('EMR-A10-3: tablet and phone layouts', () => {
  const sizes: Array<[string, number, number]> = [
    ['iPad portrait', 768, 1024],
    ['iPad landscape', 1024, 768],
    ['phone', 390, 844],
  ];

  const noSideScroll = () =>
    cy.document().then((doc) => {
      const el = doc.documentElement;
      expect(el.scrollWidth, 'page width vs window').to.be.at.most(el.clientWidth + 1);
    });

  sizes.forEach(([label, width, height]) => {
    it(`EMR-11-1 screens (SOAP, wrap-up, checkout) fit without sideways scrolling: ${label}`, () => {
      const w = emrWorld();
      const { clientId, pets } = w.households.twostaff;
      const [dog] = pets;
      cy.viewport(width, height);
      stubCardPayments(dog);

      openEncounter(dog, clientId).then((enc) => {
        addOrder(enc.id, w.items.examId, 'Wellness exam', 65, { confirmDuplicate: true });
        giveInvoiceItsShelf(dog);

        // SOAP: the chart and its tabs.
        signInEmr('veterinarian', soapPath(dog, clientId));
        cy.contains(dog.name, { timeout: 40000 });
        openPlan().should('be.visible');
        noSideScroll();

        // Wrap-up.
        cy.contains('button', 'Wrap up visit').scrollIntoView().should('be.visible').click();
        cy.contains('h1', 'Wrap up visit', { timeout: 30000 });
        cy.contains('button', 'Sign & lock SOAP').should('exist');
        noSideScroll();

        // Checkout: totals and the pay buttons are reachable (the walk stops short of paying).
        cy.visit(soapPath(dog, clientId, '/checkout'));
        cy.contains('h1', 'Checkout', { timeout: 30000 });
        cy.contains('.soap-invoice-row', 'Subtotal').should('exist');
        cy.contains('button', 'Tap to Pay', { timeout: 30000 }).scrollIntoView().should('be.visible');
        cy.contains('button', 'Card on file').scrollIntoView().should('be.visible');
        noSideScroll();
      });
    });
  });
});
