/// <reference types="cypress" />
import '../support/e2e';
import {
  addChargeVia,
  emrApi,
  emrSql,
  emrWorld,
  giveInvoiceItsShelf,
  itemName,
  openEncounter,
  readyToSign,
  signChart,
  signInEmr,
  soapPath,
  stubGmailCapture,
  stubRecapDraft,
  visitInvoice,
  type EmrPet,
} from '../support/emrCoreVisitWorld';

/**
 * EMR-11-4 to EMR-11-6: a three-pet household (dog Aspen, dog Birch, cat Clover). A multi-pet visit
 * is booked as one appointment per pet for the same client on the same day; the pets share one open
 * invoice and one wrap-up. The three tests run in order and share the visit.
 *
 * Stand-ins: Gmail (captured) and the AI-written recap text (a fixed draft). Nothing reaches Stripe.
 */
describe('EMR-11-4 to EMR-11-6: three-pet household', () => {
  const w = () => emrWorld();
  const household = () => w().households.multi;
  const pet = (name: string): EmrPet => household().pets.find((p) => p.name === name)!;
  const encounterIds: Record<string, string> = {};

  before(() => {
    // Opening each chart is what the SOAP tabs do; the ids are needed to sign them.
    for (const p of household().pets) {
      openEncounter(p, household().clientId).then((enc) => {
        encounterIds[p.name] = enc.id;
      });
    }
  });

  it('EMR-11-4: one SOAP per pet, orders on the right pet, one invoice grouped by pet', () => {
    const { clientId } = household();
    const aspen = pet('Aspen');
    signInEmr('veterinarian', soapPath(aspen, clientId));

    const chargeFor = (name: string, item: string) => addChargeVia(`Add a charge for ${name}`, itemName(item));
    cy.get('[aria-label="Pets at this visit"]', { timeout: 40000 }).should('contain.text', 'Birch').and('contain.text', 'Clover');

    chargeFor('Aspen', 'Wellness exam');
    chargeFor('Aspen', 'Rabies vaccine');
    chargeFor('Birch', 'Wellness exam');
    chargeFor('Birch', 'Fecal test');
    chargeFor('Clover', 'Wellness exam');
    chargeFor('Clover', 'Nail trim');
    chargeFor('Clover', 'Rabies vaccine');

    // Clover's nail trim is two.
    emrApi<Array<{ id: string; name: string }>>('veterinarian', 'GET', `/soap-encounters/${encounterIds.Clover}/orders?practiceId=${w().practiceId}`).then((orders) => {
      const nail = orders.find((o) => o.name === itemName('Nail trim'))!;
      emrApi('veterinarian', 'PATCH', `/soap-encounters/${encounterIds.Clover}/orders/${nail.id}`, { practiceId: w().practiceId, qty: 2 });
    });

    // Each order is on its own pet's chart, and the three tabs share one invoice with each line on the right pet.
    const expected: Record<string, { items: string[]; amount: number; tax: number }> = {
      Aspen: { items: ['Wellness exam', 'Rabies vaccine'], amount: 85, tax: 3.3 },
      Birch: { items: ['Wellness exam', 'Fecal test'], amount: 90, tax: 4.95 },
      Clover: { items: ['Wellness exam', 'Nail trim', 'Rabies vaccine'], amount: 105, tax: 3.3 },
    };
    for (const [name, want] of Object.entries(expected)) {
      emrApi<Array<{ name: string; patientId: number }>>('veterinarian', 'GET', `/soap-encounters/${encounterIds[name]}/orders?practiceId=${w().practiceId}`).then((orders) => {
        expect(orders.map((o) => o.name).sort(), `${name}'s orders`).to.deep.eq(want.items.map(itemName).sort());
        orders.forEach((o) => expect(o.patientId).to.eq(pet(name).patientId));
      });
    }
    visitInvoice(aspen).then((inv) => {
      const lines = inv.lines.filter((l) => !l.isDeleted);
      expect(lines).to.have.length(7);
      for (const [name, want] of Object.entries(expected)) {
        const mine = lines.filter((l) => Number(l.patientId) === pet(name).patientId);
        expect(mine.map((l) => l.description).sort(), `${name}'s lines`).to.deep.eq(want.items.map(itemName).sort());
        expect(mine.reduce((n, l) => n + Number(l.amount), 0)).to.be.closeTo(want.amount, 0.005);
      }
      expect(Number(inv.subtotal)).to.eq(280);
      expect(Number(inv.taxTotal)).to.be.closeTo(11.55, 0.01);
    });

    // The checkout screen groups the bill by pet, with each pet's total in its heading.
    giveInvoiceItsShelf(aspen);
    cy.visit(soapPath(aspen, clientId, '/checkout'));
    cy.contains('h1', 'Checkout', { timeout: 30000 });
    cy.contains('One bill for 3 pets');
    for (const [name, want] of Object.entries(expected)) {
      const taxed = (want.amount + want.tax).toFixed(2);
      cy.get(`#soap-invoice-pet-${pet(name).patientId}`, { timeout: 30000 }).within(() => {
        cy.contains(name);
        want.items.forEach((item) => cy.contains(itemName(item)));
        cy.contains(new RegExp(`\\$${want.amount.toFixed(2)}|\\$${taxed}`));
      });
    }
    cy.contains('.soap-invoice-row', 'Subtotal').should('contain.text', '$280.00');
    cy.contains('.soap-invoice-row', 'Sales tax').should('contain.text', '$11.5');
  });

  it('EMR-11-5: A and B signed, C still a draft: A and B locked, C editable, and the visit warns about C', () => {
    const { clientId } = household();
    ['Aspen', 'Birch'].forEach((name) => {
      readyToSign(encounterIds[name]);
      signChart(encounterIds[name]);
    });
    emrSql(`SELECT string_agg(se.status, ',' ORDER BY p.name) FROM soap_encounters se JOIN patients p ON p.id = se."patientId" WHERE se.id IN ('${Object.values(encounterIds).join("','")}')`).should(
      'eq',
      'completed,completed,draft',
    );

    // Aspen's chart is locked: a signed chart offers an addendum and its weight is read-only.
    signInEmr('veterinarian', soapPath(pet('Aspen'), clientId));
    cy.contains('button', 'Write addendum', { timeout: 40000 });
    cy.get('input[placeholder="e.g. 12.4"]').should('be.disabled');

    // Clover's is still open to editing.
    signInEmr('veterinarian', soapPath(pet('Clover'), clientId));
    cy.get('input[placeholder="e.g. 12.4"]', { timeout: 40000 }).should('not.be.disabled');
    cy.contains('button', 'Write addendum').should('not.exist');

    // Ending the visit with Clover unsigned should say so. NOTE: as of this writing neither the
    // wrap-up screen nor Start / End Visit on the schedule mentions an unsigned chart (no such text
    // in the source), so this is expected to FAIL until that warning exists. It is the plan's expected result.
    cy.visit(soapPath(pet('Clover'), clientId, '/wrap-up'));
    cy.contains('h1', 'Wrap up visit', { timeout: 30000 });
    cy.contains(/Clover.{0,80}(not signed|unsigned|still a draft|not yet signed)|(not signed|unsigned|still a draft).{0,80}Clover/i);

    // A and B stay locked and Clover stays a draft after looking at the wrap-up.
    emrSql(`SELECT status FROM soap_encounters WHERE id = '${encounterIds.Clover}'`).should('eq', 'draft');
  });

  it('EMR-11-6: one recap covers all three pets and is sent once', () => {
    const { clientId } = household();
    const gmail = stubGmailCapture();
    const names = new Map(household().pets.map((p) => [p.patientId, p.name]));
    const draft = stubRecapDraft((id) => names.get(id) ?? `pet ${id}`);
    cy.intercept('POST', '**/client-email').as('recapDecision');

    readyToSign(encounterIds.Clover);
    signChart(encounterIds.Clover);

    signInEmr('veterinarian', soapPath(pet('Aspen'), clientId, '/wrap-up'));
    cy.contains('h1', 'Wrap up visit', { timeout: 40000 });
    cy.contains('3 pets');
    cy.contains('SOAP signed & locked');
    // All three pets are named and ticked in "Cover which pets?".
    cy.contains('.soap-wrapup-petpick', 'Cover which pets?');
    for (const name of ['Aspen', 'Birch', 'Clover']) {
      cy.contains('.soap-wrapup-petpick label', name).find('input[type="checkbox"]').should('be.checked');
    }

    // The recap draft is asked for once, for all three pets, and names each of them.
    cy.contains('label', 'Subject').find('input', { timeout: 30000 }).should('not.have.value', '');
    cy.contains('button', 'Send to client').should('not.be.disabled').click();
    cy.wait('@recapDecision').its('request.body').then((body) => {
      expect(body.status).to.eq('sent');
      const covered = (body.patientIds ?? household().pets.map((p) => p.patientId)) as number[];
      expect([...covered].sort()).to.deep.eq(household().pets.map((p) => p.patientId).sort());
    });
    cy.wrap(null).should(() => {
      expect(gmail.sent(), 'one email for the household').to.have.length(1);
      const mail = gmail.sent()[0];
      const text = String(mail.bodyHtml || mail.bodyText || '');
      ['Aspen', 'Birch', 'Clover'].forEach((name) => expect(text).to.contain(name));
      // Each pet's name appears once, with its own heading.
      expect((text.match(/Aspen/g) ?? []).length).to.eq(1);
    });
    cy.wrap(null).should(() => {
      draft.asked().forEach((ids) => expect([...ids].sort()).to.deep.eq(household().pets.map((p) => p.patientId).sort()));
    });
    // Recorded on every pet's chart, as the same single decision.
    emrSql(`SELECT count(*) FROM soap_encounters WHERE id IN ('${Object.values(encounterIds).join("','")}') AND "clientEmailDelivery"->>'status' = 'sent'`).should('eq', '3');
  });
});
