/** Session snapshot for Routing page: restore form + results when navigating back in the same tab. */

import { clearRoutingCalendarPreview } from './routingCalendarPreviewStorage';

export const ROUTING_UI_SNAPSHOT_KEY = 'routing:ui-snapshot-v1';

/** Same key as Routing page — last routing request id for feedback (session). */
export const ROUTING_REQUEST_ID_SESSION_KEY = 'routing:last-request-id';

const SNAPSHOT_VERSION = 1 as const;

/** localStorage: last resolved PIMS id + label for the logged-in user's linked doctor (avoids empty-doctor flash on cold load). */
export const ROUTING_AUTH_DOCTOR_CACHE_KEY = 'routing:auth-doctor-cache-v1';

export type SnapshotRouteRequest = {
  doctorId: string;
  startDate: string;
  endDate: string;
  newAppt: {
    serviceMinutes: number;
    lat?: number;
    lon?: number;
    address?: string;
    clientId?: string;
    addressZoneShort?: string;
  };
};

export type RoutingUiSnapshotV1 = {
  v: typeof SNAPSHOT_VERSION;
  userId: string | null;
  form: SnapshotRouteRequest;
  result: unknown | null;
  multiDoctor: boolean;
  useTraffic: boolean;
  preferredWeekday: number[];
  preferredTimeOfDay: 'first' | 'middle' | 'end' | null;
  preferEarliestFeasibleStart: boolean;
  edgeFirst: boolean;
  edgeLast: boolean;
  reserveOption: 'reserve-only' | 'reserve-overflow' | null;
  clientQuery: string;
  doctorQuery: string;
  doctorNames: Record<string, string>;
  scheduleBookedKeys: Record<string, true>;
  feedbackSuccessKey: string | null;
  selectedClientAlerts: string | null;
  scheduleBookTypeId: number | null;
};

export type RoutingUiBootstrap = {
  form: SnapshotRouteRequest;
  result: unknown | null;
  multiDoctor: boolean;
  useTraffic: boolean;
  preferredWeekday: number[];
  preferredTimeOfDay: 'first' | 'middle' | 'end' | null;
  preferEarliestFeasibleStart: boolean;
  edgeFirst: boolean;
  edgeLast: boolean;
  reserveOption: 'reserve-only' | 'reserve-overflow' | null;
  clientQuery: string;
  doctorQuery: string;
  doctorNames: Record<string, string>;
  scheduleBookedKeys: Record<string, true>;
  feedbackSuccessKey: string | null;
  selectedClientAlerts: string | null;
  scheduleBookTypeId: number | null;
};

type AuthDoctorCacheV1 = { v: 1; userId: string; pimsId: string; doctorQuery: string };

function currentUserIdFromStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const id = localStorage.getItem('vayd_clientId');
    return id != null && String(id).trim() !== '' ? String(id) : null;
  } catch {
    return null;
  }
}

function defaultForm(): SnapshotRouteRequest {
  return {
    doctorId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    newAppt: { serviceMinutes: 45, address: '' },
  };
}

function emptyBootstrap(): RoutingUiBootstrap {
  const form = defaultForm();
  return {
    form,
    result: null,
    multiDoctor: false,
    useTraffic: false,
    preferredWeekday: [],
    preferredTimeOfDay: null,
    preferEarliestFeasibleStart: false,
    edgeFirst: false,
    edgeLast: false,
    reserveOption: null,
    clientQuery: '',
    doctorQuery: '',
    doctorNames: {},
    scheduleBookedKeys: {},
    feedbackSuccessKey: null,
    selectedClientAlerts: null,
    scheduleBookTypeId: null,
  };
}

export function readAuthDoctorCache(): { pimsId: string; doctorQuery: string } | null {
  const uid = currentUserIdFromStorage();
  if (!uid || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ROUTING_AUTH_DOCTOR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthDoctorCacheV1;
    if (parsed?.v !== 1 || !parsed.userId || parsed.userId !== uid) return null;
    const pimsId = String(parsed.pimsId ?? '').trim();
    if (!pimsId) return null;
    return { pimsId, doctorQuery: String(parsed.doctorQuery ?? '').trim() || 'My doctor' };
  } catch {
    return null;
  }
}

export function writeAuthDoctorCache(userId: string, pimsId: string, doctorQuery: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: AuthDoctorCacheV1 = { v: 1, userId, pimsId, doctorQuery };
    localStorage.setItem(ROUTING_AUTH_DOCTOR_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** One-time read when Routing mounts: session UI snapshot, else cached auth doctor for form defaults. */
export function readRoutingUiBootstrap(): RoutingUiBootstrap {
  const base = emptyBootstrap();
  if (typeof window === 'undefined') return base;

  const uid = currentUserIdFromStorage();

  try {
    const raw = sessionStorage.getItem(ROUTING_UI_SNAPSHOT_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<RoutingUiSnapshotV1>;
      if (s?.v === SNAPSHOT_VERSION && s.form && typeof s.form === 'object') {
        const snapUid = s.userId != null ? String(s.userId) : null;
        if (snapUid != null && uid != null && snapUid !== uid) {
          /* different user — ignore session snapshot */
        } else {
          const d = defaultForm();
          const mergedForm: SnapshotRouteRequest = {
            ...d,
            ...s.form,
            newAppt: { ...d.newAppt, ...(s.form as SnapshotRouteRequest).newAppt },
          };
          return {
            ...base,
            form: mergedForm,
            result: s.result ?? null,
            multiDoctor: !!s.multiDoctor,
            useTraffic: !!s.useTraffic,
            preferredWeekday: Array.isArray(s.preferredWeekday)
              ? s.preferredWeekday.filter((n) => typeof n === 'number' && n >= 1 && n <= 7)
              : [],
            preferredTimeOfDay:
              s.preferredTimeOfDay === 'first' ||
              s.preferredTimeOfDay === 'middle' ||
              s.preferredTimeOfDay === 'end'
                ? s.preferredTimeOfDay
                : null,
            preferEarliestFeasibleStart: !!s.preferEarliestFeasibleStart,
            edgeFirst: !!s.edgeFirst,
            edgeLast: !!s.edgeLast,
            reserveOption:
              s.reserveOption === 'reserve-only' || s.reserveOption === 'reserve-overflow'
                ? s.reserveOption
                : null,
            clientQuery: typeof s.clientQuery === 'string' ? s.clientQuery : '',
            doctorQuery: typeof s.doctorQuery === 'string' ? s.doctorQuery : '',
            doctorNames:
              s.doctorNames && typeof s.doctorNames === 'object' && !Array.isArray(s.doctorNames)
                ? (s.doctorNames as Record<string, string>)
                : {},
            scheduleBookedKeys:
              s.scheduleBookedKeys && typeof s.scheduleBookedKeys === 'object'
                ? (s.scheduleBookedKeys as Record<string, true>)
                : {},
            feedbackSuccessKey:
              typeof s.feedbackSuccessKey === 'string' || s.feedbackSuccessKey === null
                ? (s.feedbackSuccessKey as string | null)
                : null,
            selectedClientAlerts:
              typeof s.selectedClientAlerts === 'string' || s.selectedClientAlerts === null
                ? (s.selectedClientAlerts as string | null)
                : null,
            scheduleBookTypeId:
              typeof s.scheduleBookTypeId === 'number' && Number.isFinite(s.scheduleBookTypeId)
                ? s.scheduleBookTypeId
                : null,
          };
        }
      }
    }
  } catch {
    /* ignore */
  }

  const authDoctor = readAuthDoctorCache();
  if (authDoctor && uid) {
    return {
      ...base,
      form: { ...base.form, doctorId: authDoctor.pimsId },
      doctorQuery: authDoctor.doctorQuery,
    };
  }

  return base;
}

export function writeRoutingUiSnapshot(s: RoutingUiSnapshotV1) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(ROUTING_UI_SNAPSHOT_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function clearRoutingUiSnapshot() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_UI_SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * After saving a routing handoff from the scheduler: drop calendar preview, routing UI snapshot,
 * and last-request id so Routing opens fresh and prior candidates are not restored.
 */
export function clearRoutingPersistenceAfterSchedulerBook(): void {
  clearRoutingCalendarPreview();
  clearRoutingUiSnapshot();
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_REQUEST_ID_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
