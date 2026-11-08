/// <reference types="cypress" />
/**
 * Training video RL-V1: Send a Room Loader, the family's check-in, and the answers back on the calendar.
 * Recorded on a TEST stack with the demo names (Maria Rivera; Maple the dog and Juniper the cat; Dr. Avery Lane).
 * Not a test: it drives the screens at a watchable pace. The check-in email is captured to a file, never sent.
 *
 * Story: Maria's visit is booked. A CL sends the Room Loader from the calendar card (yellow tag), Maria answers it
 * from the email link (Juniper drinks more, goes outdoors), and the tag turns green with View Room Loader.
 * Setup (setup/rl-v1-setup.sh): the starter Room Loader settings, catalog items at real prices, Maple's and
 * Juniper's reminders (Maple's Lepto is due in 6 months, so it must not appear), a wellness visit and a trip fee.
 */
import '../support/e2e';
import {
  includeSeededDoctorsInProviderList,
  schedulingWorld,
  signInAsScheduling,
} from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

const TZ = 'America/New_York';
const ymdNy = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/** The next weekday at least two days out, at 10:00 New York time (EST in November). */
function visitDay(): { ymd: string; startIso: string; endIso: string } {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while ([0, 6].includes(new Date(`${ymdNy(d)}T12:00:00Z`).getUTCDay())) d.setTime(d.getTime() + 86_400_000);
  const ymd = ymdNy(d);
  return { ymd, startIso: `${ymd}T15:00:00.000Z`, endIso: `${ymd}T16:00:00.000Z` };
}

describe('Training: Room Loader', () => {
  it('RL-V1', () => {
    const w = schedulingWorld();
    const [maple, juniper] = w.households.A.activePetIds;
    const day = visitDay();
    const visits: Record<number, number> = {};
    loadNarration();

    // Setup, before the clock starts.
    // Same reset as resetSeededHouseholdsInDb(), run through the trainingSh task instead of cy.exec.
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const sh = (cmd: string) => cy.task('trainingSh', { cmd }, { timeout: 310000 });
    const sql = (statement: string) => sh(`psql -d ${db} -c "${statement.replace(/"/g, '\\"')}"`);
    const clients = `${w.households.A.clientId},${w.households.B.clientId}`;
    const keepPets = [...w.households.A.activePetIds, w.households.A.inactivePetId, w.households.B.petId].join(',');
    sql(`update appointments set "isDeleted"=true where "clientId" in (${clients}) and "appointmentStart">now() - interval '2 days'`);
    sql(`delete from room_loader_appointments where "appointmentId" in (select id from appointments where "clientId" in (${clients}))`);
    sql(
      `update patients set "isActive"=false where id in (select "patientsId" from clients_patients_patients where "clientsId" in (${clients})) and id not in (${keepPets})`
    );
    sh(`bash cypress/training/setup/rl-v1-setup.sh ${db} ${Cypress.env('SCH_API_DIR')} ${maple} ${juniper}`);
    // Last year's visit, so the form treats Maple and Juniper as established patients (no new-patient questions).
    const lastYear = new Date(Date.now() - 365 * 86_400_000);
    lastYear.setUTCHours(15, 0, 0, 0);
    // Booking can take several seconds on a busy machine; allow a minute (setup, off camera).
    const book = <T,>(body: Record<string, unknown>, failOnStatusCode = true) =>
      cy.request<T>({
        method: 'POST',
        url: `${Cypress.env('API_URL')}/appointments`,
        headers: { Authorization: w.auth.cl.Authorization },
        body,
        failOnStatusCode,
        timeout: 60000,
      });
    [maple, juniper].forEach((patientId) =>
      book({
        practiceId: w.practiceId,
        primaryProviderId: w.doctors.A,
        clientId: w.households.A.clientId,
        patientId,
        appointmentTypeId: w.types.wellness,
        appointmentStart: lastYear.toISOString(),
        appointmentEnd: new Date(lastYear.getTime() + 3600_000).toISOString(),
        description: 'Annual wellness exam',
        bookedViaRouting: true,
      }, false) // already there from an earlier take: fine
    );
    [maple, juniper].forEach((patientId) =>
      book<{ id: number }>({
        practiceId: w.practiceId,
        primaryProviderId: w.doctors.A,
        clientId: w.households.A.clientId,
        patientId,
        appointmentTypeId: w.types.wellness,
        appointmentStart: day.startIso,
        appointmentEnd: day.endIso,
        description: 'Annual wellness exam',
        bookedViaRouting: true,
      }).then((res) => (visits[patientId] = res.body.id))
    );
    includeSeededDoctorsInProviderList();
    const openCalendar = () => {
      signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${day.ymd}&provider=${w.doctors.A}`);
      cy.contains('button', /^Day$/, { timeout: 60000 }).click();
      cy.wait(2500);
      cy.then(() =>
        cy.get(`[data-appt-id="${visits[maple]}"]`, { timeout: 30000 }).first().should(($el) => {
          $el[0].scrollIntoView({ block: 'center' });
          expect($el[0].getBoundingClientRect().top, 'visit on screen').to.be.within(150, 700);
        })
      );
      cy.wait(1500);
    };
    openCalendar();

    const card = () => cy.get(`[data-appt-id="${visits[maple]}"]`).first();
    const tag = () => card().find('.scheduler-appt-card-icons-tr').first();
    const openMenu = () => {
      cy.then(() => pointAt(card, 1200));
      cy.task('trainingClick', null, { log: false });
      cy.then(() => card().rightclick());
      cy.wait(400);
    };
    const visitPrep = () => {
      pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', 'Visit Prep'), 1500);
      cy.contains('.scheduler-ctx-parent-wrap', 'Visit Prep').trigger('mouseover');
      cy.wait(400);
    };
    const reason = (i: number) => cy.get('textarea[placeholder="Enter reason for appointment..."]').eq(i);
    const radio = (name: string, i: number) => cy.get(`input[type="radio"][name="${name}"]`).eq(i).parent();
    const itemSearch = (i: number) => cy.get('input[placeholder^="Search for items"]').eq(i);
    // Client form: only the current pet's questions are on screen.
    const visible = (sel: string) => cy.get(sel).filter(':visible').first();
    const carePlanReady = () => {
      cy.contains(/Loading optional vaccines/i, { timeout: 60000 }).should('not.exist');
      cy.contains(/still loading/i, { timeout: 60000 }).should('not.exist');
    };

    // Everything below is queued once the visits exist (card() reads their ids).
    cy.then(() => {
    startClock();

    line('rl-01');
    line('rl-02', () => pointAt(card, 3500));
    line('rl-03', () => pointAt(tag, 3500));
    line('rl-04', openMenu);
    line('rl-05', visitPrep);
    line('rl-06', () => {
      tap(() => cy.contains('[role="menuitem"]', 'Send Room Loader'));
      cy.contains('h4', 'Reason for Appointment', { timeout: 60000 }).should('be.visible');
    });
    line('rl-07', () => {
      cy.get('.rl-chart-panel', { timeout: 30000 }).should('be.visible');
      pointAt(() => cy.get('.rl-chart-panel'), 4000);
    });
    line('rl-08', () => pointAt(() => cy.contains('h2, h3', /Pet 1:/), 2500));
    line('rl-09', () => typeSlowly(() => reason(0), 'Annual wellness exam and vaccines.'));
    line('rl-10', () => tap(() => radio(`mobility-${maple}`, 1)));
    line('rl-11', () => tap(() => radio(`labWork-${maple}`, 1)));
    line('rl-12', () => pointAt(() => cy.contains(/Reminders \(\d+/).first(), 4000));
    line('rl-13', () => tap(() => cy.contains('button', 'Confirm match')));
    line('rl-14', () => typeSlowly(() => itemSearch(0), 'Trip Fee'));
    line('rl-15', () => tap(() => cy.contains('div', /^CV-Tier 1 Trip Fee/, { timeout: 30000 }).last()));
    line('rl-16', () =>
      typeSlowly(() => reason(1), 'Annual wellness exam and vaccines. Juniper is drinking more than usual.')
    );
    line('rl-17', () => tap(() => radio(`mobility-${juniper}`, 1)));
    line('rl-18', () => tap(() => radio(`labWork-${juniper}`, 0)));
    line('rl-19', () => tap(() => cy.contains('button', 'Confirm match')));
    line('rl-20', () => tap(() => cy.contains('button', /^Send to Client$/)));
    line('rl-21', () => pointAt(() => cy.contains('Send via').parent(), 2500));
    line('rl-21b', () => {
      tap(() => cy.contains('button', 'Yes, send to client'));
      cy.wait(1500);
      // A busy machine can take a minute or more to send; cut that wait from the video.
      offCamera(() => cy.get('.room-loader-modal', { timeout: 240000 }).should('not.exist'));
    });
    line('rl-22');
    line('rl-23', () => {
      cy.wait(1500);
      pointAt(tag, 3500);
    });
    line('rl-24', () => {
      openMenu();
      visitPrep();
      pointAt(() => cy.contains('[role="menuitem"]', 'Re-send Room Loader'), 2500);
    });

    // The family's side: the link from the captured check-in email.
    offCamera(() => {
      cy.get('body').type('{esc}');
      cy.readFile(Cypress.env('EMAIL_CAPTURE_PATH')).then((txt: string) => {
        const rows = txt.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const mail = [...rows].reverse().find((r) => /room-loader\/form\?token=/.test(String(r.html ?? r.text ?? '')));
        const token = String(mail.html ?? mail.text).match(/room-loader\/form\?token=([A-Za-z0-9_%-]+)/)![1];
        cy.visit(`/public/room-loader/form?token=${token}`);
      });
      cy.contains('Maple', { timeout: 60000 }).should('be.visible');
      cy.wait(1500);
    });
    line('rl-25', () => pointAt(() => cy.contains(/Time to Check-in/i), 2500));
    line('rl-26', () => tap(() => visible('input[name$="_eatingDrinkingNormal"][value="yes"]').parent()));
    line('rl-27', () => {
      tap(() => cy.contains('button', /Next pet/));
      // A click that lands while the answer is still saving can be dropped: click again if still on Maple.
      cy.get('body').then(($b) => {
        if (!/Is Juniper eating/i.test($b.text())) cy.contains('button', /Next pet/).click();
      });
      cy.contains(/Is Juniper eating/i, { timeout: 15000 });
    });
    line('rl-28', () => tap(() => visible('input[name$="_eatingDrinkingNormal"][value="no"]').parent()));
    line('rl-29', () =>
      typeSlowly(() => visible('textarea[placeholder^="Describe any issues"]'), 'Drinking a lot more water for about two weeks.')
    );
    line('rl-30', () => {
      tap(() => cy.contains('button', /Continue to Care Plan/i));
      cy.contains(/Veterinary Care Plan/i, { timeout: 30000 });
      carePlanReady();
    });
    line('rl-31', () => pointAt(() => cy.contains(/The following items are recommended/).parent(), 4000));
    line('rl-32', () => pointAt(() => cy.contains(/Optional vaccines & add-ons/).parent(), 4000));
    line('rl-33', () => {
      tap(() => cy.contains('button', /Next pet/));
      carePlanReady();
    });
    line('rl-34', () => tap(() => cy.contains('.rl-outdoor label', 'Yes')));
    line('rl-35', () => tap(() => cy.get('.rl-outdoor__pitch .rl-offer__check').first()));
    line('rl-36', () => tap(() => cy.contains('label', /Purevax Rabies 1 year/)));
    line('rl-37', () => {
      tap(() => cy.contains('button', /Next: Labs/i));
      cy.contains(/Lab work we recommend/i, { timeout: 30000 });
    });
    line('rl-38', () => tap(() => cy.contains('.rl-panel label', /Not this time|No thank you/)));
    line('rl-38b', () => {
      tap(() => cy.contains('button', /Next pet/));
      cy.contains(/Juniper/, { timeout: 30000 });
    });
    line('rl-38c', () => pointAt(() => cy.get('.rl-panel').first().find('.rl-panel__prose, .rl-panel__intro').first(), 4000));
    line('rl-38d', () => tap(() => cy.get('.rl-panel').first().find('input[type="radio"]').first().parent()));
    line('rl-39', () => {
      tap(() => cy.contains('button', /Next: Summary/i));
      cy.contains(/Review Your Care Plan/i, { timeout: 30000 });
    });
    line('rl-40', () => {
      pointAt(() => cy.contains(/Estimated Total/i).first(), 2500);
      pointAt(() => cy.get('input[placeholder="Type to search products..."]').first(), 2500);
    });
    // Membership: what the family sees, and why it matters. No sign-up.
    line('rl-40b', () => {
      cy.get('.rl-pitch', { timeout: 30000 }).scrollIntoView({ offset: { top: -80, left: 0 } });
      pointAt(() => cy.get('.rl-pitch__savings'), 3500);
    });
    line('rl-40c', () => tap(() => cy.get('.rl-pitch__toggle')));
    line('rl-40d', () => {
      cy.contains(/Care Coverage Comparison/i, { timeout: 30000 }).scrollIntoView({ offset: { top: -120, left: 0 } });
      pointAt(() => cy.contains(/Care Coverage Comparison/i).parent(), 5000);
    });
    line('rl-40e', () => {
      cy.contains(/Estimated due at visit after membership signup/i).scrollIntoView({ offset: { top: -260, left: 0 } });
      pointAt(() => cy.contains(/Estimated due at visit after membership signup/i).parent(), 4000);
    });
    line('rl-40f', () => {
      cy.contains(/Why families choose/i).scrollIntoView({ offset: { top: -120, left: 0 } });
      pointAt(() => cy.contains(/Why families choose/i).parent(), 6000);
    });
    line('rl-40g', () => {
      cy.contains(/Multi-pet membership credit/i).scrollIntoView({ offset: { top: -160, left: 0 } });
      pointAt(() => cy.contains(/Multi-pet membership credit/i).parent(), 3500);
    });
    line('rl-40h', () => {
      cy.contains('button', /Enroll .* in Membership/).scrollIntoView({ offset: { top: -300, left: 0 } });
      pointAt(() => cy.contains('button', /Enroll .* in Membership/), 3000);
    });
    offCamera(() => {
      cy.get('.rl-pitch__toggle').click();
      cy.contains('button', /Submit Form/i).scrollIntoView();
    });
    line('rl-41', () => {
      tap(() => cy.contains('button', /Submit Form/i));
      cy.contains(/thank you|submitted|received/i, { timeout: 60000 });
    });

    offCamera(() => openCalendar());
    line('rl-42', () => pointAt(tag, 3500));
    line('rl-43', () => {
      openMenu();
      visitPrep();
    });
    line('rl-44', () => {
      tap(() => cy.contains('[role="menuitem"]', 'View Room Loader'));
      cy.get('[role="dialog"]', { timeout: 30000 }).should('be.visible');
    });
    // The answers PDF takes a while to build; cut the wait.
    offCamera(() => {
      cy.get('[role="dialog"] .scheduler-room-loader-pdf-canvas', { timeout: 90000 }).should('be.visible');
      cy.wait(1500);
    });
    line('rl-45', () => pointAt(() => cy.get('[role="dialog"]').last(), 4500));
    line('rl-46');
    finish();
    });
  });
});
