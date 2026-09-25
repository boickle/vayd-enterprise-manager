import { assignHoldOwner } from '../api/holds';
import { resolveEmployeeIdFromToken } from './practiceIdFromToken';
import { normalizeEmployeeId } from './taskOwnership';

/** Prefer JWT / auth employee id, then any numeric fallback (e.g. GET /holds currentUserEmployeeId). */
export function resolveStaffEmployeeIdForHoldClaim(opts: {
  token?: string | null;
  employeeId?: string | number | null;
  fallbackEmployeeId?: string | number | null;
}): number | null {
  const fromAuth = normalizeEmployeeId(opts.employeeId);
  if (fromAuth != null && fromAuth > 0) return fromAuth;
  const fromToken = resolveEmployeeIdFromToken(opts.token ?? null);
  if (fromToken != null && fromToken > 0) return fromToken;
  const fallback = normalizeEmployeeId(opts.fallbackEmployeeId);
  if (fallback != null && fallback > 0) return fallback;
  return null;
}

/**
 * After booking a HOLD appointment type, claim ownership for the current staff member.
 * Best-effort: booking already succeeded; a failed claim must not undo it.
 */
export async function claimHoldOwnerBestEffort(
  appointmentId: number,
  ownerEmployeeId: number | null | undefined
): Promise<boolean> {
  const id = Number(appointmentId);
  const ownerId = normalizeEmployeeId(ownerEmployeeId);
  if (!Number.isFinite(id) || id <= 0 || ownerId == null || ownerId <= 0) return false;
  try {
    await assignHoldOwner(id, ownerId);
    return true;
  } catch (err) {
    console.warn('[holds] auto-assign owner failed', { appointmentId: id, ownerId, err });
    return false;
  }
}
