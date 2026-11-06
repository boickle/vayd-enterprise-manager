/// <reference types="cypress" />
/**
 * SCH-08-5 and SCH-09-5 (docs/test-plans/scheduling-and-routing.md in vayd-api).
 *
 * Runs against the seeded scheduling world and the real API. Seed the world with
 * vayd-api test/scripts/scheduling-e2e-seed.ts, then its extras with test/scripts/sch-08-09-e2e-seed.ts
 * (a pet with a pending follow-up and a pending text offer for each case), and pass both JSON files:
 *
 *   CYPRESS_SCHEDULING_WORLD="$(cat sch-world.json)" CYPRESS_SCH_0809="$(cat sch-0809.json)" \
 *     npx cypress run --spec cypress/e2e/scheduling-sch-08-09-inactive-pet.cy.ts
 *
 * The seeded clients cannot be texted or emailed. Each case inactivates its own seeded pet once,
 * so reseed the extras before running again.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';

type Extras = {
  sch08: { petId: number; petName: string; forwardBookingId: number; offerId: string };
  sch09: { petId: number; petName: string; offerId: string; offerToken: string };
};

function extras(): Extras {
  const raw = Cypress.env('SCH_0809') as string | Extras | undefined;
  if (!raw) throw new Error('Set CYPRESS_SCH_0809 to the JSON from sch-08-09-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as Extras) : raw;
}

describe('SCH-08 / SCH-09: an inactive pet leaves no open scheduling items', () => {
  it('SCH-08-5: the chart wrap-up lists the follow-up and the text offer, and the pet leaves the follow-up queue', () => {
    const w = schedulingWorld();
    const { sch08 } = extras();

    signInAsScheduling('cl', `/schedule/patients?patientId=${sch08.petId}`);
    cy.contains('button', 'Deactivate', { timeout: 40000 }).click();

    cy.get('[role="dialog"]').within(() => {
      cy.contains('h4', 'Removing 1 follow-up').scrollIntoView().should('be.visible');
      cy.contains('h4', 'Expiring 1 text offer').scrollIntoView().should('be.visible');
      cy.get('select[aria-label="Reason for inactivating"]').select('moved_or_changed_vets');
      cy.contains('button', 'Accept and inactivate').click();
    });
    cy.get('[role="dialog"]').should('not.exist');
    cy.contains('button', 'Reactivate', { timeout: 20000 }).should('be.visible');

    // The follow-up queue no longer has the pet.
    schedulingApi(
      'cl',
      'GET',
      `/forward-bookings?practiceId=${w.practiceId}&patientId=${sch08.petId}&statuses=pending`
    ).then((res) => {
      const items = (res.body?.items ?? res.body ?? []) as Array<{ id: number }>;
      expect(items.map((row) => row.id)).not.to.include(sch08.forwardBookingId);
    });
    cy.visit('/schedule/scheduling-tools/forward-booking');
    cy.contains('Forward booking', { timeout: 40000 });
    // The header's "Recent" patient picker still lists the pet; the queue itself must not.
    cy.contains('Scheduling Tools').parent().should('not.contain.text', sch08.petName);

    // The text offer is closed.
    schedulingApi('cl', 'GET', `/patients/${sch08.petId}/open-scheduling-items`).then((res) => {
      expect(res.body.forwardBookings).to.have.length(0);
      expect(res.body.slotOffers).to.have.length(0);
    });
  });

  it('SCH-09-5: the confirm page for an inactive pet names no pet and books nothing', () => {
    const { sch09 } = extras();

    schedulingApi('cl', 'POST', `/patients/${sch09.petId}/deactivate`, { reason: 'passed_away' });

    cy.visit(`/confirm/${sch09.offerToken}`);
    cy.contains('Your care team will be in touch', { timeout: 40000 }).should('be.visible');
    cy.contains(sch09.petName).should('not.exist');
    cy.contains('button', 'Confirm this time').should('not.exist');

    // A tap from the old link (e.g. a second tab) books nothing either.
    cy.request({
      method: 'POST',
      url: `${Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000'}/public/slot-offers/tap/${sch09.offerToken}`,
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.body.outcome).not.to.eq('accepted');
      expect(JSON.stringify(res.body)).not.to.contain(sch09.petName);
    });

    schedulingApi(
      'cl',
      'GET',
      `/patients/${sch09.petId}/appointments?practiceId=${schedulingWorld().practiceId}&start=${encodeURIComponent(
        new Date().toISOString()
      )}&end=${encodeURIComponent(new Date(Date.now() + 365 * 864e5).toISOString())}`
    ).then((res) => {
      const list = (
        Array.isArray(res.body) ? res.body : (res.body?.items ?? res.body?.data ?? [])
      ) as unknown[];
      expect(list).to.have.length(0);
    });
  });
});
