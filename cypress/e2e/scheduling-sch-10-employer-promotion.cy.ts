/// <reference types="cypress" />
/**
 * SCH-10-3 (docs/test-plans/scheduling-and-routing.md in vayd-api, per D4): a client books online
 * with an employer promotion code; staff open that visit's checkout and see the pending
 * "Employer promotion" line, then confirm it.
 *
 * Runs against the seeded scheduling world (vayd-api test/scripts/scheduling-e2e-seed.ts) and the
 * real API. Household A's portal login fills in the public appointment form; the outgoing
 * POST /public/appointments/form is rewritten to the seeded doctor, visit type, pet, time and the
 * promotion code, then sent on to the real API. Needs CYPRESS_SCHEDULING_WORLD.
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

type PetRef = { id: number; name: string };

describe('SCH-10-3: employer promotion shows on the first visit checkout', () => {
  beforeEach(() => {
    setUpPortalForm();
  });

  it('books online with the code, then staff see "Employer promotion –$50.00" and confirm it', () => {
    const w = schedulingWorld();
    // A random day and time avoids a clash with visits earlier runs left (a started visit cannot be cleared).
    const start = workdayAt(
      9 + Math.floor(Math.random() * 6),
      Math.floor(Math.random() * 50),
      5 + Math.floor(Math.random() * 20)
    );
    const code = `SCHE2E${Date.now().toString(36).toUpperCase()}`;
    // Household B is the booking client: its first (and only live) visit is this one. Household A carries visits from
    // other specs (some started, so they cannot be cleared), and the promotion belongs only to a client's first visit.
    const pet: PetRef = { id: w.households.B.petId, name: 'Dogwood' };
    // Earlier runs leave unapplied redemptions on this client, and the checkout offers the oldest one first (so a
    // second one would show again after confirming the first). Start from none. Test database only.
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    // The promotion belongs to the client's first live visit, and a visit an earlier run billed cannot be removed
    // through the API, so retire any visits left on this client the same way (soft delete).
    cy.exec(
      `psql -d ${db} -c "update appointments set \\"isDeleted\\"=true where \\"clientId\\"=${w.households.B.clientId}"`
    );
    cy.exec(
      `psql -d ${db} -c "delete from appointment_request_promotion_usage where \\"clientId\\"=${w.households.B.clientId} and \\"appliedAt\\" is null"`
    );
    schedulingApi('manager', 'POST', '/appointment-request-promotions', {
      companyName: 'SCH e2e Acme',
      name: 'SCH e2e $50 off',
      description: '$50 off your first visit',
      code,
      discountType: 'fixed_amount',
      amountOffCents: 5000,
    });

    cy.intercept('POST', '**/public/appointments/form', (req) => {
      const body = req.body as Record<string, unknown>;
      req.headers['x-forwarded-for'] = freshVisitorIp();
      req.body = {
        ...body,
        clientType: 'existing',
        isLoggedIn: true,
        practiceId: w.practiceId,
        email: `${w.tag}+householdB@vayd.test`,
        clientId: String(w.households.B.clientId),
        pets: [
          { id: String(pet.id), dbId: pet.id, name: pet.name, species: 'Canine', breed: 'Mixed' },
        ],
        allPets: undefined,
        existingClientNewPets: undefined,
        petSpecificData: {
          [String(pet.id)]: {
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
        promotionCode: code,
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
            // The checkout page only shows an invoice once one is open ("add a charge above to open one"), so open
            // this visit's own invoice (POST /visit-invoices, as starting the visit's chart does).
            schedulingApi('cl', 'POST', '/visit-invoices', {
              practiceId: w.practiceId,
              appointmentId,
              clientId: w.households.B.clientId,
            });
            signInAsScheduling(
              'cl',
              `/schedule/soap/${appointmentId}/${pet.id}/checkout?clientId=${w.households.B.clientId}`
            );
            cy.get('[data-testid="employer-promotion-line"]', { timeout: 30000 })
              .should('be.visible')
              .and('contain.text', 'Employer promotion –$50.00');
            cy.contains('button', 'Confirm promotion').click();
            cy.get('[data-testid="employer-promotion-line"]').should('not.exist');
            cy.contains('Employer promotion').should('be.visible');
          }
        );
      });
  });
});
