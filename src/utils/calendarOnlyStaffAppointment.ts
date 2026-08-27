import { isBlockEntry } from '../api/appointments';

/**
 * Staff calendar items that are not part of the geographic route (Note To Staff,
 * exclude-from-routing types, vacation / sick). They stay on the calendar, can be
 * dragged by anyone with calendar access, and must not be treated as drive barriers.
 *
 * Real personal / flex / meeting blocks still constrain routing.
 */
function appointmentTypeName(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  const at = o.appointmentType;
  if (typeof at === 'string') return at;
  if (at && typeof at === 'object') {
    const t = at as { name?: string; prettyName?: string };
    return String(t.prettyName || t.name || '');
  }
  return String(o.typeName ?? o.blockLabel ?? '');
}

function appointmentTypeExcludesFromRouting(a: unknown): boolean {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  if (o.excludeFromRouting === true) return true;
  const at = o.appointmentType;
  if (at && typeof at === 'object' && (at as { excludeFromRouting?: boolean }).excludeFromRouting === true) {
    return true;
  }
  return false;
}

function isHardRoutingBlock(a: unknown): boolean {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  if (o.type === 'block' || o.isBlock === true || o.isPersonalBlock === true) return true;
  return false;
}

export function appointmentIsCalendarOnlyStaffItem(a: unknown): boolean {
  if (isHardRoutingBlock(a)) return false;
  if (appointmentTypeExcludesFromRouting(a)) return true;
  const name = appointmentTypeName(a).trim().toLowerCase();
  if (name.includes('note to staff')) return true;
  if (name === 'vacation' || name === 'sick time') return true;
  return false;
}

/** Personal-block flag for doctor-day household grouping — calendar-only notes are not barriers. */
export function householdPersonalBlockFlag(appt: unknown, groupKey: string): boolean {
  if (appointmentIsCalendarOnlyStaffItem(appt)) return false;
  return isBlockEntry({ ...(appt as { type?: string; isBlock?: boolean; isPersonalBlock?: boolean }), key: groupKey });
}

export function householdCountsAsRouteAddressStop(h: {
  isPersonalBlock?: boolean;
  primary?: unknown;
} | null | undefined): boolean {
  if (!h) return false;
  if (h.isPersonalBlock) return false;
  if (appointmentIsCalendarOnlyStaffItem(h.primary)) return false;
  return true;
}
