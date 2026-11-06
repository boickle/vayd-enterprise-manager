import {
  includeSeededDoctorsInProviderList,
  schedulingApi,
  schedulingWorld,
  signInAsScheduling,
} from './schedulingWorld';

/** New York calendar day (YYYY-MM-DD) and the UTC instant of a New York wall-clock time on the next weekday. */
export function nextWeekdayNy(hour: number): { ymd: string; start: Date } {
  const tz = 'America/New_York';
  const ymdOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const cursor = new Date(Date.now() + 24 * 3600 * 1000);
  while ([0, 6].includes(new Date(`${ymdOf(cursor)}T12:00:00Z`).getUTCDay())) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const ymd = ymdOf(cursor);
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
  return { ymd, start: new Date(guess) };
}

/** Books a visit for household A's first pet with doctor A, as the Scheduler's Book screen would. */
export function bookVisit(description: string, hour: number) {
  const w = schedulingWorld();
  const { ymd, start: hourStart } = nextWeekdayNy(hour);
  // A random minute keeps reruns from colliding with a visit left by an earlier run (same pet, same time).
  const start = new Date(hourStart.getTime() + Math.floor(Math.random() * 50) * 60_000);
  const end = new Date(start.getTime() + 5 * 60_000);
  return schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
    practiceId: w.practiceId,
    primaryProviderId: w.doctors.A,
    clientId: w.households.A.clientId,
    patientId: w.households.A.activePetIds[0],
    appointmentTypeId: w.types.medical,
    appointmentStart: start.toISOString(),
    appointmentEnd: end.toISOString(),
    description,
    bookedViaRouting: true,
  }).then((res) => ({ id: res.body.id, ymd }));
}

/** Opens the Scheduler on `ymd`, right-clicks the visit and picks Scheduling > Remove. */
export function openRemoveDialog(ymd: string, apptId: number) {
  includeSeededDoctorsInProviderList();
  signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${schedulingWorld().doctors.A}`);
  cy.get(`[data-appt-id="${apptId}"]`, { timeout: 30000 }).first().rightclick();
  cy.contains('.scheduler-ctx-parent-wrap', 'Scheduling').trigger('mouseover');
  cy.contains('button[role="menuitem"]', 'Remove').click();
  cy.get('[role="dialog"].scheduler-modal--remove-visit').should('be.visible');
}
