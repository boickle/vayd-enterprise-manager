/** After booking from appointment request → routing, return to the list with optional SMS prompt. */
export const APPOINTMENT_REQUEST_RETURN_SESSION_KEY = 'vayd:appointment-request-return-v1';

export const APPOINTMENT_REQUESTS_LIST_PATH = '/schedule/scheduling-tools/appointments';

export type AppointmentRequestReturnSessionV1 = {
  v: 1;
  appointmentRequestSubmissionId: number;
  bookedAppointmentId: number;
  bookedAppointmentStart: string;
  bookedAppointmentEnd?: string | null;
};

export function readAppointmentRequestReturnSession(): AppointmentRequestReturnSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(APPOINTMENT_REQUEST_RETURN_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as AppointmentRequestReturnSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.appointmentRequestSubmissionId !== 'number' ||
      typeof o.bookedAppointmentId !== 'number' ||
      !o.bookedAppointmentStart?.trim()
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function writeAppointmentRequestReturnSession(
  next: Omit<AppointmentRequestReturnSessionV1, 'v'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: AppointmentRequestReturnSessionV1 = { v: 1, ...next };
  try {
    sessionStorage.setItem(APPOINTMENT_REQUEST_RETURN_SESSION_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
}

export function clearAppointmentRequestReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(APPOINTMENT_REQUEST_RETURN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
