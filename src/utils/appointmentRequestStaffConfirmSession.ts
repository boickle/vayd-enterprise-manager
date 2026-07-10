/** Appointment request To Confirm → scheduler preview → staff confirms on calendar. */
export const APPOINTMENT_REQUEST_STAFF_CONFIRM_SESSION_KEY =
  'vayd:appointment-request-staff-confirm-v1';

export const APPOINTMENT_REQUEST_STAFF_CONFIRM_RETURN_KEY =
  'vayd:appointment-request-staff-confirm-return-v1';

export type AppointmentRequestStaffConfirmSessionV1 = {
  v: 1;
  submissionId: number;
  bookedAppointmentId: number;
  clientLabel?: string | null;
  isNewClient?: boolean;
  returnPath?: string | null;
};

export type AppointmentRequestStaffConfirmReturnV1 = {
  v: 1;
  submissionId: number;
};

export function writeAppointmentRequestStaffConfirmSession(
  next: Omit<AppointmentRequestStaffConfirmSessionV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      APPOINTMENT_REQUEST_STAFF_CONFIRM_SESSION_KEY,
      JSON.stringify({ v: 1, ...next }),
    );
  } catch {
    /* quota */
  }
}

export function readAppointmentRequestStaffConfirmSession(): AppointmentRequestStaffConfirmSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(APPOINTMENT_REQUEST_STAFF_CONFIRM_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as AppointmentRequestStaffConfirmSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.submissionId !== 'number' ||
      typeof o.bookedAppointmentId !== 'number'
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function clearAppointmentRequestStaffConfirmSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(APPOINTMENT_REQUEST_STAFF_CONFIRM_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function writeAppointmentRequestStaffConfirmReturnSession(
  next: Omit<AppointmentRequestStaffConfirmReturnV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      APPOINTMENT_REQUEST_STAFF_CONFIRM_RETURN_KEY,
      JSON.stringify({ v: 1, ...next }),
    );
  } catch {
    /* quota */
  }
}

export function readAppointmentRequestStaffConfirmReturnSession(): AppointmentRequestStaffConfirmReturnV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(APPOINTMENT_REQUEST_STAFF_CONFIRM_RETURN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as AppointmentRequestStaffConfirmReturnV1;
    if (o?.v !== 1 || typeof o.submissionId !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}

export function clearAppointmentRequestStaffConfirmReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(APPOINTMENT_REQUEST_STAFF_CONFIRM_RETURN_KEY);
  } catch {
    /* ignore */
  }
}
