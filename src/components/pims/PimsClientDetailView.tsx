import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  FileText,
  Wallet,
  Mail,
  Printer,
  UserPlus,
} from 'lucide-react';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import './PimsClientDetailView.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string' || typeof item === 'number') {
        const s = String(item).trim();
        if (s) out.push(s);
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const line =
          pickStr(o.phone) ??
          pickStr(o.number) ??
          pickStr(o.email) ??
          pickStr(o.label) ??
          pickStr(o.name);
        if (line) out.push(line);
      }
    }
    return out;
  }
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return [];
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/[$,]/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function primaryPhone(c: Record<string, unknown>): string | null {
  const list = readList(c.phones ?? c.phoneNumbers ?? c.phone ?? c.mobilePhone ?? c.homePhone);
  if (list.length) return list[0];
  return pickStr(c.phone) ?? pickStr(c.mobilePhone) ?? pickStr(c.homePhone);
}

function accountBalance(c: Record<string, unknown>): number | null {
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

function extractInvoices(c: Record<string, unknown>): unknown[] {
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

type NormalizedLine = {
  key: string;
  patient: string;
  provider: string;
  description: string;
  date: string;
  qty: string;
  subtotal: number;
  tax: number;
  total: number;
  complete: boolean;
};

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
  const prov = o.provider;
  let provider = '—';
  if (typeof prov === 'string') provider = prov;
  else if (prov && typeof prov === 'object') {
    provider =
      pickStr((prov as Record<string, unknown>).name) ??
      [
        pickStr((prov as Record<string, unknown>).firstName),
        pickStr((prov as Record<string, unknown>).lastName),
      ]
        .filter(Boolean)
        .join(' ')
        .trim() ??
      '—';
  } else {
    provider = pickStr(o.providerName) ?? pickStr(o.doctorName) ?? '—';
  }
  const description =
    pickStr(o.description) ?? pickStr(o.serviceName) ?? pickStr(o.name) ?? pickStr(o.itemDescription) ?? '—';
  const date =
    pickStr(o.serviceDate) ??
    pickStr(o.date) ??
    pickStr(o.performedDate) ??
    (typeof o.createdAt === 'string' ? o.createdAt.slice(0, 10) : '') ??
    '—';
  const qtyRaw = o.quantity ?? o.qty ?? 1;
  const qty = typeof qtyRaw === 'number' ? String(qtyRaw) : pickStr(qtyRaw) ?? '1';
  const subtotal = toNum(o.subtotal) ?? toNum(o.lineSubtotal) ?? toNum(o.amount) ?? 0;
  const tax = toNum(o.tax) ?? toNum(o.taxAmount) ?? 0;
  const total = toNum(o.total) ?? toNum(o.lineTotal) ?? toNum(o.amount) ?? subtotal + tax;
  const complete = o.complete === true || o.isComplete === true || o.completed === true;
  const id = o.id ?? o.lineItemId ?? idx;
  return {
    key: String(id),
    patient,
    provider,
    description,
    date,
    qty,
    subtotal,
    tax,
    total,
    complete,
  };
}

type NormalizedInvoice = {
  key: string;
  number: string;
  date: string;
  status: string;
  createdBy: string;
  total: number;
  paid: number;
  due: number;
  lines: NormalizedLine[];
};

function normalizeInvoice(row: unknown, idx: number): NormalizedInvoice | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const number =
    pickStr(o.invoiceNumber) ?? pickStr(o.number) ?? pickStr(o.id) ?? String(idx + 1);
  const date =
    pickStr(o.invoiceDate) ?? pickStr(o.date) ?? pickStr(o.createdAt)?.slice(0, 10) ?? '—';
  const status = pickStr(o.status) ?? pickStr(o.invoiceStatus) ?? '—';
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
  };
}

function displayName(c: Record<string, unknown>): string {
  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const both = [fn, ln].filter(Boolean).join(' ');
  return both || `Client #${pickStr(c.id) ?? ''}`;
}

type Props = {
  clientId: string;
  onBack: () => void;
};

export default function PimsClientDetailView({ clientId, onBack }: Props) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openLogin, setOpenLogin] = useState(false);
  const [openGeneral, setOpenGeneral] = useState(false);
  const [openAccount, setOpenAccount] = useState(true);
  const [confirmInfo, setConfirmInfo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    (async () => {
      try {
        const data = await fetchClientByIdStaff(clientId);
        if (cancelled) return;
        if (data && typeof data === 'object') setPayload(data as Record<string, unknown>);
        else setError('Client not found.');
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load client.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const balance = payload ? accountBalance(payload) : null;
  const phone = payload ? primaryPhone(payload) : null;
  const name = payload ? displayName(payload) : '';

  const invoices = useMemo((): NormalizedInvoice[] => {
    if (!payload) return [];
    const raw = extractInvoices(payload);
    const out: NormalizedInvoice[] = [];
    for (let i = 0; i < raw.length; i++) {
      const n = normalizeInvoice(raw[i], i);
      if (n) out.push(n);
    }
    return out;
  }, [payload]);

  const collapseAll = useCallback(() => {
    setOpenLogin(false);
    setOpenGeneral(false);
    setOpenAccount(false);
  }, []);

  if (loading) {
    return <div className="pims-client-detail__loading">Loading client…</div>;
  }

  if (error || !payload) {
    return (
      <div className="pims-client-detail">
        <div className="pims-client-detail__error">{error ?? 'Client not found.'}</div>
        <button type="button" className="pims-client-detail__link" onClick={onBack}>
          Back to List
        </button>
      </div>
    );
  }

  const summaryParts = [name];
  if (phone) summaryParts.push(`C: ${phone}`);
  if (balance != null) summaryParts.push(formatUsd(balance));

  return (
    <div className="pims-client-detail">
      <div className="pims-client-detail__banner">
        <div className="pims-client-detail__banner-actions" aria-hidden>
          <button type="button" className="pims-client-detail__icon-btn" title="Email">
            <Mail size={18} />
          </button>
          <button type="button" className="pims-client-detail__icon-btn" title="Print">
            <Printer size={18} />
          </button>
          <button type="button" className="pims-client-detail__icon-btn" title="Add">
            <UserPlus size={18} />
          </button>
        </div>
        <div className="pims-client-detail__summary">{summaryParts.join(' - ')}</div>
        <div className="pims-client-detail__banner-links">
          <button type="button" className="pims-client-detail__link" onClick={onBack}>
            Back to List
          </button>
          <button type="button" className="pims-client-detail__link" onClick={collapseAll}>
            Collapse All
          </button>
        </div>
        <label className="pims-client-detail__confirm">
          <input type="checkbox" checked={confirmInfo} onChange={(e) => setConfirmInfo(e.target.checked)} />
          Confirm Information?
        </label>
      </div>

      <div className="pims-client-detail__section">
        <button
          type="button"
          className="pims-client-detail__section-head"
          onClick={() => setOpenLogin((o) => !o)}
          aria-expanded={openLogin}
        >
          {openLogin ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <KeyRound size={18} />
          Login Information
        </button>
        {openLogin && (
          <div className="pims-client-detail__section-body">
            {pickStr(payload.portalEmail) || pickStr(payload.email) ? (
              <p>Portal / login fields will appear here when the API exposes them.</p>
            ) : (
              <p className="pims-client-detail__muted">No login information returned.</p>
            )}
          </div>
        )}
      </div>

      <div className="pims-client-detail__section">
        <button
          type="button"
          className="pims-client-detail__section-head"
          onClick={() => setOpenGeneral((o) => !o)}
          aria-expanded={openGeneral}
        >
          {openGeneral ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <FileText size={18} />
          General Information
        </button>
        {openGeneral && (
          <div className="pims-client-detail__section-body">
            <dl className="pims-client-detail__meta">
              <div>
                <dt>Client ID</dt>
                <dd>{String(payload.id ?? clientId)}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{(pickStr(payload.email) ?? readList(payload.emails).join(', ')) || '—'}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{readList(payload.phones ?? payload.phoneNumbers).join(', ') || phone || '—'}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      <div className="pims-client-detail__section">
        <button
          type="button"
          className="pims-client-detail__section-head"
          onClick={() => setOpenAccount((o) => !o)}
          aria-expanded={openAccount}
        >
          {openAccount ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <Wallet size={18} />
          Account Balance
        </button>
        {openAccount && (
          <div className="pims-client-detail__section-body">
            <div className="pims-client-detail__account-actions">
              <button type="button" className="pims-client-detail__btn">
                View History
              </button>
              <button type="button" className="pims-client-detail__btn">
                Make Payment
              </button>
              <button type="button" className="pims-client-detail__btn">
                Make Deposit
              </button>
              <button type="button" className="pims-client-detail__btn pims-client-detail__btn--ghost">
                More ▾
              </button>
            </div>

            {invoices.length === 0 ? (
              <div className="pims-client-detail__api-note">
                <strong>No open invoices in this response.</strong> The list + invoice line-item layout from your
                reference needs invoice data. If <code>GET /clients/:id</code> does not include{' '}
                <code>invoices</code> (or a <code>billing</code> object), add something like{' '}
                <code>GET /clients/:id/invoices</code> or embed invoices on the client payload; this page will render
                them automatically when present.
              </div>
            ) : (
              <>
                <div className="pims-client-detail__table-wrap">
                  <table className="pims-client-detail__table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Invoice Total</th>
                        <th>Amount Paid</th>
                        <th>Amount Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.key}>
                          <td>
                            {inv.date} — Invoice # {inv.number}
                          </td>
                          <td>{formatUsd(inv.total)}</td>
                          <td>{formatUsd(inv.paid)}</td>
                          <td>{formatUsd(inv.due)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {invoices.map((inv) => {
                  const lineSub = inv.lines.reduce((s, l) => s + l.subtotal, 0);
                  const lineTax = inv.lines.reduce((s, l) => s + l.tax, 0);
                  const lineTot = inv.lines.reduce((s, l) => s + l.total, 0);
                  const sub = inv.lines.length ? lineSub : Math.max(0, inv.total - lineTax);
                  const tax = inv.lines.length ? lineTax : 0;
                  const tot = inv.total > 0 ? inv.total : lineTot;
                  return (
                    <div key={`detail-${inv.key}`} style={{ marginBottom: 28 }}>
                      <h3 className="pims-client-detail__balance-title">
                        Account Balance: {formatUsd(balance ?? inv.due)}
                      </h3>
                      <dl className="pims-client-detail__meta">
                        <div>
                          <dt>Invoice Number</dt>
                          <dd>{inv.number}</dd>
                        </div>
                        <div>
                          <dt>Date</dt>
                          <dd>{inv.date}</dd>
                        </div>
                        <div>
                          <dt>Invoice Status</dt>
                          <dd>{inv.status}</dd>
                        </div>
                        <div>
                          <dt>Created By</dt>
                          <dd>{inv.createdBy}</dd>
                        </div>
                      </dl>
                      <div className="pims-client-detail__table-wrap">
                        <table className="pims-client-detail__table">
                          <thead>
                            <tr>
                              <th>Complete</th>
                              <th>Patient</th>
                              <th>Provider</th>
                              <th>Description</th>
                              <th>Date</th>
                              <th>Quantity</th>
                              <th>Subtotal</th>
                              <th>Tax</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.lines.map((line) => (
                              <tr key={line.key}>
                                <td>{line.complete ? '✓' : ''}</td>
                                <td>
                                  <span className="pims-client-detail__line-link">{line.patient}</span>
                                </td>
                                <td>{line.provider}</td>
                                <td>
                                  <span className="pims-client-detail__line-link">{line.description}</span>
                                </td>
                                <td>{line.date}</td>
                                <td>{line.qty}</td>
                                <td>{formatUsd(line.subtotal)}</td>
                                <td>{formatUsd(line.tax)}</td>
                                <td>{formatUsd(line.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="pims-client-detail__totals">
                        <div className="pims-client-detail__totals-inner">
                          <div className="pims-client-detail__totals-row">
                            <span>Subtotal</span>
                            <span>{formatUsd(sub)}</span>
                          </div>
                          <div className="pims-client-detail__totals-row">
                            <span>Tax</span>
                            <span>{formatUsd(tax)}</span>
                          </div>
                          <div className="pims-client-detail__totals-row">
                            <span>Invoice Total</span>
                            <span>{formatUsd(tot)}</span>
                          </div>
                          <div className="pims-client-detail__totals-row">
                            <span>Amount Paid</span>
                            <span>{formatUsd(inv.paid)}</span>
                          </div>
                          <div className="pims-client-detail__totals-row pims-client-detail__totals-row--strong">
                            <span>Amount Remaining</span>
                            <span>{formatUsd(inv.due)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="pims-client-detail__tip">
                  TIP: To re-order, just click and drag row to the appropriate location and release.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
