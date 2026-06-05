import type { AppointmentType } from '../api/appointmentSettings';

/** Suggested UX when manual booking is forbidden (403). */
export const MANUAL_BOOKING_FORBIDDEN_MESSAGE =
  "You can't create this appointment type from the calendar. Use Find a slot (routing) or ask an administrator to update your role permissions.";

export const MANUAL_BOOKING_NO_EMPLOYEE_LINK_MESSAGE =
  'Your user is not linked to an employee in this practice; manual booking is not allowed.';

export function rolesIncludeAdminBypass(rolesLower: readonly string[]): boolean {
  return rolesLower.includes('admin') || rolesLower.includes('superadmin');
}

export function filterAppointmentTypesByIds(
  catalog: readonly AppointmentType[],
  allowedIds: readonly number[]
): AppointmentType[] {
  const idSet = new Set(allowedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
  return catalog.filter((t) => idSet.has(t.id));
}

export function formatManualBookingApiError(err: unknown): string | null {
  const ax = err as {
    response?: { status?: number; data?: { message?: string | string[] } };
    message?: string;
  };
  if (ax?.response?.status !== 403) return null;
  const raw = ax.response?.data?.message;
  const msg = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : '';
  const lower = msg.toLowerCase();
  if (lower.includes('not linked to an employee')) {
    return MANUAL_BOOKING_NO_EMPLOYEE_LINK_MESSAGE;
  }
  if (
    lower.includes('does not allow manually booking') ||
    lower.includes('manual booking') ||
    lower.includes('manually booking')
  ) {
    return MANUAL_BOOKING_FORBIDDEN_MESSAGE;
  }
  return null;
}

export function formatSchedulerBookingApiError(err: unknown): string {
  return formatManualBookingApiError(err) ?? defaultApiErrorMessage(err);
}

function defaultApiErrorMessage(err: unknown): string {
  const ax = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m;
  if (ax?.message) return ax.message;
  return 'Request failed';
}
