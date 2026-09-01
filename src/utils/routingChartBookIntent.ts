/**
 * Patient chart → Routing: prefill this household and select this pet.
 * Storage only — startFreshNewAppointmentRouting() clears it before a new write.
 */

export const ROUTING_CHART_BOOK_INTENT_STORAGE_KEY = 'vayd:routing-chart-book-intent-v1';

export type RoutingChartBookIntentV1 = {
  v: 1;
  appliedToRoutingForm?: boolean;
  clientId: string;
  patientId: string;
  clientDisplayLabel?: string;
  patientName?: string;
};

export function readRoutingChartBookIntent(): RoutingChartBookIntentV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROUTING_CHART_BOOK_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as RoutingChartBookIntentV1;
    if (o?.v !== 1 || !String(o.clientId ?? '').trim() || !String(o.patientId ?? '').trim()) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function writeRoutingChartBookIntent(
  next: Omit<RoutingChartBookIntentV1, 'v' | 'appliedToRoutingForm'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: RoutingChartBookIntentV1 = {
    v: 1,
    appliedToRoutingForm: false,
    ...next,
  };
  try {
    sessionStorage.setItem(ROUTING_CHART_BOOK_INTENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
}

export function markChartBookIntentAppliedToRoutingForm(): void {
  const cur = readRoutingChartBookIntent();
  if (!cur) return;
  try {
    sessionStorage.setItem(
      ROUTING_CHART_BOOK_INTENT_STORAGE_KEY,
      JSON.stringify({ ...cur, appliedToRoutingForm: true })
    );
  } catch {
    /* ignore */
  }
}

export function clearRoutingChartBookIntent(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_CHART_BOOK_INTENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
