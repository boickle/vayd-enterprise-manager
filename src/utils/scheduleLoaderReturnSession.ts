export const SCHEDULE_LOADER_RETURN_SESSION_KEY = 'vayd:schedule-loader-return-v1';

export type ScheduleLoaderReturnSessionV1 = {
  v: 1;
  clientId: number;
  bookedAppointmentId: number;
  bookedAppointmentStart: string;
  bookedAppointmentEnd?: string | null;
  petNames: string[];
  clientDisplayName?: string | null;
  providerLastName?: string | null;
  openSms: boolean;
};

export function readScheduleLoaderReturnSession(): ScheduleLoaderReturnSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SCHEDULE_LOADER_RETURN_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as ScheduleLoaderReturnSessionV1;
    if (
      o?.v !== 1 ||
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

export function writeScheduleLoaderReturnSession(
  next: Omit<ScheduleLoaderReturnSessionV1, 'v'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: ScheduleLoaderReturnSessionV1 = { v: 1, ...next };
  try {
    sessionStorage.setItem(SCHEDULE_LOADER_RETURN_SESSION_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
}

export function clearScheduleLoaderReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(SCHEDULE_LOADER_RETURN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
