/** Query param on `/schedule/scheduler` — jump to the appointment date, provider, and highlight. */
export const SCHEDULER_FOCUS_APPOINTMENT_PARAM = 'focusAppt';

export function buildSchedulerFocusAppointmentUrl(appointmentId: number): string {
  const params = new URLSearchParams({
    [SCHEDULER_FOCUS_APPOINTMENT_PARAM]: String(appointmentId),
  });
  return `/schedule/scheduler?${params.toString()}`;
}
