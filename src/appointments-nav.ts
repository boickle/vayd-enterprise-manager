export const APPOINTMENTS_PATH_PREFIX = '/schedule/appointments';

/** Default list URL (New tab). */
export const APPOINTMENT_REQUESTS_LIST_PATH = APPOINTMENTS_PATH_PREFIX;

export const APPOINTMENT_REQUESTS_TAB_PARAM = 'tab';
export const APPOINTMENT_REQUESTS_ON_HOLD_OVER24_PARAM = 'over24';

export type AppointmentRequestListTab =
  | 'new'
  | 'contacted'
  | 'on_hold'
  | 'to_confirm'
  | 'booked'
  | 'dismissed'
  | 'need_records';

const VALID_TABS = new Set<string>([
  'new',
  'contacted',
  'on_hold',
  'to_confirm',
  'booked',
  'dismissed',
  'need_records',
]);

export function parseAppointmentRequestsTabParam(
  value: string | null | undefined,
): AppointmentRequestListTab | null {
  if (!value?.trim()) return null;
  return VALID_TABS.has(value) ? (value as AppointmentRequestListTab) : null;
}

export function parseAppointmentRequestsTabFromLocation(
  pathname: string,
  search: string,
): AppointmentRequestListTab {
  if (
    pathname === `${APPOINTMENTS_PATH_PREFIX}/on-hold` ||
    pathname.startsWith(`${APPOINTMENTS_PATH_PREFIX}/on-hold/`)
  ) {
    return 'on_hold';
  }
  return parseAppointmentRequestsTabParam(new URLSearchParams(search).get(APPOINTMENT_REQUESTS_TAB_PARAM)) ?? 'new';
}

export function appointmentRequestsOnHoldOver24FromSearch(search: string): boolean {
  return new URLSearchParams(search).get(APPOINTMENT_REQUESTS_ON_HOLD_OVER24_PARAM) === '1';
}

export function appointmentRequestsPathForTab(
  tab: AppointmentRequestListTab,
  opts?: { onHoldOver24Only?: boolean },
): string {
  if (tab === 'on_hold') {
    const params = new URLSearchParams();
    if (opts?.onHoldOver24Only) params.set(APPOINTMENT_REQUESTS_ON_HOLD_OVER24_PARAM, '1');
    const qs = params.toString();
    return qs ? `${APPOINTMENTS_PATH_PREFIX}/on-hold?${qs}` : `${APPOINTMENTS_PATH_PREFIX}/on-hold`;
  }
  if (tab === 'new') return APPOINTMENTS_PATH_PREFIX;
  return `${APPOINTMENTS_PATH_PREFIX}?${APPOINTMENT_REQUESTS_TAB_PARAM}=${encodeURIComponent(tab)}`;
}
