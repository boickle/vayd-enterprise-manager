/// <reference types="cypress" />
/** Shared demo data for the Scheduling and Routing (SR) probes and videos. Test stack only. */
import { clearSeededHouseholdVisits, resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling, includeSeededDoctorsInProviderList } from '../../support/schedulingWorld';
import { nextWeekdayNy } from '../../support/schedulingRemove';

type Pet = 'maple' | 'juniper' | 'biscuit';
type TypeKey = 'medical' | 'recheck' | 'wellness' | 'euthanasia' | 'qol' | 'hold' | 'premeds';

/** Books one visit on the next weekday at hour:minute New York time, as the Book screen would. */
export function srBook(
  pet: Pet,
  hour: number,
  minute: number,
  type: TypeKey,
  minutes = 60,
  doctor: 'A' | 'B' = 'A',
  description = ''
) {
  const w = schedulingWorld();
  const { ymd, start: h } = nextWeekdayNy(hour);
  const start = new Date(h.getTime() + minute * 60_000);
  const end = new Date(start.getTime() + minutes * 60_000);
  const household = pet === 'biscuit' ? w.households.B : w.households.A;
  const patientId =
    pet === 'biscuit' ? w.households.B.petId : w.households.A.activePetIds[pet === 'maple' ? 0 : 1];
  return schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
    practiceId: w.practiceId,
    primaryProviderId: w.doctors[doctor],
    clientId: household.clientId,
    patientId,
    appointmentTypeId: w.types[type],
    appointmentStart: start.toISOString(),
    appointmentEnd: end.toISOString(),
    description,
    bookedViaRouting: true,
  }).then((res) => ({ id: res.body.id, ymd }));
}

/** Dr. Lane's demo day: Maple 9:00 medical, Biscuit 11:00 recheck, Juniper 1:30 pm wellness. */
/** Clean slate for the demo households (test DB only), then nothing booked. */
export function resetDemo() {
  resetSeededHouseholdsInDb();
}

export function demoDay() {
  resetSeededHouseholdsInDb();
  srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
  srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck');
  srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
}

const TEXT_DIR =
  'cypress/training-out/probe-text';

/** Saves the visible text of `selector` (default: the open dialog, else the page main area) for script checking. */
export function dump(name: string, selector?: string) {
  cy.wait(800);
  cy.get('body').then(($b) => {
    const sel =
      selector ||
      ($b.find('[role="dialog"]:visible').length ? '[role="dialog"]:visible' : 'main, #root');
    const els = sel === 'body' ? $b : $b.find(sel).filter(':visible');
    const text = els
      .toArray()
      .map((el) => {
        const inputs = Array.from(el.querySelectorAll('input,select,textarea,button'))
          .map((i: any) => {
            const lbl = i.getAttribute('aria-label') || i.getAttribute('title') || i.getAttribute('placeholder') || '';
            const val = i.tagName === 'SELECT' ? i.options[i.selectedIndex]?.text : i.value;
            const dis = i.disabled ? ' (disabled)' : '';
            return i.tagName === 'BUTTON'
              ? `  [button] ${i.innerText.trim() || lbl}${dis}${i.title ? ` {title: ${i.title}}` : ''}`
              : `  [${i.tagName.toLowerCase()}${i.type ? `:${i.type}` : ''}] ${lbl} = ${val ?? ''}${dis}`;
          })
          .join('\n');
        return `${(el as HTMLElement).innerText}\n--- controls ---\n${inputs}`;
      })
      .join('\n=====\n');
    cy.writeFile(`${TEXT_DIR}/${name}.txt`, text || `(nothing visible for ${sel})`, { log: false });
  });
}

/** Opens the calendar on the demo day for Dr. Lane, as `role`. */
export function openDemoDay(role: 'cl' | 'technician' | 'manager' | 'doctorA' | 'doctorB', view = '') {
  const w = schedulingWorld();
  const { ymd } = nextWeekdayNy(9);
  includeSeededDoctorsInProviderList();
  signInAsScheduling(role, `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}${view}`);
  cy.get('[data-appt-id]', { timeout: 30000 }).should('have.length.at.least', 1);
  cy.wait(1000);
}

/** Right-clicks visit `id` and picks `group` > `item`. */
export function menuPick(id: number, group: string, item: string) {
  cy.get(`[data-appt-id="${id}"]`).first().rightclick();
  cy.contains('.scheduler-ctx-parent-wrap', group).trigger('mouseover');
  cy.contains('button[role="menuitem"]', item).click();
}
