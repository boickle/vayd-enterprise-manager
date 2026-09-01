import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { DateTime } from 'luxon';
import { Plus, Search, X } from 'lucide-react';
import { isAppointmentCancelledOnPracticeCalendar } from '../../api/appointments';
import { fetchClientAppointmentsStaff } from '../../api/pimsAppointments';
import { fetchAllEmployees, fetchEmployee, type Employee } from '../../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';
import { fetchPatientByIdStaff } from '../../api/patients';
import { fetchClientBillingStaff } from '../../api/clientsStaff';
import {
  checkItemPricing,
  searchItems,
  type Appointment,
  type SearchableItem,
} from '../../api/roomLoader';
import {
  addCounterInvoiceLine,
  addVisitTender,
  adoptEvetInvoice,
  createClientPayLink,
  cancelTerminalCheckout,
  chargeSavedCard,
  discardVisitInvoice,
  ensureCounterInvoice,
  getInvoice,
  listClientVisitInvoices,
  removeCounterInvoiceLine,
  returnVisitInvoiceLines,
  startTerminalCheckout,
  unlockVisitInvoice,
  updateCounterInvoiceLine,
  voidInvoice,
  voidVisitTender,
  VISIT_WORKFLOW_PRACTICE_ID,
  type VisitInvoice,
  type VisitInvoiceLine,
  type VisitTenderMethod,
} from '../../api/visitWorkflow';
import {
  buildCheckItemPayloadFromSearch,
  getCatalogLinePrice,
  pricingItemFromSearchAndCheck,
} from '../../utils/catalogItemPricing';
import {
  readFinancialPrefill,
  scoutArFromInvoices,
  type FinancialRefillPrefill,
} from '../../utils/clientFinancial';
import {
  evetPaymentsOnInvoice,
  formatTs,
  formatUsd,
  invoicePublicLabel,
  normalizeInvoicesFromClient,
  type NormalizedInvoice,
} from '../../utils/pimsInvoices';
import { appAlert, appConfirm, appPrompt } from '../../utils/appDialog';
import {
  INVOICE_DIRECTIONS_LEAVE_MESSAGE,
  setInvoiceDirectionsDirty,
} from '../../utils/invoiceDirectionsLeaveGuard';
import {
  applySystemSubject,
  applySystemSubjectIfCustom,
  applySystemTemplate,
  applySystemTemplateIfCustom,
} from '../../utils/messageTemplateCache';
import { firstNameFromDisplayName } from '../../utils/clientNamePrefix';
import { mergeValuesFromNames, withClinicDefaults, type MergeValues } from '../../utils/messageTemplateFields';
import {
  invoicePdfAttachment,
  invoiceTableHtml,
  ledgerPdfAttachment,
  ledgerTableHtml,
  payButtonHtml,
  type InvoiceEmailModel,
} from '../../utils/invoiceEmail';
import { listPaymentTypes, type PracticePaymentType } from '../../api/paymentTypes';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import type { GmailComposeAttachment } from '../../api/gmail';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import { ClientSmsComposeModal } from '../ClientSmsComposeModal';
import { sendClientSms } from '../../api/clientSms';
import './ClientFinancialWorkspace.css';

export type FinancialPet = { id: number; name: string; primaryProviderId?: number | null };

type LedgerFilter = 'all' | 'open' | 'paid' | 'void' | 'returns';

type LedgerRow = {
  key: string;
  source: 'scout' | 'evet';
  label: string;
  date: string;
  sortAt: number;
  status: string;
  actorNote?: string | null;
  paymentNote?: string | null;
  total: number;
  paid: number;
  due: number;
  scout?: VisitInvoice;
  evet?: NormalizedInvoice;
};

const FIN_SPLIT_KEY = 'scout.clientFin.ledgerSplitPct';
const FIN_SPLIT_MIN = 34;
const FIN_SPLIT_MAX = 68;
const FIN_SPLIT_DEFAULT = 50;

function readFinSplitPct(): number {
  try {
    const raw = localStorage.getItem(FIN_SPLIT_KEY);
    const n = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(FIN_SPLIT_MAX, Math.max(FIN_SPLIT_MIN, n));
  } catch {
    /* ignore */
  }
  return FIN_SPLIT_DEFAULT;
}

type Props = {
  clientId: number;
  clientName: string;
  evetBalance: number | null;
  evetInvoices: NormalizedInvoice[];
  pets: FinancialPet[];
  cashierEmployeeId: number | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientDoNotSms?: boolean;
  initialInvoiceId?: string | null;
  openNew?: boolean;
  initialPatientId?: number | null;
  initialAppointmentId?: number | null;
  onSelectInvoice?: (invoiceId: string | 'new' | null) => void;
  onCommunicationLogged?: () => void;
  onCombinedBalance?: (balance: number) => void;
};

function money(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v < -0.005) return `(${formatUsd(Math.abs(v))})`;
  return formatUsd(v);
}

function moneyInput(n: number | null | undefined): string {
  return (Number(n) || 0).toFixed(2);
}

function lineDirections(line: VisitInvoiceLine): string {
  return line.instructions?.trim() || line.catalogInstructions?.trim() || '';
}

function lineRefills(line: VisitInvoiceLine): string {
  const n = line.refillCount ?? line.catalogRefill;
  return n == null || !Number.isFinite(Number(n)) ? '' : String(n);
}

function payLinkMerge(clientName: string, amount: number, labels: string, url: string) {
  return withClinicDefaults({
    client_first_name: firstNameFromDisplayName(clientName) || 'there',
    client_full_name: clientName,
    amount: money(amount),
    invoice_labels: labels,
    pay_link: url,
  });
}

function PriceShown({
  charged,
  list,
  covered,
}: {
  charged: number;
  list?: number | null;
  covered?: boolean;
}) {
  if (covered) return <span className="client-fin__covered">Covered ❤️</span>;
  const showList = list != null && list > charged + 0.009;
  return (
    <span className="client-fin__price">
      {showList ? <span className="client-fin__was">{money(list)}</span> : null}
      {money(charged)}
    </span>
  );
}

function dueOf(inv: VisitInvoice): number {
  return (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
}

/** Ledger/AR status: unpaid bills are open. Only a voided or deleted invoice is void. */
function ledgerArStatus(args: {
  status: string;
  isDeleted?: boolean;
  total: number;
  paid: number;
}): string {
  const status = args.status.trim().toLowerCase();
  if (args.isDeleted || status === 'deleted') return 'deleted';
  if (status === 'void') return 'void';
  const due = (Number(args.total) || 0) - (Number(args.paid) || 0);
  if (due > 0.009) return 'open';
  if ((Number(args.paid) || 0) > 0.009 || status === 'paid') return 'paid';
  return status === 'finalized' ? 'open' : status;
}

function voidedPaymentNote(
  items: { label: string; amount: number }[],
): string | null {
  if (!items.length) return null;
  return `(${items
    .map((item) => `voided ${item.label} payment - ${money(item.amount)}`)
    .join('; ')})`;
}

type InvoiceFacePayment = {
  key: string;
  method: string;
  amount: number;
  date?: string | null;
  receiptNumber?: string | null;
  cashier?: string | null;
  extra?: string | null;
  onVoid?: () => void;
};

function paymentFaceLabel(p: InvoiceFacePayment): string {
  return [
    p.method,
    p.receiptNumber ? `Receipt #${p.receiptNumber}` : null,
    p.date,
    p.cashier,
    p.extra,
  ]
    .filter(Boolean)
    .join(' · ');
}

function StaffVoidedPayments({ items }: { items: { key: string; text: string }[] }) {
  if (!items.length) return null;
  return (
    <details className="client-fin__staff-audit">
      <summary>Staff only · voided payments ({items.length})</summary>
      <p className="client-fin__muted">
        Kept for staff lookup. Not printed or emailed to the client.
      </p>
      <ul>
        {items.map((item) => (
          <li key={item.key}>{item.text}</li>
        ))}
      </ul>
    </details>
  );
}

function activeLines(invoice: VisitInvoice | null): VisitInvoiceLine[] {
  return (invoice?.lines ?? []).filter((l) => !l.isDeleted);
}

function apiErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return msg ?? e?.message ?? 'Something went wrong.';
}

function methodLabel(method: VisitTenderMethod, paymentTypeName?: string | null): string {
  const named = paymentTypeName?.trim();
  if (named) return named;
  if (method === 'carecredit') return 'CareCredit';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function statusLabel(status: string): string {
  const s = status.trim();
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function staffName(employee: Employee | undefined, fallbackId?: number | null): string {
  if (employee) {
    const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
  }
  return fallbackId != null ? `Employee #${fallbackId}` : '—';
}

function staffShortName(employee?: Employee, name?: string | null): string | null {
  const first = employee?.firstName?.trim();
  const last = employee?.lastName?.trim();
  if (first) {
    const initial = last?.[0];
    return initial ? `${first} ${initial.toUpperCase()}.` : first;
  }
  const parts = (name ?? '').trim().split(/\s+/).filter((p) => p && !/^(dr|dra|mr|mrs|ms)\.?$/i.test(p));
  const given = parts[0];
  const surname = parts.length > 1 ? parts[parts.length - 1] : '';
  if (given && surname && !/^(dvm|vm|phd|dacv[a-z]+)\.?$/i.test(surname)) {
    return `${given} ${surname[0].toUpperCase()}.`;
  }
  return given || null;
}

function savedDirections(line: VisitInvoiceLine): string {
  return line.instructions?.trim() || '';
}

function savedRefills(line: VisitInvoiceLine): string {
  return line.refillCount == null || !Number.isFinite(Number(line.refillCount))
    ? ''
    : String(line.refillCount);
}

type SigDraft = { instructions: string; refillCount: string };

function defaultSigDraft(line: VisitInvoiceLine): SigDraft {
  return {
    instructions: lineDirections(line),
    refillCount: lineRefills(line),
  };
}

function isPrescriptionLine(line: VisitInvoiceLine): boolean {
  const type = String(line.catalogItemType ?? '').toLowerCase();
  if (type === 'inventory') return true;
  if (type === 'procedure' || type === 'lab') return false;
  return Boolean(
    line.catalogInstructions?.trim() ||
      line.catalogRefill != null ||
      line.instructions?.trim() ||
      (line.refillCount != null && Number.isFinite(Number(line.refillCount))),
  );
}

function isDiscountType(name: string | null | undefined, discountNames: Set<string>): boolean {
  const key = name?.trim().toLowerCase();
  return Boolean(key && discountNames.has(key));
}

function isImportAdjustment(line: { description?: string | null }): boolean {
  return (line.description ?? '') === 'eVet billed-total adjustment';
}

function isPlaceholderPetName(name: string | null | undefined): boolean {
  return !name?.trim() || /^Pet #\d+$/i.test(name.trim());
}

function ledgerTime(iso: string | null | undefined, formatted?: string): number {
  const fromIso = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(fromIso)) return fromIso;
  const fromLabel = formatted ? Date.parse(formatted) : NaN;
  return Number.isFinite(fromLabel) ? fromLabel : 0;
}

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function visitPetName(appt: Appointment, pets: FinancialPet[]): string {
  if (appt.patient?.name?.trim()) return appt.patient.name.trim();
  const multi = (appt as { patients?: { id?: unknown; name?: string | null }[] }).patients;
  if (Array.isArray(multi) && multi.length) {
    const names = multi
      .map((p) => p?.name?.trim() || pets.find((pet) => String(pet.id) === String(p?.id))?.name)
      .filter(Boolean);
    if (names.length) return names.join(', ');
  }
  const pid = appt.patient?.id;
  if (pid != null) return pets.find((p) => p.id === pid)?.name ?? `Pet #${pid}`;
  return 'Household';
}

function visitTypeLabel(appt: Appointment): string | null {
  const t = appt.appointmentType;
  if (!t || typeof t !== 'object') return null;
  return t.prettyName?.trim() || t.name?.trim() || null;
}

function formatVisitOption(appt: Appointment, pets: FinancialPet[]): string {
  const start = DateTime.fromISO(appt.appointmentStart).setZone(PRACTICE_TZ);
  const datePart = start.isValid ? start.toLocaleString(DateTime.DATE_MED) : 'Visit';
  const timePart = start.isValid ? start.toLocaleString(DateTime.TIME_SIMPLE) : '';
  const pet = visitPetName(appt, pets);
  const type = visitTypeLabel(appt);
  const when = timePart ? `${datePart} · ${timePart}` : datePart;
  return [when, pet, type].filter(Boolean).join(' · ');
}

export default function ClientFinancialWorkspace({
  clientId,
  clientName,
  evetBalance,
  evetInvoices,
  pets,
  cashierEmployeeId,
  clientEmail,
  clientPhone,
  clientDoNotSms,
  initialInvoiceId,
  openNew = false,
  initialPatientId,
  initialAppointmentId,
  onSelectInvoice,
  onCommunicationLogged,
  onCombinedBalance,
}: Props) {
  const [scoutInvoices, setScoutInvoices] = useState<VisitInvoice[]>([]);
  const [selected, setSelected] = useState<VisitInvoice | null>(null);
  const [evetSelected, setEvetSelected] = useState<NormalizedInvoice | null>(null);
  const [evetLoaded, setEvetLoaded] = useState<NormalizedInvoice[]>(evetInvoices);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [linePatientId, setLinePatientId] = useState<number | null>(initialPatientId ?? pets[0]?.id ?? null);
  const [visits, setVisits] = useState<Appointment[]>([]);
  const [tenderMethod, setTenderMethod] = useState<VisitTenderMethod>('cash');
  const [tenderAmount, setTenderAmount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returning, setReturning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [sigDrafts, setSigDrafts] = useState<Record<string, SigDraft>>({});
  const [extraPets, setExtraPets] = useState<FinancialPet[]>([]);
  const [staffById, setStaffById] = useState<Map<number, Employee>>(new Map());
  const [providers, setProviders] = useState<Provider[]>([]);
  const staffTriedRef = useRef<Set<number>>(new Set());
  const [terminalJob, setTerminalJob] = useState<string | null>(null);
  const [payCompose, setPayCompose] = useState<null | { channel: 'email' | 'sms'; url: string; amount: number; labels: string[] }>(
    null
  );
  const [invoiceEmail, setInvoiceEmail] = useState<{
    kind: 'invoice' | 'receipt' | 'ledger';
    subject: string;
    body: string;
    merge: MergeValues;
    attachments: GmailComposeAttachment[];
    regardingPatientId: number | null;
    regardingPatientIds: number[];
    includeInPatientEmr: boolean;
  } | null>(null);
  const [paySms, setPaySms] = useState('');
  const [paySmsSending, setPaySmsSending] = useState(false);
  const [paySmsError, setPaySmsError] = useState<string | null>(null);
  const [paymentTypes, setPaymentTypes] = useState<PracticePaymentType[]>([]);
  const [tenderPaymentType, setTenderPaymentType] = useState('');
  const [discountTypeNames, setDiscountTypeNames] = useState<Set<string>>(new Set());
  const appliedPrefill = useRef(false);
  const [splitPct, setSplitPct] = useState(readFinSplitPct);
  const [splitting, setSplitting] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startX: number; startPct: number } | null>(null);

  const persistSplit = useCallback((pct: number) => {
    const clamped = Math.min(FIN_SPLIT_MAX, Math.max(FIN_SPLIT_MIN, pct));
    setSplitPct(clamped);
    try {
      localStorage.setItem(FIN_SPLIT_KEY, String(Math.round(clamped * 10) / 10));
    } catch {
      /* ignore */
    }
  }, []);

  const applySplitFromPointer = useCallback(
    (clientX: number) => {
      const el = splitRef.current;
      const drag = splitDragRef.current;
      if (!el || !drag) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      persistSplit(drag.startPct + ((clientX - drag.startX) / rect.width) * 100);
    },
    [persistSplit],
  );

  const onSplitterPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitDragRef.current = { startX: e.clientX, startPct: splitPct };
      setSplitting(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [splitPct],
  );

  const onSplitterPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!splitDragRef.current) return;
      applySplitFromPointer(e.clientX);
    },
    [applySplitFromPointer],
  );

  const endSplitterDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current) return;
    splitDragRef.current = null;
    setSplitting(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  useEffect(() => {
    if (!splitting) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [splitting]);

  const allPets = useMemo(() => {
    const byId = new Map<number, FinancialPet>();
    for (const p of pets) byId.set(p.id, p);
    for (const p of extraPets) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()];
  }, [pets, extraPets]);

  const providerOptions = useMemo(() => {
    const rows = providers.filter((e) => e?.id != null && Number(e.id) > 0);
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return rows;
  }, [providers]);

  const primaryProviderIdFor = (patientId: number | null | undefined): number | null => {
    if (patientId == null) return null;
    const id = allPets.find((p) => p.id === patientId)?.primaryProviderId;
    return id != null && Number.isFinite(id) && id > 0 ? id : null;
  };

  const petName = (id: number | null | undefined, fallbackName?: string | null) => {
    if (fallbackName && !isPlaceholderPetName(fallbackName)) return fallbackName;
    if (id == null) return fallbackName?.trim() || '—';
    const known = allPets.find((p) => p.id === id)?.name;
    if (known && !isPlaceholderPetName(known)) return known;
    return fallbackName?.trim() || `Pet #${id}`;
  };

  async function refreshList(preferId?: string | null) {
    const rows = await listClientVisitInvoices(clientId);
    setScoutInvoices(rows);
    const keep = preferId ?? selected?.id;
    if (keep) {
      const found = rows.find((r) => r.id === keep);
      if (found) setSelected(found);
    }
    return rows;
  }

  useEffect(() => {
    let cancelled = false;
    void fetchClientBillingStaff(clientId, VISIT_WORKFLOW_PRACTICE_ID)
      .then((raw) => {
        if (cancelled) return;
        const rows = normalizeInvoicesFromClient(raw);
        if (rows.length) setEvetLoaded(rows);
      })
      .catch(() => {
        /* keep prop invoices */
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    if (evetInvoices.length && evetLoaded.length === 0) setEvetLoaded(evetInvoices);
  }, [evetInvoices, evetLoaded.length]);

  const evetLedgerInvoices = evetLoaded.length ? evetLoaded : evetInvoices;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const rows = await listClientVisitInvoices(clientId);
        if (cancelled) return;
        setScoutInvoices(rows);
        let next: VisitInvoice | null = null;
        if (initialInvoiceId && initialInvoiceId !== 'new') {
          next = rows.find((r) => r.id === initialInvoiceId) ?? (await getInvoice(initialInvoiceId));
        } else if (openNew || initialInvoiceId === 'new') {
          next = await ensureCounterInvoice({
            clientId,
            patientId: initialPatientId,
            appointmentId: initialAppointmentId,
          });
          onSelectInvoice?.(next.id);
        }
        if (!cancelled) {
          setSelected(next);
          if (next && !rows.some((r) => r.id === next!.id)) {
            setScoutInvoices([next, ...rows]);
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setError(apiErr(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally once per client open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    void fetchAllEmployees()
      .then((rows) => {
        if (cancelled) return;
        setStaffById((prev) => {
          const next = new Map(prev);
          for (const row of rows) {
            if (row?.id != null) next.set(Number(row.id), row);
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setStaffById(new Map());
      });
    void fetchPrimaryProviders()
      .then((rows) => {
        if (!cancelled) setProviders(rows);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listPaymentTypes()
      .then((rows) => {
        if (cancelled) return;
        setPaymentTypes(rows.filter((r) => r.isActive !== false));
        setDiscountTypeNames(
          new Set(
            rows
              .filter((r) => r.isDiscountCategory && r.isActive !== false)
              .map((r) => r.name.trim().toLowerCase()),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setPaymentTypes([]);
          setDiscountTypeNames(new Set());
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ids = new Set<number>();
    if (cashierEmployeeId != null) ids.add(cashierEmployeeId);
    for (const inv of scoutInvoices) {
      for (const tender of inv.tenders ?? []) {
        if (tender.cashierEmployeeId != null) ids.add(tender.cashierEmployeeId);
        if (tender.voidedByEmployeeId != null) ids.add(tender.voidedByEmployeeId);
      }
      if (inv.createdByEmployeeId != null) ids.add(inv.createdByEmployeeId);
      if (inv.voidedByEmployeeId != null) ids.add(inv.voidedByEmployeeId);
      if (inv.deletedByEmployeeId != null) ids.add(inv.deletedByEmployeeId);
      for (const line of inv.lines ?? []) {
        if (line.providerEmployeeId != null) ids.add(line.providerEmployeeId);
        if (line.enteredByEmployeeId != null) ids.add(line.enteredByEmployeeId);
        if (line.instructionsEnteredByEmployeeId != null) ids.add(line.instructionsEnteredByEmployeeId);
      }
    }
    if (selected) {
      for (const tender of selected.tenders ?? []) {
        if (tender.cashierEmployeeId != null) ids.add(tender.cashierEmployeeId);
        if (tender.voidedByEmployeeId != null) ids.add(tender.voidedByEmployeeId);
      }
      for (const line of selected.lines ?? []) {
        if (line.providerEmployeeId != null) ids.add(line.providerEmployeeId);
        if (line.enteredByEmployeeId != null) ids.add(line.enteredByEmployeeId);
        if (line.instructionsEnteredByEmployeeId != null) ids.add(line.instructionsEnteredByEmployeeId);
      }
    }
    const missing = [...ids].filter((id) => !staffById.has(id) && !staffTriedRef.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => staffTriedRef.current.add(id));
    let cancelled = false;
    void Promise.all(missing.map((id) => fetchEmployee(id).catch(() => null))).then((rows) => {
      if (cancelled) return;
      setStaffById((prev) => {
        const next = new Map(prev);
        for (const row of rows) {
          if (row?.id != null) next.set(Number(row.id), row);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [cashierEmployeeId, scoutInvoices, selected, staffById]);

  useEffect(() => {
    let cancelled = false;
    void fetchClientAppointmentsStaff(clientId, {
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      activePatientsOnly: false,
    })
      .then((rows) => {
        if (cancelled) return;
        const usable = rows.filter(
          (a) =>
            !a.isDeleted &&
            a.isActive !== false &&
            !isAppointmentCancelledOnPracticeCalendar(a)
        );
        usable.sort((a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart));
        setVisits(usable);
      })
      .catch(() => {
        if (!cancelled) setVisits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    setPendingDeleteIds([]);
    setReturnQty({});
  }, [selected?.id]);

  useEffect(() => {
    const known = new Set(
      [...pets, ...extraPets]
        .filter((p) => !isPlaceholderPetName(p.name))
        .map((p) => p.id)
    );
    const seeded: FinancialPet[] = [];
    const consider = (id: number | null | undefined, name?: string | null) => {
      if (id == null || known.has(id)) return;
      if (name && name !== '—' && !isPlaceholderPetName(name)) {
        seeded.push({ id, name });
        known.add(id);
      }
    };
    for (const inv of scoutInvoices) {
      consider(inv.patientId);
      for (const line of inv.lines ?? []) consider(line.patientId, line.patientName);
    }
    for (const inv of evetInvoices) {
      for (const line of inv.lines) consider(line.patientId, line.patient);
    }
    if (seeded.length) {
      setExtraPets((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        let changed = false;
        for (const p of seeded) {
          const cur = byId.get(p.id);
          if (!cur || isPlaceholderPetName(cur.name)) {
            byId.set(p.id, p);
            changed = true;
          }
        }
        return changed ? [...byId.values()] : prev;
      });
    }
    const missing = new Set<number>();
    for (const inv of scoutInvoices) {
      if (inv.patientId != null && !known.has(inv.patientId)) missing.add(inv.patientId);
      for (const line of inv.lines ?? []) {
        if (line.patientId != null && !known.has(line.patientId)) missing.add(line.patientId);
      }
    }
    for (const inv of evetInvoices) {
      for (const line of inv.lines) {
        if (line.patientId != null && !known.has(line.patientId)) missing.add(line.patientId);
      }
    }
    if (!missing.size) return;
    let cancelled = false;
    void Promise.all(
      [...missing].map(async (id) => {
        try {
          const row = (await fetchPatientByIdStaff(id)) as Record<string, unknown> | null;
          const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : null;
          const nested = row?.primaryProvider;
          const fromNested =
            nested && typeof nested === 'object' ? Number((nested as { id?: unknown }).id) : NaN;
          const fromFlat = Number(row?.primaryProviderId);
          const primaryProviderId =
            Number.isFinite(fromNested) && fromNested > 0
              ? fromNested
              : Number.isFinite(fromFlat) && fromFlat > 0
                ? fromFlat
                : null;
          return { id, name: name ?? `Pet #${id}`, primaryProviderId };
        } catch {
          return { id, name: `Pet #${id}` };
        }
      })
    ).then((rows) => {
      if (!cancelled) {
        setExtraPets((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const row of rows) {
            const cur = byId.get(row.id);
            if (!cur || isPlaceholderPetName(cur.name)) byId.set(row.id, row);
          }
          return [...byId.values()];
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scoutInvoices, evetInvoices, pets, extraPets]);

  useEffect(() => {
    if (!selected || appliedPrefill.current) return;
    const refill = readFinancialPrefill();
    if (!refill) return;
    appliedPrefill.current = true;
    void applyPrefill(selected, refill);
  }, [selected]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchItems({
        q,
        practiceId: VISIT_WORKFLOW_PRACTICE_ID,
        limit: 8,
        patientId: linePatientId ?? undefined,
        clientId,
      })
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, linePatientId, clientId]);

  useEffect(() => {
    if (!terminalJob || !selected?.id) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await getInvoice(selected.id);
        if (stopped || fresh.status !== 'paid') return;
        window.clearInterval(timer);
        setTerminalJob(null);
        setSelected(fresh);
        await refreshList(fresh.id);
        setNote('Payment received on Scout Terminal.');
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [terminalJob, selected?.id]);

  const visitLabel = (appointmentId: number | null | undefined): string | null => {
    if (appointmentId == null) return null;
    const appt = visits.find((v) => v.id === appointmentId);
    return appt ? formatVisitOption(appt, allPets) : null;
  };

  const ledger = useMemo((): LedgerRow[] => {
    const scoutRows: LedgerRow[] = scoutInvoices.map((inv) => {
      const deleted = inv.isDeleted === true;
      const actorNote = deleted
        ? inv.deletedByEmployeeId != null
          ? `Deleted by ${staffName(staffById.get(inv.deletedByEmployeeId), inv.deletedByEmployeeId)}`
          : 'Deleted'
        : inv.status === 'void'
          ? [
              inv.voidedByEmployeeId != null
                ? `Voided by ${staffName(staffById.get(inv.voidedByEmployeeId), inv.voidedByEmployeeId)}`
                : 'Voided',
              inv.voidReason,
            ]
              .filter(Boolean)
              .join(' · ')
          : null;
      return {
        key: `scout:${inv.id}`,
        source: 'scout',
        label: inv.lines?.some((l) => l.returnOfLineId)
          ? invoicePublicLabel(inv, { isReturn: true })
          : inv.evetInvoiceNumber != null || inv.scoutInvoiceNumber != null
            ? invoicePublicLabel(inv)
            : inv.appointmentId
              ? visitLabel(inv.appointmentId) ?? `Visit ${inv.appointmentId}`
              : invoicePublicLabel(inv),
        date: formatTs(
          inv.deletedAt ?? inv.voidedAt ?? inv.paidAt ?? inv.finalizedAt ?? inv.created,
        ),
        sortAt: ledgerTime(
          inv.deletedAt ?? inv.voidedAt ?? inv.paidAt ?? inv.finalizedAt ?? inv.created,
        ),
        status: ledgerArStatus({
          status: deleted ? 'deleted' : inv.status,
          isDeleted: deleted,
          total: Number(inv.total) || 0,
          paid: Number(inv.amountPaid) || 0,
        }),
        actorNote,
        paymentNote: voidedPaymentNote(
          (inv.tenders ?? [])
            .filter((tender) => tender.voidedAt)
            .map((tender) => ({
              label: methodLabel(tender.method, tender.paymentTypeName),
              amount: Number(tender.amount) || 0,
            })),
        ),
        total: Number(inv.total) || 0,
        paid: Number(inv.amountPaid) || 0,
        due: deleted || inv.status === 'void' ? 0 : dueOf(inv),
        scout: inv,
      };
    });
    const adoptedEvetIds = new Set(
      scoutInvoices.map((inv) => inv.evetInvoiceId).filter((id): id is number => id != null)
    );
    const evetRows: LedgerRow[] = evetLedgerInvoices
      .filter((inv) => {
        const id = Number(inv.raw.id);
        if (Number.isFinite(id) && adoptedEvetIds.has(id)) return false;
        return true;
      })
      .map((inv) => {
        const deleted = inv.raw.isDeleted === true;
        const deletedBy =
          typeof inv.raw.deletedByName === 'string' && inv.raw.deletedByName.trim()
            ? inv.raw.deletedByName.trim()
            : null;
        return {
          key: `evet:${inv.key}`,
          source: 'evet',
          label: `#${inv.number}`,
          date: inv.date,
          sortAt: ledgerTime(
            typeof inv.raw.invoicedDate === 'string' ? inv.raw.invoicedDate : null,
            inv.date
          ),
          status: ledgerArStatus({
            status: deleted ? 'deleted' : inv.status,
            isDeleted: deleted,
            total: inv.total,
            paid: inv.paid,
          }),
          actorNote: deleted
            ? [
                deletedBy ? `Deleted by ${deletedBy}` : 'Deleted',
                !deletedBy && inv.createdBy !== '—' ? `created by ${inv.createdBy}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : null,
          paymentNote: voidedPaymentNote(
            evetPaymentsOnInvoice(inv)
              .filter((pay) => pay.isVoided)
              .map((pay) => ({
                label: pay.method?.trim() || 'payment',
                amount: pay.amount,
              })),
          ),
          total: inv.total,
          paid: inv.paid,
          due: deleted ? 0 : inv.due,
          evet: inv,
        };
      });
    return [...scoutRows, ...evetRows].sort((a, b) => b.sortAt - a.sortAt);
  }, [scoutInvoices, evetLedgerInvoices, visits, allPets, staffById]);

  const visibleLedger = ledger.filter((row) => {
    const status = row.status.toLowerCase();
    if (filter === 'all') return true;
    if (filter === 'returns') {
      return Boolean(row.scout?.lines?.some((l) => l.returnOfLineId));
    }
    if (filter === 'void') return status === 'void' || status === 'deleted';
    return status === filter;
  });

  const combinedBalance = (evetBalance ?? 0) + scoutArFromInvoices(scoutInvoices);
  useEffect(() => {
    onCombinedBalance?.(combinedBalance);
  }, [combinedBalance, onCombinedBalance]);
  const adoptedEvetIds = useMemo(
    () => new Set(scoutInvoices.map((inv) => inv.evetInvoiceId).filter((id): id is number => id != null)),
    [scoutInvoices]
  );
  const unpaidEvet = useMemo(
    () =>
      evetLedgerInvoices.filter((inv) => {
        const id = Number(inv.raw.id);
        if (Number.isFinite(id) && adoptedEvetIds.has(id)) return false;
        if (inv.raw.isDeleted === true || String(inv.status).toLowerCase() === 'void' || String(inv.status).toLowerCase() === 'deleted') return false;
        return inv.due > 0.009;
      }),
    [evetLedgerInvoices, adoptedEvetIds]
  );
  const unpaidScout = useMemo(
    () =>
      scoutInvoices.filter(
        (inv) => inv.isDeleted !== true && inv.status !== 'void' && dueOf(inv) > 0.009
      ),
    [scoutInvoices]
  );
  const unpaidTotal = unpaidScout.reduce((s, inv) => s + dueOf(inv), 0) + unpaidEvet.reduce((s, inv) => s + inv.due, 0);

  async function startPayLink(channel: 'email' | 'sms') {
    if (channel === 'email' && !clientEmail?.trim()) {
      setError('Add a client email to send a pay link.');
      return;
    }
    if (channel === 'sms' && !clientPhone?.trim()) {
      setError('Add a client phone number to send a pay link.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const inv of unpaidEvet) {
        const evetId = Number(inv.raw.id);
        if (Number.isFinite(evetId)) await adoptEvetInvoice(evetId);
      }
      if (unpaidEvet.length) await refreshList();
      const here = window.location.href;
      const link = await createClientPayLink(clientId, { successUrl: here, cancelUrl: here });
      const labels = link.invoiceLabels.join(', ');
      if (channel === 'email') {
        setPayCompose({ channel: 'email', url: link.url, amount: link.amount, labels: link.invoiceLabels });
      } else {
        setPaySms(
          applySystemTemplateIfCustom(
            'payment_link_sms',
            payLinkMerge(clientName, link.amount, labels, link.url),
            `Hi ${clientName.split(' ')[0] || 'there'}, here is a secure link to pay ${money(link.amount)} for ${labels}: ${link.url}`,
          ),
        );
        setPaySmsError(null);
        setPayCompose({ channel: 'sms', url: link.url, amount: link.amount, labels: link.invoiceLabels });
      }
      setNote(`Pay link ready for ${money(link.amount)}.`);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function startInvoiceEmail() {
    const scout = selected && selected.isDeleted !== true && selected.status !== 'void' ? selected : null;
    const evet = evetSelected && evetSelected.raw.isDeleted !== true ? evetSelected : null;
    if (!scout && !evet) {
      setError('Open an invoice to email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scoutTenders = (scout?.tenders ?? []).filter((t) => !t.voidedAt);
      const evetPays = evet ? evetPaymentsOnInvoice(evet).filter((p) => !p.isVoided) : [];
      const charged = evet
        ? evet.lines.reduce((sum, line) => sum + (Number(line.total) || 0), 0)
        : Number(scout?.subtotal) || 0;
      const taxSum = evet
        ? evet.lines.reduce((sum, line) => sum + (Number(line.tax) || 0), 0)
        : Number(scout?.taxTotal) || 0;
      const total = evet ? evet.total : Number(scout?.total) || 0;
      const paid = evet ? evet.paid : Number(scout?.amountPaid) || 0;
      const due = evet
        ? evet.due
        : Math.max(0, total - paid);
      const tax =
        evet && Math.abs(total - charged - taxSum) >= 0.05
          ? Math.max(0, total - charged)
          : taxSum;
      const isReceipt = due <= 0.009;
      const receiptNo = evetPays.find((p) => p.receiptNumber)?.receiptNumber;
      const model: InvoiceEmailModel = {
        kind: isReceipt ? 'receipt' : 'invoice',
        label: isReceipt
          ? receiptNo
            ? `Receipt #${receiptNo}`
            : evet
              ? `Receipt for invoice #${evet.number}`
              : 'Receipt'
          : evet
            ? `Invoice #${evet.number}`
            : `Invoice ${invoicePublicLabel(scout!)}`,
        date: evet
          ? evet.date !== '—'
            ? evet.date
            : undefined
          : scout?.created
            ? formatTs(scout.created)
            : undefined,
        clientName,
        lines: evet
          ? evet.lines.map((l) => ({
              description: l.description,
              pet: l.patient,
              qty: Number(l.qty) || 1,
              amount: l.total,
              listAmount:
                l.originalPrice != null ? l.originalPrice * (Number(l.qty) || 1) : null,
            }))
          : (scout!.lines ?? [])
              .filter((l) => l.isDeleted !== true)
              .map((l) => ({
                description: l.description,
                pet: petName(l.patientId, l.patientName),
                qty: Number(l.qty) || 1,
                amount: Number(l.amount) || 0,
                listAmount:
                  l.listUnitPrice != null
                    ? Number(l.listUnitPrice) * (Number(l.qty) || 1)
                    : null,
              })),
        payments: evet
          ? evetPays.map((p) => ({
              date: p.receivedAt ? formatTs(p.receivedAt) : evet.date,
              method: p.method ?? 'Payment',
              receiptNumber: p.receiptNumber ?? undefined,
              amount: p.amount,
            }))
          : scoutTenders.map((t) => ({
              date: formatTs(t.receivedAt),
              method: t.paymentTypeName || t.method,
              amount: Number(t.amount) || 0,
            })),
        subtotal: charged,
        tax,
        total,
        paid,
        due,
      };
      let payUrl = '';
      if (!isReceipt && model.due > 0.009) {
        try {
          const here = window.location.href;
          const link = await createClientPayLink(clientId, { successUrl: here, cancelUrl: here });
          payUrl = link.url;
        } catch {
          /* still send the invoice without a pay button */
        }
      }
      model.payLink = payUrl || null;
      if (!isReceipt && model.due > 0.009 && !payUrl) {
        setNote('Could not create a pay link. You can still send the invoice.');
      }
      const pdf = await invoicePdfAttachment(model);
      const patientIds = new Set<number>();
      if (scout?.patientId) patientIds.add(scout.patientId);
      for (const line of scout?.lines ?? []) {
        if (line.patientId != null) patientIds.add(line.patientId);
      }
      for (const line of evet?.lines ?? []) {
        if (line.patientId != null) patientIds.add(line.patientId);
      }
      const regardingPatientId = patientIds.size === 1 ? [...patientIds][0] : null;
      const pet = allPets.find((p) => p.id === regardingPatientId);
      const templateKey = isReceipt ? 'receipt_email' : 'invoice_email';
      const merge = withClinicDefaults({
        ...mergeValuesFromNames({
          clientFullName: clientName,
          clientFirstName: firstNameFromDisplayName(clientName),
          patientName: pet?.name ?? null,
        }),
        amount: money(model.due),
        invoice_total: money(model.total),
        invoice_labels: model.label,
        pay_link: payUrl,
        pay_button: payButtonHtml(payUrl),
        invoice_html: invoiceTableHtml(model),
      });
      setInvoiceEmail({
        kind: model.kind,
        subject: applySystemSubject(
          templateKey,
          merge,
          isReceipt ? 'Your receipt from Vet At Your Door' : 'Your invoice from Vet At Your Door',
        ),
        body: applySystemTemplate(templateKey, merge),
        merge,
        attachments: [pdf],
        regardingPatientId: null,
        regardingPatientIds: [...patientIds],
        includeInPatientEmr: false,
      });
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function startLedgerEmail() {
    const rows = ledger.filter((row) => {
      const status = row.status.toLowerCase();
      return status !== 'void' && status !== 'deleted';
    });
    if (!rows.length) {
      setError('No invoices to include on a client ledger.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const balance = rows.reduce((sum, row) => sum + (Number(row.due) || 0), 0);
      const clientRows = rows.map((row) => ({
        date: row.date,
        label: row.label,
        status: statusLabel(row.status),
        total: row.total,
        paid: row.paid,
        due: row.due,
      }));
      let payUrl = '';
      if (balance > 0.009) {
        try {
          const here = window.location.href;
          const link = await createClientPayLink(clientId, { successUrl: here, cancelUrl: here });
          payUrl = link.url;
        } catch {
          /* still send the ledger without a pay button */
        }
      }
      const ledgerHtml = ledgerTableHtml({
        clientName,
        rows: clientRows,
        balance,
        payLink: payUrl || null,
      });
      const pdf = await ledgerPdfAttachment({
        clientName,
        rows: clientRows,
        balance,
      });
      const amountLabel =
        balance > 0.005
          ? `${money(balance)} due`
          : balance < -0.005
            ? `${money(Math.abs(balance))} credit`
            : money(0);
      const merge = withClinicDefaults({
        ...mergeValuesFromNames({
          clientFullName: clientName,
          clientFirstName: firstNameFromDisplayName(clientName),
        }),
        amount: amountLabel,
        invoice_labels: 'Account ledger',
        pay_link: payUrl,
        pay_button: payButtonHtml(payUrl),
        ledger_html: ledgerHtml,
      });
      setInvoiceEmail({
        kind: 'ledger',
        subject: applySystemSubject(
          'ledger_email',
          merge,
          'Your account ledger from Vet At Your Door',
        ),
        body: applySystemTemplate('ledger_email', merge),
        merge,
        attachments: [pdf],
        regardingPatientId: null,
        regardingPatientIds: [],
        includeInPatientEmr: false,
      });
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  const lines = activeLines(selected);
  const pendingDeleteSet = useMemo(() => new Set(pendingDeleteIds), [pendingDeleteIds]);
  const displayLines = lines.filter((l) => !pendingDeleteSet.has(l.id));
  const visibleLines = displayLines.filter((l) => !isImportAdjustment(l));
  const hasUnsavedDeletes = pendingDeleteIds.length > 0;
  const draftOf = (line: VisitInvoiceLine): SigDraft => sigDrafts[line.id] ?? defaultSigDraft(line);
  const lineSigDirty = (line: VisitInvoiceLine): boolean => {
    const d = draftOf(line);
    return d.instructions.trim() !== savedDirections(line) || d.refillCount.trim() !== savedRefills(line);
  };
  const previewSubtotal = displayLines
    .filter((l) => !l.isCovered)
    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const previewTax = displayLines.reduce((sum, l) => sum + (Number(l.taxAmount) || 0), 0);
  const previewTotal = Math.round((previewSubtotal + previewTax) * 100) / 100;
  const remaining = selected
    ? Math.max(
        0,
        (hasUnsavedDeletes ? previewTotal : Number(selected.total) || 0) -
          (Number(selected.amountPaid) || 0)
      )
    : 0;
  const invoiceGone = selected?.isDeleted === true;
  const canEdit = !invoiceGone && selected?.status === 'open' && !lines.some((l) => l.orderId);
  const dirtySigLines = canEdit ? visibleLines.filter((l) => isPrescriptionLine(l) && lineSigDirty(l)) : [];
  const hasDirtySigs = dirtySigLines.length > 0;
  const selectedPayType =
    paymentTypes.find((r) => r.name === tenderPaymentType) ?? null;
  const canPay =
    selected && !invoiceGone && selected.status !== 'void' && remaining > 0 && !hasUnsavedDeletes;
  const canReturn =
    selected &&
    !invoiceGone &&
    (selected.status === 'paid' || selected.status === 'finalized') &&
    !lines.some((l) => l.returnOfLineId);
  const isSoapInvoice = lines.some((l) => l.orderId);
  const canRemoveLines = Boolean(
    selected &&
      !invoiceGone &&
      selected.status !== 'void' &&
      !isSoapInvoice &&
      (canEdit || editing)
  );
  const hasUnsavedEdits = editing || hasUnsavedDeletes;

  useEffect(() => {
    setInvoiceDirectionsDirty(clientId, hasDirtySigs);
  }, [clientId, hasDirtySigs]);
  useEffect(() => {
    return () => setInvoiceDirectionsDirty(null, false);
  }, [clientId]);
  const canUnlock =
    selected &&
    !invoiceGone &&
    !isSoapInvoice &&
    (selected.status === 'paid' || selected.status === 'finalized');
  const liveTenders = (selected?.tenders ?? []).filter((t) => !t.voidedAt);
  const canDiscard =
    selected &&
    !invoiceGone &&
    selected.status === 'open' &&
    !isSoapInvoice &&
    liveTenders.length === 0 &&
    Number(selected.amountPaid) <= 0.005;
  const canVoidInvoice =
    selected && !invoiceGone && selected.status !== 'void' && !isSoapInvoice && !canDiscard;

  async function applyPrefill(invoice: VisitInvoice, refill: FinancialRefillPrefill) {
    const already = activeLines(invoice).some(
      (l) => l.description === refill.name && (l.instructions ?? '') === (refill.instructions ?? '')
    );
    if (already) return;
    setBusy(true);
    try {
      const next = await addCounterInvoiceLine(invoice.id, {
        description: refill.name,
        qty: refill.qty > 0 ? refill.qty : 1,
        unitPrice: refill.unitPrice ?? undefined,
        instructions: refill.instructions || null,
        catalogItemId: refill.catalogItemId ?? null,
        catalogItemType: refill.catalogItemId != null ? 'inventory' : null,
        patientId: linePatientId,
        providerEmployeeId: primaryProviderIdFor(linePatientId),
      });
      setSelected(next);
      await refreshList(next.id);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function startNewInvoice() {
    if (hasDirtySigs) {
      void appAlert({ title: 'Directions not saved', message: INVOICE_DIRECTIONS_LEAVE_MESSAGE });
      return;
    }
    setBusy(true);
    setError(null);
    setEvetSelected(null);
    setReturning(false);
    setEditing(false);
    try {
      const next = await ensureCounterInvoice({
        clientId,
        patientId: initialPatientId ?? linePatientId,
        appointmentId: initialAppointmentId,
      });
      setSelected(next);
      onSelectInvoice?.(next.id);
      await refreshList(next.id);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function addItem(item: SearchableItem) {
    if (!selected) return;
    const catalog =
      item.itemType === 'inventory'
        ? item.inventoryItem
        : item.itemType === 'lab'
          ? item.lab
          : item.procedure;
    const catalogId =
      catalog && typeof catalog === 'object' && catalog.id != null ? Number(catalog.id) : null;
    let priced = getCatalogLinePrice(item, 1);
    let listUnit = Number(
      item.originalPrice ?? item.wellnessPlanPricing?.originalPrice ?? priced.unitFinal
    );
    if (linePatientId != null && catalogId != null) {
      try {
        const checked = await checkItemPricing({
          patientId: linePatientId,
          practiceId: VISIT_WORKFLOW_PRACTICE_ID,
          clientId,
          itemType: item.itemType,
          item: buildCheckItemPayloadFromSearch(item),
        });
        priced = getCatalogLinePrice(pricingItemFromSearchAndCheck(item, checked), 1);
        listUnit = Number(checked.originalPrice ?? listUnit);
      } catch {
        /* search result already includes room-loader pricing */
      }
    }
    setBusy(true);
    setError(null);
    try {
      const next = await addCounterInvoiceLine(selected.id, {
        description: item.name,
        qty: 1,
        unitPrice: priced.unitFinal,
        isCovered: priced.isCovered,
        catalogItemId: Number.isFinite(catalogId) ? catalogId : null,
        catalogItemType: item.itemType || null,
        listUnitPrice: listUnit > priced.unitFinal + 0.009 ? listUnit : null,
        patientId: linePatientId,
        providerEmployeeId: primaryProviderIdFor(linePatientId),
      });
      setSelected(next);
      setQuery('');
      setHits([]);
      await refreshList(next.id);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function patchLine(line: VisitInvoiceLine, body: Parameters<typeof updateCounterInvoiceLine>[2]) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateCounterInvoiceLine(selected.id, line.id, body);
      setSelected(next);
      await refreshList(next.id);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function persistDirections(rows: VisitInvoiceLine[]) {
    if (!selected || !rows.length) return;
    setBusy(true);
    setError(null);
    try {
      let next = selected;
      for (const line of rows) {
        const d = draftOf(line);
        const refillRaw = d.refillCount.trim();
        const refillCount = refillRaw === '' ? null : Number(refillRaw);
        if (refillCount != null && (!Number.isFinite(refillCount) || refillCount < 0)) {
          setError('Refills must be a whole number.');
          return;
        }
        next = await updateCounterInvoiceLine(next.id, line.id, {
          instructions: d.instructions.trim() || null,
          refillCount,
        });
      }
      setSigDrafts((prev) => {
        const copy = { ...prev };
        for (const line of rows) delete copy[line.id];
        return copy;
      });
      setSelected(next);
      await refreshList(next.id);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(line: VisitInvoiceLine) {
    if (!selected) return;
    const stageOnly = selected.status !== 'open';
    if (stageOnly) {
      setPendingDeleteIds((prev) => (prev.includes(line.id) ? prev : [...prev, line.id]));
      setNote('Line removed. Save the invoice to keep this change.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await removeCounterInvoiceLine(selected.id, line.id);
      setSigDrafts((prev) => {
        if (!(line.id in prev)) return prev;
        const copy = { ...prev };
        delete copy[line.id];
        return copy;
      });
      setSelected(next);
      await refreshList(next.id);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelInvoiceEdits() {
    setEditing(false);
    setPendingDeleteIds([]);
    setNote(null);
  }

  async function saveInvoiceEdits() {
    if (!selected) return;
    const locked = selected.status === 'paid' || selected.status === 'finalized';
    if (!pendingDeleteIds.length && !locked) return;
    setBusy(true);
    setError(null);
    try {
      let next = selected;
      if (locked) next = await unlockVisitInvoice(next.id);
      for (const lineId of pendingDeleteIds) {
        next = await removeCounterInvoiceLine(next.id, lineId);
      }
      setPendingDeleteIds([]);
      setEditing(false);
      setSelected(next);
      await refreshList(next.id);
      setNote('Invoice saved.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeTender() {
    if (!selected) return;
    const typedAmount = tenderAmount.trim() === '' ? null : Number(tenderAmount);
    let amount = typedAmount != null && Number.isFinite(typedAmount) ? typedAmount : remaining;
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a payment amount.');
      return;
    }
    if (isDiscountType(tenderPaymentType, discountTypeNames) && cashierEmployeeId == null) {
      setError('Sign in as staff to record a discount.');
      return;
    }
    const received = Number(cashReceived);
    const cashOverDue =
      tenderMethod === 'cash' && Number.isFinite(received) && received > remaining + 0.009;
    if (cashOverDue) amount = received;
    if (amount > remaining + 0.009) {
      const credit = amount - remaining;
      const ok = await appConfirm({
        title: 'Account credit',
        message: `You are putting in a credit on this account (${money(credit)}). Record ${money(amount)}?`,
        confirmLabel: 'Record credit',
      });
      if (!ok) return;
    }
    const change =
      tenderMethod === 'cash' &&
      Number.isFinite(received) &&
      received > amount + 0.009
        ? received - amount
        : null;
    setBusy(true);
    setError(null);
    try {
      const next = await addVisitTender(selected.id, {
        method: tenderMethod,
        amount,
        paymentTypeName: tenderPaymentType.trim() || null,
        cashierEmployeeId,
        cashReceived: tenderMethod === 'cash' && Number.isFinite(received) ? received : null,
        changeGiven: change,
        checkNumber: tenderMethod === 'check' ? checkNumber.trim() || null : null,
      });
      setSelected(next);
      setTenderAmount('');
      setCashReceived('');
      setCheckNumber('');
      await refreshList(next.id);
      setTenderPaymentType('');
      setNote(`Recorded ${methodLabel(tenderMethod, tenderPaymentType)} ${money(amount)}.`);
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeSavedCard() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await chargeSavedCard(selected.id);
      setSelected(next);
      await refreshList(next.id);
      setNote('Charged the card on file.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendToTerminal() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const session = await startTerminalCheckout(selected.id);
      setTerminalJob(session.checkoutId);
      if (session.invoice) setSelected(session.invoice);
      setNote(`Sent ${money(session.amountCents / 100)} to Scout Terminal.`);
    } catch (e: unknown) {
      if (/already paid/i.test(apiErr(e)) && selected) {
        const fresh = await getInvoice(selected.id);
        setSelected(fresh);
        await refreshList(fresh.id);
        setNote('This invoice was already paid.');
      } else {
        setError(apiErr(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelTerminal() {
    if (!terminalJob) return;
    setBusy(true);
    try {
      await cancelTerminalCheckout(terminalJob);
      setTerminalJob(null);
      setNote('Canceled the Terminal checkout.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(tenderId: string) {
    if (!selected) return;
    const tender = (selected.tenders ?? []).find((t) => t.id === tenderId);
    const reason =
      (await appPrompt({
        title: 'Void payment',
        message:
          tender?.method === 'card'
            ? 'Voiding a card payment does not refund Stripe automatically. Enter a reason to void it on this invoice.'
            : 'Reason for voiding this payment?',
        confirmLabel: 'Void',
        danger: true,
      })) ?? '';
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await voidVisitTender(selected.id, tenderId, {
        reason: reason.trim(),
        voidedByEmployeeId: cashierEmployeeId,
      });
      setSelected(next);
      await refreshList(next.id);
      setNote('Payment voided.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function askVoidReason(title: string, message: string): Promise<string | null> {
    const reason = await appPrompt({
      title,
      message,
      confirmLabel: 'Void',
      danger: true,
      placeholder: 'Reason required',
    });
    if (reason == null) return null;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A void reason is required.');
      return null;
    }
    return trimmed;
  }

  async function takeOverEvet(mode: 'edit' | 'return' | 'void') {
    if (!evetSelected) return;
    const evetId = Number(evetSelected.raw.id);
    if (!Number.isFinite(evetId)) {
      setError('This eVet invoice has no id to take over.');
      return;
    }
    let voidReason: string | null = null;
    if (mode === 'void') {
      voidReason = await askVoidReason(
        'Void invoice?',
        `Enter a reason for voiding invoice #${evetSelected.number}.`,
      );
      if (!voidReason) return;
    }
    setBusy(true);
    setError(null);
    try {
      let next = await adoptEvetInvoice(evetId);
      if (mode === 'void') {
        next = await voidInvoice(next.id, {
          reason: voidReason!,
          voidedByEmployeeId: cashierEmployeeId,
        });
      }
      setEvetSelected(null);
      setSelected(next);
      setEditing(mode === 'edit');
      setReturning(mode === 'return');
      setReturnQty({});
      onSelectInvoice?.(next.id);
      await refreshList(next.id);
      setNote(
        mode === 'void'
          ? 'Invoice voided. Scout owns this bill now.'
          : mode === 'edit'
            ? 'Scout owns this bill. Remove lines, then save.'
            : 'Taken over in Scout. Enter return quantities below.'
      );
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    setReturning(false);
    setEditing(true);
    setNote('Editing. Save the invoice to keep removed lines gone.');
  }

  async function discardSelected() {
    if (!selected) return;
    const label = invoicePublicLabel(selected);
    const ok = await appConfirm({
      title: 'Delete invoice?',
      message: `Delete ${label}? It will leave the ledger.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const removedId = selected.id;
      await discardVisitInvoice(removedId, { deletedByEmployeeId: cashierEmployeeId });
      setSelected(null);
      onSelectInvoice?.(null);
      const rows = await listClientVisitInvoices(clientId);
      setScoutInvoices(rows);
      setNote('Invoice deleted.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function voidSelectedInvoice() {
    if (!selected) return;
    const reason = await askVoidReason(
      'Void invoice?',
      'Enter a reason for voiding this invoice. Payments on it will be voided too.',
    );
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const next = await voidInvoice(selected.id, {
        reason,
        voidedByEmployeeId: cashierEmployeeId,
      });
      setSelected(next);
      await refreshList(next.id);
      setNote('Invoice voided.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReturns() {
    if (!selected) return;
    const items = lines
      .map((line) => {
        const qty = Number(returnQty[line.id] || 0);
        return { lineId: line.id, qty };
      })
      .filter((item) => item.qty > 0);
    if (!items.length) {
      setError('Enter a quantity to return on at least one line.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const credit = await returnVisitInvoiceLines(selected.id, items, {
        cashierEmployeeId,
      });
      setReturnQty({});
      setReturning(false);
      setSelected(credit);
      onSelectInvoice?.(credit.id);
      await refreshList(credit.id);
      setNote('Opened a credit invoice for the returned items.');
    } catch (e: unknown) {
      setError(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  const hasDetail = selected != null || evetSelected != null;

  return (
    <div className="client-fin">
      {error ? <p className="client-fin__err">{error}</p> : null}
      {note ? <p className="client-fin__note">{note}</p> : null}

      <div
        ref={splitRef}
        className={`client-fin__grid${hasDetail ? '' : ' client-fin__grid--solo'}${
          splitting ? ' is-splitting' : ''
        }`}
        style={hasDetail ? { ['--fin-split-pct' as string]: `${splitPct}%` } : undefined}
      >
        <section className="client-fin__pane">
          <div className="client-fin__pane-head">
            <div className="client-fin__ledger-title">
              <h2>Ledger</h2>
              <div className="client-fin__bal client-fin__bal--nested">
                <span className="client-fin__bal-label">
                  {combinedBalance > 0.005
                    ? 'Balance due'
                    : combinedBalance < -0.005
                      ? 'Credit'
                      : 'Balance'}
                </span>
                <span
                  className={`client-fin__bal-value${
                    combinedBalance > 0.005
                      ? ' is-owed'
                      : combinedBalance < -0.005
                        ? ' is-credit'
                        : ''
                  }`}
                >
                  {formatUsd(Math.abs(combinedBalance))}
                </span>
              </div>
            </div>
            <button type="button" className="client-fin__btn" onClick={() => void startNewInvoice()} disabled={busy}>
              New invoice
            </button>
          </div>
          <div className="client-fin__pay-links client-fin__pay-links--ledger">
            <button
              type="button"
              className="client-fin__btn-ghost"
              disabled={busy}
              onClick={() => void startLedgerEmail()}
            >
              Email Ledger
            </button>
            {unpaidTotal > 0.009 ? (
              <>
                <button
                  type="button"
                  className="client-fin__btn"
                  disabled={busy}
                  onClick={() => void startPayLink('email')}
                >
                  Email pay link
                </button>
                <button
                  type="button"
                  className="client-fin__btn-ghost"
                  disabled={busy}
                  onClick={() => void startPayLink('sms')}
                >
                  Text pay link
                </button>
                <div className="client-fin__muted">
                  {unpaidScout.length + unpaidEvet.length > 1
                    ? `Sends ${money(unpaidTotal)} for ${unpaidScout.length + unpaidEvet.length} unpaid invoices`
                    : `Sends ${money(unpaidTotal)} for the unpaid invoice`}
                </div>
              </>
            ) : (
              <div className="client-fin__muted">
                Emails the household ledger. Deleted and voided items stay off the client copy.
              </div>
            )}
          </div>
          <div className="client-fin__filters">
            {(['all', 'open', 'paid', 'void', 'returns'] as LedgerFilter[]).map((f) => (
              <button key={f} type="button" className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'void' ? 'Void / Deleted' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="client-fin__muted">Loading invoices…</p>
          ) : visibleLedger.length === 0 ? (
            <p className="client-fin__muted">No invoices in this filter.</p>
          ) : (
            <div className="client-fin__table-wrap">
              <table className="client-fin__table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoice</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLedger.map((row) => {
                    const on =
                      (row.scout && selected?.id === row.scout.id) ||
                      (row.evet && evetSelected?.key === row.evet.key);
                    return (
                      <tr
                        key={row.key}
                        className={`is-click${on ? ' is-on' : ''}${
                          row.status.toLowerCase() === 'void' || row.status.toLowerCase() === 'deleted'
                            ? ' is-void'
                            : ''
                        }`}
                        onClick={() => {
                          if (row.scout) {
                            if (hasDirtySigs && selected?.id !== row.scout.id) {
                              void appAlert({
                                title: 'Directions not saved',
                                message: INVOICE_DIRECTIONS_LEAVE_MESSAGE,
                              });
                              return;
                            }
                            setSelected(row.scout);
                            setEvetSelected(null);
                            setReturning(false);
                            setEditing(false);
                            onSelectInvoice?.(row.scout.id);
                          } else if (row.evet) {
                            if (hasDirtySigs) {
                              void appAlert({
                                title: 'Directions not saved',
                                message: INVOICE_DIRECTIONS_LEAVE_MESSAGE,
                              });
                              return;
                            }
                            setEvetSelected(row.evet);
                            setSelected(null);
                            setReturning(false);
                            setEditing(false);
                            onSelectInvoice?.(null);
                          }
                        }}
                      >
                        <td>{row.date}</td>
                        <td>
                          {row.label}
                          <div className="client-fin__muted">
                            {row.source === 'scout' ? 'Scout' : 'eVet'}
                            {row.actorNote ? ` · ${row.actorNote}` : ''}
                          </div>
                        </td>
                        <td>{statusLabel(row.status)}</td>
                        <td>
                          {money(
                            row.scout && selected?.id === row.scout.id && hasUnsavedDeletes
                              ? previewTotal
                              : row.total
                          )}
                        </td>
                        <td>
                          {money(row.paid)}
                          {row.paymentNote ? (
                            <div className="client-fin__muted">{row.paymentNote}</div>
                          ) : null}
                        </td>
                        <td>
                          {money(
                            row.scout && selected?.id === row.scout.id && hasUnsavedDeletes
                              ? previewTotal - (Number(selected.amountPaid) || 0)
                              : row.due
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {hasDetail ? (
        <div
          className="client-fin__splitter"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={FIN_SPLIT_MIN}
          aria-valuemax={FIN_SPLIT_MAX}
          aria-valuenow={Math.round(splitPct)}
          aria-label="Resize ledger and invoice"
          tabIndex={0}
          onPointerDown={onSplitterPointerDown}
          onPointerMove={onSplitterPointerMove}
          onPointerUp={endSplitterDrag}
          onPointerCancel={endSplitterDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              persistSplit(splitPct - 2);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              persistSplit(splitPct + 2);
            }
          }}
        />
        ) : null}

        {hasDetail ? (
        <section className="client-fin__pane">
          {evetSelected ? (
            <>
              <div className="client-fin__pane-head">
                <h2>eVet invoice #{evetSelected.number}</h2>
                <button
                  type="button"
                  className="client-fin__btn-ghost"
                  disabled={busy}
                  onClick={() => void startInvoiceEmail()}
                >
                  {evetSelected.due <= 0.009 && evetSelected.paid > 0.009
                    ? 'Email receipt'
                    : 'Email invoice'}
                </button>
              </div>
              <p className="client-fin__muted">
                Status: {statusLabel(evetSelected.status)}
                {evetSelected.date !== '—' ? ` · ${evetSelected.date}` : ''}
                {evetSelected.raw.isDeleted === true
                  ? typeof evetSelected.raw.deletedByName === 'string' &&
                    evetSelected.raw.deletedByName.trim()
                    ? ` · Deleted by ${evetSelected.raw.deletedByName.trim()}`
                    : evetSelected.createdBy !== '—'
                      ? ` · Deleted · created by ${evetSelected.createdBy}`
                      : ' · Deleted'
                  : ''}
              </p>
              {evetSelected.lines.some((line) => line.isWriteOff || (line.date !== '—' && line.date !== evetSelected.date)) ? (
                <p className="client-fin__muted">
                  eVet kept adding items to this invoice over time. Negative rows are staff
                  write-offs recorded as their own lines — not extra products.
                </p>
              ) : evetSelected.lines.length === 0 && evetSelected.removedLines.length > 0 ? (
                <p className="client-fin__muted">
                  These items were removed when the receipt was voided.
                </p>
              ) : (
                <p className="client-fin__muted">
                  Imported from eVet. The first edit, return, or void is handled in Scout from then
                  on — eVet will not overwrite it.
                </p>
              )}
              <div className="client-fin__table-wrap client-fin__table-wrap--doc">
                <table className="client-fin__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Patient</th>
                      <th>Item</th>
                      <th>Provider</th>
                      <th>Qty</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(evetSelected.lines.length
                      ? evetSelected.lines
                      : evetSelected.removedLines
                    ).map((line) => (
                      <tr
                        key={line.key}
                        className={
                          line.isRemoved ? 'is-removed' : line.isWriteOff ? 'is-writeoff' : undefined
                        }
                      >
                        <td>{line.date !== '—' ? line.date : evetSelected.date}</td>
                        <td>{petName(line.patientId, line.patient)}</td>
                        <td>
                          <div className="client-fin__item-name">{line.description}</div>
                          {line.isRemoved ? (
                            <div className="client-fin__removed-tag">Removed</div>
                          ) : null}
                          {line.isCovered ? (
                            <div className="client-fin__muted">Membership</div>
                          ) : null}
                          {line.isWriteOff ? (
                            <div className="client-fin__muted">Write-off</div>
                          ) : null}
                        </td>
                        <td>
                          {line.productionEmployee && line.productionEmployee !== '—'
                            ? line.productionEmployee
                            : ''}
                        </td>
                        <td>{line.qty}</td>
                        <td className="client-fin__num">
                          <PriceShown
                            charged={line.isRemoved ? 0 : line.total}
                            list={
                              line.originalPrice != null
                                ? line.originalPrice * (Number(line.qty) || 1)
                                : line.isRemoved
                                  ? line.unitPrice * (Number(line.qty) || 1)
                                  : null
                            }
                            covered={line.isCovered}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(() => {
                const charged = evetSelected.lines.reduce(
                  (sum, line) => sum + (Number(line.total) || 0),
                  0
                );
                const listSub =
                  evetSelected.discountSavings > 0.009 ? evetSelected.listSubtotal : charged;
                const taxSum = evetSelected.lines.reduce(
                  (sum, line) => sum + (Number(line.tax) || 0),
                  0
                );
                const tax =
                  Math.abs(evetSelected.total - charged - taxSum) < 0.05
                    ? taxSum
                    : Math.max(0, evetSelected.total - charged);
                const payments = evetPaymentsOnInvoice(evetSelected);
                const livePays = payments.filter((p) => !p.isVoided);
                const voidedPays = payments.filter((p) => p.isVoided);
                const facePays: InvoiceFacePayment[] = livePays.map((p) => {
                  const who =
                    p.cashierName ??
                    (p.cashierEmployeeId != null
                      ? staffName(staffById.get(p.cashierEmployeeId), p.cashierEmployeeId)
                      : null);
                  return {
                    key: p.key,
                    method: p.method ?? 'Payment',
                    amount: p.amount,
                    date: p.receivedAt ? formatTs(p.receivedAt) : evetSelected.date,
                    receiptNumber: p.receiptNumber,
                    cashier: who,
                    extra: p.creditUsed > 0.005 ? `Credit ${money(p.creditUsed)}` : null,
                  };
                });
                return (
                  <>
                    <div className="client-fin__doc-end">
                      <div className="client-fin__invoice-foot">
                        <div>
                          <span>Subtotal</span>
                          <b>{money(listSub)}</b>
                        </div>
                        {evetSelected.discountSavings > 0.009 ? (
                          <div>
                            <span className="client-fin__savings">Discount</span>
                            <b className="client-fin__savings">{money(evetSelected.discountSavings)}</b>
                          </div>
                        ) : null}
                        <div>
                          <span>Tax</span>
                          <b>{money(tax)}</b>
                        </div>
                        <div>
                          <span>Total</span>
                          <b>{money(evetSelected.total)}</b>
                        </div>
                        {facePays.length || evetSelected.paid > 0.005 ? (
                          <div className="client-fin__pay-cat">
                            <span>Payments</span>
                            <b />
                          </div>
                        ) : null}
                        {facePays.map((p) => (
                          <div key={p.key} className="client-fin__paid-line">
                            <span>{paymentFaceLabel(p)}</span>
                            <b>{money(p.amount)}</b>
                          </div>
                        ))}
                        {facePays.length === 0 && evetSelected.paid > 0.005 ? (
                          <div className="client-fin__paid-line">
                            <span>
                              {evetSelected.paid + 0.009 < evetSelected.total
                                ? 'Applied from another eVet payment'
                                : 'Recorded on this invoice'}
                            </span>
                            <b>{money(evetSelected.paid)}</b>
                          </div>
                        ) : null}
                        {facePays.length || evetSelected.paid > 0.005 ? (
                          <div className="client-fin__pay-sum" aria-hidden />
                        ) : null}
                        <div className={`client-fin__paid-total${evetSelected.paid <= 0.009 ? ' is-zero' : ''}`}>
                          <span>Paid</span>
                          <b>{money(evetSelected.paid)}</b>
                        </div>
                        <div className="client-fin__invoice-due">
                          <span>{evetSelected.due < -0.005 ? 'Credit' : 'Due'}</span>
                          <b>{money(Math.abs(evetSelected.due))}</b>
                        </div>
                      </div>
                    </div>
                    <StaffVoidedPayments
                      items={voidedPays.map((p) => ({
                        key: p.key,
                        text: [
                          `${p.method ?? 'Payment'} ${money(p.amount)}`,
                          p.receiptNumber ? `Receipt #${p.receiptNumber}` : null,
                          p.voidedByName ? `voided by ${p.voidedByName}` : 'voided',
                          p.voidedAt ? formatTs(p.voidedAt) : null,
                          p.voidedComments,
                        ]
                          .filter(Boolean)
                          .join(' · '),
                      }))}
                    />
                  </>
                );
              })()}
              <div className="client-fin__actions">
                <button type="button" className="client-fin__btn" disabled={busy} onClick={() => void takeOverEvet('edit')}>
                  Edit in Scout
                </button>
                <button
                  type="button"
                  className="client-fin__btn-ghost"
                  disabled={busy}
                  onClick={() => void takeOverEvet('return')}
                >
                  Return items
                </button>
                <button
                  type="button"
                  className="client-fin__btn-ghost"
                  disabled={busy}
                  onClick={() => void takeOverEvet('void')}
                >
                  Void
                </button>
              </div>
            </>
          ) : selected ? (
            <>
              <div className="client-fin__pane-head">
                <h2>
                  {returning
                    ? 'Return items'
                    : editing
                      ? 'Edit invoice'
                      : selected.isDeleted
                        ? 'Deleted invoice'
                        : selected.status === 'void'
                          ? 'Voided invoice'
                          : selected.status === 'open' && visibleLines.length === 0
                            ? 'New invoice'
                            : dueOf(selected) > 0.009
                              ? 'Open invoice'
                              : Number(selected.amountPaid) > 0.009 || selected.status === 'paid'
                                ? `Receipt · ${statusLabel(selected.status)}`
                                : selected.status === 'open'
                                  ? 'Open invoice'
                                  : `Invoice · ${statusLabel(selected.status)}`}
                </h2>
                <div className="client-fin__pane-actions">
                  {returning ? (
                    <button
                      type="button"
                      className="client-fin__btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setReturning(false);
                        setReturnQty({});
                        setNote(null);
                      }}
                    >
                      Back
                    </button>
                  ) : null}
                  {editing ? (
                    <button
                      type="button"
                      className="client-fin__btn-ghost"
                      disabled={busy}
                      onClick={() => cancelInvoiceEdits()}
                    >
                      Back
                    </button>
                  ) : null}
                  {hasDirtySigs ? (
                    <button
                      type="button"
                      className="client-fin__btn"
                      disabled={busy}
                      onClick={() => void persistDirections(dirtySigLines)}
                    >
                      Save directions
                    </button>
                  ) : null}
                  {hasUnsavedEdits ? (
                    <button
                      type="button"
                      className="client-fin__btn"
                      disabled={busy}
                      onClick={() => void saveInvoiceEdits()}
                    >
                      Save invoice
                    </button>
                  ) : null}
                  {canDiscard ? (
                    <button
                      type="button"
                      className="client-fin__btn-ghost client-fin__btn-danger"
                      disabled={busy}
                      onClick={() => void discardSelected()}
                    >
                      Delete invoice
                    </button>
                  ) : null}
                  <button type="button" className="client-fin__btn-ghost" onClick={() => window.print()}>
                    Print
                  </button>
                  <button
                    type="button"
                    className="client-fin__btn-ghost"
                    disabled={busy}
                    onClick={() => void startInvoiceEmail()}
                  >
                    {remaining <= 0.009 && (Number(selected.amountPaid) || 0) > 0.009
                      ? 'Email receipt'
                      : 'Email invoice'}
                  </button>
                </div>
              </div>
              {selected.isDeleted || selected.status === 'void' ? (
                <p className="client-fin__muted">
                  {selected.isDeleted
                    ? selected.deletedByEmployeeId != null
                      ? `Deleted by ${staffName(staffById.get(selected.deletedByEmployeeId), selected.deletedByEmployeeId)}`
                      : 'Deleted'
                    : [
                        selected.voidedByEmployeeId != null
                          ? `Voided by ${staffName(staffById.get(selected.voidedByEmployeeId), selected.voidedByEmployeeId)}`
                          : 'Voided',
                        selected.voidReason,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
              ) : null}

              {canEdit ? (
                <>
                  <label className="client-fin__field">
                    Charge to
                    <select
                      value={linePatientId ?? ''}
                      onChange={(e) => setLinePatientId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">Household</option>
                      {allPets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="client-fin__search">
                    <Search size={16} aria-hidden />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search catalog to add a line"
                    />
                    {searching ? <span className="client-fin__muted">Searching…</span> : null}
                  </div>
                  {hits.length ? (
                    <ul className="client-fin__hits">
                      {hits.map((item) => (
                        <li key={`${item.itemType}-${item.name}`}>
                          <button type="button" disabled={busy} onClick={() => void addItem(item)}>
                            <span>
                              <Plus size={14} aria-hidden /> {item.name}
                            </span>
                            <PriceShown
                              charged={getCatalogLinePrice(item, 1).unitFinal}
                              list={item.originalPrice ?? item.wellnessPlanPricing?.originalPrice}
                              covered={getCatalogLinePrice(item, 1).isCovered}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}

              {hasDirtySigs ? (
                <p className="client-fin__sig-banner">
                  Directions aren’t saved. Save or delete the line before leaving this client.
                </p>
              ) : null}
              {editing || hasUnsavedDeletes ? (
                <p className="client-fin__muted">
                  Removed lines are not saved yet. Back or leave without saving to undo.
                </p>
              ) : null}

              {visibleLines.length === 0 ? (
                <p className="client-fin__muted">No lines yet.</p>
              ) : (
                <div className="client-fin__table-wrap client-fin__table-wrap--doc">
                  <table className="client-fin__table client-fin__invoice">
                    <thead>
                      <tr>
                        <th className="client-fin__col-item">Item</th>
                        <th className="client-fin__col-pet">Pet</th>
                        <th className="client-fin__col-provider">Provider</th>
                        <th className="client-fin__col-qty">Qty</th>
                        <th className="client-fin__col-price">Price</th>
                        <th className="client-fin__col-amount">Amount</th>
                        {returning && canReturn ? <th>Return</th> : null}
                        {canRemoveLines ? <th className="client-fin__row-action" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLines.map((line) => {
                        const directions = draftOf(line).instructions;
                        const refills = draftOf(line).refillCount;
                        const showMeta =
                          isPrescriptionLine(line) &&
                          (canEdit || Boolean(lineDirections(line)) || lineRefills(line) !== '');
                        const dirty = canEdit && lineSigDirty(line);
                        const lineEnteredBy = staffShortName(
                          line.enteredByEmployeeId != null
                            ? staffById.get(line.enteredByEmployeeId)
                            : line.instructionsEnteredByEmployeeId != null
                              ? staffById.get(line.instructionsEnteredByEmployeeId)
                              : undefined,
                          line.enteredByName ?? line.instructionsEnteredByName
                        );
                        const sigEnteredBy = staffShortName(
                          line.instructionsEnteredByEmployeeId != null
                            ? staffById.get(line.instructionsEnteredByEmployeeId)
                            : undefined,
                          line.instructionsEnteredByName
                        );
                        return (
                        <Fragment key={line.id}>
                        <tr>
                          <td className="client-fin__col-item">
                            <div className="client-fin__item-name">{line.description}</div>
                            {lineEnteredBy ? (
                              <div className="client-fin__item-by">{lineEnteredBy}</div>
                            ) : null}
                          </td>
                          <td className="client-fin__col-pet">
                            {canEdit ? (
                              <select
                                value={line.patientId ?? ''}
                                onChange={(e) => {
                                  const patientId = e.target.value ? Number(e.target.value) : null;
                                  void patchLine(line, {
                                    patientId,
                                    providerEmployeeId: primaryProviderIdFor(patientId),
                                  });
                                }}
                              >
                                <option value="">—</option>
                                {allPets.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              petName(line.patientId, line.patientName)
                            )}
                          </td>
                          <td className="client-fin__col-provider">
                            {canEdit ? (
                              <select
                                value={line.providerEmployeeId ?? ''}
                                onChange={(e) =>
                                  void patchLine(line, {
                                    providerEmployeeId: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                              >
                                <option value="">—</option>
                                {providerOptions.map((emp) => (
                                  <option key={String(emp.id)} value={emp.id}>
                                    {emp.name}
                                  </option>
                                ))}
                                {line.providerEmployeeId != null &&
                                !providerOptions.some((e) => Number(e.id) === line.providerEmployeeId) ? (
                                  <option value={line.providerEmployeeId}>
                                    {staffName(staffById.get(line.providerEmployeeId), line.providerEmployeeId)}
                                  </option>
                                ) : null}
                              </select>
                            ) : line.providerEmployeeId != null ? (
                              staffName(staffById.get(line.providerEmployeeId), line.providerEmployeeId)
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="client-fin__col-qty client-fin__num">
                            {canEdit ? (
                              <input
                                className="client-fin__qty"
                                inputMode="decimal"
                                defaultValue={String(line.qty)}
                                onBlur={(e) => {
                                  const qty = Number(e.target.value);
                                  if (Number.isFinite(qty) && qty !== Number(line.qty)) {
                                    void patchLine(line, { qty });
                                  }
                                }}
                              />
                            ) : (
                              line.qty
                            )}
                          </td>
                          <td className="client-fin__col-price client-fin__num">
                            {canEdit ? (
                              <label className="client-fin__price-wrap">
                                <span className="client-fin__price-prefix" aria-hidden>
                                  $
                                </span>
                                <input
                                  className="client-fin__price"
                                  inputMode="decimal"
                                  defaultValue={moneyInput(line.unitPrice)}
                                  onBlur={(e) => {
                                    const unitPrice = Math.round(Number(e.target.value) * 100) / 100;
                                    if (
                                      Number.isFinite(unitPrice) &&
                                      unitPrice !== Math.round(Number(line.unitPrice) * 100) / 100
                                    ) {
                                      void patchLine(line, { unitPrice });
                                    } else {
                                      e.target.value = moneyInput(line.unitPrice);
                                    }
                                  }}
                                />
                              </label>
                            ) : (
                              <PriceShown
                                charged={Number(line.unitPrice) || 0}
                                list={line.listUnitPrice}
                                covered={line.isCovered}
                              />
                            )}
                          </td>
                          <td className="client-fin__col-amount client-fin__num">
                            {line.isCovered ? (
                              <span className="client-fin__covered">Covered ❤️</span>
                            ) : (
                              money(line.amount)
                            )}
                          </td>
                          {returning && canReturn ? (
                            <td>
                              <input
                                value={returnQty[line.id] ?? ''}
                                onChange={(e) =>
                                  setReturnQty((prev) => ({ ...prev, [line.id]: e.target.value }))
                                }
                                placeholder={`≤ ${Math.abs(Number(line.qty) || 0)}`}
                              />
                            </td>
                          ) : null}
                          {canRemoveLines ? (
                            <td className="client-fin__row-action">
                              <button
                                type="button"
                                className="client-fin__btn-ghost"
                                disabled={busy}
                                onClick={() => removeLine(line)}
                                aria-label="Remove line"
                              >
                                <X size={14} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                        {showMeta ? (
                          <tr className="client-fin__line-meta">
                            <td colSpan={3}>
                              {canEdit ? (
                                <label className="client-fin__sig">
                                  <span className="client-fin__sig-label">
                                    Directions (sig)
                                    {dirty ? (
                                      <button
                                        type="button"
                                        className="client-fin__btn"
                                        disabled={busy}
                                        onClick={() => void persistDirections([line])}
                                      >
                                        Save
                                      </button>
                                    ) : sigEnteredBy ? (
                                      <span className="client-fin__entered">Entered by {sigEnteredBy}</span>
                                    ) : null}
                                  </span>
                                  <textarea
                                    value={directions}
                                    rows={3}
                                    onChange={(e) =>
                                      setSigDrafts((prev) => ({
                                        ...prev,
                                        [line.id]: { ...draftOf(line), instructions: e.target.value },
                                      }))
                                    }
                                  />
                                </label>
                              ) : lineDirections(line) ? (
                                <div className="client-fin__sig">
                                  <span className="client-fin__sig-label">
                                    Directions (sig)
                                    {sigEnteredBy ? (
                                      <span className="client-fin__entered">Entered by {sigEnteredBy}</span>
                                    ) : null}
                                  </span>
                                  <div>{lineDirections(line)}</div>
                                </div>
                              ) : null}
                            </td>
                            <td colSpan={returning && canReturn ? 4 : 3}>
                              {canEdit ? (
                                <label className="client-fin__refill">
                                  <span># refills</span>
                                  <input
                                    className="client-fin__refill-input"
                                    inputMode="numeric"
                                    value={refills}
                                    onChange={(e) =>
                                      setSigDrafts((prev) => ({
                                        ...prev,
                                        [line.id]: { ...draftOf(line), refillCount: e.target.value },
                                      }))
                                    }
                                  />
                                </label>
                              ) : refills !== '' ? (
                                <div className="client-fin__refill">
                                  <span># refills</span>
                                  <div>{refills}</div>
                                </div>
                              ) : null}
                            </td>
                            {canRemoveLines ? <td className="client-fin__row-action" /> : null}
                          </tr>
                        ) : null}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="client-fin__doc-end">
                {selected.lines?.some((l) => l.returnOfLineId) && selected.createdByEmployeeId != null ? (
                  <p className="client-fin__muted">
                    Returned by {staffName(staffById.get(selected.createdByEmployeeId), selected.createdByEmployeeId)}
                  </p>
                ) : null}
                <div className="client-fin__invoice-foot">
                  <div>
                    <span>Subtotal</span>
                    <b>{money(hasUnsavedDeletes ? previewSubtotal : selected.subtotal)}</b>
                  </div>
                  <div>
                    <span>Tax</span>
                    <b>{money(hasUnsavedDeletes ? previewTax : selected.taxTotal)}</b>
                  </div>
                  {(() => {
                    const liveTenders = (selected.tenders ?? []).filter((t) => !t.voidedAt);
                    const paidAmt = Number(selected.amountPaid) || 0;
                    return (
                      <>
                  {liveTenders.length ? (
                    <div className="client-fin__pay-cat">
                      <span>Payments</span>
                      <b />
                    </div>
                  ) : null}
                  {liveTenders
                    .map((t) => {
                      const who =
                        t.cashierEmployeeId != null
                          ? staffName(staffById.get(t.cashierEmployeeId), t.cashierEmployeeId)
                          : null;
                      const face: InvoiceFacePayment = {
                        key: t.id,
                        method: methodLabel(t.method, t.paymentTypeName),
                        amount: Number(t.amount) || 0,
                        date: formatTs(t.receivedAt),
                        cashier: isDiscountType(t.paymentTypeName ?? methodLabel(t.method), discountTypeNames)
                          ? who
                            ? `Entered by ${who}`
                            : null
                          : who,
                        extra: t.checkNumber ? `Check ${t.checkNumber}` : null,
                        onVoid:
                          selected.status !== 'void'
                            ? () => {
                                void voidPayment(t.id);
                              }
                            : undefined,
                      };
                      return (
                        <div key={t.id} className="client-fin__paid-line">
                          <span>{paymentFaceLabel(face)}</span>
                          <b>
                            {money(face.amount)}
                            {face.onVoid ? (
                              <button
                                type="button"
                                className="client-fin__btn-ghost client-fin__no-print"
                                disabled={busy}
                                onClick={face.onVoid}
                              >
                                Void
                              </button>
                            ) : null}
                          </b>
                        </div>
                      );
                    })}
                  {liveTenders.length ? <div className="client-fin__pay-sum" aria-hidden /> : null}
                  <div className={`client-fin__paid-total${paidAmt <= 0.009 ? ' is-zero' : ''}`}>
                    <span>Paid</span>
                    <b>{money(paidAmt)}</b>
                  </div>
                  <div className="client-fin__invoice-due">
                    <span>
                      {(() => {
                        const due = hasUnsavedDeletes
                          ? previewTotal - (Number(selected.amountPaid) || 0)
                          : dueOf(selected);
                        return due < -0.005 ? 'Credit' : 'Due';
                      })()}
                    </span>
                    <b>
                      {money(
                        Math.abs(
                          hasUnsavedDeletes
                            ? previewTotal - (Number(selected.amountPaid) || 0)
                            : dueOf(selected)
                        )
                      )}
                    </b>
                  </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <StaffVoidedPayments
                items={(selected.tenders ?? [])
                  .filter((t) => t.voidedAt)
                  .map((t) => ({
                    key: t.id,
                    text: [
                      `${methodLabel(t.method, t.paymentTypeName)} ${money(t.amount)}`,
                      t.voidedByEmployeeId != null
                        ? `voided by ${staffName(staffById.get(t.voidedByEmployeeId), t.voidedByEmployeeId)}`
                        : 'voided',
                      t.voidedAt ? formatTs(t.voidedAt) : null,
                      t.voidReason,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
              />

              {canPay ? (
                <>
                  <div className="client-fin__pay">
                    <label className="client-fin__field">
                      Method
                      <select
                        value={tenderPaymentType ? `type:${tenderPaymentType}` : tenderMethod}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith('type:')) {
                            const name = v.slice(5);
                            setTenderMethod('other');
                            setTenderPaymentType(name);
                            const type = paymentTypes.find((r) => r.name === name);
                            const pct = Number(type?.discountPercent) || 0;
                            if (type?.isDiscountCategory && pct > 0) {
                              setTenderAmount(((remaining * pct) / 100).toFixed(2));
                            }
                          } else {
                            setTenderMethod(v as VisitTenderMethod);
                            setTenderPaymentType('');
                          }
                        }}
                      >
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="carecredit">CareCredit</option>
                        <option value="other">Other</option>
                        {paymentTypes
                          .filter((r) => r.isDiscountCategory && r.isActive !== false)
                          .map((r) => (
                            <option key={r.id} value={`type:${r.name}`}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="client-fin__field">
                      Amount
                      <input
                        value={tenderAmount}
                        onChange={(e) => setTenderAmount(e.target.value)}
                        placeholder={String(remaining.toFixed(2))}
                      />
                    </label>
                    {tenderMethod === 'cash' ? (
                      <label className="client-fin__field">
                        Cash received
                        <input value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} />
                      </label>
                    ) : null}
                    {tenderMethod === 'check' ? (
                      <label className="client-fin__field">
                        Check #
                        <input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
                      </label>
                    ) : null}
                    {selectedPayType?.isDiscountCategory ? (
                      <p className="client-fin__muted" style={{ gridColumn: '1 / -1', margin: 0 }}>
                        {(Number(selectedPayType.discountPercent) || 0) > 0
                          ? `Applies ${Number(selectedPayType.discountPercent)}%`
                          : 'Enter the amount'}
                        {selectedPayType.excludeFromIncome
                          ? ' · left off income on the sales report'
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="client-fin__actions">
                    <button type="button" className="client-fin__btn" disabled={busy} onClick={() => void takeTender()}>
                      Record {methodLabel(tenderMethod, tenderPaymentType)}
                    </button>
                    {selected.savedPaymentMethodId ? (
                      <button
                        type="button"
                        className="client-fin__btn-ghost"
                        disabled={busy}
                        onClick={() => void takeSavedCard()}
                      >
                        Charge remaining on saved card
                      </button>
                    ) : null}
                    {terminalJob ? (
                      <button type="button" className="client-fin__btn-ghost" disabled={busy} onClick={() => void cancelTerminal()}>
                        Cancel terminal
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="client-fin__btn-ghost"
                        disabled={busy}
                        onClick={() => void sendToTerminal()}
                      >
                        Send remaining to terminal
                      </button>
                    )}
                  </div>
                </>
              ) : null}

              {canUnlock || canVoidInvoice ? (
                <div className="client-fin__actions">
                  {canUnlock && !editing ? (
                    <button type="button" className="client-fin__btn-ghost" disabled={busy} onClick={() => startEditing()}>
                      Edit invoice
                    </button>
                  ) : null}
                  {canVoidInvoice ? (
                    <button type="button" className="client-fin__btn-ghost" disabled={busy} onClick={() => void voidSelectedInvoice()}>
                      Void invoice
                    </button>
                  ) : null}
                </div>
              ) : null}

              {canReturn && !returning ? (
                <div className="client-fin__actions">
                  <button type="button" className="client-fin__btn-ghost" disabled={busy} onClick={() => setReturning(true)}>
                    Return items
                  </button>
                </div>
              ) : null}

              {canReturn && returning ? (
                <div className="client-fin__actions">
                  <button type="button" className="client-fin__btn" disabled={busy} onClick={() => void submitReturns()}>
                    Return selected quantities
                  </button>
                  <button
                    type="button"
                    className="client-fin__btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      setReturning(false);
                      setReturnQty({});
                      setNote(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

            </>
          ) : null}
        </section>
        ) : null}
      </div>

      <ClientEmailComposeModal
        open={invoiceEmail != null}
        clientId={clientId}
        clientLabel={clientName}
        title={
          invoiceEmail?.kind === 'receipt'
            ? 'Email receipt'
            : invoiceEmail?.kind === 'ledger'
              ? 'Email ledger'
              : 'Email invoice'
        }
        initialSubject={invoiceEmail?.subject ?? ''}
        initialBodyText={invoiceEmail?.body ?? ''}
        mergeValues={invoiceEmail?.merge}
        initialAttachments={invoiceEmail?.attachments}
        regardingPatients={allPets}
        regardingPatientId={invoiceEmail?.regardingPatientId ?? null}
        onRegardingPatientIdChange={(id) =>
          setInvoiceEmail((cur) => (cur ? { ...cur, regardingPatientId: id } : cur))
        }
        regardingPatientIds={invoiceEmail?.regardingPatientIds ?? []}
        onRegardingPatientIdsChange={(ids) =>
          setInvoiceEmail((cur) => (cur ? { ...cur, regardingPatientIds: ids } : cur))
        }
        patientEmrLogging="opt-in"
        includeInPatientEmr={invoiceEmail?.includeInPatientEmr ?? false}
        onIncludeInPatientEmrChange={(next) =>
          setInvoiceEmail((cur) => (cur ? { ...cur, includeInPatientEmr: next } : cur))
        }
        onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
          const onEmr = invoiceEmail?.includeInPatientEmr === true;
          const emrPets = onEmr ? invoiceEmail?.regardingPatientIds ?? [] : [];
          await recordScoutChartCommunication({
            clientId,
            patientIds: emrPets,
            channel: 'email',
            body: bodyHtml || bodyText,
            subject,
            destination: to,
            sentFrom: from,
            typeLabel:
              invoiceEmail?.kind === 'receipt'
                ? 'Receipt email'
                : invoiceEmail?.kind === 'ledger'
                  ? 'Ledger email'
                  : 'Invoice email',
            includeOnMedicalRecord: onEmr,
          });
          onCommunicationLogged?.();
          setNote(
            invoiceEmail?.kind === 'receipt'
              ? 'Receipt emailed.'
              : invoiceEmail?.kind === 'ledger'
                ? 'Ledger emailed.'
                : 'Invoice emailed.',
          );
        }}
        onClose={() => setInvoiceEmail(null)}
      />
      <ClientEmailComposeModal
        open={payCompose?.channel === 'email'}
        clientId={clientId}
        clientLabel={clientName}
        initialSubject={
          payCompose
            ? applySystemSubjectIfCustom(
                'payment_link_email',
                payLinkMerge(
                  clientName,
                  payCompose.amount,
                  payCompose.labels.join(', '),
                  payCompose.url,
                ),
                `Payment link for ${payCompose.labels.join(', ')}`,
              )
            : 'Payment link'
        }
        initialBodyText={
          payCompose
            ? applySystemTemplateIfCustom(
                'payment_link_email',
                payLinkMerge(
                  clientName,
                  payCompose.amount,
                  payCompose.labels.join(', '),
                  payCompose.url,
                ),
                `Hi ${clientName.split(' ')[0] || 'there'},\n\nHere is a secure Stripe link to pay ${money(payCompose.amount)} for ${payCompose.labels.join(', ')}:\n\n${payCompose.url}\n\nThank you.`,
              )
            : ''
        }
        mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
        onClose={() => setPayCompose(null)}
      />
      <ClientSmsComposeModal
        open={payCompose?.channel === 'sms'}
        clientId={clientId}
        doNotSms={clientDoNotSms}
        clientLabel={clientName}
        message={paySms}
        onMessageChange={setPaySms}
        onClose={() => setPayCompose(null)}
        sending={paySmsSending}
        sendError={paySmsError}
        title="Text pay link"
        subtitle={payCompose ? `${money(payCompose.amount)} · ${payCompose.labels.join(', ')}` : undefined}
        mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
        onSend={({ overrideNonProd }) => {
          void (async () => {
            const message = paySms.trim();
            if (!message) {
              setPaySmsError('Enter a message before sending.');
              return;
            }
            setPaySmsSending(true);
            setPaySmsError(null);
            try {
              await sendClientSms(clientId, {
                message,
                source: 'financial_pay_link',
                ...(overrideNonProd ? { overrideNonProd: true } : {}),
              });
              setPayCompose(null);
              setNote('Pay link texted to the client.');
            } catch (e: unknown) {
              setPaySmsError(apiErr(e));
            } finally {
              setPaySmsSending(false);
            }
          })();
        }}
      />
    </div>
  );
}
