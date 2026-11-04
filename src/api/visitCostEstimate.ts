import { http } from './http';

export type VisitCostEstimatePet = {
  name?: string;
  appointmentTypeName: string;
  species?: string;
  weight?: string;
};

export type VisitCostEstimateRequest = {
  practiceId: number;
  zoneName?: string;
  pets: VisitCostEstimatePet[];
};

export type VisitCostEstimateLine = {
  label: string;
  amount: number;
  amountMax: number | null;
  note: string | null;
};

export type VisitCostEstimate = {
  areaLabel: string;
  assumedSouthernPricing: boolean;
  lines: VisitCostEstimateLine[];
  total: number | null;
  totalMax: number | null;
  disclaimer: string;
};

export async function fetchVisitCostEstimate(
  body: VisitCostEstimateRequest,
): Promise<VisitCostEstimate> {
  const { data } = await http.post<VisitCostEstimate>(
    '/public/appointments/visit-cost-estimate',
    body,
  );
  return data;
}

/** Show the estimate only when the chosen visit starts within this many hours. */
export const VISIT_COST_ESTIMATE_WINDOW_HOURS = 48;

/**
 * True when a confirmed slot starts within the next 48 hours.
 * No slot, an unreadable time, or a later visit stays on the original form.
 */
export function isAppointmentWithinCostEstimateWindow(
  slot: { appointmentStart?: string | null } | null | undefined,
  nowMs: number = Date.now(),
  windowHours: number = VISIT_COST_ESTIMATE_WINDOW_HOURS,
): boolean {
  const iso = slot?.appointmentStart?.trim();
  if (!iso) return false;
  const startMs = Date.parse(iso);
  if (!Number.isFinite(startMs)) return false;
  const hoursUntil = (startMs - nowMs) / (60 * 60 * 1000);
  return hoursUntil >= 0 && hoursUntil <= windowHours;
}

export function formatVisitCostAmount(amount: number, amountMax?: number | null): string {
  const format = (value: number) => {
    const cents = Math.round(value * 100) % 100;
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: cents === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
  };
  if (amountMax != null && amountMax !== amount) {
    return `${format(amount)}–${format(amountMax)}`;
  }
  return format(amount);
}
