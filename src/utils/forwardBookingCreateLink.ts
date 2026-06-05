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
    if (!Number.isFinite(patientId) || !Number.isFinite(appointmentId)) return null;
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
