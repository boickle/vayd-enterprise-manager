import type { EstimateVisitChoice, VisitEstimate } from '../../api/visitEstimates';

export const estimateMoney = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

const when = (iso: string | null | undefined, withTime: boolean) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    weekday: withTime ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
};

/** "Thu, Nov 6, 10:00 AM · Juniper · Dental · Avery Lane" */
export function formatVisitChoice(v: EstimateVisitChoice): string {
  return [when(v.start, true), v.patientName, v.appointmentTypeName, v.providerName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}

/** "Estimate #14 · Nov 5 · Maple, Juniper" */
export function estimateHeading(e: VisitEstimate): string {
  const pets = [...new Set((e.lines ?? []).map((l) => l.patientName?.trim()).filter(Boolean))];
  return [
    e.estimateNumber != null ? `Estimate #${e.estimateNumber}` : 'Estimate',
    e.title?.trim() || null,
    when(e.created, false),
    pets.join(', ') || null,
  ]
    .filter(Boolean)
    .join(' · ');
}
