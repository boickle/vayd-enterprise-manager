import type { EtaRequestCandidateSlot } from '../api/routing';

export type RoutingEtaCandidateSlotSource = {
  insertionIndex?: number | null;
  positionInDay?: number | null;
  suggestedStartIso?: string | null;
  lat?: number | null;
  lon?: number | null;
  serviceMinutes?: number | null;
  overrunSeconds?: number | null;
  validationLastEtdSec?: number | null;
  validationReturnSec?: number | null;
  arrivalWindow?: {
    windowStartIso?: string | null;
    windowEndIso?: string | null;
  } | null;
};

function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(+v)) return +v;
  return undefined;
}

function resolveInsertionIndex(
  raw: unknown,
  householdCount: number | undefined
): number {
  const maxIdx =
    householdCount != null && householdCount > 0 ? householdCount - 1 : Number.MAX_SAFE_INTEGER;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(maxIdx, Math.floor(raw)));
  }
  if (raw != null) {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n)) return Math.max(0, Math.min(maxIdx, n || 0));
  }
  return householdCount != null && householdCount > 0 ? maxIdx : 0;
}

/** 0-based insert index for visit-order households (existing stops only). */
export function resolveRoutingEtaInsertionIndex(
  raw: unknown,
  householdCount: number
): number {
  return resolveInsertionIndex(raw, householdCount);
}

/**
 * Slot-search `insertionIndex` / `positionInDay` count routable client stops only.
 * Meetings, personal blocks, and other non-route calendar rows are excluded from that
 * count but still appear in doctor-day / ETA household lists — map before inserting.
 */
export function householdCountsForRoutingInsertionIndex(h: {
  isPreview?: boolean;
  isPersonalBlock?: boolean;
}): boolean {
  if (h.isPreview) return false;
  if (h.isPersonalBlock) return false;
  return true;
}

/**
 * Map a routable-relative insertion index onto a full existing-stop list that may
 * include leading/trailing meetings and personal blocks.
 *
 * Example: existing `[Meeting, Dostie, Seaver]`, slot-search last-of-day index `2`
 * (Visit #3 among two client stops) → full index `3` (after Seaver), not `2`
 * (which would incorrectly place the candidate before Seaver).
 */
export function mapRoutableInsertionIndexToFullIndex<T>(
  existing: T[],
  insertionIndex: unknown,
  counts: (item: T) => boolean = householdCountsForRoutingInsertionIndex as (item: T) => boolean
): number {
  const n = existing.length;
  if (n === 0) return 0;

  const raw = finiteNumber(insertionIndex);
  const desired = raw !== undefined ? Math.max(0, Math.floor(raw)) : 0;

  const routableIdxs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (counts(existing[i]!)) routableIdxs.push(i);
  }

  if (routableIdxs.length === 0) {
    return Math.max(0, Math.min(n, desired));
  }

  const amongRoutable = Math.max(0, Math.min(routableIdxs.length, desired));
  if (amongRoutable >= routableIdxs.length) {
    // After the last routable stop (keeps any trailing blocks after the candidate).
    return routableIdxs[routableIdxs.length - 1]! + 1;
  }
  return routableIdxs[amongRoutable]!;
}

/**
 * Build POST /routing/eta `candidateSlot` from a selected routing result card so
 * computeEtasForDay matches slot-search placement (not PIMS startIso times alone).
 *
 * By default we do **not** forward slot-search `overrunSeconds` /
 * `validationReturnSec` / `validationLastEtdSec`. Pinning those made View Placement
 * paint the optimistic search return-to-depot, while post-book `/routing/eta` (no
 * pins) could show much larger overflow on the schedule.
 */
export function buildEtaCandidateSlot(
  source: RoutingEtaCandidateSlotSource,
  opts?: {
    householdCount?: number;
    defaultServiceMinutes?: number;
    /** When true, forward search validation pins (legacy; prefer live ETA). */
    pinSearchValidation?: boolean;
  }
): EtaRequestCandidateSlot | undefined {
  const lat = finiteNumber(source.lat);
  const lon = finiteNumber(source.lon);
  if (lat === undefined || lon === undefined) return undefined;

  const suggestedStartIso = String(source.suggestedStartIso ?? '').trim();
  if (!suggestedStartIso) return undefined;

  const insertionIndex = resolveInsertionIndex(source.insertionIndex, opts?.householdCount);
  const pd = source.positionInDay;
  const positionInDay =
    typeof pd === 'number' && Number.isFinite(pd)
      ? Math.floor(pd)
      : pd != null && Number.isFinite(Number(pd))
        ? Math.floor(Number(pd)) || insertionIndex + 1
        : insertionIndex + 1;

  const slot: EtaRequestCandidateSlot = {
    insertionIndex,
    positionInDay,
    suggestedStartIso,
    lat,
    lon,
    serviceMinutes: Math.max(
      1,
      Math.floor(finiteNumber(source.serviceMinutes) ?? opts?.defaultServiceMinutes ?? 30)
    ),
  };

  if (opts?.pinSearchValidation) {
    const overrunSeconds = finiteNumber(source.overrunSeconds);
    if (overrunSeconds !== undefined) slot.overrunSeconds = overrunSeconds;

    const validationLastEtdSec = finiteNumber(source.validationLastEtdSec);
    if (validationLastEtdSec !== undefined) slot.validationLastEtdSec = validationLastEtdSec;

    const validationReturnSec = finiteNumber(source.validationReturnSec);
    if (validationReturnSec !== undefined) slot.validationReturnSec = validationReturnSec;
  }

  const aw = source.arrivalWindow;
  if (aw?.windowStartIso && aw?.windowEndIso) {
    slot.arrivalWindow = {
      windowStartIso: aw.windowStartIso,
      windowEndIso: aw.windowEndIso,
    };
  }

  return slot;
}

/**
 * Existing households first (by `firstApptIndex`), candidate preview inserted at the
 * slot-search index mapped across personal blocks / meetings.
 */
export function orderHouseholdsWithCandidateAtInsertion<
  T extends { isPreview?: boolean; firstApptIndex?: number; isPersonalBlock?: boolean },
>(households: T[], insertionIndex: unknown): T[] {
  const existing = households.filter((h) => !h.isPreview);
  const virtualH = households.find((h) => h.isPreview);
  const sortedExisting = [...existing].sort(
    (a, b) => (a.firstApptIndex ?? 999) - (b.firstApptIndex ?? 999)
  );
  const fullIns = mapRoutableInsertionIndexToFullIndex(sortedExisting, insertionIndex);
  return virtualH != null
    ? [...sortedExisting.slice(0, fullIns), virtualH, ...sortedExisting.slice(fullIns)]
    : sortedExisting;
}

/** Index of the preview household in visit order (for `candidateSlot.insertionIndex`). */
export function routingEtaCandidateInsertionIndexInOrder<T extends { isPreview?: boolean }>(
  orderedHouseholds: T[],
  fallback: unknown = 0
): number {
  const idx = orderedHouseholds.findIndex((h) => h.isPreview);
  if (idx >= 0) return idx;
  const n = finiteNumber(fallback);
  return n !== undefined ? Math.max(0, Math.floor(n)) : 0;
}
