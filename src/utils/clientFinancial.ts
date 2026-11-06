export type FinancialRefillPrefill = {
  name: string;
  qty: number;
  instructions: string;
  catalogItemId?: number | null;
  unitPrice?: number | null;
};

const PREFILL_KEY = 'scout.financial.prefill';

export function buildClientFinancialHref(opts: {
  clientId: string | number;
  invoice?: 'new' | string;
  patientId?: string | number | null;
  appointmentId?: string | number | null;
}): string {
  const q = new URLSearchParams();
  q.set('clientId', String(opts.clientId));
  q.set('tab', 'financial');
  if (opts.invoice) q.set('invoice', String(opts.invoice));
  if (opts.patientId != null && String(opts.patientId) !== '') {
    q.set('patientId', String(opts.patientId));
  }
  if (opts.appointmentId != null && String(opts.appointmentId) !== '') {
    q.set('appointmentId', String(opts.appointmentId));
  }
  return `/schedule/clients?${q.toString()}`;
}

export function writeFinancialPrefill(prefill: FinancialRefillPrefill | null): void {
  try {
    if (!prefill) sessionStorage.removeItem(PREFILL_KEY);
    else sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readFinancialPrefill(): FinancialRefillPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILL_KEY);
    const parsed = JSON.parse(raw) as FinancialRefillPrefill;
    if (!parsed?.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function scoutArFromInvoices(
  invoices: { status: string; total: number; amountPaid: number; isDeleted?: boolean }[]
): number {
  return invoices.reduce((sum, inv) => {
    if (inv.isDeleted === true || inv.status === 'void') return sum;
    return sum + (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
  }, 0);
}

export function combinedAccountBalance(
  evetBalance: number | null,
  scoutInvoices: { status: string; total: number; amountPaid: number }[]
): number | null {
  const scout = scoutArFromInvoices(scoutInvoices);
  if (evetBalance == null && scout === 0) return null;
  return (evetBalance ?? 0) + scout;
}
