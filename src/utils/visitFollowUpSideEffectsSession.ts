/** Prevent duplicate labs tasks / forward-booking rows when revisiting End Visit. */
export type VisitFollowUpSideEffectKind = 'labs_pending_task' | 'forward_booking_list';

export function followUpSideEffectsSessionKey(
  appointmentIds: readonly number[],
  kind: VisitFollowUpSideEffectKind,
): string {
  const ids = [...new Set(appointmentIds.filter((id) => Number.isFinite(id) && id > 0))].sort(
    (a, b) => a - b,
  );
  return `vayd:visit-follow-up-${kind}:${ids.join(',') || 'none'}`;
}

export function readFollowUpSideEffectsDone(key: string): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function markFollowUpSideEffectsDone(key: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* quota */
  }
}
