import type { NavigateFunction } from 'react-router';
import {
  APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM,
  APPOINTMENT_REQUESTS_LIST_PATH,
  APPOINTMENT_REQUESTS_TAB_PARAM,
  APPOINTMENTS_PATH_PREFIX,
  appointmentRequestsPathForTab,
  parseAppointmentRequestsTabParam,
  type AppointmentRequestListTab,
} from '../appointments-nav';
import { HOLDS_PATH } from '../holds-nav';

export const APPOINTMENT_REQUEST_LIST_RETURN_TAB_KEY =
  'vayd:appointment-request-list-return-tab-v1';

export type AppointmentsListLocationState = {
  /** In-page tab switch (same session); avoids resetting to New on route remount. */
  appointmentsTab?: AppointmentRequestListTab;
};

export function appointmentsTabFromLocationState(
  state: unknown,
): AppointmentRequestListTab | null {
  if (!state || typeof state !== 'object') return null;
  return parseAppointmentRequestsTabParam(
    (state as AppointmentsListLocationState).appointmentsTab,
  );
}

export function writeAppointmentRequestListReturnTab(tab: AppointmentRequestListTab): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(APPOINTMENT_REQUEST_LIST_RETURN_TAB_KEY, tab);
  } catch {
    /* quota */
  }
}

export function readAppointmentRequestListReturnTab(): AppointmentRequestListTab | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(APPOINTMENT_REQUEST_LIST_RETURN_TAB_KEY);
    return parseAppointmentRequestsTabParam(raw);
  } catch {
    return null;
  }
}

export function clearAppointmentRequestListReturnTab(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(APPOINTMENT_REQUEST_LIST_RETURN_TAB_KEY);
  } catch {
    /* ignore */
  }
}

/** Navigate back to the appointments list and restore the given tab on load. */
export function returnToAppointmentRequestsList(
  navigate: NavigateFunction,
  tab: AppointmentRequestListTab,
  opts?: { replace?: boolean; onHoldOver24Only?: boolean },
): void {
  if (tab === 'on_hold') {
    navigate(HOLDS_PATH, { replace: opts?.replace });
    return;
  }
  writeAppointmentRequestListReturnTab(tab);
  navigate(
    appointmentRequestsPathForTab(tab, {
      onHoldOver24Only: opts?.onHoldOver24Only,
    }),
    { replace: opts?.replace, state: { appointmentsTab: tab } satisfies AppointmentsListLocationState },
  );
}

export function appointmentRequestsListPathMatches(
  pathname: string,
  search: string,
  tab: AppointmentRequestListTab,
  opts?: { onHoldOver24Only?: boolean },
): boolean {
  const target = appointmentRequestsPathForTab(tab, opts);
  const q = target.indexOf('?');
  const targetPath = q === -1 ? target : target.slice(0, q);
  const targetSearch = q === -1 ? '' : target.slice(q);

  const currentParams = new URLSearchParams(search);
  currentParams.delete(APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM);
  const currentSearch = currentParams.toString();
  const normalizedCurrent = currentSearch ? `?${currentSearch}` : '';

  return pathname === targetPath && normalizedCurrent === targetSearch;
}

/** Restore tab from return flows; honor explicit ?tab= deep links (e.g. Open in Scout from Gmail). */
export function resolveAppointmentsListEntryTab(
  pathname: string,
  search: string,
  locationState: unknown,
): AppointmentRequestListTab | null {
  const stateTab = appointmentsTabFromLocationState(locationState);
  if (stateTab) {
    clearAppointmentRequestListReturnTab();
    return stateTab;
  }

  const restoreTab = readAppointmentRequestListReturnTab();
  if (restoreTab) {
    clearAppointmentRequestListReturnTab();
    return restoreTab;
  }

  if (
    pathname === `${APPOINTMENTS_PATH_PREFIX}/on-hold` ||
    pathname.startsWith(`${APPOINTMENTS_PATH_PREFIX}/on-hold/`)
  ) {
    return null;
  }

  if (new URLSearchParams(search).has(APPOINTMENT_REQUESTS_TAB_PARAM)) {
    return null;
  }

  return null;
}

export { APPOINTMENT_REQUESTS_LIST_PATH };
