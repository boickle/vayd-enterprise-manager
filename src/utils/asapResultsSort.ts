/**
 * ASAP All Doctors In Zone Search result ordering.
 * Score (lower is better) is the preferred default; staff can toggle to earliest-first.
 */

export type AsapResultsSortMode = 'datetime' | 'score';

/** Default when an ASAP search starts or the sort toggle is first shown. */
export const ASAP_RESULTS_SORT_MODE_PREFERRED: AsapResultsSortMode = 'score';

export function resolveAsapResultsSortComparatorKind(
  resultsSortedByDateTime: boolean,
  asapResultsSortMode: AsapResultsSortMode
): 'datetime' | 'score' {
  return resultsSortedByDateTime && asapResultsSortMode === 'datetime' ? 'datetime' : 'score';
}

export function toggleAsapResultsSortMode(mode: AsapResultsSortMode): AsapResultsSortMode {
  return mode === 'datetime' ? 'score' : 'datetime';
}

export function asapResultsHeading(args: {
  hasResult: boolean;
  resultsSortedByDateTime: boolean;
  asapResultsSortMode: AsapResultsSortMode;
  hasActiveRescheduleIntent: boolean;
}): string {
  if (!args.hasResult) return 'Results';
  if (args.resultsSortedByDateTime) {
    return resolveAsapResultsSortComparatorKind(
      args.resultsSortedByDateTime,
      args.asapResultsSortMode
    ) === 'datetime'
      ? 'Results (earliest first)'
      : 'Results (lower score is better)';
  }
  if (args.hasActiveRescheduleIntent) {
    return 'Results (lower score is better — vs. original booking)';
  }
  return 'Results (lower score is better)';
}

export function asapResultsSortToggleLabel(mode: AsapResultsSortMode): string {
  return mode === 'datetime' ? 'Sort by Score (Preferred)' : 'Sort by Date & Time';
}
