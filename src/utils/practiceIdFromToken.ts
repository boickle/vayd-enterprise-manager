/** Resolve practice id from JWT or VITE_PRACTICE_ID (shared PIMS / inventory helpers). */
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
    const raw = p?.practiceId ?? p?.practice_id;
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
}

/** Staff JWT may carry `employeeId` / `employee_id` for task ownership and permissions. */
export function resolveEmployeeIdFromToken(token: string | null): number | null {
  if (!token) return null;
  const p = decodeJwtPayload(token);
  const raw = p?.employeeId ?? p?.employee_id;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
