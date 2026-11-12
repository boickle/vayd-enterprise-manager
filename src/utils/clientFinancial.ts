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

/**
 * The eVet part of the balance, without eVet invoices Scout has taken over.
 *
 * `evetBalance` comes from the client record loaded with the page, and the API leaves taken-over
 * invoices out of it. Right after "Edit in Scout" the page still holds the older record, so the
 * invoice's balance sits in that figure and again in the new Scout invoice. `evetInvoices` must be
 * the list that arrived with `evetBalance` (not a later reload): when the record is refreshed the
 * taken-over invoice is gone from both and nothing is taken off twice.
 */
export function evetBalanceWithoutAdopted(
  evetBalance: number | null | undefined,
  evetInvoices: { status: string; due: number; raw: Record<string, unknown> }[],
  adoptedEvetIds: ReadonlySet<number>,
): number {
  let balance = evetBalance ?? 0;
  if (adoptedEvetIds.size === 0) return balance;
  for (const inv of evetInvoices) {
    const id = Number(inv.raw.id);
    if (!Number.isFinite(id) || !adoptedEvetIds.has(id)) continue;
    const status = String(inv.status).toLowerCase();
    if (inv.raw.isDeleted === true || status === 'void' || status === 'deleted') continue;
    if (inv.due > 0.005) balance -= inv.due;
  }
  return Math.round(balance * 100) / 100;
}
