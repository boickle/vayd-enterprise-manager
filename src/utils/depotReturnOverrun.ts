import { DateTime } from 'luxon';

/** Practice-local HMS ("HH:mm" / "HH:mm:ss") → seconds since midnight. */
export function localHmsToSeconds(hms?: string | null): number | undefined {
  if (typeof hms !== 'string') return undefined;
  const s = hms.trim();
  if (!s) return undefined;
  const [hh = 0, mm = 0, ss = 0] = s.split(':').map(Number);
  if ([hh, mm, ss].some((n) => Number.isNaN(n))) return undefined;
  return hh * 3600 + mm * 60 + ss;
}

/** Coerce API overrun fields that may arrive as numeric strings. */
export function coerceOverrunSeconds(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(+raw)) {
    return Math.max(0, Math.floor(+raw));
  }
  return undefined;
}

/**
 * Seconds past scheduled depot end when the doctor returns after shift end.
 * Prefers live `/routing/eta` `backToDepotIso` over search `validationReturnSec`.
 */
export function computeDepotReturnOverrunSeconds(dayData: {
  endDepotTime?: string | null;
  backToDepotIso?: string | null;
  validationReturnSec?: number | null;
  timezone?: string | null;
}): number | null {
  const endSec = localHmsToSeconds(dayData.endDepotTime);
  if (endSec == null) return null;

  let returnSec: number | undefined;
  const backIso = dayData.backToDepotIso?.trim();
  if (backIso) {
    let dt = DateTime.fromISO(backIso);
    if (dt.isValid) {
      const zone = dayData.timezone?.trim();
      if (zone) dt = dt.setZone(zone);
      if (dt.isValid) {
        returnSec = dt.hour * 3600 + dt.minute * 60 + dt.second;
      }
    }
  }
  if (returnSec == null && typeof dayData.validationReturnSec === 'number') {
    if (Number.isFinite(dayData.validationReturnSec)) {
      returnSec = Math.max(0, Math.floor(dayData.validationReturnSec));
    }
  }
  if (returnSec == null) return null;
  return Math.max(0, returnSec - endSec);
}
