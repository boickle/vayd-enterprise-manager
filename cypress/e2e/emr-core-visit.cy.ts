/// <reference types="cypress" />
import '../support/e2e';
import {
  addOrder,
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
  stubCardPayments,
  stubGmailCapture,
  stubRecapDraft,
  visitInvoice,
  waitForRecapMailbox,
  seedRecapDraft,
  waitForRecapDraft,
} from '../support/emrCoreVisitWorld';

/**
 * EMR-11-1 to EMR-11-3: an ordinary one-pet visit start to finish.
 *
 * What is real: the screens, the API, the database (a dedicated test database, see
 * emrCoreVisitWorld.ts). What is a stand-in: the card reader and the saved card (browser stubs that
 * record a real card tender with a made-up PaymentIntent, so no Stripe), Gmail (captured), and the
 * AI-written recap text (a fixed draft). "Check in" is opening the SOAP, which creates the encounter.
 */
describe('EMR-11-1: wellness visit, card reader', () => {
  it('SOAP, vitals, exam and two vaccines with lots, sign as vet, pay on the reader, recap once', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.well;
    const [dog] = pets;
    const gmail = stubGmailCapture();
    stubRecapDraft(() => dog.name);
    stubCardPayments(dog);

    // Check in: the encounter exists once the SOAP is opened.
    openEncounter(dog, clientId).then((enc) => {
      // Vitals (weight 52 lb, follow-up answered) and the exam and two vaccines as orders on the bill.
      readyToSign(enc.id, '52');
      addOrder(enc.id, w.items.examId, 'Wellness exam', 65);
      addOrder(enc.id, w.items.rabiesId, 'Rabies vaccine', 28);
      addOrder(enc.id, w.items.da2ppId, 'DA2PP vaccine', 32);
      seedRecapDraft(enc.id, 'Visit recap', `<p><strong>${dog.name}</strong>: wellness exam, rabies and DA2PP vaccines.</p>`);
      signInEmr('veterinarian', soapPath(dog, clientId));
      cy.contains(dog.name, { timeout: 40000 });
      cy.contains(itemName('Wellness exam'), { timeout: 30000 });

      // Doses: each vaccine with its lot; the rabies one with a tag (the same save the dose form makes).
      emrApi<Array<{ id: string; name: string }>>('veterinarian', 'GET', `/soap-encounters/${enc.id}/orders?practiceId=${w.practiceId}`).then((orders) => {
        expect(orders).to.have.length(3);
        const next = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
        const dose = (name: string, lot: { lotNumber: string; lotBalanceId: number }, tag?: string) => {
          const order = orders.find((o) => o.name === itemName(name))!;
          return emrApi('veterinarian', 'PUT', `/soap-encounters/${enc.id}/orders/${order.id}/vaccination`, {
            practiceId: w.practiceId,
            nextVaccinationDate: next,
            inventoryLotBalanceId: lot.lotBalanceId,
            lotNumber: lot.lotNumber,
            ...(tag ? { tagNumber: tag } : {}),
            employeeId: w.employees.veterinarian,
          });
        };
        dose('Rabies vaccine', w.lots.rabies, 'T-0042');
        dose('DA2PP vaccine', w.lots.da2pp);
      });

      // Wrap up: the recap goes through the captured Gmail, once; then sign and lock.
      cy.contains('button', 'Wrap up visit').click();
      cy.contains('h1', 'Wrap up visit', { timeout: 30000 });
      cy.contains(dog.name);
      waitForRecapMailbox();
      waitForRecapDraft();
      cy.contains('button', 'Send to client').should('not.be.disabled').click();
      cy.wrap(null).should(() => expect(gmail.sent()).to.have.length(1));
      cy.contains('button', 'Sign & lock SOAP').should('not.be.disabled').click();
      cy.contains('SOAP signed & locked', { timeout: 30000 });
      cy.wrap(null).should(() => expect(gmail.sent(), 'recap sent exactly once').to.have.length(1));

      // The chart is locked with the vet as the signer; the doses are on the chart with lot and tag.
      emrSql(`SELECT status || ',' || coalesce("completedByEmployeeId"::text,'') FROM soap_encounters WHERE id = '${enc.id}'`).should(
        'eq',
        `completed,${w.employees.veterinarian}`,
      );
      emrSql(
        `SELECT string_agg("vaccineName" || ':' || "lotNumber" || ':' || coalesce("tagNumber",''), '|' ORDER BY "vaccineName") FROM vaccination_logs WHERE "patientId" = ${dog.patientId} AND "isDeleted" = false`,
      ).should(
        'eq',
        `${itemName('DA2PP vaccine')}:${w.lots.da2pp.lotNumber}:|${itemName('Rabies vaccine')}:${w.lots.rabies.lotNumber}:T-0042`,
      );

      // The bill matches the orders: 65 + 28 + 32 = 125.00, tax 5.5% on the exam only (3.58).
      visitInvoice(dog).then((inv) => {
        expect(inv.lines.filter((l) => !l.isDeleted)).to.have.length(3);
        expect(Number(inv.subtotal)).to.eq(125);
        expect(Number(inv.taxTotal)).to.be.closeTo(3.58, 0.01);
      });

      // Check out on the (stubbed) test reader.
      giveInvoiceItsShelf(dog);
      cy.visit(soapPath(dog, clientId, '/checkout'));
      cy.contains('h1', 'Checkout', { timeout: 30000 });
      cy.contains('.soap-invoice-row', 'Subtotal').should('contain.text', '$125.00');
      cy.contains('.soap-invoice-row', 'Sales tax').should('contain.text', '$3.5');
      cy.contains('button', 'Tap to Pay', { timeout: 30000 }).should('not.be.disabled').click();
      cy.contains(/Payment received|marked paid|Paid/i, { timeout: 30000 });
      visitInvoice(dog).then((inv) => {
        expect(inv.status).to.eq('paid');
        expect(Number(inv.amountPaid)).to.be.closeTo(Number(inv.total), 0.005);
      });
      cy.wrap(null).should(() => expect(gmail.sent()).to.have.length(1));
    });
  });
});

describe('EMR-11-2: sick visit, Rx and the saved card', () => {
  it('Rx with sig and one refill gets a number and a label, then pays with the card on file', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.sick;
    const [cat] = pets;
    stubCardPayments(cat);

    openEncounter(cat, clientId).then((enc) => {
      readyToSign(enc.id, '9');
      addOrder(enc.id, w.items.examId, 'Wellness exam', 65);
      addOrder(enc.id, w.items.rxId, 'Amoxicillin 50 mg tablet', 18, { kind: 'med' });
      signInEmr('veterinarian', soapPath(cat, clientId));
      cy.contains(cat.name, { timeout: 40000 });
      cy.contains(itemName('Amoxicillin 50 mg tablet'), { timeout: 30000 });

      emrApi<Array<{ id: string; name: string; kind: string }>>('veterinarian', 'GET', `/soap-encounters/${enc.id}/orders?practiceId=${w.practiceId}`).then((orders) => {
        const rx = orders.find((o) => o.name === itemName('Amoxicillin 50 mg tablet'))!;
        expect(rx.kind).to.eq('med');
        // The sig and refill the Rx form saves.
        emrApi('veterinarian', 'PUT', `/soap-encounters/${enc.id}/orders/${rx.id}/prescription`, {
          practiceId: w.practiceId,
          instructions: 'Give 1 tablet by mouth twice daily for 7 days',
          refill: 1,
          refillExpiration: new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10),
          acuity: 'acute',
          employeeId: w.employees.veterinarian,
        });
        emrSql(`SELECT coalesce("rxNumber"::text,'') || ',' || refill FROM prescriptions WHERE "encounterOrderId" = '${rx.id}' AND "isDeleted" = false`).should(
          'match',
          /^[1-9]\d*,1$/,
        );
        // The printable label follows the sig.
        emrSql(`SELECT "medLabel"::text FROM encounter_orders WHERE id = '${rx.id}'`).should('contain', 'twice daily');
      });

      signChart(enc.id);
      giveInvoiceItsShelf(cat);

      cy.visit(soapPath(cat, clientId, '/checkout'));
      cy.contains('h1', 'Checkout', { timeout: 30000 });
      cy.contains('button', 'Card on file', { timeout: 30000 }).should('not.be.disabled').click();
      // Wave 11: Card on file opens a confirm that names the amount; this click charges.
      cy.contains('button', /^Charge \$[\d,.]+ to /, { timeout: 30000 }).click();
      cy.contains(/Charged the card on file/i, { timeout: 30000 });
      visitInvoice(cat).then((inv) => {
        expect(inv.status).to.eq('paid');
        expect(Number(inv.subtotal)).to.eq(83); // 65 exam + 18 tablet
        expect(Number(inv.total)).to.be.closeTo(83 * 1.055, 0.02); // tax 5.5% on both
      });
    });
  });
});

describe('EMR-11-3: cash and partial payment', () => {
  it('pay 100 in cash, then 80 by card: two tenders, Paid, both shown in Billing', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.cash;
    const [dog] = pets;
    stubCardPayments(dog);

    openEncounter(dog, clientId).then((enc) => {
      // A $180.00 bill: the dental package, untaxed.
      emrApi('veterinarian', 'POST', `/soap-encounters/${enc.id}/orders`, {
        practiceId: w.practiceId,
        name: itemName('Dental package'),
        kind: 'treatment',
        catalogItemId: w.items.dentalId,
        catalogItemType: 'inventory',
        qty: 1,
        unitPrice: 180,
        state: 'accepted',
      });
      giveInvoiceItsShelf(dog);
      visitInvoice(dog).then((inv) => {
        expect(Number(inv.total)).to.eq(180);
        signInEmr('veterinarian', `/schedule/clients?clientId=${clientId}&tab=financial&invoice=${inv.id}`);

        // 100.00 in cash.
        cy.contains('option', 'Cash', { timeout: 40000 }).parent('select').select('Cash');
        cy.contains('label', /^Amount/).find('input').clear().type('100');
        cy.contains('button', 'Record Cash').click();
        cy.contains(/Recorded Cash \$100\.00/i, { timeout: 20000 });
        visitInvoice(dog).then((mid) => {
          expect(mid.status).to.not.eq('paid');
          expect(Number(mid.amountPaid)).to.eq(100);
        });

        // The last 80.00 on the card on file.
        cy.contains('option', /Card on file/).then(($o) => cy.wrap($o.parent('select')).select($o.text()));
        cy.contains('button', 'Charge card on file').click();
        cy.contains(/Charged the card on file/i, { timeout: 20000 });
      });

      visitInvoice(dog).then((inv) => {
        expect(inv.status).to.eq('paid');
        expect(Number(inv.amountPaid)).to.eq(180);
        const live = (inv.tenders ?? []).filter((t) => !t.voidedAt);
        expect(live.map((t) => [t.method, Number(t.amount)])).to.deep.eq([['cash', 100], ['card', 80]]);
      });
      // Billing lists both payments.
      cy.contains(/Cash/, { timeout: 20000 });
      cy.contains(/\$100\.00/);
      cy.contains(/\$80\.00/);
    });
  });
});
