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

/** Household A's existing-client form, up to (not including) Submit, with the given pets checked. */
function fillExistingClientForm(petIndexes: number[]) {
  cy.get('input[type="tel"]', { timeout: 15000 }).should('not.have.value', '');
  cy.contains('Is this the address where we will come to see you')
    .parent()
    .find('input[value="Yes"]')
    .check();
  cy.get('input[type="checkbox"]', { timeout: 10000 });
  for (const i of petIndexes) {
    cy.get('input[type="checkbox"]').eq(i).check();
    cy.get('[data-visit-reason="not-feeling-well"]').eq(i).click();
  }
  cy.get('textarea').first().type('Limping since yesterday');
  cy.contains('How soon do you need to be seen?').scrollIntoView();
  cy.get('[data-how-soon="Flexible"]').click();
}

describe('SCH-10-3: employer promotion shows on the first visit checkout', () => {
  beforeEach(() => {
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
    // Reference data the form loads; the client's own pets and contact come from the real API.
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', {
      fixture: 'species-breeds.json',
    }).as('getSpecies');
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', {
      fixture: 'breeds.json',
    }).as('getBreeds');
    cy.intercept('GET', '**/public/appointment-types*', { fixture: 'appointment-types.json' }).as(
      'getAppointmentTypes'
    );
    cy.intercept('GET', '**/appointment-types*', { fixture: 'appointment-types.json' }).as(
      'getAuthAppointmentTypes'
    );
    cy.intercept('GET', '**/public/appointments/find-zone-by-address*', { statusCode: 200 }).as(
      'checkZone'
    );
    cy.intercept('POST', '**/public/appointments/availability', {
      fixture: 'availability-slots.json',
    }).as('getAvailability');
    cy.intercept('GET', '**/public/appointments/veterinarians*', {
      fixture: 'veterinarians.json',
    }).as('getPublicVeterinarians');
    cy.intercept('GET', '**/employees/veterinarians*', { fixture: 'veterinarians.json' }).as(
      'getVeterinarians'
    );
  });

  it('books online with the code, then staff see "Employer promotion –$50.00" and confirm it', () => {
    const w = schedulingWorld();
    const start = workdayAt(9, 0, 5);
    const code = `SCHE2E${Date.now().toString(36).toUpperCase()}`;
    const pet: PetRef = { id: w.households.A.activePetIds[0], name: 'Alder' };
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
      req.body = {
        ...body,
        clientType: 'existing',
        isLoggedIn: true,
        practiceId: w.practiceId,
        email: `${w.tag}+householdA@vayd.test`,
        clientId: String(w.households.A.clientId),
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

    cy.wait('@submitForm')
      .its('response.body')
      .then((body) => {
        expect(body.bookingOutcome).to.equal('booked');
        schedulingApi('cl', 'GET', `/appointments/request-submissions/${body.submissionId}`).then(
          (res) => {
            const appointmentId = res.body.bookedAppointmentId as number;
            expect(appointmentId, 'booked visit').to.be.a('number');
            signInAsScheduling(
              'cl',
              `/schedule/soap/${appointmentId}/${pet.id}/checkout?clientId=${w.households.A.clientId}`
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
