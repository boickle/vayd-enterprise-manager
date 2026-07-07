/** Appointment request → scheduler: remove linked visit before marking not booked. */
export const NOT_BOOKED_REMOVE_SESSION_KEY = 'vayd:appt-request-not-booked-remove-v1';
export const NOT_BOOKED_REMOVE_RETURN_KEY = 'vayd:appt-request-not-booked-remove-return-v1';

export type NotBookedRemoveSessionV1 = {
  v: 1;
  submissionId: number;
  bookedAppointmentId: number;
  clientLabel?: string | null;
  returnPath: string;
};

export type NotBookedRemoveReturnV1 = {
  v: 1;
  submissionId: number;
};

export function writeNotBookedRemoveSession(next: Omit<NotBookedRemoveSessionV1, 'v'>): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      NOT_BOOKED_REMOVE_SESSION_KEY,
      JSON.stringify({ v: 1, ...next }),
    );
  } catch {
    /* quota */
  }
}

export function readNotBookedRemoveSession(): NotBookedRemoveSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(NOT_BOOKED_REMOVE_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as NotBookedRemoveSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.submissionId !== 'number' ||
      typeof o.bookedAppointmentId !== 'number' ||
      !o.returnPath?.trim()
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function clearNotBookedRemoveSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(NOT_BOOKED_REMOVE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function writeNotBookedRemoveReturnSession(
  next: Omit<NotBookedRemoveReturnV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      NOT_BOOKED_REMOVE_RETURN_KEY,
      JSON.stringify({ v: 1, ...next }),
    );
  } catch {
    /* quota */
  }
}

export function readNotBookedRemoveReturnSession(): NotBookedRemoveReturnV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(NOT_BOOKED_REMOVE_RETURN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as NotBookedRemoveReturnV1;
    if (o?.v !== 1 || typeof o.submissionId !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}

export function clearNotBookedRemoveReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(NOT_BOOKED_REMOVE_RETURN_KEY);
  } catch {
    /* ignore */
  }
}
