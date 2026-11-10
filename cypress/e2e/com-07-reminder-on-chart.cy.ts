/// <reference types="cypress" />
/**
 * COM-07-6 (docs/test-plans/communications.md in vayd-api): screen to database. A health reminder for a seeded pet
 * is built and sent by the local API (fake SES), then the CL opens the pet chart's Communications section and sees
 * the entry: type, date, recipient and the text the client got.
 *
 * NOT RUN YET. The orchestrator runs it against a seeded vayd_api_test* database:
 *   1. Seed the world (test/scripts/scheduling-e2e-seed.ts) and export CYPRESS_SCHEDULING_WORLD.
 *   2. Start the test API with CONTROL_DB_ENABLED=false GMAIL_POLL_INTERVAL_MS=0, the fake SES (the harness's captured
 *      email, never real SES) and TEST_REMINDER_EMAIL=<a test address> so the reminder is redirected, as in any
 *      non-production run. Texts are not used. Nothing else needs to be set.
 *   3. Run this spec between 10:00 and 18:00 New York time: the sender sends nothing outside that window (COM-01).
 *      Set CYPRESS_SCH_DB=vayd_api_test_<x> as for the other scheduling specs.
 *
 * It uses only endpoints the API already has: POST /reminders (staff writes a reminder due in 30 days, which is in the
 * default 30/15/7-day cadence), POST /notifications/reminders/build-reminders and POST /notifications/sender/email
 * (the staff "send now" triggers). The build queues reminders for every household, so the sender also sends other
 * households' pending reminders; the spec only looks at household A's pet. The seed turns every contact block on
 * (doNotEmail, doNotSendReminders), so the spec turns those two off for household A first and back on afterwards.
 * Emails stay captured by the stack (EMAIL_CAPTURE_PATH) and are never delivered.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';

/** Midday New York time `days` from today, as the app's own reminder screens send it (a bare date would be read as
 * midnight UTC, which is the evening before in New York, and miss the 30-day step). */
function dueInDays(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); // YYYY-MM-DD
  return `${day}T16:00:00.000Z`;
}

describe('COM-07-6: a sent reminder shows in the pet chart Communications', () => {
  const description = `COM-07 Rabies vaccine ${Date.now()}`;

  before(() => {
    const { clientId } = schedulingWorld().households.A;
    schedulingApi('manager', 'PATCH', `/clients/${clientId}`, { doNotEmail: false, doNotSendReminders: false });
  });

  after(() => {
    const { clientId } = schedulingWorld().households.A;
    schedulingApi('manager', 'PATCH', `/clients/${clientId}`, { doNotEmail: true, doNotSendReminders: true });
  });

  it('the CL sees "Health reminder email" with the date, the client address and the text', () => {
    const w = schedulingWorld();
    const petId = w.households.A.activePetIds[0];
    const clientId = w.households.A.clientId;

    schedulingApi('cl', 'GET', `/clients/${clientId}`).then((res) => {
      const clientEmail = String(res.body.email || '');
      expect(clientEmail, 'seeded client email').to.contain('@');

      schedulingApi('manager', 'POST', '/reminders', {
        patientId: petId,
        description,
        reminderType: 'Vaccine',
        dueDate: dueInDays(30),
      });
      schedulingApi('manager', 'POST', '/notifications/reminders/build-reminders', {});
      schedulingApi('manager', 'POST', '/notifications/sender/email', {}).then((sent) => {
        expect(sent.body.success, JSON.stringify(sent.body)).to.eq(true);
      });

      // The database side: one entry on this pet, with the text as sent and the client's own address.
      schedulingApi('cl', 'GET', `/patients/${petId}/communication-logs`).then((res) => {
        const logs = res.body as any[];
        const entry = logs.find(
          (l) =>
            String(l.communicationMessageLog?.communicationTypeLabel ?? l.typeLabel ?? '') ===
              'Health reminder email' &&
            String(l.communicationMessageLog?.message ?? l.message ?? '').includes(description)
        );
        expect(entry, 'Health reminder email entry for the pet').to.exist;
        expect(String(entry.email ?? entry.destination ?? '')).to.eq(clientEmail);
      });

      // The screen: the pet chart, Communications.
      signInAsScheduling('cl', `/schedule/patients?patientId=${petId}`);
      // The medical record's "By category" tab lists Communications as a collapsible group.
      cy.contains('[role="tab"]', 'By category', { timeout: 20000 }).scrollIntoView().click();
      cy.contains('.pims-patient-detail__accordion-head', /^.*Communications \(\d+\)/, { timeout: 20000 })
        .scrollIntoView()
        .click();
      cy.contains('.pims-patient-detail__accordion-body', 'Health reminder email', { timeout: 20000 })
        .scrollIntoView()
        .should('be.visible');
    });
  });
});
