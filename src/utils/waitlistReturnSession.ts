export const WAITLIST_RETURN_SESSION_KEY = 'vayd:waitlist-return-v1';

export type WaitlistReturnSessionV1 = {
  v: 1;
  waitlistEntryId: number;
  clientId: number;
  bookedAppointmentId: number;
  bookedAppointmentStart: string;
  bookedAppointmentEnd?: string | null;
  petNames: string[];
  clientDisplayName?: string | null;
  clientFirstName?: string | null;
  providerLastName?: string | null;
  /** When true, post-book SMS includes the hold-spot release deadline. */
  isHold?: boolean;
  openSms: boolean;
};

export function readWaitlistReturnSession(): WaitlistReturnSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WAITLIST_RETURN_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as WaitlistReturnSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.waitlistEntryId !== 'number' ||
      typeof o.clientId !== 'number' ||
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

export function writeWaitlistReturnSession(next: Omit<WaitlistReturnSessionV1, 'v'>): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(WAITLIST_RETURN_SESSION_KEY, JSON.stringify({ v: 1, ...next }));
  } catch {
    /* quota */
  }
}

export function clearWaitlistReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(WAITLIST_RETURN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
