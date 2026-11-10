/// <reference types="cypress" />
/**
 * COM-03-7 (docs/test-plans/communications.md in vayd-api): screen to database. A signed STOP text arrives on the
 * Quo message webhook of the local API; the CL opens the client page, then the text screens.
 *
 * NOT RUN YET. The orchestrator runs it against a seeded vayd_api_test* database:
 *   1. Seed the world (test/scripts/scheduling-e2e-seed.ts) and export CYPRESS_SCHEDULING_WORLD.
 *   2. Start the test API with OPENPHONE_MESSAGE_WEBHOOK_KEY=<base64 key> (CONTROL_DB_ENABLED=false) and run this spec
 *      with CYPRESS_OPENPHONE_MESSAGE_WEBHOOK_KEY set to the same key, and CYPRESS_SCH_DB=vayd_api_test_<x>.
 *
 * The client's phone is the seeded household A number. The spec turns texts on for it first, posts the signed STOP,
 * checks the client page ("Texts off: replied STOP (<date>)"), that the text screen cannot send and gives the reason,
 * and that the API refuses a staff text. Care Outreach's own text screen (ClientContactComposeModal) shows the same
 * reason and is covered by its component test; the Texts screen on the client page uses the same check.
 * A START reply at the end puts texts back on, so the seeded household is left as it was found.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';

const apiBase = () =>
  Cypress.env('API_URL') ||
  Cypress.config('baseUrl')?.replace(':5173', ':3000') ||
  'http://localhost:3000';

/** Quo's signature: `hmac;1;<timestamp>;<base64 HMAC-SHA256 of "<timestamp>.<body>" keyed by the base64-decoded key>`. */
async function quoSignature(keyBase64: string, body: string): Promise<string> {
  const timestamp = String(Date.now());
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const digest = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `hmac;1;${timestamp};${digest}`;
}

function postInboundText(from: string, text: string) {
  const key = Cypress.env('OPENPHONE_MESSAGE_WEBHOOK_KEY') as string;
  expect(key, 'CYPRESS_OPENPHONE_MESSAGE_WEBHOOK_KEY').to.be.a('string').and.not.be.empty;
  const body = JSON.stringify({
    id: `EVcom03${Date.now()}`,
    object: 'event',
    type: 'message.received',
    createdAt: new Date().toISOString(),
    data: {
      object: {
        id: `ACcom03${Date.now()}`,
        object: 'message',
        from,
        to: ['+12075550000'],
        direction: 'incoming',
        body: text,
        text,
        status: 'received',
        createdAt: new Date().toISOString(),
      },
    },
  });
  return cy.wrap(quoSignature(key, body)).then((signature) =>
    cy.request({
      method: 'POST',
      url: `${apiBase()}/webhooks/openphone/message`,
      headers: { 'content-type': 'application/json', 'openphone-signature': signature as string },
      body,
      failOnStatusCode: false,
    })
  );
}

describe('COM-03-7: a STOP reply shows on the client page and turns the text screens off', () => {
  let phone = '';

  before(() => {
    const { clientId } = schedulingWorld().households.A;
    schedulingApi('manager', 'GET', `/clients/${clientId}`).then((res) => {
      phone = res.body.phone1 || '9195550142';
      schedulingApi('manager', 'PATCH', `/clients/${clientId}`, {
        doNotSms: false,
        smsOptOut: false,
        phone1: phone,
      });
    });
  });

  after(() => {
    // START turns back on what the STOP reply turned off.
    postInboundText(`+1${phone.replace(/\D/g, '').slice(-10)}`, 'START');
  });

  it('shows "Texts off: replied STOP (date)" and blocks texting', () => {
    const w = schedulingWorld();
    const clientId = w.households.A.clientId;
    const e164 = () => `+1${phone.replace(/\D/g, '').slice(-10)}`;
    const today = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    }).format(new Date());

    // An unsigned STOP is refused and changes nothing (COM-03-6, at the real endpoint).
    cy.request({
      method: 'POST',
      url: `${apiBase()}/webhooks/openphone/message`,
      body: { type: 'message.received', data: { object: { from: e164(), direction: 'incoming', body: 'STOP' } } },
      failOnStatusCode: false,
    })
      .its('status')
      .should('eq', 401);

    postInboundText(e164(), 'STOP').its('status').should('be.lessThan', 300);

    schedulingApi('cl', 'GET', `/clients/${clientId}`).then((res) => {
      expect(res.body.smsOptOut).to.eq(true);
      expect(res.body.smsOptOutSource).to.eq('replied STOP');
    });

    // The CL opens the client page.
    signInAsScheduling('cl', `/schedule/clients?clientId=${clientId}`);
    cy.contains(`Texts off: replied STOP (${today})`, { timeout: 20000 }).should('be.visible');

    // The text screen gives the reason and cannot send.
    // Clicking the phone number opens its menu (Call / Text this number / View text history).
    cy.contains(phone.replace(/\D/g, '').slice(-4)).first().click();
    cy.contains('[role="menuitem"]', 'Text this number').click();
    cy.get('[data-testid="texts-off-reason"]').should('contain.text', `Texts off: replied STOP (${today})`);
    // Even with a message typed, the text screen's Send stays off.
    cy.get('[role="dialog"]').within(() => {
      cy.get('textarea').first().type('Hello from the clinic');
      cy.contains('button', 'Send text').should('be.disabled');
    });

    // A text composed by staff is refused by the API with the date.
    schedulingApi(
      'cl',
      'POST',
      `/sms/client/${clientId}`,
      { message: 'Hello from the clinic' },
      false
    ).then((res) => {
      expect(res.status).to.eq(400);
      expect(JSON.stringify(res.body)).to.contain('Client replied STOP on');
    });
  });
});
