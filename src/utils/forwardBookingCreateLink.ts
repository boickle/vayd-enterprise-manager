import { FORWARD_BOOKING_LIST_PATH } from './forwardBookingReturnSession';

export { FORWARD_BOOKING_LIST_PATH };

export const FORWARD_BOOKING_CREATE_NEW_PARAM = 'new';
export const FORWARD_BOOKING_CREATE_PATIENT_PARAM = 'patientId';
export const FORWARD_BOOKING_CREATE_APPOINTMENT_PARAM = 'appointmentId';
export const FORWARD_BOOKING_CREATE_RETURN_TO_PARAM = 'returnTo';

export type CreateForwardBookingPrefill = {
  patientId: number;
  appointmentId: number;
  patientLabel?: string;
};

export function buildTaskForwardBookingReturnPath(taskId: number): string {
  return `/schedule/tasks?taskId=${encodeURIComponent(String(taskId))}`;
}

/** Set on the task return path once the forward booking was created — the task
 * screen uses it to show the "Forward booking added" confirmation. */
export const FORWARD_BOOKING_TASK_ADDED_PARAM = 'fbAdded';

/** Task id when `returnTo` points back at a task (the labs-pending flow). */
export function taskIdFromForwardBookingReturnPath(returnPath: string | null | undefined): number | null {
  const path = sanitizeForwardBookingReturnTo(returnPath);
  if (!path) return null;
  try {
    const url = new URL(path, 'https://local');
    if (url.pathname !== '/schedule/tasks') return null;
    const id = Number(url.searchParams.get('taskId'));
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function withForwardBookingTaskAddedFlag(returnPath: string): string {
  try {
    const url = new URL(returnPath, 'https://local');
    url.searchParams.set(FORWARD_BOOKING_TASK_ADDED_PARAM, '1');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return returnPath;
  }
}

/** Only allow in-app schedule paths (avoid open redirects). */
export function sanitizeForwardBookingReturnTo(raw: string | null | undefined): string | null {
  const path = raw?.trim();
  if (!path || !path.startsWith('/schedule/')) return null;
  if (path.includes('://')) return null;
  return path;
}

export function buildCreateForwardBookingUrl(args: {
  patientId: number;
  appointmentId: number;
  returnTo?: string | null;
}): string {
  const params = new URLSearchParams({
    [FORWARD_BOOKING_CREATE_NEW_PARAM]: '1',
    [FORWARD_BOOKING_CREATE_PATIENT_PARAM]: String(args.patientId),
    [FORWARD_BOOKING_CREATE_APPOINTMENT_PARAM]: String(args.appointmentId),
  });
  const returnTo = sanitizeForwardBookingReturnTo(args.returnTo);
  if (returnTo) params.set(FORWARD_BOOKING_CREATE_RETURN_TO_PARAM, returnTo);
  return `${FORWARD_BOOKING_LIST_PATH}?${params.toString()}`;
}

export const LABS_PENDING_FORWARD_BOOKING_TASK_BODY =
  'When lab results are back, add to the forward booking list.';

/**
 * Whether putting this on the forward booking list is the work. Patient +
 * appointment links alone are not enough — an invoice or callback task carries
 * those too, and would otherwise sprout a booking panel it has no use for.
 */
export function isForwardBookingTask(task: {
  body?: string | null;
  links?: ReadonlyArray<{ entityType: string; entityId: number }>;
}): boolean {
  if (!getForwardBookingPrefillFromTaskLinks(task.links)) return false;
  const body = task.body?.trim();
  if (!body) return false;
  if (body === LABS_PENDING_FORWARD_BOOKING_TASK_BODY) return true;
  // Older tasks carried the booking link in the notes instead of a marker body.
  return body
    .split('\n')
    .some((line) => parseCreateForwardBookingPrefillFromUrl(line.trim()) != null);
}

export function getForwardBookingPrefillFromTaskLinks(
  links: ReadonlyArray<{ entityType: string; entityId: number }> | undefined
): CreateForwardBookingPrefill | null {
  if (!links?.length) return null;
  let patientId: number | null = null;
  let appointmentId: number | null = null;
  for (const link of links) {
    if (link.entityType === 'patient' && Number.isFinite(link.entityId)) {
      patientId = link.entityId;
    }
    if (link.entityType === 'appointment' && Number.isFinite(link.entityId)) {
      appointmentId = link.entityId;
    }
  }
  if (patientId == null || appointmentId == null) return null;
  return { patientId, appointmentId };
}

/** Hide legacy URL lines embedded in task notes. */
export function taskDescriptionDisplayBody(body: string | null | undefined): string | null {
  if (!body?.trim()) return null;
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !parseCreateForwardBookingPrefillFromUrl(line));
  return lines.join('\n').trim() || null;
}

export function parseCreateForwardBookingPrefillFromUrl(
  pathWithQuery: string
): CreateForwardBookingPrefill | null {
  try {
    const url = pathWithQuery.startsWith('/')
      ? new URL(pathWithQuery, 'https://local')
      : new URL(pathWithQuery);
    if (!url.pathname.endsWith('/forward-booking') && url.pathname !== FORWARD_BOOKING_LIST_PATH) {
      return null;
    }
    if (url.searchParams.get(FORWARD_BOOKING_CREATE_NEW_PARAM) !== '1') return null;
    const patientId = Number(url.searchParams.get(FORWARD_BOOKING_CREATE_PATIENT_PARAM));
    const appointmentId = Number(url.searchParams.get(FORWARD_BOOKING_CREATE_APPOINTMENT_PARAM));
    if (!Number.isFinite(patientId) || patientId <= 0 || !Number.isFinite(appointmentId) || appointmentId <= 0) {
      return null;
    }
    return { patientId, appointmentId };
  } catch {
    return null;
  }
}

export function forwardBookingLinkLabel(pathWithQuery: string): string {
  return parseCreateForwardBookingPrefillFromUrl(pathWithQuery) ? 'Add forward booking' : pathWithQuery;
}

const INTERNAL_PATH_RE = /(\/schedule\/[^\s]+)/g;

export function taskBodyContainsInternalLink(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  return INTERNAL_PATH_RE.test(body);
}
