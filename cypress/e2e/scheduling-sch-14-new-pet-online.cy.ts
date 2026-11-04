/// <reference types="cypress" />
/**
 * SCH-14-4 (docs/test-plans/scheduling-and-routing.md in vayd-api, per D6): an existing client
 * adds a new pet on the public form and picks a slot. The pet is created in Scout and a normal
 * visit is booked, so the Scheduler shows the visit for Mochi, not a HOLD.
 *
 * Runs against the seeded scheduling world and the real API. The outgoing
 * POST /public/appointments/form is rewritten to the seeded doctor, visit type, time and a new pet,
 * then sent on to the real API. Needs CYPRESS_SCHEDULING_WORLD.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import {
  fillExistingClientForm,
  freshVisitorIp,
  setUpPortalForm,
  waitForFormResponse,
} from '../support/schedulingPortal';

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

describe('SCH-14-4: new pet of an existing client books a normal visit', () => {
  beforeEach(() => {
    setUpPortalForm();
  });

  it('shows the visit for Mochi on the Scheduler, not a HOLD', () => {
    const w = schedulingWorld();
    // A random day and time avoids a clash with visits earlier runs left (a started visit cannot be cleared).
    const start = workdayAt(
      9 + Math.floor(Math.random() * 6),
      Math.floor(Math.random() * 50),
      5 + Math.floor(Math.random() * 20)
    );
    const newPet = {
      id: `new-${Date.now()}`,
      name: 'Mochi',
      species: 'Canine',
      speciesId: 0,
      age: '2',
      spayedNeutered: 'Yes',
      sex: 'Female',
      breed: 'Mixed',
      breedId: 0,
      color: 'Brown',
      weight: 30,
    };
    cy.intercept('POST', '**/public/appointments/form', (req) => {
      const body = req.body as Record<string, unknown>;
      req.headers['x-forwarded-for'] = freshVisitorIp();
      req.body = {
        ...body,
        clientType: 'existing',
        isLoggedIn: true,
        practiceId: w.practiceId,
        email: `${w.tag}+householdA@vayd.test`,
        clientId: String(w.households.A.clientId),
        pets: [{ ...newPet, new: true }],
        allPets: undefined,
        existingClientNewPets: [newPet],
        petSpecificData: {
          [newPet.id]: {
            appointmentTypeId: w.types.medical,
            appointmentTypeName: 'Medical Visit',
            needsToday: 'Not feeling well',
          },
        },
        optOutOfRecordsRequest: true,
        addressChanged: false,
        appointmentType: 'regular_visit',
        preferredDoctorId: w.doctors.A,
        selfScheduledSlot: {
          doctorId: w.doctors.A,
          appointmentStart: start.toISOString(),
          serviceMinutes: 60,
        },
        onlineBooking: true,
      };
      req.continue();
    }).as('submitForm');

    signInAsScheduling('client', '/client-portal/request-appointment');
    fillExistingClientForm([0]);
    cy.contains('button', 'Submit').click();

    waitForFormResponse('@submitForm')
      .its('response.body')
      .then((body) => {
        expect(body.bookingOutcome).to.equal('booked');
        schedulingApi('cl', 'GET', `/appointments/request-submissions/${body.submissionId}`).then(
          (res) => {
            const appointmentId = res.body.bookedAppointmentId as number;
            expect(appointmentId, 'booked visit').to.be.a('number');
            schedulingApi('cl', 'GET', `/appointments/${appointmentId}`).then((appt) => {
              expect(appt.body.patientId, 'linked to a pet').to.be.a('number');
              expect(appt.body.appointmentType?.isHold ?? false).to.equal(false);
            });
            const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
              start
            );
            signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}`);
            cy.get(`[data-appt-id="${appointmentId}"]`, { timeout: 30000 })
              .first()
              .should('contain.text', 'Mochi')
              .and('not.contain.text', 'HOLD');
          }
        );
      });
  });
});
