import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  FileText,
  Wallet,
  Mail,
  Printer,
  UserPlus,
  PawPrint,
  Pencil,
} from 'lucide-react';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { patchClientStaff, saveClients, type ClientDto } from '../../api/clientsMutations';
import { apiBaseUrl } from '../../api/http';
import PimsAppointmentsSection from './PimsAppointmentsSection';
import { PIMS_ENTITY_EDIT_ENABLED } from '../../utils/pimsEntityEditing';
import './PimsClientDetailView.css';

const PIMS_CLIENT_DETAIL_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

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
  const p1 = pickStr(c.phone1);
  const p2 = pickStr(c.phone2);
  if (p1 && p2) return `${p1} · ${p2}`;
  if (p1) return p1;
  if (p2) return p2;
  const list = readList(c.phones ?? c.phoneNumbers ?? c.phone ?? c.mobilePhone ?? c.homePhone);
  if (list.length) return list[0];
  return pickStr(c.phone) ?? pickStr(c.mobilePhone) ?? pickStr(c.homePhone);
}

function formatTs(iso: unknown): string {
  if (typeof iso !== 'string' || !iso.trim()) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function yn(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '—';
}

function mediaUrl(path: unknown): string | null {
  const p = pickStr(path);
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const base = apiBaseUrl.replace(/\/$/, '');
  return `${base}/${p.replace(/^\//, '')}`;
}

function providerLabel(p: Record<string, unknown>): string {
  const pp = p.primaryProvider;
  if (!pp || typeof pp !== 'object') return '—';
  const o = pp as Record<string, unknown>;
  const parts = [
    pickStr(o.title),
    pickStr(o.firstName),
    pickStr(o.middleName),
    pickStr(o.lastName),
    pickStr(o.designation),
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}

function providerDetailRows(p: Record<string, unknown>): { label: string; value: ReactNode }[] {
  const pp = p.primaryProvider;
  if (!pp || typeof pp !== 'object') return [];
  const o = pp as Record<string, unknown>;
  return [
    { label: 'Provider PIMS ID', value: pickStr(o.pimsId) },
    { label: 'Provider email', value: pickStr(o.email) },
    { label: 'Provider license', value: pickStr(o.licenseNumber) },
    { label: 'Provider phone', value: pickStr(o.phone1) ?? pickStr(o.phone2) },
    { label: 'Provider city', value: pickStr(o.city) },
    { label: 'Provider state', value: pickStr(o.state) },
    { label: 'Provider timezone', value: pickStr(o.timezone) },
  ];
}

function zoneDisplay(c: Record<string, unknown>): string {
  const zn = pickStr(c.zoneName);
  const topZid = c.zoneId != null && String(c.zoneId).trim() !== '' ? String(c.zoneId) : '';
  const cz = c.clientZone;
  let czName: string | null = null;
  let czId = '';
  if (cz && typeof cz === 'object') {
    const co = cz as Record<string, unknown>;
    czName = pickStr(co.name);
    if (co.id != null && String(co.id).trim() !== '') czId = String(co.id);
  }
  const idBit = topZid || czId;
  const bits: string[] = [];
  if (zn) bits.push(zn);
  if (czName) bits.push(czName);
  if (idBit) bits.push(`Zone id ${idBit}`);
  return bits.length ? bits.join(' · ') : '—';
}

function statusDiscountText(v: unknown): ReactNode {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return (
      <pre className="pims-client-detail__json-inline">{JSON.stringify(v, null, 2)}</pre>
    );
  } catch {
    return '—';
  }
}

function MetaDl({ rows, className }: { rows: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={['pims-client-detail__meta', className].filter(Boolean).join(' ')}>
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          <dt>{r.label}</dt>
          <dd>
            {r.value == null ? (
              '—'
            ) : typeof r.value === 'string' ? (
              r.value.trim() ? (
                r.value
              ) : (
                '—'
              )
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
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

function strFromScalar(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return pickStr(v);
}

type NormalizedLine = {
  key: string;
  patient: string;
  provider: string;
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
  const invD = pickStr(o.inventoryDescription);
  const lab = pickStr(o.labName);
  const proc = pickStr(o.procedureName);
  const custom = pickStr(o.customName);
  let description =
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
    toNum(o.totalPrice) ?? toNum(o.lineTotal) ?? toNum(o.amount) ?? (Number.isFinite(lineNet + tax) ? lineNet + tax : subtotal + tax);
  const complete = o.complete === true || o.isComplete === true || o.completed === true;
  const id = o.id ?? o.lineItemId ?? idx;
  return {
    key: String(id),
    patient,
    provider,
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
  /** Original invoice DTO for payments and extra fields in the detail modal. */
  raw: Record<string, unknown>;
};

function normalizeInvoice(row: unknown, idx: number): NormalizedInvoice | null {
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

function ClientInvoiceDetailModal({
  inv,
  balance,
  onClose,
}: {
  inv: NormalizedInvoice;
  balance: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const raw = inv.raw;
  const payments = Array.isArray(raw.invoicePayments)
    ? (raw.invoicePayments as Record<string, unknown>[])
    : [];

  const metaRows: { label: string; value: ReactNode }[] = [
    { label: 'Invoice #', value: inv.number },
    { label: 'Invoiced', value: inv.date },
    { label: 'Status', value: inv.status },
    { label: 'Total', value: formatUsd(inv.total) },
    { label: 'Amount paid', value: formatUsd(inv.paid) },
    { label: 'Amount due', value: formatUsd(inv.due) },
    { label: 'Discount', value: toNum(raw.discount) != null ? formatUsd(toNum(raw.discount)!) : '—' },
    { label: 'Client balance (from header)', value: balance != null ? formatUsd(balance) : '—' },
    { label: 'PIMS id', value: strFromScalar(raw.pimsId) ?? '—' },
    { label: 'PIMS type', value: pickStr(raw.pimsType) ?? '—' },
    { label: 'Invoice key', value: pickStr(raw.invoiceKey) ?? '—' },
    { label: 'Post-close complete', value: yn(raw.postCloseProcessComplete) },
    { label: 'Transferred', value: yn(raw.isTransferred) },
    { label: 'Created by', value: inv.createdBy },
  ];

  const modal = (
    <div
      className="pims-client-detail__inv-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pims-client-detail__inv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pims-inv-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="pims-inv-modal-title" className="pims-client-detail__inv-modal-title">
          Invoice #{inv.number}
        </h2>
        <dl className="pims-client-detail__inv-modal-meta">
          {metaRows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="pims-client-detail__inv-modal-subhead">Line items</h3>
        <div className="pims-client-detail__inv-modal-table-wrap">
          <table className="pims-client-detail__inv-modal-table">
            <thead>
              <tr>
                <th>Done</th>
                <th>Service date</th>
                <th>Description</th>
                <th>Patient</th>
                <th>Provider</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Svc fee</th>
                <th>Subtotal</th>
                <th>Tax</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="pims-client-detail__inv-modal-empty">
                    No line items on this invoice.
                  </td>
                </tr>
              ) : (
                inv.lines.map((line) => (
                  <tr key={line.key}>
                    <td>{line.complete ? '✓' : ''}</td>
                    <td>{line.date}</td>
                    <td>{line.description}</td>
                    <td>{line.patient}</td>
                    <td>{line.provider}</td>
                    <td>{line.qty}</td>
                    <td>{formatUsd(line.unitPrice)}</td>
                    <td>{formatUsd(line.serviceFee)}</td>
                    <td>{formatUsd(line.subtotal)}</td>
                    <td>{formatUsd(line.tax)}</td>
                    <td>{formatUsd(line.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {payments.length > 0 ? (
          <>
            <h3 className="pims-client-detail__inv-modal-subhead">Payments</h3>
            <div className="pims-client-detail__inv-modal-table-wrap">
              <table className="pims-client-detail__inv-modal-table">
                <thead>
                  <tr>
                    <th>Amount paid</th>
                    <th>Credit used</th>
                    <th>Payment history PIMS id</th>
                    <th>Payment PIMS id</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={strFromScalar(p.id) ?? `pay-${i}`}>
                      <td>{formatUsd(toNum(p.amountPaid) ?? 0)}</td>
                      <td>{formatUsd(toNum(p.creditUsed) ?? 0)}</td>
                      <td>{pickStr(p.paymentHistoryPimsId) ?? '—'}</td>
                      <td>{pickStr(p.paymentPimsId) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div className="pims-client-detail__inv-modal-actions">
          <button type="button" className="pims-client-detail__inv-modal-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function displayName(c: Record<string, unknown>): string {
  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const both = [fn, ln].filter(Boolean).join(' ');
  return both || `Client #${pickStr(c.id) ?? ''}`;
}

type ClientEditDraft = {
  firstName: string;
  lastName: string;
  secondFirstName: string;
  secondLastName: string;
  email: string;
  secondEmail: string;
  username: string;
  portalEmail: string;
  phone1: string;
  phone2: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  county: string;
  alerts: string;
  discount: string;
  statusDiscountStr: string;
  lat: string;
  lon: string;
  latLonMatchLevel: string;
  zoneId: string;
  zoneName: string;
};

function payloadToEditDraft(p: Record<string, unknown>): ClientEditDraft {
  const g = (key: string) => pickStr(p[key]) ?? '';
  return {
    firstName: g('firstName'),
    lastName: g('lastName'),
    secondFirstName: g('secondFirstName'),
    secondLastName: g('secondLastName'),
    email: g('email') || readList(p.emails).join(', '),
    secondEmail: g('secondEmail'),
    username: g('username'),
    portalEmail: g('portalEmail'),
    phone1: g('phone1'),
    phone2: g('phone2'),
    address1: g('address1'),
    address2: g('address2'),
    address3: g('address3'),
    city: g('city'),
    state: g('state'),
    zipcode: g('zipcode'),
    country: g('country'),
    county: g('county'),
    alerts: g('alerts'),
    discount:
      typeof p.discount === 'number' && Number.isFinite(p.discount) ? String(p.discount) : g('discount'),
    statusDiscountStr: (() => {
      const v = p.statusDiscount;
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v, null, 2);
      return String(v);
    })(),
    lat: typeof p.lat === 'number' ? String(p.lat) : g('lat'),
    lon: typeof p.lon === 'number' ? String(p.lon) : g('lon'),
    latLonMatchLevel: g('latLonMatchLevel'),
    zoneId: p.zoneId != null ? String(p.zoneId) : '',
    zoneName: g('zoneName'),
  };
}

function extractClientSaveErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save client.';
}

function buildPatchBody(
  d: ClientEditDraft,
  isActive: boolean,
  latLonValidated: boolean,
): Record<string, unknown> {
  const sdRaw = d.statusDiscountStr.trim();
  let statusDiscount: unknown = null;
  if (sdRaw) {
    try {
      statusDiscount = JSON.parse(sdRaw) as unknown;
    } catch {
      statusDiscount = sdRaw;
    }
  }
  const zid = toNum(d.zoneId);
  const body: Record<string, unknown> = {
    firstName: d.firstName.trim() || null,
    lastName: d.lastName.trim() || null,
    secondFirstName: d.secondFirstName.trim() || null,
    secondLastName: d.secondLastName.trim() || null,
    email: d.email.trim() || null,
    secondEmail: d.secondEmail.trim() || null,
    username: d.username.trim() || null,
    portalEmail: d.portalEmail.trim() || null,
    phone1: d.phone1.trim() || null,
    phone2: d.phone2.trim() || null,
    address1: d.address1.trim() || null,
    address2: d.address2.trim() || null,
    address3: d.address3.trim() || null,
    city: d.city.trim() || null,
    state: d.state.trim() || null,
    zipcode: d.zipcode.trim() || null,
    country: d.country.trim() || null,
    county: d.county.trim() || null,
    alerts: d.alerts.trim() || null,
    isActive,
    latLonValidated,
    statusDiscount,
  };
  const disc = toNum(d.discount);
  body.discount = disc ?? 0;
  const lat = toNum(d.lat);
  const lon = toNum(d.lon);
  if (lat != null) body.lat = lat;
  if (lon != null) body.lon = lon;
  body.latLonMatchLevel = d.latLonMatchLevel.trim() || null;
  body.zoneName = d.zoneName.trim() || null;
  if (d.zoneId.trim() !== '' && zid != null) body.zoneId = zid;
  else body.zoneId = null;
  return body;
}

type Props = {
  clientId: string;
  onBack: () => void;
};

export default function PimsClientDetailView({ clientId, onBack }: Props) {
  const location = useLocation();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openLogin, setOpenLogin] = useState(true);
  const [openPatients, setOpenPatients] = useState(true);
  const [openAccount, setOpenAccount] = useState(true);
  const [confirmInfo, setConfirmInfo] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<ClientEditDraft | null>(null);
  const [isActiveDraft, setIsActiveDraft] = useState(true);
  const [latLonValidatedDraft, setLatLonValidatedDraft] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<NormalizedInvoice | null>(null);

  const patientsBasePath = useMemo(
    () => (location.pathname.startsWith('/schedule/') ? '/schedule/patients' : '/pims/patients'),
    [location.pathname],
  );

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

  useEffect(() => {
    setInvoiceDetail(null);
  }, [clientId]);

  useEffect(() => {
    setIsEditing(false);
    setEditDraft(null);
    setSaveError(null);
    setSaving(false);
  }, [clientId]);

  useEffect(() => {
    if (!PIMS_ENTITY_EDIT_ENABLED) {
      setIsEditing(false);
      setEditDraft(null);
      setSaveError(null);
      setSaving(false);
    }
  }, []);

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

  const patients = useMemo(() => {
    if (!payload) return [] as Record<string, unknown>[];
    const raw = payload.patients;
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is Record<string, unknown> => p != null && typeof p === 'object');
  }, [payload]);

  const collapseAll = useCallback(() => {
    setOpenLogin(false);
    setOpenPatients(false);
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

  const billing =
    payload.billing && typeof payload.billing === 'object'
      ? (payload.billing as Record<string, unknown>)
      : null;

  const record = payload as Record<string, unknown>;

  const fmtMoney = (v: unknown) => {
    const n = toNum(v);
    return n != null ? formatUsd(n) : '—';
  };

  function beginEdit() {
    if (!PIMS_ENTITY_EDIT_ENABLED) return;
    setSaveError(null);
    setEditDraft(payloadToEditDraft(record));
    setIsActiveDraft(record.isActive === true);
    setLatLonValidatedDraft(record.latLonValidated === true);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditDraft(null);
    setSaveError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!PIMS_ENTITY_EDIT_ENABLED) return;
    if (!editDraft) return;
    if (!editDraft.firstName.trim() || !editDraft.lastName.trim()) {
      setSaveError('First and last name are required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const body = buildPatchBody(editDraft, isActiveDraft, latLonValidatedDraft);
    try {
      let updated: unknown;
      try {
        updated = await patchClientStaff(clientId, body);
      } catch (firstErr) {
        const st = (firstErr as { response?: { status?: number } })?.response?.status;
        if (st === 404 || st === 405) {
          updated = await saveClients({ id: record.id, ...body } as ClientDto);
        } else {
          throw firstErr;
        }
      }
      let next: Record<string, unknown> | null = null;
      if (updated && typeof updated === 'object' && !Array.isArray(updated)) {
        next = updated as Record<string, unknown>;
      } else if (Array.isArray(updated) && updated[0] && typeof updated[0] === 'object') {
        next = updated[0] as Record<string, unknown>;
      } else {
        const data = await fetchClientByIdStaff(clientId);
        next = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      }
      if (next) setPayload(next);
      setIsEditing(false);
      setEditDraft(null);
    } catch (err) {
      setSaveError(extractClientSaveErr(err));
    } finally {
      setSaving(false);
    }
  }

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

      <div className="pims-client-detail__profile">
        <div className="pims-client-detail__profile-title-row">
          <h2 className="pims-client-detail__profile-title">
            <FileText size={20} aria-hidden />
            Client record
          </h2>
          {PIMS_ENTITY_EDIT_ENABLED && !isEditing ? (
            <button type="button" className="pims-client-detail__btn-edit" onClick={beginEdit}>
              <Pencil size={16} aria-hidden />
              Edit
            </button>
          ) : null}
        </div>
        {saveError ? (
          <div className="pims-client-detail__save-error" role="alert">
            {saveError}
          </div>
        ) : null}
        {!PIMS_ENTITY_EDIT_ENABLED || !isEditing ? (
          <>
        <h3 className="pims-client-detail__subhead">Identity and PIMS</h3>
        <MetaDl
          rows={[
            { label: 'Client ID', value: String(payload.id ?? clientId) },
            { label: 'Created', value: formatTs(payload.created) },
            { label: 'Updated', value: formatTs(payload.updated) },
            { label: 'External created', value: formatTs(payload.externalCreated) },
            { label: 'External updated', value: formatTs(payload.externalUpdated) },
            { label: 'Active', value: yn(payload.isActive) },
            { label: 'Deleted', value: yn(payload.isDeleted) },
            { label: 'PIMS ID', value: pickStr(payload.pimsId) },
            { label: 'PIMS type', value: pickStr(payload.pimsType) },
          ]}
        />

        <h3 className="pims-client-detail__subhead">Primary contact</h3>
        <MetaDl
          rows={[
            { label: 'First name', value: pickStr(payload.firstName) },
            { label: 'Last name', value: pickStr(payload.lastName) },
            { label: 'Email', value: pickStr(payload.email) ?? (readList(payload.emails).join(', ') || null) },
            { label: 'Phone 1', value: pickStr(payload.phone1) },
            { label: 'Phone 2', value: pickStr(payload.phone2) },
          ]}
        />

        <h3 className="pims-client-detail__subhead">Secondary contact</h3>
        <MetaDl
          rows={[
            { label: 'Second first name', value: pickStr(payload.secondFirstName) },
            { label: 'Second last name', value: pickStr(payload.secondLastName) },
            { label: 'Second email', value: pickStr(payload.secondEmail) },
          ]}
        />

        <h3 className="pims-client-detail__subhead">Address</h3>
        <MetaDl
          rows={[
            { label: 'Address line 1', value: pickStr(payload.address1) },
            { label: 'Address line 2', value: pickStr(payload.address2) },
            { label: 'Address line 3', value: pickStr(payload.address3) },
            { label: 'City', value: pickStr(payload.city) },
            { label: 'State', value: pickStr(payload.state) },
            { label: 'ZIP', value: pickStr(payload.zipcode) },
            { label: 'Country', value: pickStr(payload.country) },
            { label: 'County', value: pickStr(payload.county) },
          ]}
        />

        <h3 className="pims-client-detail__subhead">Geocoding</h3>
        <MetaDl
          rows={[
            {
              label: 'Latitude',
              value:
                typeof payload.lat === 'number'
                  ? payload.lat.toFixed(7)
                  : pickStr(payload.lat),
            },
            {
              label: 'Longitude',
              value:
                typeof payload.lon === 'number'
                  ? payload.lon.toFixed(7)
                  : pickStr(payload.lon),
            },
            { label: 'Match level', value: pickStr(payload.latLonMatchLevel) },
            { label: 'Validated', value: yn(payload.latLonValidated) },
          ]}
        />

        <h3 className="pims-client-detail__subhead">Zone</h3>
        <MetaDl rows={[{ label: 'Zone', value: zoneDisplay(payload) }]} />

        <h3 className="pims-client-detail__subhead">Alerts</h3>
        <div className="pims-client-detail__alerts-wrap">
          {pickStr(payload.alerts) ? (
            <p className="pims-client-detail__alerts">{pickStr(payload.alerts)}</p>
          ) : (
            <p className="pims-client-detail__muted">No client alerts.</p>
          )}
        </div>

        <h3 className="pims-client-detail__subhead">Discounts</h3>
        <MetaDl
          rows={[
            { label: 'Status discount', value: statusDiscountText(payload.statusDiscount) },
            {
              label: 'Discount',
              value:
                typeof payload.discount === 'number'
                  ? String(payload.discount)
                  : pickStr(payload.discount),
            },
          ]}
        />

        <h3 className="pims-client-detail__subhead">Balances (from response)</h3>
        <MetaDl
          rows={[
            { label: 'Account balance', value: fmtMoney(payload.accountBalance) },
            { label: 'Balance', value: fmtMoney(payload.balance) },
            { label: 'Amount due', value: fmtMoney(payload.amountDue) },
            ...(billing
              ? ([
                  { label: 'Billing — account balance', value: fmtMoney(billing.accountBalance) },
                  { label: 'Billing — balance', value: fmtMoney(billing.balance) },
                  { label: 'Billing — amount due', value: fmtMoney(billing.amountDue) },
                ] as { label: string; value: ReactNode }[])
              : []),
          ]}
        />
          </>
        ) : editDraft ? (
          <>
            <form className="pims-client-detail__edit-form" onSubmit={handleSave}>
              <div className="pims-client-detail__edit-toolbar">
                <button
                  type="button"
                  className="pims-client-detail__btn-secondary"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="pims-client-detail__btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>

              <h3 className="pims-client-detail__subhead">Identity and PIMS (read-only)</h3>
              <MetaDl
                rows={[
                  { label: 'Client ID', value: String(payload.id ?? clientId) },
                  { label: 'Created', value: formatTs(payload.created) },
                  { label: 'Updated', value: formatTs(payload.updated) },
                  { label: 'External created', value: formatTs(payload.externalCreated) },
                  { label: 'External updated', value: formatTs(payload.externalUpdated) },
                  { label: 'Deleted', value: yn(payload.isDeleted) },
                  { label: 'PIMS ID', value: pickStr(payload.pimsId) },
                  { label: 'PIMS type', value: pickStr(payload.pimsType) },
                ]}
              />

              <h3 className="pims-client-detail__subhead">Flags</h3>
              <div className="pims-client-detail__edit-checks">
                <label className="pims-client-detail__check">
                  <input
                    type="checkbox"
                    checked={isActiveDraft}
                    onChange={(e) => setIsActiveDraft(e.target.checked)}
                  />
                  Active
                </label>
                <label className="pims-client-detail__check">
                  <input
                    type="checkbox"
                    checked={latLonValidatedDraft}
                    onChange={(e) => setLatLonValidatedDraft(e.target.checked)}
                  />
                  Geocode validated
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Primary contact</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field">
                  <span>First name *</span>
                  <input
                    className="input"
                    value={editDraft.firstName}
                    onChange={(e) => setEditDraft({ ...editDraft, firstName: e.target.value })}
                    required
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Last name *</span>
                  <input
                    className="input"
                    value={editDraft.lastName}
                    onChange={(e) => setEditDraft({ ...editDraft, lastName: e.target.value })}
                    required
                  />
                </label>
                <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                  <span>Email</span>
                  <input
                    className="input"
                    type="email"
                    value={editDraft.email}
                    onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Phone 1</span>
                  <input
                    className="input"
                    type="tel"
                    value={editDraft.phone1}
                    onChange={(e) => setEditDraft({ ...editDraft, phone1: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Phone 2</span>
                  <input
                    className="input"
                    type="tel"
                    value={editDraft.phone2}
                    onChange={(e) => setEditDraft({ ...editDraft, phone2: e.target.value })}
                  />
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Secondary contact</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field">
                  <span>Second first name</span>
                  <input
                    className="input"
                    value={editDraft.secondFirstName}
                    onChange={(e) => setEditDraft({ ...editDraft, secondFirstName: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Second last name</span>
                  <input
                    className="input"
                    value={editDraft.secondLastName}
                    onChange={(e) => setEditDraft({ ...editDraft, secondLastName: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                  <span>Second email</span>
                  <input
                    className="input"
                    type="email"
                    value={editDraft.secondEmail}
                    onChange={(e) => setEditDraft({ ...editDraft, secondEmail: e.target.value })}
                  />
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Login</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field">
                  <span>Username</span>
                  <input
                    className="input"
                    value={editDraft.username}
                    onChange={(e) => setEditDraft({ ...editDraft, username: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                  <span>Portal email</span>
                  <input
                    className="input"
                    type="email"
                    value={editDraft.portalEmail}
                    onChange={(e) => setEditDraft({ ...editDraft, portalEmail: e.target.value })}
                  />
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Address</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                  <span>Address line 1</span>
                  <input
                    className="input"
                    value={editDraft.address1}
                    onChange={(e) => setEditDraft({ ...editDraft, address1: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                  <span>Address line 2</span>
                  <input
                    className="input"
                    value={editDraft.address2}
                    onChange={(e) => setEditDraft({ ...editDraft, address2: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                  <span>Address line 3</span>
                  <input
                    className="input"
                    value={editDraft.address3}
                    onChange={(e) => setEditDraft({ ...editDraft, address3: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>City</span>
                  <input
                    className="input"
                    value={editDraft.city}
                    onChange={(e) => setEditDraft({ ...editDraft, city: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>State</span>
                  <input
                    className="input"
                    value={editDraft.state}
                    onChange={(e) => setEditDraft({ ...editDraft, state: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>ZIP</span>
                  <input
                    className="input"
                    value={editDraft.zipcode}
                    onChange={(e) => setEditDraft({ ...editDraft, zipcode: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Country</span>
                  <input
                    className="input"
                    value={editDraft.country}
                    onChange={(e) => setEditDraft({ ...editDraft, country: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>County</span>
                  <input
                    className="input"
                    value={editDraft.county}
                    onChange={(e) => setEditDraft({ ...editDraft, county: e.target.value })}
                  />
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Geocoding</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field">
                  <span>Latitude</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={editDraft.lat}
                    onChange={(e) => setEditDraft({ ...editDraft, lat: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Longitude</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={editDraft.lon}
                    onChange={(e) => setEditDraft({ ...editDraft, lon: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Match level</span>
                  <input
                    className="input"
                    value={editDraft.latLonMatchLevel}
                    onChange={(e) => setEditDraft({ ...editDraft, latLonMatchLevel: e.target.value })}
                  />
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Zone</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field">
                  <span>Zone ID</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={editDraft.zoneId}
                    onChange={(e) => setEditDraft({ ...editDraft, zoneId: e.target.value })}
                  />
                </label>
                <label className="pims-client-detail__edit-field">
                  <span>Zone name</span>
                  <input
                    className="input"
                    value={editDraft.zoneName}
                    onChange={(e) => setEditDraft({ ...editDraft, zoneName: e.target.value })}
                  />
                </label>
              </div>

              <h3 className="pims-client-detail__subhead">Alerts</h3>
              <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                <span>Client alerts</span>
                <textarea
                  className="input pims-client-detail__textarea"
                  rows={4}
                  value={editDraft.alerts}
                  onChange={(e) => setEditDraft({ ...editDraft, alerts: e.target.value })}
                />
              </label>

              <h3 className="pims-client-detail__subhead">Discounts</h3>
              <div className="pims-client-detail__edit-grid">
                <label className="pims-client-detail__edit-field">
                  <span>Discount (number)</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={editDraft.discount}
                    onChange={(e) => setEditDraft({ ...editDraft, discount: e.target.value })}
                  />
                </label>
              </div>
              <label className="pims-client-detail__edit-field pims-client-detail__edit-field--full">
                <span>Status discount (JSON or text)</span>
                <textarea
                  className="input pims-client-detail__textarea"
                  rows={3}
                  value={editDraft.statusDiscountStr}
                  onChange={(e) => setEditDraft({ ...editDraft, statusDiscountStr: e.target.value })}
                />
              </label>
            </form>

            <h3 className="pims-client-detail__subhead">Balances (from response)</h3>
            <MetaDl
              rows={[
                { label: 'Account balance', value: fmtMoney(payload.accountBalance) },
                { label: 'Balance', value: fmtMoney(payload.balance) },
                { label: 'Amount due', value: fmtMoney(payload.amountDue) },
                ...(billing
                  ? ([
                      { label: 'Billing — account balance', value: fmtMoney(billing.accountBalance) },
                      { label: 'Billing — balance', value: fmtMoney(billing.balance) },
                      { label: 'Billing — amount due', value: fmtMoney(billing.amountDue) },
                    ] as { label: string; value: ReactNode }[])
                  : []),
              ]}
            />
          </>
        ) : null}
      </div>

      <div className="pims-client-detail__section">
        <button
          type="button"
          className="pims-client-detail__section-head"
          onClick={() => setOpenPatients((o) => !o)}
          aria-expanded={openPatients}
        >
          {openPatients ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <PawPrint size={18} />
          Patients ({patients.length})
        </button>
        {openPatients && (
          <div className="pims-client-detail__section-body">
            {patients.length === 0 ? (
              <p className="pims-client-detail__muted">No patients on this client.</p>
            ) : (
              <ul className="pims-client-detail__patient-list">
                {patients.map((p, idx) => {
                  const pid = p.id != null ? String(p.id) : '';
                  const href = pid ? `${patientsBasePath}?patientId=${encodeURIComponent(pid)}` : patientsBasePath;
                  const img = mediaUrl(p.imageUrl);
                  const rowKey = pid || pickStr(p.pimsId) || `patient-${idx}`;
                  return (
                    <li key={rowKey} className="pims-client-detail__patient-card">
                      {img ? (
                        <img className="pims-client-detail__patient-img" src={img} alt="" width={72} height={72} />
                      ) : (
                        <div className="pims-client-detail__patient-img pims-client-detail__patient-img--placeholder" />
                      )}
                      <div className="pims-client-detail__patient-body">
                        <div className="pims-client-detail__patient-title">
                          {pid ? (
                            <Link className="pims-client-detail__patient-link" to={href}>
                              {pickStr(p.name) ?? `Patient #${pid}`}
                            </Link>
                          ) : (
                            <span>{pickStr(p.name) ?? 'Patient'}</span>
                          )}
                        </div>
                        <MetaDl
                          className="pims-client-detail__meta--patient"
                          rows={[
                            { label: 'Patient ID', value: pid || '—' },
                            { label: 'PIMS ID', value: pickStr(p.pimsId) },
                            { label: 'PIMS type', value: pickStr(p.pimsType) },
                            { label: 'Active', value: yn(p.isActive) },
                            { label: 'Deleted', value: yn(p.isDeleted) },
                            { label: 'DOB', value: formatTs(p.dob) },
                            { label: 'Species', value: pickStr(p.species) },
                            { label: 'Breed', value: pickStr(p.breed) },
                            { label: 'Sex', value: pickStr(p.sex) },
                            { label: 'Color', value: pickStr(p.color) },
                            { label: 'Weight', value: pickStr(p.weight) },
                            { label: 'Primary provider', value: providerLabel(p) },
                            ...providerDetailRows(p),
                            {
                              label: 'Created',
                              value: formatTs(p.created),
                            },
                            { label: 'Updated', value: formatTs(p.updated) },
                            { label: 'External created', value: formatTs(p.externalCreated) },
                            { label: 'External updated', value: formatTs(p.externalUpdated) },
                          ]}
                        />
                        {pickStr(p.alerts) ? (
                          <div className="pims-client-detail__patient-alerts">
                            <strong>Patient alerts</strong>
                            <p className="pims-client-detail__alerts">{pickStr(p.alerts)}</p>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <PimsAppointmentsSection
        variant="client"
        practiceId={PIMS_CLIENT_DETAIL_PRACTICE_ID}
        clientId={clientId}
        patients={patients}
      />

      <div className="pims-client-detail__section">
        <button
          type="button"
          className="pims-client-detail__section-head"
          onClick={() => setOpenLogin((o) => !o)}
          aria-expanded={openLogin}
        >
          {openLogin ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <KeyRound size={18} />
          Login information
        </button>
        {openLogin && (
          <div className="pims-client-detail__section-body">
            <MetaDl
              rows={[
                { label: 'Username', value: pickStr(payload.username) },
                { label: 'Primary email', value: pickStr(payload.email) ?? readList(payload.emails).join(', ') },
                { label: 'Second email', value: pickStr(payload.secondEmail) },
                { label: 'Portal email', value: pickStr(payload.portalEmail) },
              ]}
            />
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

            <MetaDl
              rows={[
                {
                  label: 'Invoices (count)',
                  value: String(Array.isArray(payload.invoices) ? payload.invoices.length : 0),
                },
                {
                  label: 'Open invoices (count)',
                  value: String(Array.isArray(payload.openInvoices) ? payload.openInvoices.length : 0),
                },
                ...(billing
                  ? ([
                      {
                        label: 'Billing — invoices (count)',
                        value: String(Array.isArray(billing.invoices) ? billing.invoices.length : 0),
                      },
                      {
                        label: 'Billing — open invoices (count)',
                        value: String(
                          Array.isArray(billing.openInvoices) ? billing.openInvoices.length : 0,
                        ),
                      },
                    ] as { label: string; value: ReactNode }[])
                  : []),
              ]}
            />

            {invoices.length === 0 ? (
              <div className="pims-client-detail__api-note">
                <strong>No invoices in this response.</strong> When <code>GET /clients/:id</code> includes an{' '}
                <code>invoices</code> array (or billing invoices), they appear here. Click a row for line items and
                payments.
              </div>
            ) : (
              <>
                <div className="pims-client-detail__invoice-list-scroll">
                  <table className="pims-client-detail__table pims-client-detail__table--invoice-summary">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Status</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr
                          key={inv.key}
                          className="pims-client-detail__invoice-row--clickable"
                          tabIndex={0}
                          role="button"
                          aria-label={`Invoice ${inv.number}, ${inv.status}`}
                          onClick={() => setInvoiceDetail(inv)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setInvoiceDetail(inv);
                            }
                          }}
                        >
                          <td>
                            <span className="pims-client-detail__invoice-row-title">
                              #{inv.number} · {inv.date}
                            </span>
                          </td>
                          <td>{inv.status}</td>
                          <td>{formatUsd(inv.total)}</td>
                          <td>{formatUsd(inv.paid)}</td>
                          <td>{formatUsd(inv.due)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="pims-client-detail__invoice-hint">
                  Scroll the list to see all invoices. Click a row for full details, line items, and payments.
                </p>
                {invoiceDetail ? (
                  <ClientInvoiceDetailModal
                    inv={invoiceDetail}
                    balance={balance}
                    onClose={() => setInvoiceDetail(null)}
                  />
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
