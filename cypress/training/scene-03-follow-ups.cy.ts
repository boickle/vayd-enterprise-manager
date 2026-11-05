/// <reference types="cypress" />
/**
 * Training video, Scene 3: Schedule follow-ups, from the calendar to the owner's text. Recorded on a TEST stack
 * with the demo names (Maria Rivera; Maple, Juniper and Pepper; Dr. Avery Lane). Not a test: it drives the
 * screens at a watchable pace. Nothing leaves the test system: the text to the owner is stubbed.
 *
 * Story: Juniper was seen today for an ear infection (recheck in 2 weeks). Maple came along; her annual exam and
 * a vaccine come due in about three weeks, so she joins Juniper's card. Pepper (not seen today) goes to the CLs.
 */
import '../support/e2e';
import {
  resetSeededHouseholdsInDb,
  schedulingApi,
  schedulingWorld,
  signInAsScheduling,
} from '../support/schedulingWorld';
import {
  catchNewTabs,
  choose,
  closeNewTab,
  drag,
  finish,
  line,
  loadNarration,
  pointAt,
  startClock,
  tap,
  typeSlowly,
} from './trainingKit';

const TZ = 'America/New_York';
const asList = (body: any): any[] =>
  Array.isArray(body) ? body : (body?.items ?? body?.appointments ?? body?.data ?? []);
const ymdNy = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

describe('Training: Schedule follow-ups', () => {
  const names: Record<number, string> = {};
  let textSettings: { doNotSms?: boolean; smsOptOut?: boolean } = {};

  before(() => {
    const w = schedulingWorld();
    loadNarration();
    [...w.households.A.activePetIds, w.households.A.inactivePetId].forEach((id) =>
      schedulingApi('manager', 'GET', `/patients/${id}`).then((res) => {
        names[id] = String(res.body.name);
      })
    );
    // The owner's text is shown on screen, so texting is on for this household (restored after).
    schedulingApi('manager', 'GET', `/clients/${w.households.A.clientId}`).then((res) => {
      textSettings = { doNotSms: res.body.doNotSms, smsOptOut: res.body.smsOptOut };
      schedulingApi('manager', 'PATCH', `/clients/${w.households.A.clientId}`, {
        doNotSms: false,
        smsOptOut: false,
      });
    });
  });

  after(() => {
    const w = schedulingWorld();
    schedulingApi('manager', 'PATCH', `/clients/${w.households.A.clientId}`, {
      doNotSms: textSettings.doNotSms ?? true,
      smsOptOut: textSettings.smsOptOut ?? true,
    });
  });

  it('Scene 3', () => {
    const w = schedulingWorld();
    const [maple, juniper] = w.households.A.activePetIds;
    const pepper = w.households.A.inactivePetId;
    const petName = (id: number) => names[id];
    const fit = () => cy.get('[role="dialog"][aria-label="Find a time"]', { timeout: 30000 });
    const slotsShown = () => fit().find('.fup-fit__book', { timeout: 60000 }).should('have.length.greaterThan', 0);
    const needs: Record<string, string> = { Juniper: 'Ear recheck', Maple: 'Annual exam and DHPP vaccine' };
    const fillNeeds = () =>
      fit()
        .find('.fup-fit__need')
        .each(($row) => {
          const $input = $row.find('input');
          if (!String($input.val() ?? '').trim()) {
            const who = Object.keys(needs).find((n) => $row.text().includes(n)) ?? 'Juniper';
            typeSlowly(() => cy.wrap($input), needs[who]);
          }
        });
    const petButton = (id: number) => cy.contains('button.fup-pet', petName(id));
    const pickType = (petId: number, typeId: number) =>
      choose(() => cy.get(`select[aria-label="Visit type for ${petName(petId)}"]`), String(typeId));

    // Nothing is sent: the text to the owner is answered here. Review's new tab shows as a window over the page.
    cy.intercept('POST', '**/sms/client/*', { statusCode: 200, body: { ok: true } }).as('sms');
    catchNewTabs();

    // Setup, before the clock starts.
    resetSeededHouseholdsInDb();
    // 90 minutes ago, on a quarter hour: the Day calendar opens at the current hour, so the visit is in view.
    const start = new Date(Math.floor((Date.now() - 90 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    const today: Record<number, number> = {};
    const reasons: Record<number, string> = { [juniper]: 'Ear infection, left ear', [maple]: 'Weight check' };
    [juniper, maple].forEach((patientId) =>
      schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
        practiceId: w.practiceId,
        primaryProviderId: w.doctors.A,
        clientId: w.households.A.clientId,
        patientId,
        appointmentTypeId: w.types.medical,
        appointmentStart: start.toISOString(),
        appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
        description: reasons[patientId],
        bookedViaRouting: true,
      }).then((res) => (today[patientId] = res.body.id))
    );
    // Maple's annual exam and vaccine come due in about three weeks.
    const due = ymdNy(new Date(Date.now() + 19 * 24 * 3600_000));
    schedulingApi('manager', 'GET', `/reminders/patient/${maple}`).then((res) => {
      const open = asList(res.body).map((r) => String(r.description));
      ['Annual exam', 'DHPP vaccine'].forEach((description) => {
        if (!open.includes(description)) {
          schedulingApi('manager', 'POST', '/reminders', { patientId: maple, description, dueDate: due });
        }
      });
    });
    cy.then(() =>
      signInAsScheduling(
        'doctorA',
        `/schedule/scheduler?fromMyDay=1&date=${ymdNy(new Date())}&provider=${w.doctors.A}`
      )
    );
    cy.contains('button', /^Day$/, { timeout: 30000 }).click();
    // The calendar sets its own scroll as it loads; keep bringing the visit to the middle until it stays there.
    cy.wait(2500);
    cy.then(() =>
      cy
        .get(`[data-appt-id="${today[juniper]}"]`, { timeout: 30000 })
        .first()
        .should(($el) => {
          $el[0].scrollIntoView({ block: 'center' });
          const r = $el[0].getBoundingClientRect();
          expect(r.top, 'visit on screen').to.be.within(150, 700);
        })
    );
    cy.wait(1500);
    cy.then(() =>
      cy.get(`[data-appt-id="${today[juniper]}"]`).first().should(($el) => {
        const r = $el[0].getBoundingClientRect();
        expect(r.top, 'visit still on screen').to.be.within(150, 700);
      })
    );

    startClock();

    const visit = () => cy.get(`[data-appt-id="${today[juniper]}"]`).first();
    const charge = (pet: number) => {
      tap(() => cy.get(`input[placeholder="Add a charge for ${petName(pet)}"]`));
      typeSlowly(() => cy.get(`input[placeholder="Add a charge for ${petName(pet)}"]`), 'Office exam');
      tap(() => cy.contains('.soap-plan-result-name', 'Office exam', { timeout: 20000 }).closest('button'));
    };

    line('s3-01');
    line('s3-01b', () => {
      cy.then(() => pointAt(visit, 3500));
    });
    line('s3-02a', () => {
      cy.then(() => pointAt(visit, 1200));
      cy.task('trainingClick', null, { log: false });
      cy.then(() => visit().rightclick());
      cy.wait(400);
    });
    line('s3-02b', () => {
      pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', 'On Visit Day'), 1500);
      cy.contains('.scheduler-ctx-parent-wrap', 'On Visit Day').trigger('mouseover');
      cy.wait(300);
    });
    line('s3-02c', () => {
      tap(() => cy.contains('button[role="menuitem"]', /Start Encounter|Edit Encounter/));
    });
    line('s3-02d', () => {
      tap(() => cy.contains('.scheduler-modal-encounter-choice-title', /^SOAP$/));
      cy.get('input[placeholder^="Add a charge for"]', { timeout: 60000 }).should('exist');
    });
    line('s3-03a');
    line('s3-03b', () => {
      pointAt(() => cy.contains('button', 'Wrap up visit'), 4000);
    });
    line('s3-03c', () => {
      pointAt(() => cy.get('.soap-checkout').first(), 4000);
    });
    line('s3-03d', () => charge(juniper));
    line('s3-03e', () => charge(maple));
    line('s3-03f', () => {
      cy.get('.soap-checkout-goto button', { timeout: 30000 }).should('not.be.disabled');
      tap(() => cy.get('.soap-checkout-goto button'));
      cy.contains('button.fup-cta__btn', 'Schedule follow-ups', { timeout: 60000 }).should('be.visible');
    });
    line('s3-04a', () => {
      tap(() => cy.contains('button.fup-cta__btn', 'Schedule follow-ups'));
      cy.get('[role="dialog"][aria-labelledby="fup-title"]').should('be.visible');
    });
    line('s3-04b', () => pointAt(() => petButton(juniper), 2500));
    line('s3-04c', () => pointAt(() => petButton(maple), 3500));
    line('s3-05a', () => {
      drag(() => petButton(juniper), () => cy.contains('article.fup-card', 'In 1 year'));
      cy.contains('article.fup-card', 'In 1 year').should('contain.text', petName(juniper));
    });
    line('s3-05b', () => {
      tap(() => cy.get('[aria-label="How soon"]').contains('button', '2 weeks'));
    });
    line('s3-06a', () => pointAt(() => cy.contains('article.fup-card', 'In 2 weeks'), 3500));
    line('s3-06b', () => tap(() => petButton(maple)));
    line('s3-06c', () => {
      tap(() => cy.contains('[role="menuitem"]', /"In 2 weeks" card/));
      cy.contains('article.fup-card', 'In 2 weeks').should('contain.text', petName(maple));
    });
    line('s3-07');
    line('s3-07a', () => pickType(juniper, w.types.recheck));
    line('s3-07b', () => pickType(maple, w.types.wellness));
    line('s3-08a', () => pointAt(() => cy.get('article.fup-card--labs'), 3500));
    line('s3-08b', () => pointAt(() => cy.get('article.fup-card--none'), 3000));
    line('s3-09a', () => {
      tap(() => cy.contains('article.fup-card', 'In 2 weeks').contains('button', 'Find a time now'));
    });
    line('s3-09b', () => {
      slotsShown();
      pointAt(() => fit().find('.fup-fit__book').first().parent(), 4000);
    });
    line('s3-10');
    line('s3-10b', () => {
      tap(() => fit().contains('button', 'Mornings'));
      slotsShown();
    });
    line('s3-11a', () => {
      tap(() => fit().find('.fup-fit__book').first().parent().contains('button', 'Review'));
      cy.get('#training-tab iframe', { timeout: 15000 }).should('exist');
    });
    line('s3-11b', () => cy.wait(1500));
    line('s3-11c', () => closeNewTab());
    line('s3-12a', () => fillNeeds());
    line('s3-12b', () => {
      tap(() => fit().find('.fup-fit__book').first());
      cy.get('[role="dialog"][aria-label="Find a time"]', { timeout: 15000 }).should('not.exist');
    });
    line('s3-13', () => {
      tap(() => cy.get('[role="status"]').contains('button', 'Undo'));
      cy.get('[role="status"]').should('contain.text', 'Booking undone');
    });
    line('s3-14a', () => {
      tap(() => cy.contains('article.fup-card', 'In 2 weeks').contains('button', 'Find a time now'));
      slotsShown();
      fillNeeds();
    });
    line('s3-14b', () => {
      tap(() => fit().find('.fup-fit__book').first());
      cy.get('[role="dialog"][aria-label="Find a time"]', { timeout: 15000 }).should('not.exist');
      cy.contains('.fup-status--ok', 'Booked').should('be.visible');
      pointAt(() => cy.contains('.fup-status--ok', 'Booked'), 2000);
    });
    line('s3-15');
    line('s3-15a', () => tap(() => cy.contains('button', '+ 1 year')));
    line('s3-15b', () => drag(() => petButton(pepper), () => cy.contains('article.fup-card', 'In 1 year')));
    line('s3-15c', () => pickType(pepper, w.types.wellness));
    line('s3-15d', () => {
      tap(() => cy.contains('article.fup-card', 'In 1 year').contains('button', 'Send to CLs to book'));
      cy.contains('.fup-status--cl', 'Goes to the CLs when you press Done').should('be.visible');
    });
    line('s3-16a', () => {
      tap(() => cy.contains('button', /^Done/));
      cy.get('#fup-title').should('contain.text', 'Text the owner');
    });
    line('s3-16b', () => pointAt(() => cy.get('textarea[aria-label="Text message to the owner"]'), 6000));
    line('s3-16c', () => {
      tap(() => cy.contains('button', 'Send text & finish'));
      cy.wait('@sms');
      cy.get('[role="dialog"][aria-labelledby="fup-title"]').should('not.exist');
    });
    line('s3-17');
    finish();

    // Tidy up what the recording booked, so the next take starts the same way.
    cy.then(() =>
      schedulingApi(
        'manager',
        'GET',
        `/forward-bookings?practiceId=${w.practiceId}&clientId=${w.households.A.clientId}&statuses=pending,booked`
      ).then((res) =>
        asList(res.body).forEach((r) =>
          schedulingApi('manager', 'PATCH', `/forward-bookings/${r.id}`, { practiceId: w.practiceId, status: 'removed' }, false)
        )
      )
    );
  });
});
