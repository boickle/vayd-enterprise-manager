import { HOLDS_PATH, holdsPathWithHighlight } from './holds-nav';

export const APPOINTMENTS_PATH_PREFIX = '/schedule/appointments';

/** Simple client/patient appointment lookup (upcoming + recent past). */
export const APPOINTMENT_SEARCH_PATH = `${APPOINTMENTS_PATH_PREFIX}/search`;

/** Default list URL (New tab). */
export const APPOINTMENT_REQUESTS_LIST_PATH = APPOINTMENTS_PATH_PREFIX;

export const APPOINTMENT_REQUESTS_TAB_PARAM = 'tab';
export const APPOINTMENT_REQUESTS_ON_HOLD_OVER24_PARAM = 'over24';
/** Scroll-to row when opening a specific submission from Gmail or another deep link. */
export const APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM = 'highlight';

export type AppointmentRequestListTab =
  | 'new'
  | 'contacted'
  | 'on_hold'
  | 'to_confirm'
  | 'booked'
  | 'dismissed';

const VALID_TABS = new Set<string>([
  'new',
  'contacted',
  'on_hold',
  'to_confirm',
  'booked',
  'dismissed',
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

export function parseAppointmentRequestsHighlightFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM);
  if (!raw?.trim()) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

export function appointmentRequestsPathForTab(
  tab: AppointmentRequestListTab,
  opts?: { onHoldOver24Only?: boolean; highlightId?: number },
): string {
  if (tab === 'on_hold') {
    if (opts?.highlightId != null) {
      return holdsPathWithHighlight(opts.highlightId);
    }
    return HOLDS_PATH;
  }

  const params = new URLSearchParams();
  if (tab !== 'new') params.set(APPOINTMENT_REQUESTS_TAB_PARAM, tab);
  if (opts?.highlightId != null) {
    params.set(APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM, String(opts.highlightId));
  }
  const qs = params.toString();
  return qs ? `${APPOINTMENTS_PATH_PREFIX}?${qs}` : APPOINTMENTS_PATH_PREFIX;
}
