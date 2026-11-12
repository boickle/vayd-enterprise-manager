/// <reference types="cypress" />
/**
 * SCH-R5-1..R5-5 (docs/test-plans/scheduling-and-routing.md in vayd-api): the Appointments list end to end
 * (Scheduling > Appointments, /schedule/appointments), signed in as the seeded CL.
 *   R5-1 a client text on an open request: red badge on the Scheduling menu, the Appointments link and the row;
 *        the row is first and shows "↩ Texted" (plus a blue badge when the request is someone else's, D-A5).
 *   R5-2 opening the row reads the reply (badge clears), More > Mark as unread brings it back.
 *   R5-3 a booked request: Records "Not needed", then Communication "Communication complete" (D-A3, D8); the row
 *        leaves In progress and shows on Booked. The Booking, Communication and Records pills are all driven.
 *   R5-4 conversation: "Checking texts…" while the (slow) texts load, calls already in, "Checking for messages…"
 *        until done.
 *   R5-5 record pop-up: client name, then pet name, open the client / medical record in a dialog; Esc closes.
 *
 * NOT RUN YET (written, compiled only). Needs: the scheduling world seeded with vayd-api's
 * test/scripts/scheduling-e2e-seed.ts into a vayd_api_test* database (export CYPRESS_SCHEDULING_WORLD), the API
 * running on that same database, and CYPRESS_SCH_DB naming it (default vayd_api_test_rb). psql must be on the PATH.
 *
 * Fakes (no real Gmail or Quo is touched):
 *  - Client replies are inserted straight into appointment_request_reply (channel 'text', no Gmail, no Quo), on
 *    appointment_request_submission rows inserted in the same test database. Every row carries requestData.e2eTag
 *    ("SCHR5-...") and is deleted afterwards (and any leftover from an earlier crashed run, before).
 *  - GET /gmail/access is stubbed to {allowed:false}: the page then makes no Gmail calls at all.
 *  - GET .../conversation?include=texts|calls is stubbed (the page loads texts and calls as two requests), so
 *    Quo is never called; R5-4 delays the texts answer.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { bookVisit } from '../support/schedulingRemove';

const STAMP = Date.now();
const TAG_PREFIX = 'SCHR5-';
const TAG = `${TAG_PREFIX}${STAMP}`;
const LIST = '/schedule/appointments';

const db = () => String(Cypress.env('SCH_DB') || 'vayd_api_test_rb');

/** One statement against the test database; yields the first output line. */
function sql(statement: string): Cypress.Chainable<string> {
  const name = db();
  expect(name, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(
    /^vayd_api_test[A-Za-z0-9_]*$/
  );
  return cy
    .exec(`psql -h localhost -U vayd -d ${name} -qtA -c "$R5_SQL"`, {
      env: { PGPASSWORD: String(Cypress.env('PGPASSWORD') || 'vayd'), R5_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function removeTaggedRows() {
  const tagged = `select id from appointment_request_submission where "requestData"->>'e2eTag' like '${TAG_PREFIX}%'`;
  sql(`delete from appointment_request_reply where "submissionId" in (${tagged})`);
  sql(`delete from appointment_request_submission where id in (${tagged})`);
}

type SeedOptions = {
  /** Shown name: first "R5", last = label + stamp. */
  label: string;
  status?: 'new' | 'contacted' | 'booked';
  communicationStatus?: 'not_contacted' | 'contacted' | 'owner_replied' | 'complete';
  recordsStatus?: 'waiting' | 'not_needed' | 'complete' | null;
  liaisonEmployeeId?: number | null;
  bookedAppointmentId?: number | null;
  /** Links the request to household A and its first pet in Scout (R5-5). */
  linkToScout?: boolean;
  /** Client text(s) to record as unread replies. */
  replyText?: string | null;
};

/** Inserts one request (and its unread text reply); yields { id, name }. */
function seedRequest(o: SeedOptions): Cypress.Chainable<{ id: number; name: string }> {
  const w = schedulingWorld();
  const name = `R5 ${o.label}${STAMP}`;
  const hh = w.households.A;
  const requestData = {
    e2eTag: TAG,
    clientType: 'existing',
    fullName: { first: 'R5', last: `${o.label}${STAMP}` },
    email: `r5-${o.label.toLowerCase()}@vayd.test`,
    ...(o.linkToScout ? { clientId: String(hh.clientId) } : {}),
    pets: [
      {
        name: 'Biscuit',
        ...(o.linkToScout
          ? {
              id: String(hh.activePetIds[0]),
              dbId: String(hh.activePetIds[0]),
              clientId: String(hh.clientId),
            }
          : {}),
      },
    ],
  };
  const booked = o.bookedAppointmentId != null;
  const insert =
    `insert into appointment_request_submission ("practiceId","submittedAt","requestData","status","communicationStatus",` +
    `"recordsStatus","needsRecords","liaisonEmployeeId","bookedAppointmentId","bookedAt") values (` +
    `${w.practiceId}, now() - interval '1 hour', $j$${JSON.stringify(requestData)}$j$::jsonb, ${q(o.status ?? 'new')}, ` +
    `${q(o.communicationStatus ?? 'not_contacted')}, ${o.recordsStatus ? q(o.recordsStatus) : 'null'}, ` +
    `${o.recordsStatus === 'waiting'}, ${o.liaisonEmployeeId ?? 'null'}, ${o.bookedAppointmentId ?? 'null'}, ` +
    `${booked ? 'now()' : 'null'}) returning id`;
  return sql(insert).then((idText) => {
    const id = Number(idText);
    expect(id, 'seeded submission id').to.be.greaterThan(0);
    if (!o.replyText) return cy.wrap({ id, name });
    return sql(
      `insert into appointment_request_reply ("submissionId","channel","externalId","fromAddress","preview","receivedAt") values ` +
        `(${id}, 'text', ${q(`r5-${STAMP}-${id}`)}, '+19195550142', ${q(o.replyText)}, now() - interval '5 minutes')`
    ).then(() => ({ id, name }));
  });
}

const unreadMine = () =>
  schedulingApi<{ mine: number; others: number }>(
    'cl',
    'GET',
    `/appointments/request-submissions/unread-counts?practiceId=${schedulingWorld().practiceId}`
  ).then((res) => res.body.mine);

/** The API's red count for the CL, retried a few times (the page's own write may still be in flight). */
function expectUnreadMine(expected: number, tries = 10): void {
  unreadMine().then((n) => {
    if (n === expected) return;
    if (tries <= 0) expect(n, 'unread requests for the CL').to.eq(expected);
    else cy.wait(500).then(() => expectUnreadMine(expected, tries - 1));
  });
}

const row = (name: string) => cy.contains('ul.appt-request-list > li', name, { timeout: 30000 });

const EMPTY_CONVERSATION = {
  submissionId: 0,
  phone: null,
  texts: [],
  textsError: null,
  quoCalls: [],
  calls: [],
};

/** Stand-ins for Gmail and Quo; texts and calls are separate requests. */
function stubGmailAndQuo(opts?: { textsDelayMs?: number; textBody?: string; callNote?: string }) {
  cy.intercept('GET', '**/gmail/access*', { statusCode: 200, body: { allowed: false } });
  cy.intercept('GET', /\/appointments\/request-submissions\/\d+\/conversation\?.*include=calls/, {
    statusCode: 200,
    body: {
      ...EMPTY_CONVERSATION,
      calls: opts?.callNote
        ? [
            {
              id: 9001,
              at: new Date().toISOString(),
              outcome: 'reached',
              note: opts.callNote,
              employee: null,
            },
          ]
        : [],
    },
  }).as('convoCalls');
  cy.intercept('GET', /\/appointments\/request-submissions\/\d+\/conversation\?.*include=texts/, {
    delay: opts?.textsDelayMs ?? 0,
    statusCode: 200,
    body: {
      ...EMPTY_CONVERSATION,
      texts: opts?.textBody
        ? [
            {
              id: 'r5-text-1',
              direction: 'in',
              body: opts.textBody,
              at: new Date().toISOString(),
              beforeRequest: false,
            },
          ]
        : [],
    },
  }).as('convoTexts');
}

describe('SCH-R5: Appointments list end to end', () => {
  before(() => {
    removeTaggedRows();
  });
  after(() => {
    removeTaggedRows();
  });

  it('SCH-R5-1 a client text puts a red badge on the menu, the link and the row, and the row is first', () => {
    stubGmailAndQuo();
    seedRequest({ label: 'Reply', replyText: 'Can we do Tuesday instead?' }).then(({ name }) => {
      signInAsScheduling('cl', `${LIST}?tab=new`);
      row(name).within(() => {
        cy.get('.appt-reply-badge--mine').should('exist');
        cy.get('.appt-table-reply')
          .should('contain.text', '↩ Texted')
          .and('contain.text', 'Can we do Tuesday instead?');
      });
      cy.get('ul.appt-request-list > li').first().should('contain.text', name);
      // The Appointments link (quick link) and the Scheduling menu carry the red count too.
      cy.contains('.schedule-app__quick-link-label', 'Appointments')
        .find('.appt-reply-badge--mine')
        .should('exist');
      cy.contains('summary', 'Scheduling').find('.appt-reply-badge--mine').should('exist');
    });
  });

  it("SCH-R5-1 (D-A5) a reply on someone else's request is blue, not red", () => {
    stubGmailAndQuo();
    const others = schedulingWorld().employees.manager;
    seedRequest({
      label: 'Others',
      liaisonEmployeeId: others,
      replyText: 'Are you coming today?',
    }).then(({ name }) => {
      signInAsScheduling('cl', `${LIST}?tab=new`);
      row(name).within(() => {
        cy.get('.appt-reply-badge--others').should('exist');
        cy.get('.appt-reply-badge--mine').should('not.exist');
        cy.get('.appt-table-reply').should('contain.text', '↩ Texted');
      });
    });
  });

  it('SCH-R5-2 opening the row reads the reply; More > Mark as unread brings it back', () => {
    stubGmailAndQuo({ textBody: 'Please call me' });
    seedRequest({ label: 'Unread', replyText: 'Please call me' }).then(({ id, name }) => {
      unreadMine().then((before) => {
        expect(before, 'unread requests for the CL before opening').to.be.greaterThan(0);
        signInAsScheduling('cl', `${LIST}?tab=new`);
        row(name).find('.appt-reply-badge--mine').should('exist');

        // Open: the reply is read for everyone, the row's badge and "↩ Texted" line go.
        row(name).find('button.appt-table-client').click();
        row(name).find('.appt-reply-badge--mine').should('not.exist');
        row(name).find('.appt-table-reply').should('not.exist');
        expectUnreadMine(before - 1);
        if (before - 1 === 0) {
          cy.contains('.schedule-app__quick-link-label', 'Appointments')
            .find('.appt-reply-badge--mine')
            .should('not.exist');
        }

        // Mark as unread: the latest reply is unread again and the request closes.
        row(name).contains('button', 'More').click();
        cy.contains('[role="menuitem"]', 'Mark as unread').click();
        row(name).find('.appt-reply-badge--mine').should('exist');
        row(name).find('.appt-table-reply').should('contain.text', '↩ Texted');
        row(name).find('button.appt-table-client').should('have.attr', 'aria-expanded', 'false');
        expectUnreadMine(before);
        cy.contains('.schedule-app__quick-link-label', 'Appointments')
          .find('.appt-reply-badge--mine')
          .should('exist');
        schedulingApi<{ unreadReplies?: { count: number } | null }>(
          'cl',
          'GET',
          `/appointments/request-submissions/${id}`
        ).then((res) => {
          if (res.body.unreadReplies !== undefined) expect(res.body.unreadReplies?.count).to.eq(1);
        });
      });
    });
  });

  it('SCH-R5-3 a booked request leaves In progress for Booked once Records and Communication are done', () => {
    stubGmailAndQuo();
    const apptIds: number[] = [];
    bookVisit('SCH-R5-3 booked visit', 11).then(({ id: apptId }) => {
      apptIds.push(apptId);
      seedRequest({
        label: 'Booked',
        status: 'booked',
        communicationStatus: 'contacted',
        recordsStatus: 'waiting',
        bookedAppointmentId: apptId,
      }).then(({ id, name }) => {
        signInAsScheduling('cl', `${LIST}?tab=contacted`);
        row(name).within(() => {
          cy.get('button[aria-label^="Booking for"]').should('contain.text', 'Booked');
          cy.get('button[aria-label^="Communication for"]').should('contain.text', 'Contacted');
          cy.get('button[aria-label^="Records for"]').should('contain.text', 'Waiting on client');
        });

        // The Booking pill is a menu too (Booked is not changed here).
        row(name).find('button[aria-label^="Booking for"]').click();
        cy.get('[role="menu"] [role="menuitem"]').should('have.length.greaterThan', 0);
        cy.get('body').type('{esc}');

        // Records first: with Communication still open the row stays on In progress.
        row(name).find('button[aria-label^="Records for"]').click();
        cy.contains('[role="menuitem"]', 'Not needed').click();
        row(name).find('button[aria-label^="Records for"]').should('contain.text', 'Not needed');
        row(name)
          .find('button[aria-label^="Communication for"]')
          .should('contain.text', 'Contacted');

        // Communication complete (D8): the request is finished, so it leaves In progress.
        row(name).find('button[aria-label^="Communication for"]').click();
        cy.contains('[role="menuitem"]', 'Communication complete').click();
        cy.contains('ul.appt-request-list > li', name, { timeout: 30000 }).should('not.exist');
        schedulingApi<{ communicationStatus: string; recordsStatus: string | null }>(
          'cl',
          'GET',
          `/appointments/request-submissions/${id}`
        ).then((res) => {
          expect(res.body.communicationStatus).to.eq('complete');
          expect(res.body.recordsStatus).to.eq('not_needed');
        });

        cy.contains('.appt-request-status-tab', /^\s*Booked\b/).click();
        row(name).within(() => {
          cy.get('button[aria-label^="Communication for"]').should(
            'contain.text',
            'Communication complete'
          );
          cy.get('button[aria-label^="Records for"]').should('contain.text', 'Not needed');
        });
      });
    });
    cy.then(() => {
      // Take the visit off the calendar (the request row is removed in after()).
      removeTaggedRows();
      apptIds.forEach((id) =>
        schedulingApi('manager', 'DELETE', `/appointments/${id}`, undefined, false)
      );
    });
  });

  it('SCH-R5-4 slow texts: "Checking texts…", calls already in, "Checking for messages…" until done', () => {
    stubGmailAndQuo({
      textsDelayMs: 5000,
      textBody: 'Running late, see you soon',
      callNote: 'Left a voicemail about R5-4',
    });
    seedRequest({ label: 'Convo' }).then(({ name }) => {
      signInAsScheduling('cl', `${LIST}?tab=new`);
      row(name).find('button.appt-table-client').click();
      row(name).within(() => {
        cy.contains('.req-convo-checking-part--busy', 'Checking texts…')
          .scrollIntoView()
          .should('be.visible');
        cy.contains('.req-convo-checking-part', 'Calls ✓').should('be.visible');
        cy.get('.req-convo-status').should('contain.text', 'Checking for messages…');
        // Calls show first, before the texts arrive.
        cy.contains('Left a voicemail about R5-4').should('be.visible');
        cy.contains('Running late, see you soon').should('not.exist');
      });
      row(name).within(() => {
        cy.contains('Running late, see you soon', { timeout: 20000 }).should('be.visible');
        cy.get('.req-convo-checking').should('not.exist');
        cy.get('.req-convo-status').should('not.contain.text', 'Checking for messages…');
      });
    });
  });

  it('SCH-R5-5 the client, then the pet, open their records in a pop-up; Esc closes', () => {
    stubGmailAndQuo();
    seedRequest({ label: 'Record', linkToScout: true }).then(({ name }) => {
      signInAsScheduling('cl', `${LIST}?tab=new`);
      row(name).find('button.appt-table-client').click();

      row(name).find('button.req-record-link[title="Open the client record"]').click();
      cy.get('[data-testid="soap-record-modal"] [role="dialog"]', { timeout: 30000 })
        .should('be.visible')
        .and('contain.text', `${name} — client record`);
      cy.get('body').type('{esc}');
      cy.get('[data-testid="soap-record-modal"]').should('not.exist');

      row(name)
        .find('button.req-record-link[title="Open the medical record"]')
        .contains('Biscuit')
        .click();
      cy.get('[data-testid="soap-record-modal"] [role="dialog"]', { timeout: 30000 })
        .should('be.visible')
        .and('contain.text', 'Biscuit — medical record');
      cy.get('body').type('{esc}');
      cy.get('[data-testid="soap-record-modal"]').should('not.exist');
      // The Appointments list stayed open underneath.
      row(name).should('be.visible');
    });
  });
});
