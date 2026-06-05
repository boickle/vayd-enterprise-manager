export function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/[$,]/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatTs(iso: unknown): string {
  if (typeof iso !== 'string' || !iso.trim()) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function yn(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '—';
}

function strFromScalar(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return pickStr(v);
}

function invoiceLineItems(inv: Record<string, unknown>): unknown[] {
  const raw =
    inv.lineItems ??
    inv.items ??
    inv.details ??
    inv.services ??
    inv.invoiceLines ??
    (inv.lines as unknown);
  return Array.isArray(raw) ? raw : [];
}

export type NormalizedLine = {
  key: string;
  patient: string;
  provider: string;
  productionEmployee: string;
  description: string;
  date: string;
  qty: string;
  unitPrice: number;
  serviceFee: number;
  subtotal: number;
  tax: number;
  total: number;
  complete: boolean;
};

function employeeName(v: unknown): string | null {
  if (typeof v === 'string') return pickStr(v);
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = pickStr(o.name);
  if (name) return name;
  const full = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  return full || null;
}

function firstEmployeeName(sources: unknown[]): string {
  for (const source of sources) {
    const name = employeeName(source);
    if (name) return name;
  }
  return '—';
}

function normalizeLine(row: unknown, idx: number): NormalizedLine | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const pat = o.patient;
  let patient = '—';
  if (typeof pat === 'string') patient = pat;
  else if (pat && typeof pat === 'object') {
    const p = pat as Record<string, unknown>;
    patient =
      pickStr(p.name) ??
      [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() ??
      '—';
  } else {
    patient = pickStr(o.patientName) ?? pickStr(o.petName) ?? '—';
  }
  const provider = firstEmployeeName([
    o.provider,
    o.primaryProvider,
    o.providerName,
    o.doctorName,
  ]);
  const productionEmployee = firstEmployeeName([
    o.productionEmployee,
    o.productionEmployeeName,
  ]);
  const invD = pickStr(o.inventoryDescription);
  const lab = pickStr(o.labName);
  const proc = pickStr(o.procedureName);
  const custom = pickStr(o.customName);
  const description =
    invD ??
    (lab ? `Lab: ${lab}` : null) ??
    proc ??
    custom ??
    pickStr(o.description) ??
    pickStr(o.serviceName) ??
    pickStr(o.name) ??
    pickStr(o.itemDescription) ??
    '—';
  const serviceIso = pickStr(o.serviceDate) ?? pickStr(o.date) ?? pickStr(o.performedDate);
  const date =
    serviceIso && serviceIso.trim()
      ? formatTs(serviceIso)
      : typeof o.createdAt === 'string' && o.createdAt
        ? formatTs(o.createdAt)
        : '—';
  const qtyRaw = o.quantity ?? o.qty ?? 1;
  const qty = typeof qtyRaw === 'number' ? String(qtyRaw) : pickStr(qtyRaw) ?? '1';
  const qtyNum = typeof o.quantity === 'number' ? o.quantity : toNum(o.quantity) ?? 1;
  const unitPrice = toNum(o.price) ?? 0;
  const serviceFee = toNum(o.serviceFee) ?? 0;
  const lineNet = unitPrice * qtyNum + serviceFee;
  const subtotal = toNum(o.subtotal) ?? toNum(o.lineSubtotal) ?? unitPrice * qtyNum;
  const tax = toNum(o.tax) ?? toNum(o.taxAmount) ?? 0;
  const total =
    toNum(o.totalPrice) ??
    toNum(o.lineTotal) ??
    toNum(o.amount) ??
    (Number.isFinite(lineNet + tax) ? lineNet + tax : subtotal + tax);
  const complete = o.complete === true || o.isComplete === true || o.completed === true;
  const id = o.id ?? o.lineItemId ?? idx;
  return {
    key: String(id),
    patient,
    provider,
    productionEmployee,
    description,
    date,
    qty,
    unitPrice,
    serviceFee,
    subtotal,
    tax,
    total,
    complete,
  };
}

export type NormalizedInvoice = {
  key: string;
  number: string;
  date: string;
  status: string;
  createdBy: string;
  total: number;
  paid: number;
  due: number;
  lines: NormalizedLine[];
  /** Original invoice DTO for payments and extra fields in the detail modal. */
  raw: Record<string, unknown>;
};

export function normalizeInvoice(row: unknown, idx: number): NormalizedInvoice | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const number =
    strFromScalar(o.invoiceNumber) ?? strFromScalar(o.number) ?? strFromScalar(o.id) ?? String(idx + 1);
  const dateIso =
    pickStr(o.invoicedDate) ?? pickStr(o.invoiceDate) ?? pickStr(o.date) ?? pickStr(o.createdAt) ?? '';
  const date = dateIso.trim() ? formatTs(dateIso) : '—';
  const status =
    pickStr(o.invoiceStatusName) ?? pickStr(o.invoiceStatus) ?? pickStr(o.status) ?? '—';
  const created = o.createdBy;
  let createdBy = '—';
  if (typeof created === 'string') createdBy = created;
  else if (created && typeof created === 'object') {
    const cr = created as Record<string, unknown>;
    createdBy =
      [pickStr(cr.firstName), pickStr(cr.lastName)].filter(Boolean).join(' ').trim() ||
      pickStr(cr.name) ||
      '—';
  } else {
    createdBy = pickStr(o.createdByName) ?? '—';
  }
  const total = toNum(o.invoiceTotal) ?? toNum(o.total) ?? toNum(o.amount) ?? 0;
  const paid = toNum(o.amountPaid) ?? toNum(o.paid) ?? 0;
  const due = toNum(o.amountDue) ?? toNum(o.balance) ?? Math.max(0, total - paid);
  const rawLines = invoiceLineItems(o);
  const lines = rawLines.map(normalizeLine).filter(Boolean) as NormalizedLine[];
  return {
    key: String(o.id ?? number ?? idx),
    number,
    date,
    status,
    createdBy,
    total,
    paid,
    due,
    lines,
    raw: o,
  };
}

export function extractInvoices(c: Record<string, unknown>): unknown[] {
  if (Array.isArray(c.invoices)) return c.invoices;
  if (Array.isArray(c.openInvoices)) return c.openInvoices;
  if (Array.isArray(c.accountInvoices)) return c.accountInvoices;
  const billing = c.billing;
  if (billing && typeof billing === 'object') {
    const b = billing as Record<string, unknown>;
    if (Array.isArray(b.invoices)) return b.invoices;
    if (Array.isArray(b.openInvoices)) return b.openInvoices;
  }
  return [];
}

export function accountBalanceFromClient(c: Record<string, unknown>): number | null {
  const keys = [
    'accountBalance',
    'balance',
    'openBalance',
    'totalBalance',
    'amountDue',
    'balanceDue',
    'arBalance',
  ];
  for (const k of keys) {
    const n = toNum(c[k]);
    if (n != null) return n;
  }
  const billing = c.billing;
  if (billing && typeof billing === 'object') {
    for (const k of keys) {
      const n = toNum((billing as Record<string, unknown>)[k]);
      if (n != null) return n;
    }
  }
  return null;
}

export function normalizeInvoicesFromClient(c: Record<string, unknown>): NormalizedInvoice[] {
  const raw = extractInvoices(c);
  const out: NormalizedInvoice[] = [];
  for (let i = 0; i < raw.length; i++) {
    const n = normalizeInvoice(raw[i], i);
    if (n) out.push(n);
  }
  return out;
}

function invoicePaymentMatchesPaymentId(
  row: Record<string, unknown>,
  paymentId: number
): boolean {
  const direct = row.paymentId ?? (row.payment as Record<string, unknown> | undefined)?.id;
  if (direct != null && Number(direct) === paymentId) return true;
  return false;
}

const MONEY_EPS = 0.01;

function dateKey(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  return iso.slice(0, 10);
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_EPS;
}

function invoiceAmountCandidates(inv: NormalizedInvoice): number[] {
  const raw = inv.raw;
  const total = inv.total;
  const paid = inv.paid;
  const due = inv.due;
  const amountPaid = toNum(raw.amountPaid);
  return [...new Set([total, paid, due, amountPaid].filter((n): n is number => n != null && Number.isFinite(n)))];
}

function findInvoiceByLinkedPaymentId(
  invoices: NormalizedInvoice[],
  paymentId: number
): NormalizedInvoice | null {
  for (const inv of invoices) {
    const payments = inv.raw.invoicePayments;
    if (!Array.isArray(payments)) continue;
    for (const p of payments) {
      if (p && typeof p === 'object' && invoicePaymentMatchesPaymentId(p as Record<string, unknown>, paymentId)) {
        return inv;
      }
    }
  }
  return null;
}

/** Fallback when invoicePayments is empty or not yet linked to local payment rows. */
function findInvoiceByAmountAndDate(
  invoices: NormalizedInvoice[],
  amount: number,
  paymentDateKey?: string
): NormalizedInvoice | null {
  const amountMatches = invoices.filter((inv) =>
    invoiceAmountCandidates(inv).some((candidate) => amountsMatch(candidate, amount))
  );
  if (amountMatches.length === 0) return null;
  if (amountMatches.length === 1) return amountMatches[0]!;

  if (paymentDateKey) {
    const sameDay = amountMatches.filter(
      (inv) => dateKey(inv.raw.invoicedDate) === paymentDateKey
    );
    if (sameDay.length === 1) return sameDay[0]!;
    if (sameDay.length > 1) {
      return sameDay.sort((a, b) =>
        String(b.raw.invoicedDate ?? '').localeCompare(String(a.raw.invoicedDate ?? ''))
      )[0]!;
    }
  }

  return amountMatches.sort((a, b) =>
    String(b.raw.invoicedDate ?? '').localeCompare(String(a.raw.invoicedDate ?? ''))
  )[0]!;
}

export type PaymentInvoiceLookup = {
  paymentId: number;
  amount?: number;
  /** Calendar day of the payment (YYYY-MM-DD). */
  date?: string;
};

/** Find the invoice for a practice payment (linked row first, then amount/date heuristics). */
export function findInvoiceForPayment(
  client: Record<string, unknown>,
  lookup: PaymentInvoiceLookup
): NormalizedInvoice | null {
  const invoices = normalizeInvoicesFromClient(client);
  const linked = findInvoiceByLinkedPaymentId(invoices, lookup.paymentId);
  if (linked) return linked;

  if (lookup.amount != null && Number.isFinite(lookup.amount)) {
    const paymentDateKey = lookup.date?.slice(0, 10);
    const byAmount = findInvoiceByAmountAndDate(invoices, lookup.amount, paymentDateKey);
    if (byAmount) return byAmount;
  }

  return null;
}

/** @deprecated Use findInvoiceForPayment */
export function findInvoiceForPaymentId(
  client: Record<string, unknown>,
  paymentId: number
): NormalizedInvoice | null {
  return findInvoiceForPayment(client, { paymentId });
}
