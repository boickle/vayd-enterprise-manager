/**
 * "+ Appointment" / New appointment: open Get Best Route with a cleared left-side form.
 */

import { clearRoutingAppointmentRequestIntent } from './routingAppointmentRequestIntent';
import { clearRoutingChartBookIntent } from './routingChartBookIntent';
import {
  EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE,
  hasActiveEditVisitTimePreview,
} from './routingCalendarPreviewGuard';
import { alertAndBlockForwardBookingWorkspaceLeave } from './forwardBookingWorkspaceGuard';
import { appAlert } from './appDialog';
import { clearRoutingRescheduleIntent } from './routingRescheduleIntent';
import {
  clearRoutingPersistenceAfterSchedulerBook,
  ROUTING_NEW_APPOINTMENT_CLEAR_EVENT,
} from './routingUiSnapshot';

export { ROUTING_NEW_APPOINTMENT_CLEAR_EVENT };

/**
 * Clear routing form persistence + live pane state so staff can start a new route.
 * Keeps doctor selection (handled in the Routing listener).
 *
 * @returns false when the action was blocked (forward-booking lock or edit-visit preview).
 */
export function startFreshNewAppointmentRouting(): boolean {
  if (typeof window === 'undefined') return false;
  if (alertAndBlockForwardBookingWorkspaceLeave()) return false;
  if (hasActiveEditVisitTimePreview()) {
    void appAlert({
      title: 'Appointment preview open',
      message: EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE,
    });
    return false;
  }

  // Drop reschedule / appointment-request workspace state without navigating away.
  clearRoutingRescheduleIntent();
  clearRoutingAppointmentRequestIntent();
  clearRoutingChartBookIntent();
  // Preview + session snapshot + last request id — so remounted Routing bootstraps empty.
  clearRoutingPersistenceAfterSchedulerBook();
  window.dispatchEvent(new Event(ROUTING_NEW_APPOINTMENT_CLEAR_EVENT));
  return true;
}
