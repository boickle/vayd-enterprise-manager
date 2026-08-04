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

/** Existing households first, candidate preview at `insertionIndex` (matches My Week / scheduler). */
export function orderHouseholdsWithCandidateAtInsertion<
  T extends { isPreview?: boolean; firstApptIndex?: number },
>(households: T[], insertionIndex: number): T[] {
  const existing = households.filter((h) => !h.isPreview);
  const virtualH = households.find((h) => h.isPreview);
  const sortedExisting = [...existing].sort(
    (a, b) => (a.firstApptIndex ?? 999) - (b.firstApptIndex ?? 999)
  );
  const ins = Math.max(0, Math.min(sortedExisting.length, insertionIndex));
  return virtualH != null
    ? [...sortedExisting.slice(0, ins), virtualH, ...sortedExisting.slice(ins)]
    : sortedExisting;
}
