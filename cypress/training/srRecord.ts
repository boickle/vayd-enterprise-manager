/// <reference types="cypress" />
/**
 * Shared setup for the Scheduling and Routing training videos (docs/training/scripts/scheduling-routing/).
 * Test stack only. Demo data comes from probes-sr/srKit.ts (resetDemo, srBook, demoDay).
 */
import { pointAt, tap } from './trainingKit';

/**
 * The orange "Not production" banner belongs to test stacks, not to what staff will see. Hide it on every page
 * load (and give its space back to the page) so it never appears in a video.
 */
export function hideNonProdBanner() {
  cy.on('window:load', (win) => {
    const style = win.document.createElement('style');
    style.textContent =
      '.app-nonprod-banner{display:none!important}.app-root--nonprod{--app-nonprod-banner-height:0px!important;padding-top:0!important}';
    win.document.head.appendChild(style);
  });
}

/** Right-click a calendar visit with the cursor, outline and click sound. */
export function rightClickVisit(apptId: number) {
  tap(() => cy.get(`[data-appt-id="${apptId}"]`).first(), 'rightclick');
}

/** Moves the cursor to a right-click menu group and opens it. */
export function openMenuGroup(group: string) {
  pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', group), 1500);
  cy.contains('.scheduler-ctx-parent-wrap', group).trigger('mouseover');
  cy.wait(400, { log: false });
}

/** Clicks an item in the open right-click menu. */
export function menuItem(label: string | RegExp) {
  tap(() => cy.contains('button[role="menuitem"]', label));
}

/**
 * Marks the calendar spot at `label` (a time-column label, e.g. '11:00 AM') plus `plusMin` minutes in
 * day column `dayIdx` with a small transparent box, so tap() can double-click it with the big cursor.
 * The box sits inside the day body, so the double-click reaches the calendar's own handler.
 */
export function markCalendarSpot(dayIdx: number, label: string, plusMin: number) {
  cy.contains('.scheduler-time-slot', label).then(($slot) => {
    const top = $slot[0].offsetTop + plusMin * 1.1;
    cy.get('.scheduler-day-body').eq(dayIdx).then(($body) => {
      $body[0].querySelector('#sr-spot')?.remove();
      const spot = $body[0].ownerDocument.createElement('div');
      spot.id = 'sr-spot';
      spot.style.cssText = `position:absolute;left:10%;right:10%;top:${top - 8}px;height:16px;pointer-events:auto;`;
      $body[0].appendChild(spot);
      spot.scrollIntoView({ block: 'center' });
    });
  });
}
