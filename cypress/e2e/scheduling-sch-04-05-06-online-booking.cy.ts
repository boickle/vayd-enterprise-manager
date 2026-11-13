/// <reference types="cypress" />
/**
 * SCH-04-4, SCH-05-3 and SCH-06-4 (docs/test-plans/scheduling-and-routing.md in vayd-api).
 *
 * Runs against the seeded scheduling world (vayd-api test/scripts/scheduling-e2e-seed.ts) and the
 * real API. The household A portal login fills in the public appointment form. The slot picker is
 * not driven here: the outgoing POST /public/appointments/form is rewritten to the seeded doctor,
 * visit type, pets and a fixed time, then sent on to the real API, which decides the outcome.
 *
 * Needs: CYPRESS_SCHEDULING_WORLD (world JSON). SCH-06-4 also needs the API started with the
 * email capture preload (EMAIL_CAPTURE_PATH, see test/scripts/e2e-capture-preload.js) and
 * APPOINTMENT_REQUEST_TEST_EMAIL set (lower environments only email that inbox).
 */
import '../support/e2e';
import {
  schedulingApi,
  schedulingWorld,
  signInAsScheduling,
} from '../support/schedulingWorld';
import {
  fillExistingClientForm,
  freshVisitorIp,
  setUpPortalForm,
  showOnScreen,
} from '../support/schedulingPortal';

const D2_MESSAGE =
  'That time was just taken. Our team will call you soon to find another time.';

/** A New York wall-clock time on the weekday `workdaysAhead` weekdays from today (DST-safe). */
function workdayAt(hour: number, minute: number, workdaysAhead: number): Date {
  const tz = 'America/New_York';
  const ymd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const isWeekend = (d: Date) => [0, 6].includes(new Date(`${ymd(d)}T12:00:00Z`).getUTCDay());
  const cursor = new Date();
  let left = workdaysAhead;
  while (left > 0 || isWeekend(cursor)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) left--;
  }
  const [y, m, d] = ymd(cursor).split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    guess +=
      Date.UTC(y, m - 1, d, hour, minute) -
      Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  }
  return new Date(guess);
}

type PetRef = { id: number; name: string };

/** Points the submitted form at the seeded world: household A, doctor A, Medical Visit, `start`. */
function routeFormToSeededSlot(start: Date, pets: PetRef[]) {
  const w = schedulingWorld();
  cy.intercept('POST', '**/public/appointments/form', (req) => {
    const typeId = w.types.medical;
    const body = req.body as Record<string, unknown>;
    // The form endpoint allows 3 submissions an hour per IP. The API trusts X-Forwarded-For from loopback, so each
    // submission comes from its own made-up visitor address and reruns are not throttled.
    req.headers['x-forwarded-for'] = freshVisitorIp();
    req.body = {
      ...body,
      clientType: 'existing',
      isLoggedIn: true,
      practiceId: w.practiceId,
      email: `${w.tag}+householdA@vayd.test`,
      clientId: String(w.households.A.clientId),
      pets: pets.map((p) => ({
        id: String(p.id),
        dbId: p.id,
        name: p.name,
        species: 'Canine',
        breed: 'Mixed',
      })),
      allPets: undefined,
      existingClientNewPets: undefined,
      petSpecificData: Object.fromEntries(
        pets.map((p) => [
          String(p.id),
          {
            appointmentTypeId: typeId,
            appointmentTypeName: 'Medical Visit',
            needsToday: 'Not feeling well',
          },
        ])
      ),
      optOutOfRecordsRequest: true,
      recordsDelivery: undefined,
      addressChanged: false,
      appointmentType: 'regular_visit',
      preferredDoctorId: w.doctors.A,
      noneOfWorkForMe: false,
      selectedDateTimePreferences: null,
      selfScheduledSlot: {
        doctorId: w.doctors.A,
        appointmentStart: start.toISOString(),
        serviceMinutes: 60,
      },
      onlineBooking: true,
    };
    req.continue();
  }).as('submitForm');
}

/** Staff book a visit through the API (as the seeded client liaison). */
function staffBook(o: {
  clientId: number;
  patientId: number;
  doctorId: number;
  start: Date;
  minutes?: number;
}) {
  const w = schedulingWorld();
  const end = new Date(o.start.getTime() + (o.minutes ?? 60) * 60_000);
  return schedulingApi('cl', 'POST', '/appointments', {
    practiceId: w.practiceId,
    primaryProviderId: o.doctorId,
    clientId: o.clientId,
    patientId: o.patientId,
    appointmentTypeId: w.types.medical,
    appointmentStart: o.start.toISOString(),
    appointmentEnd: end.toISOString(),
    description: 'SCH e2e: booked by staff first',
    // The Scheduler's Book screen always sends this (see plan SCH-A1).
    bookedViaRouting: true,
  });
}

describe('Online booking outcomes on the public form (SCH-04-4, SCH-05-3, SCH-06-4)', () => {
  beforeEach(() => {
    setUpPortalForm();
  });

  it('SCH-04-4: the picked slot is booked by staff first -> the client sees the D2 message, not "booked successfully"', () => {
    const w = schedulingWorld();
    const start = workdayAt(10, 0, 3);
    // Staff fill the open slot (another household) before the client submits.
    staffBook({
      clientId: w.households.B.clientId,
      patientId: w.households.B.petId,
      doctorId: w.doctors.A,
      start,
    });
    routeFormToSeededSlot(start, [{ id: w.households.A.activePetIds[0], name: 'Alder' }]);

    signInAsScheduling('client', '/client-portal/request-appointment');
    fillExistingClientForm([0]);
    cy.contains('button', 'Submit').click();

    cy.wait('@submitForm')
      .its('response.body')
      .should((body) => {
        expect(body.bookingOutcome).to.equal('slot_taken');
        expect(body.message).to.equal(D2_MESSAGE);
      });
    showOnScreen(cy.contains(D2_MESSAGE)).should('be.visible');
    cy.contains('booked successfully').should('not.exist');
  });

  it('SCH-05-3: one of two pets cannot be booked -> the success page shows the partial message', () => {
    const w = schedulingWorld();
    const start = workdayAt(13, 0, 3);
    const [alderId, birchId] = w.households.A.activePetIds;
    // Alder already has a visit in that window with doctor B.
    staffBook({
      clientId: w.households.A.clientId,
      patientId: alderId,
      doctorId: w.doctors.B,
      start,
    });
    routeFormToSeededSlot(start, [
      { id: alderId, name: 'Alder' },
      { id: birchId, name: 'Birch' },
    ]);

    signInAsScheduling('client', '/client-portal/request-appointment');
    fillExistingClientForm([0, 1]);
    cy.contains('button', 'Submit').click();

    cy.wait('@submitForm').its('response.body.bookingOutcome').should('equal', 'partial');
    showOnScreen(cy.contains('booked for Birch')).should('be.visible');
    showOnScreen(cy.contains('our team will call you about Alder')).should('be.visible');
    cy.contains('booked successfully').should('not.exist');
  });

  it('SCH-06-4: a double click on Submit sends one client confirmation', () => {
    const w = schedulingWorld();
    const start = workdayAt(9, 0, 4);
    routeFormToSeededSlot(start, [{ id: w.households.A.activePetIds[1], name: 'Birch' }]);
    cy.clearCapturedEmails();

    signInAsScheduling('client', '/client-portal/request-appointment');
    fillExistingClientForm([1]);
    // Two native clicks in the same tick: the second lands before React re-renders the button.
    cy.contains('button', 'Submit').then(($button) => {
      $button[0].click();
      $button[0].click();
    });

    cy.wait('@submitForm');
    showOnScreen(cy.contains('Thank You!', { timeout: 20000 })).should('be.visible');
    cy.get('@submitForm.all').should('have.length', 1);
    cy.capturedEmails().then((emails) => {
      const confirmations = (emails as Array<{ subject?: string }>).filter((e) =>
        /Your Appointment Is Confirmed|We Received Your Appointment Request/.test(e.subject ?? '')
      );
      expect(confirmations, 'client confirmations').to.have.length(1);
    });
  });
});
