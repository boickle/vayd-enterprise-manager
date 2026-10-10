/**
 * A multi-pet Scribe pass produces problem suggestions for housemates whose chart isn't open,
 * and those must not land on the Master Problem List without an Acute/Chronic choice — that is
 * what makes them show under "Chronic problems on record". They're parked here until that pet's
 * tab is opened, where the same review cards the single-pet path uses appear.
 *
 * Read-once by design: accepting or dismissing a card is the doctor's decision; keeping the
 * stash would resurrect rows they already resolved.
 */

export type DeferredScribeProblem = {
  key: string;
  label: string;
  kind: 'presenting_complaint' | 'rule_out' | 'diagnosis';
};

const STORAGE_PREFIX = 'vayd.scribe.deferredProblems.';

function storageKey(encounterId: string): string {
  return `${STORAGE_PREFIX}${encounterId}`;
}

export function stashDeferredProblems(
  encounterId: string,
  items: DeferredScribeProblem[]
): void {
  if (!encounterId || items.length === 0) return;
  try {
    sessionStorage.setItem(storageKey(encounterId), JSON.stringify(items));
  } catch {
    /* private mode / quota — deferring is best-effort */
  }
}

export function takeDeferredProblems(encounterId: string): DeferredScribeProblem[] {
  if (!encounterId) return [];
  try {
    const raw = sessionStorage.getItem(storageKey(encounterId));
    if (!raw) return [];
    sessionStorage.removeItem(storageKey(encounterId));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DeferredScribeProblem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as DeferredScribeProblem).key === 'string' &&
        typeof (item as DeferredScribeProblem).label === 'string' &&
        typeof (item as DeferredScribeProblem).kind === 'string'
    );
  } catch {
    return [];
  }
}
