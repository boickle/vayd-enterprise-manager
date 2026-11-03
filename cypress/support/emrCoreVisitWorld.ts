/// <reference types="cypress" />
/**
 * The seeded world and helpers for the EMR-11 specs (ordinary and multi-pet visits,
 * cypress/e2e/emr-core-visit*.cy.ts). It is separate from the other EMR worlds on purpose.
 *
 * Seed it with vayd-api's test/scripts/emr-core-visit-seed.ts (a database whose name contains "test"):
 *   npx ts-node -T test/scripts/emr-core-visit-seed.ts seed vayd_api_test_e2e /tmp/emr-core.json
 *   CYPRESS_EMR_CORE_WORLD="$(cat /tmp/emr-core.json)" CYPRESS_E2E_DB=vayd_api_test_e2e \
 *     npx cypress run --spec "cypress/e2e/emr-core-visit*.cy.ts"
 * The API the dev server talks to must use the same database.
 *
 * Money safety: the card reader and the saved card are stubbed in the browser (see
 * stubCardPayments); nothing here reaches Stripe, and the recap goes to a captured Gmail stub.
 */
/** `technician` is a licensed technician (EMR-07); the vet is licensed with a license number. */
export type EmrCoreRole = 'veterinarian' | 'practice_manager' | 'technician';

export type EmrPet = { patientId: number; name: string; species: string; appointmentId: number };
export type EmrHousehold = { clientId: number; email: string; pets: EmrPet[] };

export type EmrCoreWorld = {
  tag: string;
  practiceId: number;
  branchId: number;
  locationId: number;
  items: {
    examId: number;
    rabiesId: number;
    da2ppId: number;
    fecalId: number;
    nailId: number;
    rxId: number;
    dentalId: number;
  };
  lots: Record<'rabies' | 'da2pp', { lotNumber: string; lotBalanceId: number }>;
  employees: Record<EmrCoreRole, number>;
  auth: Record<EmrCoreRole, { Authorization: string; token: string }>;
  households: Record<'well' | 'sick' | 'cash' | 'multi' | 'signoff', EmrHousehold>;
};

export function emrWorld(): EmrCoreWorld {
  const raw = Cypress.env('EMR_CORE_WORLD') as string | EmrCoreWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_EMR_CORE_WORLD to the JSON from emr-core-visit-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as EmrCoreWorld) : raw;
}

const apiBase = () =>
  Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000';

/** Catalog item name as the seed made it (every name starts with the world's tag). */
export const itemName = (name: string) => `${emrWorld().tag} ${name}`;

/** Calls the API as one of the seeded staff; yields the response body. */
export function emrApi<T = any>(
  role: EmrCoreRole,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Cypress.Chainable<T> {
  const w = emrWorld();
  return cy
    .request({
      method,
      url: `${apiBase()}${path}`,
      headers: { Authorization: w.auth[role].Authorization },
      body: body as Cypress.RequestBody,
      failOnStatusCode: true,
    })
    .its('body') as Cypress.Chainable<T>;
}

/** Like emrApi but yields the whole response and never fails on the status (for refusals). */
export function emrRequest(
  role: EmrCoreRole,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Cypress.Chainable<Cypress.Response<any>> {
  const w = emrWorld();
  return cy.request({
    method,
    url: `${apiBase()}${path}`,
    headers: { Authorization: w.auth[role].Authorization },
    body: body as Cypress.RequestBody,
    failOnStatusCode: false,
  });
}

/** Signs in as a seeded staff member (no password) and opens `path`. */
export function signInEmr(role: EmrCoreRole, path: string) {
  const w = emrWorld();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.auth[role].token);
  });
  cy.visit(path);
}

const db = () => String(Cypress.env('E2E_DB') || 'vayd_api_test_e2e');

/** One SQL statement on the dedicated test database; refuses anything not named "test". */
export function emrSql(statement: string): Cypress.Chainable<string> {
  if (!/test/i.test(db()) || /vayd_api_local|prod/i.test(db())) {
    throw new Error(`Refusing: "${db()}" is not a dedicated test database`);
  }
  return cy
    .exec('psql -h localhost -U vayd -d ' + db() + ' -tA -c "$EMR_SQL"', {
      env: { PGPASSWORD: 'vayd', EMR_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

export const soapPath = (pet: EmrPet, clientId: number, tail = '') =>
  `/schedule/soap/${pet.appointmentId}/${pet.patientId}${tail}?clientId=${clientId}`;

export type VisitInvoiceBody = {
  id: string;
  status: string;
  subtotal: string | number;
  taxTotal: string | number;
  total: string | number;
  amountPaid: string | number;
  inventoryBranchId?: number | null;
  inventoryLocationId?: number | null;
  tenders?: Array<{ method: string; amount: string | number; voidedAt?: string | null }>;
  lines: Array<{ id: string; patientId: number | null; description: string; amount: string | number; isDeleted?: boolean }>;
};

export const visitInvoice = (pet: EmrPet) =>
  emrApi<VisitInvoiceBody>('veterinarian', 'GET', `/visit-invoices/by-appointment/${pet.appointmentId}?practiceId=${emrWorld().practiceId}`);

/** Checkout draws stock from a shelf: give the open invoice the seeded office and Main shelf. */
export function giveInvoiceItsShelf(pet: EmrPet) {
  const w = emrWorld();
  return visitInvoice(pet).then((inv) =>
    emrApi('veterinarian', 'PATCH', `/visit-invoices/${inv.id}`, {
      practiceId: w.practiceId,
      inventoryBranchId: w.branchId,
      inventoryLocationId: w.locationId,
    }),
  );
}

/** Opens the SOAP encounter for a pet (the call the SOAP page makes on load); yields the encounter. */
export function openEncounter(pet: EmrPet, clientId: number) {
  const w = emrWorld();
  return emrApi<{ id: string; status: string }>('veterinarian', 'POST', '/soap-encounters', {
    practiceId: w.practiceId,
    appointmentId: pet.appointmentId,
    patientId: pet.patientId,
    clientId,
  });
}

/** Weight and follow-up answered, so the chart can be signed. */
export function readyToSign(encounterId: string, weight = '40') {
  const w = emrWorld();
  return emrApi('veterinarian', 'PATCH', `/soap-encounters/${encounterId}`, {
    practiceId: w.practiceId,
    objectiveVitals: { weight, weightUnit: 'lb', weightConfirmed: true },
    forwardBookingDisposition: { mode: 'not_appropriate' },
  });
}

export const signChart = (encounterId: string) =>
  emrApi('veterinarian', 'POST', `/soap-encounters/${encounterId}/complete`, { practiceId: emrWorld().practiceId });

/** Types the item name into a "Add a charge" box and picks it; waits for the line on the bill. */
export function addChargeVia(placeholder: string, name: string) {
  cy.get(`input[placeholder="${placeholder}"]`, { timeout: 30000 }).first().clear().type(name);
  // Not the "Add as note: <typed text>" row: it is always listed and contains the name too ($0 note order).
  cy.contains('[role="option"]:not(.soap-plan-result-note), li, button:not(.soap-plan-result-note)', name, { timeout: 20000 }).first().click();
  // The box empties itself only once the order was created (an error leaves the text in it).
  cy.get(`input[placeholder="${placeholder}"]`, { timeout: 30000 }).first().should('have.value', '');
}

/**
 * Enters the weight in pounds. The weight box lives under the Objective tab (and a second, hidden copy sits in
 * the document view), so open Objective when the tabs are showing and use the visible box.
 */
export function openObjective() {
  cy.get('[aria-label="SOAP sections"], .soap-doc-section, input[placeholder="e.g. 12.4"]', { timeout: 40000 }).should('exist');
  cy.get('body').then(($b) => {
    const tab = $b.find('[role="tab"]:contains("Objective")');
    if (tab.length) cy.wrap(tab.first()).click();
  });
}

export function enterWeightLb(value: string) {
  openObjective();
  cy.get('input[placeholder="e.g. 12.4"]:visible', { timeout: 20000 }).first().clear().type(value).blur();
  cy.contains('label:visible', 'Lb').find('input[type="radio"]').check();
}

/** The wrap-up picks its Gmail mailbox after the page loads; sending before that says no mailbox is connected. */
export function waitForRecapMailbox() {
  cy.contains(/Through info@vetatyourdoor\.com/, { timeout: 30000 });
}

/** Stands in for Gmail; every send is captured in memory and never leaves the machine. */
export function stubGmailCapture() {
  const sent: Array<Record<string, any>> = [];
  cy.intercept('GET', '**/gmail/access', { allowed: true });
  cy.intercept('GET', '**/gmail/mailboxes*', {
    mailboxes: [{ email: 'info@vetatyourdoor.com', kind: 'shared', connected: true, authMode: 'service_account' }],
  });
  cy.intercept('GET', '**/gmail/send-as*', {
    aliases: [{ sendAsEmail: 'info@vetatyourdoor.com', displayName: 'Vet At Your Door', isDefault: true, isPrimary: true, treatAsAlias: false, signature: '' }],
  });
  cy.intercept('POST', '**/gmail/messages/send*', (req) => {
    sent.push(req.body);
    req.reply({ id: 'captured-1', threadId: 'captured-t1' });
  });
  return { sent: () => sent };
}

/**
 * The recap text normally comes from an AI call. Replace it with a fixed draft built from the pets the
 * page asked about, and remember which pets that was.
 */
export function stubRecapDraft(petNames: (patientId: number) => string) {
  const asked: number[][] = [];
  cy.intercept('POST', '**/scribe/client-recap', (req) => {
    const ids: number[] = req.body?.patientIds ?? [];
    asked.push(ids);
    req.reply({
      subject: 'Visit recap',
      body: ids.map((id) => `<p><strong>${petNames(id)}</strong>: seen today.</p>`).join(''),
    });
  });
  return { asked: () => asked };
}

/**
 * The test card reader and the saved card, stubbed in the browser. A "payment" through either one is
 * recorded for real on the API as a card tender with a made-up PaymentIntent id, so the invoice, its
 * totals and its Paid status are the real thing; only Stripe and the reader are stand-ins.
 */
export function stubCardPayments(pet: EmrPet) {
  const w = emrWorld();
  const calls: string[] = [];
  const reader = { id: 'emr-reader', kind: 'scout_terminal', label: 'Test reader (stub)', online: true, deviceId: 'emr-device' };
  cy.intercept('GET', '**/visit-payments/terminal/readers*', {
    selected: { kind: 'scout_terminal', deviceId: 'emr-device', label: reader.label },
    selectedId: reader.id,
    readers: [reader],
  });
  cy.intercept('PUT', '**/visit-payments/terminal/readers/selection*', {
    selected: { kind: 'scout_terminal', deviceId: 'emr-device', label: reader.label },
    selectedId: reader.id,
    readers: [reader],
  });
  cy.intercept('GET', '**/visit-payments/terminal/presence*', { online: false, devices: [] });
  cy.intercept('GET', '**/visit-payments/*/card-on-file*', {
    card: { customerId: 'cus_emr_stub', paymentMethodId: 'pm_emr_stub', last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
    declinedAt: null,
  });

  const headers = { Authorization: w.auth.veterinarian.Authorization, 'Content-Type': 'application/json' };
  const getInvoice = async (invoiceId: string) =>
    (await fetch(`${apiBase()}/visit-invoices/${invoiceId}?practiceId=${w.practiceId}`, { headers })).json();

  /**
   * Records a real card tender for what is due (cy commands are not allowed inside an intercept handler,
   * so this uses fetch), then yields the fresh invoice for the screen.
   */
  const settle = async (kind: 'reader' | 'saved', invoiceId: string) => {
    calls.push(kind);
    const inv = await getInvoice(invoiceId);
    const due = Math.round(((Number(inv.total) || 0) - (Number(inv.amountPaid) || 0)) * 100) / 100;
    const res = await fetch(`${apiBase()}/visit-invoices/${invoiceId}/tenders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        practiceId: w.practiceId,
        method: 'card',
        amount: due,
        stripePaymentIntentId: `pi_emr_${kind}_${Date.now()}`,
      }),
    });
    return { invoice: await res.json(), cents: Math.round(due * 100) };
  };

  cy.intercept('POST', '**/visit-payments/*/terminal/checkout', (req) => {
    const invoiceId = String(req.url.match(/visit-payments\/([^/]+)\/terminal\/checkout/)?.[1]);
    return settle('reader', invoiceId).then(({ invoice, cents }) =>
      req.reply({
        checkoutId: 'emr-checkout-1',
        invoiceId,
        appointmentId: pet.appointmentId,
        practiceId: w.practiceId,
        paymentIntentId: 'pi_emr_reader_stub',
        clientSecret: 'stub',
        amountCents: cents,
        currency: 'usd',
        status: 'succeeded',
        clientLabel: null,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        targetDeviceId: null,
        invoice,
      }),
    );
  });
  cy.intercept('POST', '**/visit-payments/*/terminal/checkout/sync', (req) => {
    const invoiceId = String(req.url.match(/visit-payments\/([^/]+)\/terminal/)?.[1]);
    return getInvoice(invoiceId).then((invoice) => req.reply({ paid: invoice.status === 'paid', invoice }));
  });
  cy.intercept('POST', '**/visit-payments/*/charge-saved-card', (req) => {
    const invoiceId = String(req.url.match(/visit-payments\/([^/]+)\/charge-saved-card/)?.[1]);
    return settle('saved', invoiceId).then(({ invoice }) => req.reply(invoice));
  });
  return { calls: () => calls };
}

/**
 * Puts an accepted order (and so a bill line) on a chart, at an explicit price. (The $0 lines in the first runs
 * came from addChargeVia clicking the search box's "Add as note" row, not from the catalog result; fixed there.)
 * The specs place orders through the API, the same call the box makes, and use the screens to check the result.
 */
export function addOrder(encounterId: string, itemId: number, name: string, unitPrice: number, opts: { qty?: number; kind?: 'treatment' | 'med'; confirmDuplicate?: boolean } = {}) {
  return emrApi<{ id: string; name: string }>('veterinarian', 'POST', `/soap-encounters/${encounterId}/orders`, {
    ...(opts.confirmDuplicate ? { confirmDuplicate: true } : {}),
    practiceId: emrWorld().practiceId,
    name: itemName(name),
    kind: opts.kind ?? 'treatment',
    catalogItemId: itemId,
    catalogItemType: 'inventory',
    qty: opts.qty ?? 1,
    unitPrice,
    state: 'accepted',
  });
}

/**
 * Stores the recap draft on the chart, the way the wrap-up page saves one, so the page opens with a draft and never
 * calls the AI writer. (The AI route is also stubbed as a safety net.)
 */
export function seedRecapDraft(encounterId: string, subject: string, bodyHtml: string) {
  const w = emrWorld();
  return emrApi<{ subjective?: Record<string, unknown> | null }>('veterinarian', 'GET', `/soap-encounters/${encounterId}?practiceId=${w.practiceId}`).then((enc) =>
    emrApi('veterinarian', 'PATCH', `/soap-encounters/${encounterId}`, {
      practiceId: w.practiceId,
      subjective: { ...(enc.subjective && typeof enc.subjective === 'object' ? enc.subjective : {}), clientEmailSubject: subject, clientEmailBody: bodyHtml },
    }),
  );
}

/** Waits for the recap form to show its seeded draft. */
export function waitForRecapDraft() {
  cy.contains('label', 'Subject', { timeout: 40000 }).find('input').should('not.have.value', '');
}

/** Records every rabies / DA2PP dose on the chart (lot and tag), so the chart can be signed. */
export function recordDoses(encounterId: string, tag = 'T-0042') {
  const w = emrWorld();
  const next = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  return emrApi<Array<{ id: string; name: string }>>('veterinarian', 'GET', `/soap-encounters/${encounterId}/orders?practiceId=${w.practiceId}`).then((orders) => {
    const jobs: Array<[string, { lotNumber: string; lotBalanceId: number }, string | undefined]> = [
      [itemName('Rabies vaccine'), w.lots.rabies, tag],
      [itemName('DA2PP vaccine'), w.lots.da2pp, undefined],
    ];
    for (const [name, lot, t] of jobs) {
      const order = orders.find((o) => o.name === name);
      if (!order) continue;
      emrApi('veterinarian', 'PUT', `/soap-encounters/${encounterId}/orders/${order.id}/vaccination`, {
        practiceId: w.practiceId,
        nextVaccinationDate: next,
        inventoryLotBalanceId: lot.lotBalanceId,
        lotNumber: lot.lotNumber,
        ...(t ? { tagNumber: t } : {}),
        employeeId: w.employees.veterinarian,
      });
    }
  });
}
