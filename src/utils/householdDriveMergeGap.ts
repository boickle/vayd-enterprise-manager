/**
 * Match API `HOUSEHOLD_MERGE_GAP_SEC` (routing-v2 / household-visit-order.util).
 * Multi-pet same stop when the later start is within this gap of the earlier end.
 */
export const HOUSEHOLD_DRIVE_MERGE_GAP_MS = 60 * 60 * 1000;

/** Overlap/touch, or later start within merge gap of earlier end. */
export function scheduledIntervalsClumped(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  mergeGapMs: number = HOUSEHOLD_DRIVE_MERGE_GAP_MS
): boolean {
  if (aStart <= bEnd && bStart <= aEnd) return true;
  const earlierEnd = aStart <= bStart ? aEnd : bEnd;
  const laterStart = aStart <= bStart ? bStart : aStart;
  return laterStart <= earlierEnd + mergeGapMs;
}
