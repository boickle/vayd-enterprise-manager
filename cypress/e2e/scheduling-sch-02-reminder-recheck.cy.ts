/// <reference types="cypress" />
/**
 * SCH-02-5 (docs/test-plans/scheduling-and-routing.md in vayd-api): a visit is cancelled after the reminder
 * was built; when the send job runs, no text goes to that client.
 *
 * NOT RUN YET. The orchestrator runs it against a seeded vayd_api_test* database:
 *   1. Seed the world (test/scripts/scheduling-e2e-seed.ts) and export CYPRESS_SCHEDULING_WORLD.
 *   2. Build the API (npx nest build), then run this spec with
 *        CYPRESS_SCH_API_DIR=<vayd-api worktree> CYPRESS_SCH_DB=vayd_api_test_a
 *        CYPRESS_SCH_SMS_CAPTURE=/tmp/sch02-sms.jsonl
 *      The spec runs the API's test/scripts/sch-02-reminders-job.js twice through cy.exec ("build", then
 *      "send"); that script calls the cron and sender methods once and captures texts to the JSONL file
 *      (nothing is delivered). TEST_REMINDER_PHONE is set for it so the real send path is reached.
 *   The job must run in the morning-like state the API expects; it uses real "now", and the build only
 *   queues visits from tomorrow (UTC) onward, so run it before 8 pm New York (the UTC day must not have rolled).
 *
 * Staff cancel is done through the same PATCH the Scheduler's Cancel sends (confirmStatusName "Canceled
 * Appointment"), not by clicking the calendar, so this spec does not depend on the SCH-03 Remove change.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld } from '../support/schedulingWorld';

const CANCELED = 'Canceled Appointment';

function nyTomorrowAt(hour: number): Date {
  const tz = 'America/New_York';
  const t = new Date(Date.now() + 24 * 3600 * 1000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t);
  const [y, m, d] = ymd.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, 0);
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(new Date(guess));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    guess +=
      Date.UTC(y, m - 1, d, hour, 0) -
      Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  }
  return new Date(guess);
}

describe('SCH-02-5: reminder not sent for a visit cancelled after the build', () => {
  const apiDir = () => Cypress.env('SCH_API_DIR') as string;
  const capture = () => (Cypress.env('SCH_SMS_CAPTURE') as string) || '/tmp/sch02-sms.jsonl';
  const job = (mode: 'build' | 'send') =>
    cy.exec(
      `cd "${apiDir()}" && DB_DATABASE=${Cypress.env('SCH_DB')} MIGRATION_DB_NAME=${Cypress.env('SCH_DB')} ` +
        `TEST_REMINDER_PHONE=2078440442 SMS_CAPTURE_PATH="${capture()}" node test/scripts/sch-02-reminders-job.js ${mode}`,
      { timeout: 180000 }
    );

  it('the cancelled visit gets no text, a kept visit still does', () => {
    const w = schedulingWorld();
    // A random minute avoids a same-pet same-time clash with a visit left by an earlier run.
    const start = new Date(nyTomorrowAt(9).getTime() + Math.floor(Math.random() * 50) * 60_000);
    const end = new Date(start.getTime() + 5 * 60_000);
    const book = (patientId: number, doctorId: number, desc: string) =>
      schedulingApi('cl', 'POST', '/appointments', {
        practiceId: w.practiceId,
        primaryProviderId: doctorId,
        clientId: w.households.A.clientId,
        patientId,
        appointmentTypeId: w.types.medical,
        appointmentStart: start.toISOString(),
        appointmentEnd: end.toISOString(),
        description: desc,
        bookedViaRouting: true, // the cl login may not book this type by hand; routing bookings are allowed
      });

    cy.writeFile(capture(), '');
    // Clean slate for household A: earlier runs (and the other specs) leave future visits and sent-reminder rows,
    // and the sender will not text a household twice for the same day. Test database only.
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const clientId = w.households.A.clientId;
    const sql = (statement: string) =>
      cy.exec(`psql -d ${db} -c "${statement.replace(/"/g, '\\"')}"`);
    sql(`delete from notification_outbox where "clientId"=${clientId}`);
    sql(`update appointments set "isDeleted"=true where "clientId"=${clientId} and "appointmentStart">now()`);
    // The seeded household cannot be texted; allow it for this test (texts are captured, never delivered).
    sql(
      `update clients set "doNotSendReminders"=false,"doNotSms"=false,"smsOptOut"=false where id=${clientId}`
    );
    const [pet1, pet2] = w.households.A.activePetIds;
    book(pet1, w.doctors.A, 'SCH-02 e2e keep').then((keep) => {
      book(pet2, w.doctors.B, 'SCH-02 e2e cancel').then((gone) => {
        job('build');
        // Staff cancel it in the Scheduler (same PATCH as its Cancel button) after the 3 am build.
        schedulingApi('cl', 'PATCH', `/appointments/${gone.body.id}`, {
          cancellationFlag: true,
          confirmStatusName: CANCELED,
          cancellationReason: 'SCH-02 e2e',
        });
        // Only this household's reminders are under test: drop the rows the build queued for any other client in the
        // copied data, so their texts do not land in the capture.
        sql(`delete from notification_outbox where "clientId" is distinct from ${clientId}`);
        job('send');
        cy.readFile(capture()).then((raw: string) => {
          const texts = raw
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as { to: string; body: string });
          // Household A has two pets; only the kept visit may be mentioned, in one text.
          expect(texts, 'one text for the remaining visit').to.have.length(1);
          expect(keep.body.id).to.be.a('number');
        });
        sql(
          `update clients set "doNotSendReminders"=true,"doNotSms"=true,"smsOptOut"=true where id=${clientId}`
        );
      });
    });
  });
});
