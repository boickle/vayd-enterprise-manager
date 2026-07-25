import { DateTime } from 'luxon';
import type { HoldListItem } from '../api/holds';
import { resolveHoldPatientLabel } from './holdsDisplay';

/** Holds sharing one calendar visit window (same client, same day, overlapping slot). */
export type HoldVisitSlotGroup = {
  key: string;
  holds: HoldListItem[];
  anchor: HoldListItem;
};

/** All holds for one client (any scheduled date), split into visit slots. */
export type HoldHouseholdGroup = {
  key: string;
  holds: HoldListItem[];
  visitSlots: HoldVisitSlotGroup[];
  /** Earliest scheduled hold — used for sort order and outreach defaults. */
  anchor: HoldListItem;
};

function holdClientId(h: HoldListItem): string | null {
  const id = h.client?.id;
  if (id == null) return null;
  return String(id);
}

function holdClientLabel(h: HoldListItem): string {
  if (!h.client) return '';
  return `${h.client.firstName ?? ''} ${h.client.lastName ?? ''}`.trim();
}

function samePracticeDay(isoA: string, isoB: string, practiceTz: string): boolean {
  const a = DateTime.fromISO(isoA, { zone: 'utc' }).setZone(practiceTz);
  const b = DateTime.fromISO(isoB, { zone: 'utc' }).setZone(practiceTz);
  if (!a.isValid || !b.isValid) return false;
  return a.toISODate() === b.toISODate();
}

function holdInterval(h: HoldListItem): { start: number; end: number } | null {
  const startIso = h.appointmentStart;
  const endIso = h.appointmentEnd;
  if (!startIso?.trim() || !endIso?.trim()) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function intervalsClumped(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Same client, same day, overlapping or touching appointment windows. */
function holdsInClientVisitClump(
  anchor: HoldListItem,
  allHolds: readonly HoldListItem[],
  practiceTz: string
): HoldListItem[] {
  const clientId = holdClientId(anchor);
  const anchorStart = anchor.appointmentStart;
  if (clientId == null || !anchorStart?.trim()) return [anchor];

  const candidates = allHolds.filter((h) => {
    if (h.allDay) return false;
    if (holdClientId(h) !== clientId) return false;
    if (!h.appointmentStart?.trim()) return false;
    return samePracticeDay(h.appointmentStart, anchorStart, practiceTz);
  });

  const list = candidates.some((h) => h.id === anchor.id) ? candidates : [...candidates, anchor];
  const anchorIv = holdInterval(anchor);
  if (!anchorIv) return [anchor];

  const intervals = new Map<number, { start: number; end: number }>();
  for (const h of list) {
    const iv = holdInterval(h);
    if (iv) intervals.set(h.id, iv);
  }

  const cluster = new Set<number>([anchor.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const h of list) {
      if (cluster.has(h.id)) continue;
      const iv = intervals.get(h.id);
      if (!iv) continue;
      for (const memberId of cluster) {
        const memberIv = intervals.get(memberId);
        if (!memberIv) continue;
        if (intervalsClumped(iv.start, iv.end, memberIv.start, memberIv.end)) {
          cluster.add(h.id);
          grew = true;
          break;
        }
      }
    }
  }

  const clump = list.filter((h) => cluster.has(h.id));
  return clump.length > 0 ? clump : [anchor];
}

/** Same start/end when client is not linked yet (online holds). */
function holdsInSameCalendarSlot(
  anchor: HoldListItem,
  allHolds: readonly HoldListItem[],
  practiceTz: string
): HoldListItem[] {
  const anchorStart = anchor.appointmentStart;
  const anchorEnd = anchor.appointmentEnd;
  if (!anchorStart?.trim() || !anchorEnd?.trim()) return [anchor];

  const clientLabel = holdClientLabel(anchor).toLowerCase();
  const matches = allHolds.filter((h) => {
    if (h.allDay) return false;
    if (!h.appointmentStart?.trim() || !h.appointmentEnd?.trim()) return false;
    if (!samePracticeDay(h.appointmentStart, anchorStart, practiceTz)) return false;
    if (h.appointmentStart !== anchorStart || h.appointmentEnd !== anchorEnd) return false;
    if (clientLabel) {
      const hay = `${h.description ?? ''} ${h.instructions ?? ''}`.toLowerCase();
      if (!hay.includes(clientLabel)) return false;
    }
    return true;
  });

  const list = matches.some((h) => h.id === anchor.id) ? matches : [...matches, anchor];
  return list.length > 0 ? list : [anchor];
}

function resolveHoldVisitClump(
  anchor: HoldListItem,
  allHolds: readonly HoldListItem[],
  practiceTz: string
): HoldListItem[] {
  const byClient = holdsInClientVisitClump(anchor, allHolds, practiceTz);
  if (byClient.length > 1) return byClient;

  const bySlot = holdsInSameCalendarSlot(anchor, allHolds, practiceTz);
  if (bySlot.length > 1) return bySlot;

  return byClient.length > 0 ? byClient : [anchor];
}

function sortHoldsForDisplay(a: HoldListItem, b: HoldListItem): number {
  return (
    (a.appointmentStart ?? '').localeCompare(b.appointmentStart ?? '') ||
    holdClientLabel(a).localeCompare(holdClientLabel(b), undefined, { sensitivity: 'base' }) ||
    a.id - b.id
  );
}

export function groupHoldsIntoVisitSlots(
  holds: readonly HoldListItem[],
  practiceTz: string
): HoldVisitSlotGroup[] {
  const sorted = [...holds].sort(sortHoldsForDisplay);
  const assigned = new Set<number>();
  const slots: HoldVisitSlotGroup[] = [];

  for (const anchor of sorted) {
    if (assigned.has(anchor.id)) continue;
    const clump = resolveHoldVisitClump(anchor, sorted, practiceTz);
    for (const h of clump) assigned.add(h.id);
    const ordered = [...clump].sort((a, b) => a.id - b.id);
    slots.push({
      key: ordered.map((h) => h.id).join('-'),
      holds: ordered,
      anchor: ordered[0]!,
    });
  }

  return slots;
}

/**
 * Group holds by linked client (all dates combined). Unlinked holds stay grouped
 * by same-day visit clump only.
 */
export function groupHoldsByClientHousehold(
  holds: readonly HoldListItem[],
  practiceTz: string
): HoldHouseholdGroup[] {
  const sorted = [...holds].sort(sortHoldsForDisplay);
  const byClient = new Map<string, HoldListItem[]>();
  const unlinked: HoldListItem[] = [];

  for (const h of sorted) {
    const cid = holdClientId(h);
    if (cid) {
      const list = byClient.get(cid) ?? [];
      list.push(h);
      byClient.set(cid, list);
    } else {
      unlinked.push(h);
    }
  }

  const groups: HoldHouseholdGroup[] = [];

  for (const [cid, clientHolds] of byClient) {
    const ordered = [...clientHolds].sort(sortHoldsForDisplay);
    const visitSlots = groupHoldsIntoVisitSlots(ordered, practiceTz);
    groups.push({
      key: `client:${cid}`,
      holds: ordered,
      visitSlots,
      anchor: ordered[0]!,
    });
  }

  const unlinkedAssigned = new Set<number>();
  for (const anchor of unlinked) {
    if (unlinkedAssigned.has(anchor.id)) continue;
    const clump = resolveHoldVisitClump(anchor, unlinked, practiceTz);
    for (const h of clump) unlinkedAssigned.add(h.id);
    const ordered = [...clump].sort((a, b) => a.id - b.id);
    groups.push({
      key: `unlinked:${ordered.map((h) => h.id).join('-')}`,
      holds: ordered,
      visitSlots: [
        {
          key: ordered.map((h) => h.id).join('-'),
          holds: ordered,
          anchor: ordered[0]!,
        },
      ],
      anchor: ordered[0]!,
    });
  }

  groups.sort((a, b) => sortHoldsForDisplay(a.anchor, b.anchor));
  return groups;
}

/** @deprecated Use groupHoldsByClientHousehold — kept for imports during transition. */
export function groupHoldsByHouseholdVisit(
  holds: readonly HoldListItem[],
  practiceTz: string
): HoldHouseholdGroup[] {
  return groupHoldsByClientHousehold(holds, practiceTz);
}

export function holdHouseholdPatientNames(holds: readonly HoldListItem[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const h of holds) {
    const name = resolveHoldPatientLabel(h);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function holdHouseholdUniqueNotes(holds: readonly HoldListItem[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of holds) {
    const note = (h.description || h.forwardBooking?.bookingNotes || '').trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

export function holdHouseholdEarliestPlacedAt(
  holds: readonly HoldListItem[]
): string | null {
  let best: string | null = null;
  for (const h of holds) {
    const iso = h.holdPlacedAtIso;
    if (!iso) continue;
    if (best == null || iso.localeCompare(best) < 0) best = iso;
  }
  return best;
}

export function holdHouseholdAnyStale(holds: readonly HoldListItem[]): boolean {
  const now = DateTime.utc();
  return holds.some((h) => {
    if (!h.holdPlacedAtIso) return false;
    const dt = DateTime.fromISO(h.holdPlacedAtIso, { zone: 'utc' });
    if (!dt.isValid) return false;
    return now.diff(dt, 'hours').hours > 24;
  });
}

/** Mon–Fri calendar days from `fromDay` up to (but not including) `toDay`. Same day → 0. */
export function businessDaysBetween(fromDay: DateTime, toDay: DateTime): number {
  const from = fromDay.startOf('day');
  const to = toDay.startOf('day');
  if (!from.isValid || !to.isValid) return Number.NaN;
  if (to < from) return Number.NaN;
  if (to.equals(from)) return 0;

  let count = 0;
  let cursor = from;
  while (cursor < to) {
    cursor = cursor.plus({ days: 1 });
    if (cursor.weekday <= 5) count++;
  }
  return count;
}

export function holdBusinessDaysUntilAppointment(
  hold: HoldListItem,
  practiceTz: string,
  now: DateTime = DateTime.now()
): number | null {
  const start = hold.appointmentStart?.trim();
  if (!start) return null;
  const apptDay = DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz);
  if (!apptDay.isValid) return null;
  const days = businessDaysBetween(now.setZone(practiceTz), apptDay);
  return Number.isFinite(days) ? days : null;
}

export function holdIsWithin3BusinessDays(
  hold: HoldListItem,
  practiceTz: string,
  now: DateTime = DateTime.now()
): boolean {
  const days = holdBusinessDaysUntilAppointment(hold, practiceTz, now);
  return days != null && days <= 3;
}

export function holdHouseholdWithin3BusinessDays(
  holds: readonly HoldListItem[],
  practiceTz: string,
  now: DateTime = DateTime.now()
): boolean {
  return holds.some((h) => holdIsWithin3BusinessDays(h, practiceTz, now));
}

export function holdHouseholdMinBusinessDaysUntil(
  holds: readonly HoldListItem[],
  practiceTz: string,
  now: DateTime = DateTime.now()
): number | null {
  let best: number | null = null;
  for (const h of holds) {
    const days = holdBusinessDaysUntilAppointment(h, practiceTz, now);
    if (days == null) continue;
    if (best == null || days < best) best = days;
  }
  return best;
}

export function holdHouseholdEarliestAppointmentStart(
  holds: readonly HoldListItem[]
): string | null {
  let best: string | null = null;
  for (const h of holds) {
    const iso = h.appointmentStart?.trim();
    if (!iso) continue;
    if (best == null || iso.localeCompare(best) < 0) best = iso;
  }
  return best;
}

/** Earliest scheduled appointment first (household anchor / earliest hold in the group). */
export function sortHoldHouseholdGroupsByAppointmentStart(
  groups: HoldHouseholdGroup[],
): HoldHouseholdGroup[] {
  return [...groups].sort((a, b) => {
    const aStart =
      holdHouseholdEarliestAppointmentStart(a.holds) ?? a.anchor.appointmentStart ?? '';
    const bStart =
      holdHouseholdEarliestAppointmentStart(b.holds) ?? b.anchor.appointmentStart ?? '';
    return (
      aStart.localeCompare(bStart) ||
      holdClientLabel(a.anchor).localeCompare(holdClientLabel(b.anchor), undefined, {
        sensitivity: 'base',
      }) ||
      a.anchor.id - b.anchor.id
    );
  });
}

/** @deprecated Prefer {@link sortHoldHouseholdGroupsByAppointmentStart}. */
export function sortHoldHouseholdGroupsByPriority(
  groups: HoldHouseholdGroup[],
  _practiceTz?: string,
  _now?: DateTime,
): HoldHouseholdGroup[] {
  return sortHoldHouseholdGroupsByAppointmentStart(groups);
}

export function holdHouseholdOwnerIsCurrentUser(holds: readonly HoldListItem[]): boolean {
  return holds.length > 0 && holds.every((h) => h.ownerIsCurrentUser);
}

export function holdHouseholdSharedOwnerLabel(
  holds: readonly HoldListItem[],
  ownerChip: (h: HoldListItem) => { label: string; color: 'success' | 'warning' | 'default' }
): { label: string; color: 'success' | 'warning' | 'default' } {
  if (holds.length === 0) return { label: 'Unassigned', color: 'default' };
  const first = ownerChip(holds[0]!);
  const allSame = holds.every((h) => ownerChip(h).label === first.label);
  if (allSame) return first;
  return { label: 'Mixed ownership', color: 'warning' };
}

export function holdHouseholdSharedSource(holds: readonly HoldListItem[]): HoldListItem['source'] | 'mixed' {
  if (holds.length === 0) return 'manual';
  const first = holds[0]!.source;
  return holds.every((h) => h.source === first) ? first : 'mixed';
}

/** Minimal card snapshot for exit animation when the hold no longer appears in GET /holds. */
export function buildHoldExitSnapshotGroup(
  appointmentIds: number[],
  clientLabel: string | null,
  groupKey?: string | null,
  snapshotMeta?: {
    appointmentStart?: string | null;
    holdPlacedAtIso?: string | null;
  },
): HoldHouseholdGroup {
  const id = appointmentIds[0] ?? 0;
  const anchor: HoldListItem = {
    id,
    appointmentStart: snapshotMeta?.appointmentStart ?? null,
    appointmentEnd: null,
    allDay: false,
    holdPlacedAtIso: snapshotMeta?.holdPlacedAtIso ?? null,
    appointmentType: null,
    client: null,
    patient: null,
    primaryProvider: null,
    createdByEmployee: null,
    holdOwner: null,
    holdOwnerAssignedAt: null,
    ownerBucket: 'unassigned',
    effectiveOwnerEmployeeId: null,
    ownerIsCurrentUser: false,
    source: 'manual',
    description: clientLabel ? `Online Booking - ${clientLabel}` : null,
    instructions: null,
    pimsId: null,
    appointmentRequestSubmissionId: null,
    forwardBooking: null,
  };
  return {
    key: groupKey?.trim() || `exit:${appointmentIds.join('-')}`,
    holds: [anchor],
    visitSlots: [{ key: String(id), holds: [anchor], anchor }],
    anchor,
  };
}
