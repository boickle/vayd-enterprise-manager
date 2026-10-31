import { getToken } from '../api/http';

/** Where the practice id of this browser's host is kept for signed-out pages. */
export const HOST_PRACTICE_ID_STORAGE_KEY = 'scout_host_practice_id';

function positiveId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Practice id the API reported for this host, or 1 before it has answered. */
export function hostPracticeId(): number {
  try {
    return positiveId(localStorage.getItem(HOST_PRACTICE_ID_STORAGE_KEY)) ?? 1;
  } catch {
    return 1;
  }
}

/**
 * The signed-in practice's id, or this host's practice when signed out. The
 * API replaces any practiceId a request sends with the request's own practice,
 * so this only needs to be right for what the page does with it locally.
 */
export function currentPracticeId(): number {
  return resolvePracticeIdFromToken(getToken());
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolvePracticeIdFromToken(token: string | null): number {
  if (token) {
    const p = decodeJwtPayload(token);
    const fromToken = positiveId(p?.practiceId ?? p?.practice_id);
    if (fromToken) return fromToken;
  }
  return hostPracticeId();
}

/** Staff JWT may carry `employeeId` / `employee_id` for task ownership and permissions. */
export function resolveEmployeeIdFromToken(token: string | null): number | null {
  if (!token) return null;
  const p = decodeJwtPayload(token);
  if (!p) return null;
  const employeeObj = p.employee;
  const nestedId =
    employeeObj && typeof employeeObj === 'object' && 'id' in employeeObj
      ? (employeeObj as { id?: unknown }).id
      : null;
  const raw =
    p.employeeId ??
    p.employee_id ??
    p.staffEmployeeId ??
    p.staff_employee_id ??
    nestedId;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
