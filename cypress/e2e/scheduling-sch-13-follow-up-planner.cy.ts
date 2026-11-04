/// <reference types="cypress" />
/**
 * SCH-13-1..5 (docs/test-plans/scheduling-and-routing.md in vayd-api): the Schedule follow-ups planner,
 * opened from the checkout page of a seeded visit (/schedule/soap/:appointmentId/:patientId/checkout).
 *
 * NOT RUN YET. Seed the world (vayd-api test/scripts/scheduling-e2e-seed.ts, a vayd_api_test* database) and
 * export CYPRESS_SCHEDULING_WORLD, with the API running on that database.
 *
 * What is driven through the UI: opening the planner, placing pets on a card, the interval chip, each pet's own
 * visit type, "Find a time now", Undo, Add (to a housemate's visit), labs pending, Send to CLs, Done, and the
 * review/Send step. What the API decides is read back with schedulingApi.
 *
 * Intercepts and stand-ins (and why):
 *  - "Find a time now" opens the "Find a time" panel (best-route slot cards). The spec books through its Book
 *    button, as a user does (no calendar, no new tab). The slot is whatever routing offers, so the follow-up start
 *    is read back from the booked appointments. Everything after (card turns "Booked", Undo, Done, review) is the
 *    planner's own code against the real API.
 *  - The API under test captures email to a file but has no way to observe sent texts from Cypress, and the
 *    seeded clients are do-not-text. SCH-13-5 turns text on for household A (restored afterwards), stubs
 *    POST /sms/client/:id so no text can leave, and asserts exactly ONE such request was made.
 */
import '../support/e2e';
import {
  resetSeededHouseholdsInDb,
  schedulingApi,
  schedulingWorld,
  signInAsScheduling,
} from '../support/schedulingWorld';

const TZ = 'America/New_York';
/** The planner's own "Undo" window is 10 s; the test clicks Undo well inside it. */

/** UTC instant of a New York wall-clock time on the first weekday at least `daysAhead` days from now. */
function weekdayAtNy(daysAhead: number, hour: number): Date {
  const ymdOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const cursor = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  while ([0, 6].includes(new Date(`${ymdOf(cursor)}T12:00:00Z`).getUTCDay())) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const [y, m, d] = ymdOf(cursor).split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, 0);
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
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

/**
 * "Today's visit": the visit being checked out started a little while ago today. (A visit tomorrow would make the
 * planner count its housemates' visits as upcoming ones already booked, not as part of this visit.) A random
 * minute keeps same-pet visits from earlier runs from colliding.
 */
const todaysVisitStart = () =>
  new Date(Date.now() - (60 + Math.floor(Math.random() * 90)) * 60_000);

const asList = (body: any): any[] =>
  Array.isArray(body) ? body : (body?.items ?? body?.appointments ?? body?.data ?? []);

const petIdsOf = (a: any): number[] => {
  const multi = Array.isArray(a.patients) ? a.patients.map((p: any) => Number(p.id)) : [];
  const one = a.patient?.id ?? a.patientId;
  return [...new Set([...multi, ...(one != null ? [Number(one)] : [])])];
};

const ms = (iso: string) => new Date(iso).getTime();

/** Household A's live (not deleted) appointments from a day ago (today's visits start in the past) to 60 days out. */
function clientAppointments() {
  const w = schedulingWorld();
  const start = new Date(Date.now() - 24 * 3600_000).toISOString();
  const end = new Date(Date.now() + 60 * 24 * 3600_000).toISOString();
  return schedulingApi(
    'manager',
    'GET',
    `/clients/${w.households.A.clientId}/appointments?practiceId=${w.practiceId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&activePatientsOnly=true`
  ).then((res): any => asList(res.body).filter((a) => a.isDeleted !== true)) as Cypress.Chainable<
    any[]
  >;
}

function forwardBookings(statuses: string, patientId?: number) {
  const w = schedulingWorld();
  return schedulingApi(
    'manager',
    'GET',
    `/forward-bookings?practiceId=${w.practiceId}&clientId=${w.households.A.clientId}&statuses=${statuses}${
      patientId ? `&patientId=${patientId}` : ''
    }`
  ).then((res): any => asList(res.body)) as Cypress.Chainable<any[]>;
}

/** Books one visit per pet at the same start with doctor A, as the Scheduler's Book screen would. */
function bookVisits(petIds: number[], start: Date, minutes: number, typeId: number, note: string) {
  const w = schedulingWorld();
  const ids: number[] = [];
  petIds.forEach((patientId) => {
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: w.practiceId,
      primaryProviderId: w.doctors.A,
      clientId: w.households.A.clientId,
      patientId,
      appointmentTypeId: typeId,
      appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + minutes * 60_000).toISOString(),
      description: note,
      bookedViaRouting: true,
    }).then((res) => ids.push(res.body.id));
  });
  return cy.wrap(null, { log: false }).then((): any => ids) as Cypress.Chainable<number[]>;
}

describe('SCH-13: Schedule follow-ups planner end to end', () => {
  let names: Record<number, string> = {};
  let leftoverAppointmentIds = new Set<number>();
  let leftoverEntryIds = new Set<number>();
  /** The visit being checked out: both household A pets, tomorrow-ish at 10:00 New York. */
  let todayVisitIds: number[] = [];

  before(() => {
    const w = schedulingWorld();
    w.households.A.activePetIds.forEach((id) =>
      schedulingApi('manager', 'GET', `/patients/${id}`).then((res) => {
        names[id] = String(res.body.name);
      })
    );
  });

  beforeEach(() => {
    // Visits whose chart was opened cannot be deleted through the API, so start each test from a clean household.
    resetSeededHouseholdsInDb();
    // Hermetic: remember what already exists so afterEach removes only what this test made.
    clientAppointments().then((rows) => {
      leftoverAppointmentIds = new Set(rows.map((a) => Number(a.id)));
    });
    forwardBookings('pending,booked').then((rows) => {
      leftoverEntryIds = new Set(rows.map((r) => Number(r.id)));
    });
  });

  afterEach(() => {
    const w = schedulingWorld();
    clientAppointments().then((rows) =>
      rows
        .filter((a) => !leftoverAppointmentIds.has(Number(a.id)))
        .forEach((a) =>
          schedulingApi('manager', 'DELETE', `/appointments/${a.id}`, undefined, false)
        )
    );
    forwardBookings('pending,booked').then((rows) =>
      rows
        .filter((r) => !leftoverEntryIds.has(Number(r.id)))
        .forEach((r) =>
          schedulingApi(
            'manager',
            'PATCH',
            `/forward-bookings/${r.id}`,
            { practiceId: w.practiceId, status: 'removed' },
            false
          )
        )
    );
  });

  const petA = () => names[schedulingWorld().households.A.activePetIds[0]];
  const petB = () => names[schedulingWorld().households.A.activePetIds[1]];

  /** Checks out the visit and opens the planner from the checkout page's button. */
  function openPlanner(appointmentId: number, patientId: number) {
    const w = schedulingWorld();
    signInAsScheduling(
      'manager',
      `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${w.households.A.clientId}`
    );
    cy.contains('button.fup-cta__btn', 'Schedule follow-ups', { timeout: 30000 }).click();
    cy.get('[role="dialog"][aria-labelledby="fup-title"]', { timeout: 30000 }).should(
      'contain.text',
      'Schedule follow-ups'
    );
  }

  /** Puts a tray pet on the card that starts out as "In 1 year". */
  function putOnDefaultCard(petName: string) {
    cy.contains('button.fup-pet', petName).click();
    cy.contains('[role="menuitem"]', /"In 1 year" card/).click();
  }

  function pickType(petName: string, typeId: number) {
    cy.get(`select[aria-label="Visit type for ${petName}"]`).select(String(typeId));
  }

  /**
   * Plans a 2-week recheck for both pets, picks each pet's type, clicks Find a time now and books the first slot
   * from the "Find a time" panel's Book button (no calendar). The slot is whatever the routing search offers, so
   * the follow-up start is read back from the booked appointments. Yields that start, the booked appointment ids
   * and the forward-booking rows the planner made.
   */
  function planAndBookBoth() {
    const w = schedulingWorld();
    putOnDefaultCard(petA());
    putOnDefaultCard(petB());
    cy.get('[aria-label="How soon"]').contains('button', '2 weeks').click();
    cy.contains('.fup-card', 'In 2 weeks')
      .should('contain.text', petA())
      .and('contain.text', petB());

    // Find a time refuses until every pet has its own type.
    cy.contains('button', 'Find a time now').click();
    cy.get('[role="alert"]').should('contain.text', 'Pick a visit type for');
    pickType(petA(), w.types.recheck);
    cy.contains('button', 'Find a time now').click();
    cy.get('[role="alert"]').should('contain.text', petB());
    pickType(petB(), w.types.recheck);
    cy.get('select[aria-label^="Visit type for"]').each(($s) =>
      expect($s.val()).to.equal(String(w.types.recheck))
    );
    cy.contains('button', 'Find a time now').click();

    // The "Find a time" panel (not the old in-planner calendar) lists slot cards with a Book button.
    cy.get('[role="dialog"][aria-label="Find a time"]', { timeout: 30000 }).as('fit').should('be.visible');
    cy.get('@fit').find('.fup-fit__book', { timeout: 60000 }).should('have.length.greaterThan', 0);
    // "What does <pet> need?" is required (it becomes the visit Description); fill any that the card's note left empty.
    cy.get('@fit')
      .find('.fup-fit__need input')
      .should('have.length', 2)
      .each(($input) => {
        if (!String($input.val() ?? '').trim()) {
          cy.wrap($input).type('SCH-13 e2e follow-up recheck');
        }
      });
    cy.get('@fit').find('.fup-fit__book').first().should('not.be.disabled').click();
    cy.get('@fit').find('.fup-fit__booked').should('contain.text', `Booked ${petA()}`);
    // The panel returns to the plan by itself; the card is booked, with Undo in the toast.
    cy.get('[role="dialog"][aria-label="Find a time"]', { timeout: 15000 }).should('not.exist');
    cy.contains('.fup-status--ok', 'Booked').should('be.visible');
    cy.get('[role="status"]').should('contain.text', `Booked ${petA()}`);

    const pets = w.households.A.activePetIds;
    return forwardBookings('booked').then((rows) => {
      const mine = rows.filter(
        (r) => pets.includes(Number(r.patientId)) && !leftoverEntryIds.has(Number(r.id))
      );
      expect(mine.map((r) => Number(r.patientId)).sort()).to.deep.equal([...pets].sort());
      const booked = mine.map((r) => Number(r.bookedAppointmentId));
      return schedulingApi('manager', 'GET', `/appointments/${booked[0]}`).then((res) => {
        const start = new Date(res.body.appointmentStart);
        return { start, booked, rows: mine } as { start: Date; booked: number[]; rows: any[] };
      });
    });
  }

  function expectVisitsAt(followUpStart: Date, expected: number) {
    const w = schedulingWorld();
    return clientAppointments().then((rows) => {
      const atStart = rows.filter(
        (a) => Math.abs(ms(a.appointmentStart) - followUpStart.getTime()) < 60_000
      );
      expect(atStart, 'follow-up visits at the booked start').to.have.length(expected);
      if (expected) {
        expect(atStart.flatMap(petIdsOf).sort()).to.deep.equal(
          [...w.households.A.activePetIds].sort()
        );
      }
    });
  }

  function setUpTodaysVisit(_hour = 10) {
    const w = schedulingWorld();
    const start = todaysVisitStart();
    return bookVisits(
      w.households.A.activePetIds,
      start,
      60,
      w.types.medical,
      'SCH-13 e2e visit being checked out'
    ).then((ids) => {
      todayVisitIds = ids;
      return ids;
    });
  }

  it('SCH-13-1: books a 2-week recheck for both pets; visits exist and forward bookings are "booked"', () => {
    const w = schedulingWorld();
    setUpTodaysVisit().then(() => {
      openPlanner(todayVisitIds[0], w.households.A.activePetIds[0]);
      cy.get('.fup-tray').should('contain.text', petA()).and('contain.text', petB());
      planAndBookBoth().then(({ start: followUp, booked, rows }) => {
        expect(booked).to.have.length(2);
        expectVisitsAt(followUp, 2);
        forwardBookings('booked').then((now) => {
          const mine = now.filter((r) => rows.some((x) => Number(x.id) === Number(r.id)));
          expect(mine, 'the two rows the planner created').to.have.length(2);
          mine.forEach((r) => {
            expect(r.status).to.equal('booked');
            expect(booked).to.include(Number(r.bookedAppointmentId));
          });
        });
        // Done goes on to the text step because something was booked.
        cy.contains('button', 'Done · next: text the owner').click();
        cy.get('#fup-title').should('contain.text', 'Text the owner');
        cy.contains('.fup-sum__item--booked', petA()).should('contain.text', 'booked');
        cy.contains('button', 'Finish without texting').click();
        cy.get('[role="dialog"][aria-labelledby="fup-title"]').should('not.exist');
      });
    });
  });

  it('SCH-13-2: Undo within 10 s removes the visits and the forward bookings', () => {
    const w = schedulingWorld();
    setUpTodaysVisit(12).then(() => {
      openPlanner(todayVisitIds[0], w.households.A.activePetIds[0]);
      planAndBookBoth().then(({ start: followUp, booked, rows }) => {
        expectVisitsAt(followUp, 2);
        cy.get('[role="status"]').contains('button', 'Undo').click();
        cy.get('[role="status"]').should('contain.text', 'Booking undone');
        // Visits are gone.
        expectVisitsAt(followUp, 0);
        booked.forEach((id) =>
          schedulingApi('manager', 'GET', `/appointments/${id}`, undefined, false).then((res) => {
            const gone = res.status === 404 || res.body?.isDeleted === true;
            expect(gone, `appointment ${id} removed`).to.equal(true);
          })
        );
        // Forward bookings are not booked or waiting any more (removed).
        forwardBookings('pending,booked').then((now) => {
          const stillThere = now.filter((r) => rows.some((x) => Number(x.id) === Number(r.id)));
          expect(stillThere, 'forward-booking rows left after Undo').to.have.length(0);
        });
        // The card is back to a draft, so the pets can be booked again.
        cy.contains('button', 'Find a time now').should('be.visible');
      });
    });
  });

  describe("SCH-13-3: add a pet to a housemate's upcoming visit", () => {
    let housemateVisit: { start: Date; originalEnd: Date; id: number };

    /** Pet B has a visit next week; pet A is the one being checked out today. */
    function seedHousemateVisit() {
      const w = schedulingWorld();
      const start = weekdayAtNy(7, 11);
      return bookVisits(
        [w.households.A.activePetIds[1]],
        start,
        60,
        w.types.medical,
        'SCH-13 e2e housemate visit'
      ).then(([id]) => {
        housemateVisit = { start, originalEnd: new Date(start.getTime() + 60 * 60_000), id };
      });
    }

    function checkoutPetAndOpenAddMenu() {
      const w = schedulingWorld();
      return bookVisits(
        [w.households.A.activePetIds[0]],
        todaysVisitStart(),
        60,
        w.types.medical,
        'SCH-13 e2e visit being checked out'
      ).then(([todayId]) => {
        openPlanner(todayId, w.households.A.activePetIds[0]);
        cy.contains('button.fup-pet', petA()).click();
        cy.contains('[role="menuitem"]', /visit · /).click();
        cy.contains('.fup-card--existing', petA());
        pickType(petA(), w.types.recheck);
      });
    }

    it('adds the pet at the same start and every row shares the longer end', () => {
      const w = schedulingWorld();
      seedHousemateVisit().then(() =>
        checkoutPetAndOpenAddMenu().then(() => {
          cy.contains('.fup-card--existing button', `Add ${petA()}`, { timeout: 30000 })
            .should('not.be.disabled')
            .click();
          cy.get('[role="status"]').should('contain.text', `Added ${petA()}`);
          clientAppointments().then((rows) => {
            const atStart = rows
              .filter(
                (a) =>
                  !leftoverAppointmentIds.has(Number(a.id)) || Number(a.id) === housemateVisit.id
              )
              .filter(
                (a) => Math.abs(ms(a.appointmentStart) - housemateVisit.start.getTime()) < 60_000
              );
            const added = atStart.filter((a) =>
              petIdsOf(a).includes(w.households.A.activePetIds[0])
            );
            expect(added, 'one new visit for the added pet').to.have.length(1);
            const sibling = atStart.find((a) => Number(a.id) === housemateVisit.id)!;
            expect(sibling, 'housemate visit still there').to.exist;
            expect(ms(added[0].appointmentStart)).to.equal(ms(sibling.appointmentStart));
            expect(ms(added[0].appointmentEnd)).to.equal(ms(sibling.appointmentEnd));
            expect(ms(sibling.appointmentEnd), 'shared end is the longer one').to.be.greaterThan(
              housemateVisit.originalEnd.getTime()
            );
          });
        })
      );
    });

    it('on a forced API error nothing is half-added and the sibling keeps its times', () => {
      const w = schedulingWorld();
      // The sibling-alignment step is a PATCH on the housemate's row; fail it.
      cy.intercept('PATCH', '**/appointments/*', {
        statusCode: 500,
        body: { message: 'Forced by SCH-13-3' },
      }).as('forcedPatch');
      seedHousemateVisit().then(() =>
        checkoutPetAndOpenAddMenu().then(() => {
          cy.contains('.fup-card--existing button', `Add ${petA()}`, { timeout: 30000 })
            .should('not.be.disabled')
            .click();
          cy.wait('@forcedPatch');
          cy.get('[role="alert"]').should('be.visible');
          clientAppointments().then((rows) => {
            const atStart = rows.filter(
              (a) => Math.abs(ms(a.appointmentStart) - housemateVisit.start.getTime()) < 60_000
            );
            expect(atStart, "only the housemate's own visit is on the calendar").to.have.length(1);
            expect(petIdsOf(atStart[0])).to.deep.equal([w.households.A.activePetIds[1]]);
          });
          // Read the sibling straight from the API, past the stubbed PATCH: start and end are as seeded.
          schedulingApi('manager', 'GET', `/appointments/${housemateVisit.id}`).then((res) => {
            expect(ms(res.body.appointmentStart)).to.equal(housemateVisit.start.getTime());
            expect(ms(res.body.appointmentEnd)).to.equal(housemateVisit.originalEnd.getTime());
          });
        })
      );
    });
  });

  it('SCH-13-4: labs pending for one pet and send to CLs for the other creates a labs task and a CL card', () => {
    const w = schedulingWorld();
    const [idA, idB] = w.households.A.activePetIds;
    // SCH-E: the labs task goes to doctor A (the visit's doctor) and to the technician who works
    // with them (the seed links them, Settings → Staff "Works with"), as linked copies.
    const labsTasksFor = (role: 'doctorA' | 'technician') =>
      schedulingApi(
        role,
        'GET',
        `/tasks?patientId=${idA}&includeDone=true&involvement=assigned`
      ).then((res): any => asList(res.body)) as Cypress.Chainable<any[]>;
    const fresh = (after: any[], before: any[]) =>
      after.filter((t) => !before.some((b) => b.id === t.id));
    const reviewers = () => cy.contains('.fup-card--labs .scheduler-forward-booking-staff-pick', 'Who reviews');
    setUpTodaysVisit(13).then(() => {
      labsTasksFor('doctorA').then((beforeDoctor) =>
        labsTasksFor('technician').then((beforeTech) => {
          openPlanner(todayVisitIds[0], idA);
          // Pet A: labs pending.
          cy.contains('button.fup-pet', petA()).click();
          cy.contains('[role="menuitem"]', 'Labs pending').click();
          cy.contains('.fup-card--labs', petA());
          // "Who reviews" opens with the visit's doctor and their linked tech, editable.
          reviewers()
            .find('.scheduler-forward-booking-staff-chips li', { timeout: 30000 })
            .should('have.length', 2);
          reviewers().should('contain.text', 'Sched doctorA').and('contain.text', 'Sched technician');
          // Pet B: send to the CLs on the default card (with its own type).
          putOnDefaultCard(petB());
          cy.contains('button', 'Send to CLs to book').click();
          cy.get('[role="alert"]').should('contain.text', petB());
          pickType(petB(), w.types.recheck);
          cy.contains('button', 'Send to CLs to book').click();
          cy.contains('.fup-status--cl', 'Goes to the CLs when you press Done').should('be.visible');
          cy.contains('button', /^Done/).click();
          // Nothing was booked, so Done saves and closes.
          cy.get('[role="dialog"][aria-labelledby="fup-title"]').should('not.exist');

          labsTasksFor('doctorA').then((afterDoctor) =>
            labsTasksFor('technician').then((afterTech) => {
              const doctorCopy = fresh(afterDoctor, beforeDoctor);
              const techCopy = fresh(afterTech, beforeTech);
              expect(doctorCopy, "doctor A's labs task").to.have.length(1);
              expect(techCopy, "the linked tech's labs task").to.have.length(1);
              for (const t of [doctorCopy[0], techCopy[0]]) {
                expect(String(t.title)).to.match(/once labs are back/i);
                expect(String(t.title)).to.contain(petA());
              }
              expect(doctorCopy[0].shareGroupId, 'linked copies of one task').to.be.a('string');
              expect(techCopy[0].shareGroupId).to.equal(doctorCopy[0].shareGroupId);

              // The tech closes theirs "for everyone": both copies close.
              signInAsScheduling('technician', `/schedule/tasks?taskId=${techCopy[0].id}`);
              cy.contains('.pims-task-detail__shared', 'Shared', { timeout: 30000 }).should(
                'contain.text',
                'Sched doctorA'
              );
              // The prompt closes before the request finishes: wait for the complete call itself.
              cy.intercept('POST', '**/tasks/*/complete').as('completeTask');
              cy.contains('button', 'Mark complete').click();
              cy.get('[role="alertdialog"]')
                .should('contain.text', 'Also close it for Sched doctorA?')
                .contains('button', 'Close for everyone')
                .click();
              cy.wait('@completeTask').its('response.statusCode').should('be.within', 200, 299);
              cy.get('[role="alertdialog"]').should('not.exist');
              schedulingApi('doctorA', 'GET', `/tasks/${doctorCopy[0].id}`).then((res) => {
                expect(res.body.status).to.equal('done');
                expect(String(res.body.resolutionNote)).to.contain('closed their copy');
              });
              schedulingApi('technician', 'GET', `/tasks/${techCopy[0].id}`).then((res) => {
                expect(res.body.status).to.equal('done');
              });
            })
          );
          forwardBookings('pending', idB).then((rows) => {
            const cl = rows.filter((r) => !leftoverEntryIds.has(Number(r.id)));
            expect(cl, 'CL card (pending forward-booking row) for the other pet').to.have.length(1);
            expect(Number(cl[0].appointmentTypeId)).to.equal(w.types.recheck);
          });
          forwardBookings('pending', idA).then((rows) => {
            expect(
              rows.filter((r) => !leftoverEntryIds.has(Number(r.id))),
              'the labs pet gets a task, not a CL row'
            ).to.have.length(0);
          });
        })
      );
    });
  });

  describe('SCH-13-5: confirmation text', () => {
    let original: { doNotSms?: boolean; smsOptOut?: boolean; phone1?: string };

    before(() => {
      // Seeded clients are do-not-text. Turn text on just for this test; restored in after().
      const { clientId } = schedulingWorld().households.A;
      schedulingApi('manager', 'GET', `/clients/${clientId}`).then((res) => {
        original = {
          doNotSms: res.body.doNotSms,
          smsOptOut: res.body.smsOptOut,
          phone1: res.body.phone1,
        };
        schedulingApi('manager', 'PATCH', `/clients/${clientId}`, {
          doNotSms: false,
          smsOptOut: false,
          phone1: res.body.phone1 || '9195550142',
        });
      });
    });

    after(() => {
      const { clientId } = schedulingWorld().households.A;
      schedulingApi('manager', 'PATCH', `/clients/${clientId}`, {
        doNotSms: original?.doNotSms ?? true,
        smsOptOut: original?.smsOptOut ?? true,
      });
    });

    it('Send & finish with a double click makes exactly one text request', () => {
      const w = schedulingWorld();
      // Stubbed: nothing can be sent, and the stub is how the single send is counted.
      cy.intercept('POST', '**/sms/client/*', { statusCode: 200, body: { ok: true } }).as('sms');
      setUpTodaysVisit(15).then(() => {
        openPlanner(todayVisitIds[0], w.households.A.activePetIds[0]);
        planAndBookBoth().then(() => {
          cy.contains('button', 'Done · next: text the owner').click();
          cy.get('#fup-title').should('contain.text', 'Text the owner');
          cy.get('textarea[aria-label="Text message to the owner"]')
            .invoke('val')
            .should('contain', petA());
          cy.contains('button', 'Send text & finish').dblclick();
          cy.wait('@sms').then(({ request }) => {
            expect(request.body.source).to.equal('follow_up_confirmation');
            expect(request.body.patientIds).to.have.length(2);
            expect(String(request.body.message)).to.contain(petB());
          });
          cy.get('[role="dialog"][aria-labelledby="fup-title"]').should('not.exist');
          // Give a second request time to show up before counting.
          cy.wait(1500);
          cy.get('@sms.all').should('have.length', 1);
        });
      });
    });
  });
});
