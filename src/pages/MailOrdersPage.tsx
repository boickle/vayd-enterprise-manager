import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { Link, useSearchParams } from 'react-router';
import {
  addMailApprovalNote,
  buyMailLabel,
  createStaffMailOrder,
  fetchMailRates,
  listMailOrders,
  refundMailLabel,
  type MailParcelType,
  type MailRateQuote,
  patchMailOrder,
  pharmacyMailAction,
  sendMailApprovalTask,
  type MailOrder,
  type MailPharmacyStage,
} from '../api/onlineStore';
import { sendClientSms } from '../api/clientSms';
import { createClientPayLink } from '../api/visitWorkflow';
import { searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import {
  extractPatientListFromSearchResponse,
  searchPatients,
  searchPatientsStaff,
  type PatientSearchRow,
} from '../api/patients';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';
import { formatAutoshipFrequency } from './store/storeCartState';
import MailOrderFillLabels from '../components/soap/MailOrderFillLabels';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import StockLotPicker from '../components/inventory/StockLotPicker';
import {
  getPracticeSettings,
  parseOnlineStoreFulfillmentBranchId,
} from '../api/practiceSettings';
import {
  clientIdFromPatientRow,
  clientNameFromPatientRow,
  patientDisplayName,
} from '../utils/briefDisplay';
import './Settings.css';
import './MailOrders.css';

function practiceIdFromToken(token: string | null): number {
  try {
    if (!token) return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(p.practiceId ?? p.practice_id) || 1;
  } catch {
    return 1;
  }
}

const ORIGIN_LABEL: Record<MailOrder['origin'], string> = {
  online_store: 'Online store',
  staff_mail: 'Staff mail',
  office_pickup: 'Office pickup',
  kit: 'Kit',
};

const STAGE_LABEL: Record<MailPharmacyStage, string> = {
  needs_approval: 'Needs approval',
  needs_payment: 'Needs payment',
  fill: 'Fill',
  check: 'Check',
  rtg: 'RTG',
  ship: 'Ship',
  ready_for_pickup: 'Ready for pickup',
  contacted: 'Contacted',
  done: 'Done',
  rejected: 'Rejected',
};

type QueueFilter =
  | 'open'
  | MailPharmacyStage
  | 'ready'
  | 'all';

function payLabel(status?: string | null): string {
  return status === 'paid' ? 'Paid' : 'Needs payment';
}

function fulfillmentLabel(order: MailOrder): string {
  return isPickupOrder(order) ? 'Office pickup' : 'Ship';
}

function matchesMailSearch(order: MailOrder, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  if (/^\d+$/.test(q)) return String(order.id) === q;
  if ((order.customerName || '').toLowerCase().includes(q)) return true;
  if ((order.customerEmail || '').toLowerCase().includes(q)) return true;
  if ((order.patientName || '').toLowerCase().includes(q)) return true;
  for (const pet of order.patients || []) {
    if ((pet.name || '').toLowerCase().includes(q)) return true;
  }
  for (const line of order.lines || []) {
    if ((line.name || '').toLowerCase().includes(q)) return true;
    if ((line.strength || '').toLowerCase().includes(q)) return true;
    if ((line.patientName || '').toLowerCase().includes(q)) return true;
  }
  return false;
}

function matchesQueueFilter(order: MailOrder, filter: QueueFilter): boolean {
  const stage = pharmacyStageOf(order);
  if (filter === 'all') return true;
  if (filter === 'open') return stage !== 'done' && stage !== 'rejected';
  if (filter === 'ready') return stage === 'ship' || stage === 'ready_for_pickup';
  return stage === filter;
}

function mailFillDone(order: MailOrder): boolean {
  const process = order.processStatus || 'queued';
  return Boolean(
    order.filledAt ||
      order.fillerEmployeeId ||
      ['filled', 'first_check', 'second_check', 'packaged', 'rtg', 'shipped'].includes(process),
  );
}

function mailShipDone(order: MailOrder): boolean {
  if (isPickupOrder(order)) {
    return Boolean(
      order.packagedAt ||
        ['packaged', 'rtg', 'second_check', 'shipped'].includes(order.processStatus || ''),
    );
  }
  return Boolean(order.labelUrl);
}

function mailCheckDone(order: MailOrder): boolean {
  return Boolean(
    order.secondCheckedAt ||
      order.secondCheckerEmployeeId ||
      order.processStatus === 'second_check' ||
      order.processStatus === 'shipped',
  );
}

function mailContactedDone(order: MailOrder): boolean {
  return Boolean(order.clientContactedAt || order.processStatus === 'shipped');
}

function thanksAlreadySent(order: MailOrder): boolean {
  return (order.approvalNotes || []).some(
    (note) =>
      note.kind === 'thanks' || /thanks-for-your-order/i.test(note.notes || ''),
  );
}

function pharmacyStageOf(order: MailOrder): MailPharmacyStage {
  if (order.pharmacyStage) return order.pharmacyStage;
  if (order.status === 'cancelled' || order.approvalStatus === 'rejected') return 'rejected';
  if (
    order.approvalStatus === 'needs_doctor_approval' ||
    order.approvalStatus === 'approval_pending' ||
    order.approvalStatus === 'send_back'
  ) {
    return 'needs_approval';
  }
  if ((order.paymentStatus || 'awaiting_payment') !== 'paid') return 'needs_payment';
  if (!mailFillDone(order)) return 'fill';
  if (!mailShipDone(order)) return isPickupOrder(order) ? 'ready_for_pickup' : 'ship';
  if (!mailCheckDone(order)) return 'check';
  if (!mailContactedDone(order)) return 'contacted';
  return 'done';
}

function badgeClass(kind: 'go' | 'wait' | 'warn' | 'stop' | 'plain'): string {
  return `mail-queue__badge${kind === 'plain' ? '' : ` is-${kind}`}`;
}

function stageBadgeKind(stage: MailPharmacyStage): 'go' | 'wait' | 'warn' | 'stop' {
  if (stage === 'done') return 'go';
  if (stage === 'rejected') return 'stop';
  if (stage === 'needs_approval' || stage === 'needs_payment') return 'wait';
  if (stage === 'ship' || stage === 'ready_for_pickup' || stage === 'contacted') return 'go';
  return 'warn';
}

function formatPatientWeight(
  weightLbs?: number | null,
  weightDate?: string | null,
): string | null {
  if (weightLbs == null || !Number.isFinite(Number(weightLbs))) return null;
  const n = Number(weightLbs);
  const lbs = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  const iso = weightDate?.slice(0, 10);
  const date = iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  return date ? `${lbs} lb · ${date}` : `${lbs} lb`;
}

function petNames(order: MailOrder): Array<{
  id: number | null;
  name: string;
  weightLabel: string | null;
}> {
  if (order.patients?.length) {
    return order.patients
      .map((pet) => ({
        id: pet.id ?? null,
        name: pet.name || '',
        weightLabel: formatPatientWeight(pet.weightLbs, pet.weightDate),
      }))
      .filter((pet) => pet.name);
  }
  if (order.patientName) {
    const line = (order.lines || []).find((row) => row.patientId === order.patientId);
    return [
      {
        id: order.patientId ?? null,
        name: order.patientName,
        weightLabel: formatPatientWeight(line?.weightLbs, line?.weightDate),
      },
    ];
  }
  const fromLines = new Map<
    string,
    { id: number | null; name: string; weightLabel: string | null }
  >();
  for (const line of order.lines || []) {
    if (!line.patientName) continue;
    fromLines.set(`${line.patientId || line.patientName}`, {
      id: line.patientId ?? null,
      name: line.patientName,
      weightLabel: formatPatientWeight(line.weightLbs, line.weightDate),
    });
  }
  return [...fromLines.values()];
}

function itemsByPet(order: MailOrder): string[] {
  const groups = new Map<string, string[]>();
  for (const line of order.lines || []) {
    const pet = line.patientName || 'Household';
    const label = `${line.name} × ${Number(line.quantity)}`;
    groups.set(pet, [...(groups.get(pet) || []), label]);
  }
  return [...groups.entries()].map(([pet, items]) => `${pet}: ${items.join(', ')}`);
}

function autoshipLabel(order: MailOrder): string | null {
  const freqs = (order.lines || [])
    .map((line) => line.autoshipFrequency)
    .filter((value): value is string => Boolean(value))
    .map((value) => formatAutoshipFrequency(value))
    .filter((value, idx, all) => all.indexOf(value) === idx);
  if (freqs.length) return freqs.join(', ');
  return order.autoship ? 'Yes' : null;
}

function firstName(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

function money(value?: number | null): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function printCheckSlip(order: MailOrder) {
  const w = window.open('', '_blank', 'width=480,height=700');
  if (!w) return;
  const pets = petNames(order).map((pet) => pet.name).join(' & ') || '—';
  const lines = (order.lines || [])
    .map((line) => {
      const script = line.scriptText || line.refillNote || '';
      return `<p><strong>${line.patientName ? `${line.patientName} · ` : ''}${line.name}</strong> × ${Number(line.quantity)}<br/>${script}</p>`;
    })
    .join('');
  w.document.write(`<!doctype html><html><head><title>Check slip #${order.id}</title>
    <style>body{font:16px/1.4 system-ui,sans-serif;padding:24px;color:#0f172a} h1{font-size:20px;margin:0 0 8px} .muted{color:#64748b}</style>
    </head><body>
    <h1>Pharmacy check slip #${order.id}</h1>
    <p>${order.customerName || 'Client'} · ${pets}</p>
    <p class="muted">Filled by ${order.fillerName || '—'} · Check notes below</p>
    ${lines}
    <p><strong>Notes for checker</strong><br/>${(order.checkNotes || 'None').replace(/\n/g, '<br/>')}</p>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function approvalLabel(status?: MailOrder['approvalStatus']): string {
  if (status === 'approval_pending') return 'Doctor approval pending';
  if (status === 'rejected') return 'Rejected';
  if (status === 'send_back') return 'Sent back';
  if (status === 'needs_doctor_approval') return 'Needs doctor approval';
  return 'Doctor approved';
}

function formatOrderedAt(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isPickupOrder(order: MailOrder): boolean {
  return Boolean(order.pickup) || order.origin === 'office_pickup' || /pick\s*up/i.test(order.shippingChargeName || '');
}

function clientDisplayName(row: ClientSearchRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || `Client #${row.id}`;
}

function apiErrorMessage(e: unknown): string {
  const res = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const message = res?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return e instanceof Error ? e.message : 'Request failed';
}

export default function MailOrdersPage() {
  const { token, employeeId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceId = practiceIdFromToken(token);
  const [rows, setRows] = useState<MailOrder[]>([]);
  const [openId, setOpenId] = useState<number | null>(() => {
    const id = Number(searchParams.get('orderId'));
    return Number.isFinite(id) && id > 0 ? id : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [rates, setRates] = useState<MailRateQuote>({ rates: [], carriers: [], notes: [] });
  const [staffOpen, setStaffOpen] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>('open');
  const [search, setSearch] = useState('');

  const reload = () =>
    listMailOrders(practiceId)
      .then(setRows)
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void reload();
  }, [practiceId]);

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [practiceId]);

  useEffect(() => {
    const id = Number(searchParams.get('orderId'));
    if (Number.isFinite(id) && id > 0) setOpenId(id);
  }, [searchParams]);

  const visible = useMemo(() => {
    const q = search.trim();
    return rows.filter((row) => {
      if (q) return matchesMailSearch(row, q);
      return matchesQueueFilter(row, filter);
    });
  }, [rows, filter, search]);

  const applyFilter = (next: QueueFilter) => {
    setFilter(next);
    const open = rows.find((row) => row.id === openId);
    if (open && !matchesQueueFilter(open, next)) {
      setOpenId(null);
      setRates({ rates: [], carriers: [], notes: [] });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('orderId');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const toggleOpen = (row: MailOrder) => {
    const next = openId === row.id ? null : row.id;
    setOpenId(next);
    setRates({ rates: [], carriers: [], notes: [] });
    setWeight(row.packageWeightOz != null ? String(row.packageWeightOz) : '');
    const nextParams = new URLSearchParams(searchParams);
    if (next) nextParams.set('orderId', String(next));
    else nextParams.delete('orderId');
    setSearchParams(nextParams, { replace: true });
  };

  const replace = (order: MailOrder) => {
    setRows((rs) => rs.map((r) => (r.id === order.id ? order : r)));
  };

  const run = async (fn: () => Promise<MailOrder>) => {
    setError(null);
    try {
      const order = await fn();
      const wasDone = pharmacyStageOf(rows.find((row) => row.id === order.id) || order) === 'done';
      replace(order);
      if (!wasDone && pharmacyStageOf(order) === 'done') setFilter('done');
      return true;
    } catch (e) {
      setError(apiErrorMessage(e));
      return false;
    }
  };

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Mail Order Queue</h2>
          <p className="settings-muted" style={{ margin: 0 }}>
            Collapsed row is the synopsis. Expand an order to do the current pharmacy step.
            Approval decisions live on the assigned task, not here.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => setStaffOpen(true)}>
          + New Mail Order
        </button>
      </div>

      <label className="settings-label mail-queue__search">
        Search
        <input
          type="search"
          className="settings-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order #, client, patient, or medication — searches all stages"
        />
      </label>

      <div className="mail-queue__filters">
        {(
          [
            ['open', 'Open'],
            ['needs_approval', 'Needs approval'],
            ['needs_payment', 'Needs payment'],
            ['fill', 'Fill'],
            ['ready', 'Ship / pickup'],
            ['check', 'Check'],
            ['contacted', 'Contacted'],
            ['done', 'Done'],
            ['rejected', 'Rejected'],
            ['all', 'All'],
          ] as Array<[QueueFilter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'btn primary' : 'btn secondary'}
            onClick={() => applyFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="settings-message settings-error-message">
          <span>{error}</span>
          <button type="button" className="btn secondary" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="mail-queue__list">
        {visible.map((row) => {
          const stage = pharmacyStageOf(row);
          const open = openId === row.id;
          const pets = petNames(row);
          const ship = autoshipLabel(row);
          return (
            <article key={row.id} className={`mail-queue__card${open ? ' is-open' : ''}`}>
              <div
                className="mail-queue__synopsis"
                role="button"
                tabIndex={0}
                onClick={() => toggleOpen(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleOpen(row);
                  }
                }}
              >
                <div>
                  <div className="mail-queue__id">#{row.id}</div>
                  <div className="mail-queue__when">{formatOrderedAt(row.created)}</div>
                  <div className="mail-queue__meta">{ORIGIN_LABEL[row.origin]}</div>
                </div>
                <div>
                  <div>
                    {row.clientId ? (
                      <Link
                        className="mail-queue__pet-link"
                        to={`/schedule/clients?clientId=${encodeURIComponent(String(row.clientId))}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.customerName}
                      </Link>
                    ) : (
                      row.customerName
                    )}
                  </div>
                  <div className="mail-queue__pets">
                    {pets.length
                      ? pets.map((pet, idx) => (
                          <span key={`${pet.id || pet.name}-${idx}`}>
                            {idx > 0 ? ' & ' : ''}
                            {pet.id ? (
                              <Link
                                className="mail-queue__pet-link"
                                to={`/schedule/patients?patientId=${encodeURIComponent(String(pet.id))}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {pet.name}
                              </Link>
                            ) : (
                              pet.name
                            )}
                            {pet.weightLabel ? (
                              <span className="mail-queue__weight"> · {pet.weightLabel}</span>
                            ) : null}
                          </span>
                        ))
                      : 'No pet on file'}
                  </div>
                  <div className="mail-queue__meta">
                    Dr {row.doctorName || '—'} · Created by {row.createdByName || row.customerName || '—'}
                  </div>
                </div>
                <div className="mail-queue__items">
                  {itemsByPet(row).length
                    ? itemsByPet(row).map((line) => <span key={line}>{line}</span>)
                    : '—'}
                </div>
                <div className="mail-queue__badges">
                  <span className={badgeClass(stageBadgeKind(stage))}>{STAGE_LABEL[stage]}</span>
                  <span className={badgeClass(row.paymentStatus === 'paid' ? 'go' : 'wait')}>
                    {payLabel(row.paymentStatus)}
                  </span>
                  <span className={badgeClass('plain')}>{fulfillmentLabel(row)}</span>
                  {ship ? <span className={badgeClass('wait')}>{ship}</span> : null}
                </div>
                <div className="mail-queue__total">{money(row.total)}</div>
              </div>
              {open ? (
                <OrderDetail
                  open={row}
                  employeeId={employeeId}
                  weight={weight}
                  rates={rates}
                  onWeight={setWeight}
                  onRates={setRates}
                  onRun={run}
                  practiceId={practiceId}
                />
              ) : null}
            </article>
          );
        })}
        {!visible.length && (
          <p className="settings-muted">
            {search.trim()
              ? 'No mail orders match that search.'
              : 'No mail orders in this filter yet. They appear when someone orders from the store or staff send an item to mail.'}
          </p>
        )}
      </div>

      {staffOpen && (
        <StaffCreate
          practiceId={practiceId}
          createdByEmployeeId={employeeId ? Number(employeeId) : null}
          onClose={() => setStaffOpen(false)}
          onCreate={async (body) => {
            const created = await createStaffMailOrder(practiceId, body);
            setRows((rs) => [created, ...rs]);
            setStaffOpen(false);
            setOpenId(created.id);
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('orderId', String(created.id));
            setSearchParams(nextParams, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function OrderDetail({
  open,
  employeeId,
  weight,
  rates,
  onWeight,
  onRates,
  onRun,
  practiceId,
}: {
  open: MailOrder;
  employeeId: string | null;
  weight: string;
  rates: MailRateQuote;
  onWeight: (v: string) => void;
  onRates: (v: MailRateQuote) => void;
  onRun: (fn: () => Promise<MailOrder>) => Promise<boolean>;
  practiceId: number;
}) {
  const stage = pharmacyStageOf(open);
  const pickup = isPickupOrder(open);
  const lastStep: MailPharmacyStage = pickup ? 'ready_for_pickup' : 'ship';
  const steps: MailPharmacyStage[] = [
    'needs_approval',
    'needs_payment',
    'fill',
    lastStep,
    'check',
    'contacted',
  ];
  const [viewStep, setViewStep] = useState<MailPharmacyStage>(
    stage === 'done' ? 'contacted' : stage,
  );
  const [scriptsByLine, setScriptsByLine] = useState<Record<number, string>>(() => {
    const next: Record<number, string> = {};
    for (const line of open.lines || []) next[line.id] = line.scriptText || '';
    return next;
  });
  const [savingScriptId, setSavingScriptId] = useState<number | null>(null);
  const myId = employeeId ? Number(employeeId) : 0;
  const iFilled = Boolean(open.fillerEmployeeId && myId && open.fillerEmployeeId === myId);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const [benchNote, setBenchNote] = useState('');
  const [checkNotes, setCheckNotes] = useState(open.checkNotes || '');
  const [sameCheckConfirm, setSameCheckConfirm] = useState(false);
  const [paySubject, setPaySubject] = useState(`Payment for Vet At Your Door order #${open.id}`);
  const [payMessage, setPayMessage] = useState(
    `Hi ${firstName(open.customerName)}, your order #${open.id} totaling ${money(open.total)} still needs payment.`,
  );
  const [notifySubject, setNotifySubject] = useState(
    pickup
      ? `Your order #${open.id} is ready for pickup`
      : `Your order #${open.id} has shipped`,
  );
  const [notifyMessage, setNotifyMessage] = useState(
    pickup
      ? `Hi ${firstName(open.customerName)}, order #${open.id} is ready for pickup${open.shippingChargeName ? ` at ${open.shippingChargeName}` : ''}.`
      : `Hi ${firstName(open.customerName)}, order #${open.id} has shipped${open.trackingCode ? ` — tracking ${open.trackingCode}` : ''}.`,
  );
  const [rejectSubject, setRejectSubject] = useState(
    `Update on your Vet At Your Door order #${open.id}`,
  );
  const [rejectMessage, setRejectMessage] = useState(
    `Hi ${firstName(open.customerName)}, we were not able to fill order #${open.id}. If you were charged, a refund is on the way.`,
  );
  const [rejectNotes, setRejectNotes] = useState('');
  const [fillBranches, setFillBranches] = useState<PracticeBranch[]>([]);
  const [fillBranchId, setFillBranchId] = useState<number | ''>(open.fillBranchId ?? '');
  const [fillLots, setFillLots] = useState<
    Record<number, { lotId: number | null; lotNumber: string }>
  >({});
  const [texting, setTexting] = useState(false);
  const [textedAt, setTextedAt] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailedAt, setEmailedAt] = useState<string | null>(null);
  const [parcelType, setParcelType] = useState<MailParcelType>('mailer');
  const [parcelLength, setParcelLength] = useState('');
  const [parcelWidth, setParcelWidth] = useState('');
  const [parcelHeight, setParcelHeight] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [sendingThanks, setSendingThanks] = useState(false);

  const parcel = () => ({
    type: parcelType,
    weightOz: Number(weight),
    lengthIn: parcelLength ? Number(parcelLength) : null,
    widthIn: parcelWidth ? Number(parcelWidth) : null,
    heightIn: parcelHeight ? Number(parcelHeight) : null,
  });

  const sentClock = () =>
    new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

  useEffect(() => {
    setTextedAt(null);
    setTexting(false);
    setEmailedAt(null);
    setEmailing(false);
    setViewStep(stage === 'done' ? 'contacted' : stage);
    setSameCheckConfirm(false);
    const next: Record<number, string> = {};
    for (const line of open.lines || []) next[line.id] = line.scriptText || '';
    setScriptsByLine(next);
    const lots: Record<number, { lotId: number | null; lotNumber: string }> = {};
    for (const line of open.lines || []) {
      lots[line.id] = {
        lotId: line.inventoryLotBalanceId ?? null,
        lotNumber: line.lotNumber || '',
      };
    }
    setFillLots(lots);
  }, [open.id]);

  useEffect(() => {
    const next = stage === 'done' ? 'contacted' : stage;
    const nextRank = steps.indexOf(next);
    const currentRank = steps.indexOf(viewStep);
    if (nextRank < 0 || currentRank < 0 || nextRank <= currentRank) return;
    setViewStep(next);
    setSameCheckConfirm(false);
  }, [stage]);

  useEffect(() => {
    setCheckNotes(open.checkNotes || '');
  }, [open.id, open.checkNotes]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPracticeBranches(practiceId),
      getPracticeSettings(practiceId).catch(() => ({})),
    ]).then(([offices, settings]) => {
      if (cancelled) return;
      const active = offices.filter((row) => row.isActive !== false);
      setFillBranches(active);
      if (open.fillBranchId) {
        setFillBranchId(open.fillBranchId);
        return;
      }
      const fromSettings = parseOnlineStoreFulfillmentBranchId(settings);
      const fallback =
        fromSettings ||
        active.find((row) => row.isDefault)?.id ||
        active.find((row) => /brunswick/i.test(row.name))?.id ||
        active[0]?.id ||
        '';
      setFillBranchId(fallback || '');
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, open.id, open.fillBranchId]);

  useEffect(() => {
    void fetchAllEmployees().then((rows) => {
      const active = rows.filter((row) => row.isActive !== false && !row.isDeleted);
      setStaff(active);
      const preferred =
        open.doctorEmployeeId ||
        active.find((row) => formatEmployeeDisplayName(row) === open.doctorName)?.id;
      if (preferred) setAssigneeId(String(preferred));
    });
  }, [open.id, open.doctorEmployeeId, open.doctorName]);

  const sendClientText = async (message: string, typeLabel: string) => {
    if (!open.clientId) throw new Error('This order has no client record to text.');
    const patientIds = [
      ...new Set(
        [open.patientId, ...(open.lines || []).map((line) => line.patientId)].filter(
          (id): id is number => id != null && id > 0,
        ),
      ),
    ];
    await sendClientSms(open.clientId, {
      message,
      source: 'mail_order',
      practiceId,
      patientIds,
      typeLabel,
    });
  };

  const groupedLines = useMemo(() => {
    const groups: Array<{ key: string; petId: number | null; petName: string | null; lines: MailOrder['lines'] }> = [];
    for (const line of open.lines || []) {
      const key = String(line.patientId || line.patientName || 'household');
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.lines.push(line);
      else {
        groups.push({
          key,
          petId: line.patientId ?? null,
          petName: line.patientName ?? null,
          lines: [line],
        });
      }
    }
    return groups;
  }, [open.lines]);

  const stepDone = (step: MailPharmacyStage) => {
    if (step === 'needs_approval') {
      return !['needs_doctor_approval', 'approval_pending', 'send_back'].includes(
        open.approvalStatus || '',
      );
    }
    if (step === 'needs_payment') return (open.paymentStatus || 'awaiting_payment') === 'paid';
    if (step === 'fill') return mailFillDone(open);
    if (step === 'ship' || step === 'ready_for_pickup') return mailShipDone(open);
    if (step === 'check') return mailCheckDone(open);
    if (step === 'contacted') return mailContactedDone(open);
    return stage === 'done';
  };

  const stepClass = (step: MailPharmacyStage) => {
    if (stage === 'rejected' && step === 'needs_approval') return ' is-stop';
    const viewing = viewStep === step || (step === lastStep && (viewStep === 'ship' || viewStep === 'ready_for_pickup'));
    if (stepDone(step)) return viewing ? ' is-now is-done' : ' is-done';
    if (viewing) return ' is-due';
    return '';
  };

  const stepLabel = (step: MailPharmacyStage) => {
    if (stage === 'rejected' && step === 'needs_approval') return 'Rejected';
    if (stepDone(step) && step === 'needs_approval') return 'Approved';
    if (stepDone(step) && step === 'needs_payment') return 'Paid';
    if (stepDone(step) && step === 'fill') return 'Filled';
    if (stepDone(step) && (step === 'ship' || step === 'ready_for_pickup')) {
      return pickup ? 'Pickup ready' : 'Label printed';
    }
    if (stepDone(step) && step === 'check') return 'Checked';
    if (stepDone(step) && step === 'contacted') {
      return open.clientContactKind === 'none' ? 'Do not contact' : 'Contacted';
    }
    return STAGE_LABEL[step];
  };

  const jumpTo = (step: MailPharmacyStage) => {
    if (
      (step === 'check' || step === 'ship' || step === 'ready_for_pickup') &&
      !mailFillDone(open)
    ) {
      return;
    }
    setViewStep(step);
  };

  const voidLabelButton = (compact = false) =>
    open.labelUrl || open.trackingCode ? (
      <div className="mail-queue__void">
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            if (
              !window.confirm(
                'Void this label on EasyPost? Unused USPS postage is refunded in about 15 days, not instantly. If the carrier has already scanned it, EasyPost will refuse and postage is spent.',
              )
            ) {
              return;
            }
            void onRun(() => refundMailLabel(practiceId, open.id));
          }}
        >
          Void / refund this label
        </button>
        {!compact ? (
          <p className="settings-muted">
            This asks EasyPost to refund unused postage. It is not instant — USPS
            usually takes about 15 days. Already scanned or in-transit labels cannot
            be refunded.
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="mail-queue__detail" onClick={(e) => e.stopPropagation()}>
      <div className="mail-queue__steps">
        {steps.map((step) => {
          const locked =
            (step === 'check' || step === 'ship' || step === 'ready_for_pickup') &&
            !mailFillDone(open);
          return (
            <button
              key={step}
              type="button"
              className={`mail-queue__step${stepClass(step)}${locked ? ' is-locked' : ''}`}
              disabled={locked}
              title={locked ? 'Mark filled before shipping or checking' : undefined}
              onClick={() => jumpTo(step)}
            >
              {stepDone(step) ? `✓ ${stepLabel(step)}` : stepLabel(step)}
            </button>
          );
        })}
      </div>

      <div>
        <div className="mail-queue__current">
          <h3>{stepLabel(viewStep)}</h3>
          {viewStep === 'needs_approval' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                {approvalLabel(open.approvalStatus)}. Approved, rejected, and send back live only
                on the assigned task. Sending the task fills the script from a prior Rx or the
                catalog default.
              </p>
              <div className="mail-queue__actions">
                <label className="settings-label">
                  Send approval task to
                  <select
                    className="settings-input"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                  >
                    <option value="">Choose staff</option>
                    {staff.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {formatEmployeeDisplayName(emp) || emp.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-label">
                  Task note
                  <input
                    className="settings-input"
                    value={taskNote}
                    onChange={(e) => setTaskNote(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!assigneeId}
                  onClick={() =>
                    void onRun(() =>
                      sendMailApprovalTask(practiceId, open.id, {
                        assignedToEmployeeId: Number(assigneeId),
                        notes: taskNote.trim() || undefined,
                      }).then((order) => {
                        setTaskNote('');
                        return order;
                      }),
                    )
                  }
                >
                  Send task
                </button>
                {open.approvalTaskId ? (
                  <Link
                    className="btn secondary"
                    to={`/schedule/tasks?taskId=${encodeURIComponent(String(open.approvalTaskId))}`}
                  >
                    Open task
                  </Link>
                ) : null}
              </div>
            </>
          )}

          {viewStep === 'needs_payment' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                Email an invoice or text a pay link. You can edit the message before it goes out.
              </p>
              <div className="mail-queue__compose">
                <label className="settings-label">
                  Email subject
                  <input
                    className="settings-input"
                    value={paySubject}
                    onChange={(e) => setPaySubject(e.target.value)}
                  />
                </label>
                <label className="settings-label">
                  Message
                  <textarea
                    className="settings-input"
                    value={payMessage}
                    onChange={(e) => setPayMessage(e.target.value)}
                  />
                </label>
              </div>
              <div className="mail-queue__actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!open.clientId}
                  onClick={() =>
                    void onRun(async () => {
                      let message = payMessage.trim();
                      try {
                        const link = await createClientPayLink(open.clientId!);
                        if (link.url && !message.includes(link.url)) {
                          message = `${message}\n\nPay here: ${link.url}`;
                          setPayMessage(message);
                        }
                      } catch {
                        /* still send the note without a Stripe link */
                      }
                      return pharmacyMailAction(practiceId, open.id, {
                        action: 'notify',
                        subject: paySubject.trim() || undefined,
                        message,
                      });
                    })
                  }
                >
                  Email invoice
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!open.clientId}
                  onClick={() =>
                    void onRun(async () => {
                      let message = payMessage.trim();
                      try {
                        const link = await createClientPayLink(open.clientId!);
                        if (link.url && !message.includes(link.url)) {
                          message = `${message} Pay here: ${link.url}`;
                          setPayMessage(message);
                        }
                      } catch {
                        /* still send the text without a Stripe link */
                      }
                      await sendClientText(message, 'Mail order payment text');
                      return addMailApprovalNote(practiceId, open.id, 'Pay-link text sent');
                    })
                  }
                >
                  Text to pay
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    void onRun(() =>
                      patchMailOrder(practiceId, open.id, { paymentStatus: 'paid' }),
                    )
                  }
                >
                  Mark paid
                </button>
              </div>
            </>
          )}

          {viewStep === 'fill' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                Mark this filled whenever the bag is ready, and choose the office you
                took stock from. Ship and check stay locked until then.
              </p>
              <label className="settings-label">
                Filling from
                <select
                  className="settings-input"
                  value={fillBranchId}
                  onChange={(e) =>
                    setFillBranchId(e.target.value ? Number(e.target.value) : '')
                  }
                >
                  <option value="">Choose office…</option>
                  {fillBranches.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {(open.lines || []).some((line) => line.trackLots) ? (
                <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                  {(open.lines || [])
                    .filter((line) => line.trackLots)
                    .map((line) => (
                      <StockLotPicker
                        key={line.id}
                        practiceId={practiceId}
                        inventoryItemId={line.stockInventoryItemId ?? line.inventoryItemId}
                        branchId={fillBranchId === '' ? null : Number(fillBranchId)}
                        required
                        selectedLotId={fillLots[line.id]?.lotId ?? null}
                        lotNumber={fillLots[line.id]?.lotNumber ?? ''}
                        label={`${line.name} — lot / expiration`}
                        onChange={(pick) =>
                          setFillLots((prev) => ({
                            ...prev,
                            [line.id]: { lotId: pick.lotId, lotNumber: pick.lotNumber },
                          }))
                        }
                      />
                    ))}
                </div>
              ) : null}
              <label className="settings-label mail-queue__field">
                Notes for the checker
                <textarea
                  className="settings-input"
                  value={checkNotes}
                  onChange={(e) => setCheckNotes(e.target.value)}
                  placeholder="Dose, count, anything the checker should see"
                />
              </label>
              <div className="mail-queue__actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={
                    !employeeId ||
                    !fillBranchId ||
                    (open.lines || []).some(
                      (line) => line.trackLots && !fillLots[line.id]?.lotId
                    )
                  }
                  onClick={() =>
                    void onRun(() =>
                      pharmacyMailAction(practiceId, open.id, {
                        action: 'fill',
                        checkNotes,
                        fillBranchId: Number(fillBranchId),
                        lineLots: (open.lines || []).map((line) => ({
                          lineId: line.id,
                          inventoryLotBalanceId: fillLots[line.id]?.lotId ?? null,
                          lotNumber: fillLots[line.id]?.lotNumber || null,
                        })),
                      }),
                    )
                  }
                >
                  Mark filled
                </button>
              </div>
            </>
          )}

          {viewStep === 'check' && (
            <>
              <p style={{ marginTop: 0 }}>
                Filled by <strong>{open.fillerName || '—'}</strong>
                {open.fillBranchName ? (
                  <>
                    {' '}
                    from <strong>{open.fillBranchName}</strong>
                  </>
                ) : null}
              </p>
              <p>
                <strong>Notes from filler</strong>
                <br />
                {open.checkNotes || 'None'}
              </p>
              {open.labelUrl || open.trackingCode ? (
                <p>
                  {open.labelUrl ? (
                    <a href={open.labelUrl} target="_blank" rel="noreferrer">
                      Open shipping label
                    </a>
                  ) : null}
                  {open.trackingCode ? ` · ${open.carrier || 'EasyPost'} ${open.trackingCode}` : ''}
                </p>
              ) : pickup ? (
                <p className="settings-muted">Office pickup — no shipping label.</p>
              ) : null}
              {mailCheckDone(open) ? (
                <p className="settings-muted">Checked. Use Contacted when you are ready to tell the client.</p>
              ) : sameCheckConfirm ? (
                <div className="mail-queue__same-check" role="status">
                  <p className="mail-queue__same-check-title">You filled this order</p>
                  <p>
                    A second person should check it. If no one else is available, you can
                    check it yourself — that is recorded on the order.
                  </p>
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setSameCheckConfirm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!employeeId || !mailFillDone(open)}
                      onClick={() =>
                        void onRun(() =>
                          pharmacyMailAction(practiceId, open.id, {
                            action: 'check_override',
                            notes: 'Checked by the person who filled this order.',
                          }),
                        ).then((ok) => {
                          if (ok) {
                            setSameCheckConfirm(false);
                            setViewStep('contacted');
                          }
                        })
                      }
                    >
                      Check this order
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mail-queue__actions">
                  <button type="button" className="btn secondary" onClick={() => printCheckSlip(open)}>
                    Print check slip
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!employeeId || !mailFillDone(open)}
                    onClick={() => {
                      if (iFilled) {
                        setSameCheckConfirm(true);
                        return;
                      }
                      void onRun(() =>
                        pharmacyMailAction(practiceId, open.id, { action: 'check' }),
                      ).then((ok) => {
                        if (ok) setViewStep('contacted');
                      });
                    }}
                  >
                    I checked this
                  </button>
                </div>
              )}
              {voidLabelButton()}
            </>
          )}

          {(viewStep === 'ship' || viewStep === 'ready_for_pickup') && (
            <>
              {viewStep === 'ship' && (open.labelUrl || open.trackingCode) && (
                <>
                  <p className="mail-queue__sent" style={{ marginTop: 0 }}>
                    Label already printed — postage was charged. Do not print another
                    unless you void this one first.
                  </p>
                  <p>
                    {open.carrier || 'EasyPost'}
                    {open.service ? ` ${open.service}` : ''}
                    {open.trackingCode ? ` · ${open.trackingCode}` : ''}
                  </p>
                  {open.labelUrl ? (
                    <p>
                      <a href={open.labelUrl} target="_blank" rel="noreferrer">
                        Open shipping label
                      </a>
                    </p>
                  ) : null}
                  {voidLabelButton()}
                </>
              )}
              {viewStep === 'ship' && !(open.labelUrl || open.trackingCode) && (
                <>
                  <p className="settings-muted" style={{ marginTop: 0 }}>
                    Choose the package type before quoting. A 1 oz bottle in a padded
                    mailer is much cheaper than the same weight rated as a box.
                    EasyPost only returns carriers connected on that account — add UPS
                    there if it is missing. These are EasyPost retail/account rates, not
                    Stamps.com negotiated postage.
                    {open.fillBranchName
                      ? ` Quotes ship from ${open.fillBranchName}.`
                      : ' Fill the order first so quotes use that office ZIP.'}
                  </p>
                  {open.labelRefundStatus ? (
                    <p className="settings-muted">
                      Last label refund: {open.labelRefundStatus}. Print a new label if
                      you still need to ship.
                    </p>
                  ) : null}
                  <div className="mail-queue__actions">
                    <label className="settings-label">
                      Package type
                      <select
                        className="settings-input"
                        value={parcelType}
                        onChange={(e) => setParcelType(e.target.value as MailParcelType)}
                      >
                        <option value="letter">Letter / envelope</option>
                        <option value="flat">Large envelope (flat)</option>
                        <option value="mailer">Padded mailer</option>
                        <option value="small_box">Small box</option>
                        <option value="custom">Custom dimensions</option>
                      </select>
                    </label>
                    <label className="settings-label">
                      Package weight (oz)
                      <input
                        className="settings-input"
                        value={weight}
                        onChange={(e) => onWeight(e.target.value)}
                        placeholder="Required"
                      />
                    </label>
                    {(parcelType === 'custom' || parcelType === 'mailer' || parcelType === 'small_box') && (
                      <>
                        <label className="settings-label">
                          L (in)
                          <input
                            className="settings-input"
                            value={parcelLength}
                            onChange={(e) => setParcelLength(e.target.value)}
                            placeholder={parcelType === 'mailer' ? '10' : parcelType === 'small_box' ? '8' : ''}
                          />
                        </label>
                        <label className="settings-label">
                          W (in)
                          <input
                            className="settings-input"
                            value={parcelWidth}
                            onChange={(e) => setParcelWidth(e.target.value)}
                            placeholder={parcelType === 'mailer' ? '7' : parcelType === 'small_box' ? '6' : ''}
                          />
                        </label>
                        <label className="settings-label">
                          H (in)
                          <input
                            className="settings-input"
                            value={parcelHeight}
                            onChange={(e) => setParcelHeight(e.target.value)}
                            placeholder={parcelType === 'mailer' ? '1' : parcelType === 'small_box' ? '4' : ''}
                          />
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={!mailFillDone(open) || !open.fillBranchId || quoting}
                      onClick={() => {
                        setQuoting(true);
                        void fetchMailRates(practiceId, open.id, parcel())
                          .then(onRates)
                          .finally(() => setQuoting(false));
                      }}
                    >
                      {quoting ? 'Comparing sizes…' : 'Get cheapest rates'}
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!mailFillDone(open) || !open.fillBranchId}
                      onClick={() =>
                        void onRun(async () => {
                          const order = await buyMailLabel(practiceId, open.id, parcel());
                          if (order.labelUrl) window.open(order.labelUrl, '_blank');
                          return order;
                        })
                      }
                    >
                      Print cheapest label
                    </button>
                  </div>
                  {rates.shipFrom?.zip ? (
                    <p className="settings-muted">
                      Quoted from {rates.shipFrom.name || rates.shipFrom.city}{' '}
                      {rates.shipFrom.zip}.
                    </p>
                  ) : null}
                  {rates.packHints && rates.packHints.length > 0 ? (
                    <div className="mail-queue__pack-hint">
                      <p>
                        <strong>Cheaper if you can pack smaller.</strong> Same
                        weight, different box. Only print after you actually fit
                        it.
                      </p>
                      <ul>
                        {rates.packHints.map((hint) => (
                          <li key={hint.label}>
                            {hint.label}: {hint.carrier} {hint.service} ${hint.rate}{' '}
                            (${hint.save} less){' '}
                            <button
                              type="button"
                              className="brief-text-btn"
                              disabled={quoting}
                              onClick={() => {
                                setParcelType(hint.type);
                                setParcelLength(String(hint.lengthIn));
                                setParcelWidth(String(hint.widthIn));
                                setParcelHeight(String(hint.heightIn));
                                setQuoting(true);
                                void fetchMailRates(practiceId, open.id, {
                                  type: hint.type,
                                  weightOz: Number(weight),
                                  lengthIn: hint.lengthIn,
                                  widthIn: hint.widthIn,
                                  heightIn: hint.heightIn,
                                })
                                  .then(onRates)
                                  .finally(() => setQuoting(false));
                              }}
                            >
                              Use this size
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : rates.rates.length > 0 ? (
                    <p className="settings-muted">
                      Also quoted a few smaller mailers at this weight — none beat
                      this price.
                    </p>
                  ) : null}
                  {rates.rates.length > 0 && (
                    <ul>
                      {rates.rates.map((r) => (
                        <li key={r.id}>
                          {r.carrier} {r.service} — ${r.rate}{' '}
                          <button
                            type="button"
                            className="brief-text-btn"
                            onClick={() =>
                              void onRun(async () => {
                                const order = await buyMailLabel(practiceId, open.id, {
                                  ...parcel(),
                                  rateId: r.id,
                                });
                                if (order.labelUrl) window.open(order.labelUrl, '_blank');
                                return order;
                              })
                            }
                          >
                            Print this label
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {rates.blockedCarriers?.length ? (
                    <p className="settings-muted">
                      {rates.blockedCarriers.join(' and ')}{' '}
                      {rates.blockedCarriers.length === 1 ? 'is' : 'are'} hidden
                      because an item on this order lists{' '}
                      {rates.blockedCarriers.length === 1 ? 'it' : 'them'} as a
                      prohibited carrier.
                    </p>
                  ) : rates.carriers.length > 0 && !rates.carriers.some((c) => /ups/i.test(c)) ? (
                    <p className="settings-muted">
                      UPS is not on this quote. Connect a UPS carrier account in EasyPost
                      if you want those rates.
                    </p>
                  ) : null}
                </>
              )}
              {viewStep === 'ready_for_pickup' && (
                <p className="settings-muted" style={{ marginTop: 0 }}>
                  Office pickup — no EasyPost label. Send it to check when the bag is ready.
                </p>
              )}
              <div className="mail-queue__actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!pickup && !open.labelUrl}
                  onClick={() =>
                    void onRun(() =>
                      pharmacyMailAction(practiceId, open.id, { action: 'ready_for_check' }),
                    )
                  }
                >
                  Ready for check
                </button>
              </div>
              {!pickup && !open.labelUrl ? (
                <p className="settings-muted">Print an EasyPost label before sending this to check.</p>
              ) : null}
            </>
          )}

          {viewStep === 'contacted' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                The order is Done only after fill, ship or pickup, check, and this contact step.
              </p>
              {mailContactedDone(open) ? (
                <p className="mail-queue__sent" role="status">
                  {open.clientContactKind === 'none'
                    ? 'Marked do not contact.'
                    : open.clientContactKind === 'sms'
                      ? 'Client was texted.'
                      : 'Client was emailed.'}
                </p>
              ) : (
                <>
                  <div className="mail-queue__compose">
                    <label className="settings-label">
                      Subject
                      <input
                        className="settings-input"
                        value={notifySubject}
                        onChange={(e) => setNotifySubject(e.target.value)}
                      />
                    </label>
                    <label className="settings-label">
                      Message
                      <textarea
                        className="settings-input"
                        value={notifyMessage}
                        onChange={(e) => setNotifyMessage(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={emailing}
                      onClick={() =>
                        void (async () => {
                          setEmailing(true);
                          const ok = await onRun(() =>
                            pharmacyMailAction(practiceId, open.id, {
                              action: pickup ? 'ready_for_pickup' : 'notify',
                              subject: notifySubject.trim() || undefined,
                              message: notifyMessage.trim() || undefined,
                              recordContact: true,
                            }),
                          );
                          setEmailing(false);
                          if (ok) setEmailedAt(sentClock());
                        })()
                      }
                    >
                      {emailing ? 'Emailing…' : emailedAt ? 'Emailed' : 'Email client'}
                    </button>
                    <button
                      type="button"
                      className={textedAt ? 'btn primary' : 'btn secondary'}
                      disabled={!open.clientId || texting}
                      onClick={() =>
                        void (async () => {
                          setTexting(true);
                          const ok = await onRun(async () => {
                            await sendClientText(
                              notifyMessage.trim(),
                              pickup ? 'Mail order pickup text' : 'Mail order shipped text',
                            );
                            return pharmacyMailAction(practiceId, open.id, {
                              action: 'complete',
                              notes: pickup ? 'Pickup text sent' : 'Shipped text sent',
                            });
                          });
                          setTexting(false);
                          if (ok) setTextedAt(sentClock());
                        })()
                      }
                    >
                      {texting ? 'Texting…' : textedAt ? 'Texted' : 'Text client'}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() =>
                        void onRun(() =>
                          pharmacyMailAction(practiceId, open.id, {
                            action: 'skip_contact',
                            notes: 'Do not contact client',
                          }),
                        )
                      }
                    >
                      Do not contact client
                    </button>
                  </div>
                  {emailedAt ? (
                    <p className="mail-queue__sent" role="status">
                      Email sent to {open.customerName} at {emailedAt}.
                    </p>
                  ) : null}
                  {textedAt ? (
                    <p className="mail-queue__sent" role="status">
                      Text sent to {open.customerName} at {textedAt}.
                    </p>
                  ) : null}
                </>
              )}
              {stage === 'done' ? (
                <p className="settings-muted">
                  {pickup ? 'Ready for pickup / completed.' : 'Shipped.'}
                  {open.trackingCode ? ` Tracking ${open.trackingCode}.` : ''}
                </p>
              ) : null}
            </>
          )}

          {stage === 'rejected' && (
            <p className="settings-muted" style={{ marginTop: 0 }}>
              This order was rejected. Linked auto-ship is cancelled and a refund is issued when a
              Stripe charge exists.
            </p>
          )}

          {!employeeId && (viewStep === 'fill' || viewStep === 'check') && (
            <p className="settings-muted">Sign in as staff so your name is recorded.</p>
          )}
        </div>

        {groupedLines.map((group) => {
          const weightLabel = formatPatientWeight(
            group.lines[0]?.weightLbs,
            group.lines[0]?.weightDate,
          );
          return (
          <div key={group.key}>
            {group.petName ? (
              <p className="mail-queue__pet">
                {group.petId ? (
                  <Link
                    className="mail-queue__pet-link"
                    to={`/schedule/patients?patientId=${encodeURIComponent(String(group.petId))}`}
                  >
                    {group.petName}
                  </Link>
                ) : (
                  group.petName
                )}
                {weightLabel ? <span className="mail-queue__weight"> · {weightLabel}</span> : null}
              </p>
            ) : null}
            {group.lines.map((line) => (
              <div key={line.id} className="mail-queue__line">
                <h4>
                  {line.name} × {Number(line.quantity)}
                </h4>
                <p className="settings-muted" style={{ margin: '0 0 6px' }}>
                  {line.autoshipFrequency
                    ? `Auto-ship ${formatAutoshipFrequency(line.autoshipFrequency)}${
                        line.renewalDate ? ` · next ${line.renewalDate}` : ''
                      }`
                    : 'One-time fill'}
                  {' · '}
                  {line.primaryProviderName || open.doctorName || 'No primary provider'}
                </p>
                {line.authorizedRefills != null ? (
                  <p className="mail-queue__refills">
                    Add {line.authorizedRefills} refill{line.authorizedRefills === 1 ? '' : 's'}
                    {line.authorizedRefillExpiration
                      ? ` · expire ${line.authorizedRefillExpiration}`
                      : ''}
                  </p>
                ) : null}
                <p className="settings-muted" style={{ margin: '4px 0 0' }}>
                  {line.refillsRemaining != null
                    ? `${line.refillsRemaining} remaining on the prior Rx`
                    : line.refillNote || 'Prior refill count not on file'}
                  {line.refillExpiresAt
                    ? ` · expires ${new Date(line.refillExpiresAt).toLocaleDateString()}`
                    : ''}
                </p>
                <label className="settings-label mail-queue__field">
                  Directions
                  <textarea
                    className="settings-input mail-queue__script"
                    rows={3}
                    value={scriptsByLine[line.id] ?? line.scriptText ?? ''}
                    onChange={(e) =>
                      setScriptsByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                    }
                  />
                </label>
                <div className="mail-queue__actions">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={
                      savingScriptId === line.id ||
                      (scriptsByLine[line.id] ?? '').trim() === (line.scriptText || '').trim()
                    }
                    onClick={() =>
                      void (async () => {
                        setSavingScriptId(line.id);
                        try {
                          await onRun(() =>
                            pharmacyMailAction(practiceId, open.id, {
                              action: 'update_script',
                              lineId: line.id,
                              scriptText: (scriptsByLine[line.id] || '').trim(),
                            }),
                          );
                        } finally {
                          setSavingScriptId(null);
                        }
                      })()
                    }
                  >
                    {savingScriptId === line.id ? 'Saving…' : 'Save directions'}
                  </button>
                </div>
                <MailOrderFillLabels
                  order={open}
                  line={{
                    ...line,
                    scriptText: scriptsByLine[line.id] ?? line.scriptText,
                  }}
                  checkNotes={checkNotes}
                />
              </div>
            ))}
          </div>
          );
        })}
      </div>

      <div className="mail-queue__side">
        <div className="mail-queue__side-card">
          <h3>Order</h3>
          <p style={{ margin: '0 0 6px' }}>
            {open.clientId ? (
              <Link
                className="mail-queue__pet-link"
                to={`/schedule/clients?clientId=${encodeURIComponent(String(open.clientId))}`}
              >
                {open.customerName}
              </Link>
            ) : (
              open.customerName
            )}
          </p>
          <p className="settings-muted" style={{ margin: '0 0 6px' }}>
            {open.shipLine1 || 'No address yet'}
            {open.shipLine2 ? `, ${open.shipLine2}` : ''}
            {open.shipCity ? `, ${open.shipCity}` : ''} {open.shipState} {open.shipPostal}
          </p>
          <p className="settings-muted" style={{ margin: 0 }}>
            Doctor {open.doctorName || '—'}
            <br />
            Created by {open.createdByName || open.customerName || '—'}
            <br />
            Filled by {open.fillerName || '—'}
            {open.fillBranchName ? ` at ${open.fillBranchName}` : ''}
            {open.secondCheckerName ? ` · Checked by ${open.secondCheckerName}` : ''}
          </p>
          {(open.labelUrl || open.trackingCode) && (
            <>
              <p>
                {open.labelUrl ? (
                  <a href={open.labelUrl} target="_blank" rel="noreferrer">
                    Open label
                  </a>
                ) : null}
                {open.trackingCode ? ` · ${open.trackingCode}` : ''}
              </p>
              {voidLabelButton(true)}
            </>
          )}
        </div>

        <div className="mail-queue__side-card">
          <h3>Activity</h3>
          {!thanksAlreadySent(open) ? (
            <div className="mail-queue__actions" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn secondary"
                disabled={sendingThanks || !open.customerEmail}
                onClick={() =>
                  void (async () => {
                    setSendingThanks(true);
                    try {
                      await onRun(() =>
                        pharmacyMailAction(practiceId, open.id, { action: 'thanks' }),
                      );
                    } finally {
                      setSendingThanks(false);
                    }
                  })()
                }
              >
                {sendingThanks ? 'Sending…' : 'Send thanks-for-your-order email'}
              </button>
            </div>
          ) : null}
          {(open.approvalNotes || []).length ? (
            <div className="mail-queue__notes">
              {(open.approvalNotes || []).map((note, idx) => (
                <div key={`${note.at}-${idx}`} className="mail-queue__note">
                  <strong>
                    {note.kind === 'task_sent'
                      ? 'Task sent'
                      : note.kind === 'approved'
                        ? 'Approved'
                        : note.kind === 'rejected'
                          ? 'Rejected'
                          : note.kind === 'send_back'
                            ? 'Sent back'
                            : note.kind === 'sig'
                              ? 'Directions changed'
                              : note.kind === 'contacted'
                                ? 'Contacted'
                                : note.kind === 'thanks'
                                  ? 'Thanks email'
                                  : note.kind === 'check_override'
                                    ? 'Second-person check overridden'
                                    : 'Note'}
                  </strong>
                  {note.actorName ? ` · ${note.actorName}` : ''}
                  {note.assignedToName ? ` → ${note.assignedToName}` : ''}
                  <div className="settings-muted">{formatOrderedAt(note.at)}</div>
                  {note.notes ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{note.notes}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-muted" style={{ margin: 0 }}>
              No notes yet.
            </p>
          )}
          <div className="mail-queue__actions" style={{ marginTop: 10 }}>
            <label className="settings-label" style={{ flex: '1 1 160px' }}>
              Internal note
              <input
                className="settings-input"
                value={benchNote}
                onChange={(e) => setBenchNote(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn secondary"
              disabled={!benchNote.trim()}
              onClick={() =>
                void onRun(() =>
                  addMailApprovalNote(practiceId, open.id, benchNote.trim()).then((order) => {
                    setBenchNote('');
                    return order;
                  }),
                )
              }
            >
              Add note
            </button>
          </div>
        </div>

        {stage !== 'done' && stage !== 'rejected' && (
          <div className="mail-queue__side-card mail-queue__danger">
            <h3>Reject</h3>
            <p className="settings-muted" style={{ marginTop: 0 }}>
              Refunds the Stripe charge, cancels linked auto-ship, and can email or text the
              client.
            </p>
            <label className="settings-label">
              Internal reason
              <input
                className="settings-input"
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
              />
            </label>
            <label className="settings-label">
              Email subject
              <input
                className="settings-input"
                value={rejectSubject}
                onChange={(e) => setRejectSubject(e.target.value)}
              />
            </label>
            <label className="settings-label mail-queue__field">
              Client message
              <textarea
                className="settings-input"
                value={rejectMessage}
                onChange={(e) => setRejectMessage(e.target.value)}
              />
            </label>
            <div className="mail-queue__actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  void onRun(() =>
                    pharmacyMailAction(practiceId, open.id, {
                      action: 'reject',
                      notes: rejectNotes.trim() || undefined,
                      subject: rejectSubject.trim() || undefined,
                      message: rejectMessage.trim() || undefined,
                    }),
                  )
                }
              >
                Reject + refund + email
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!open.clientId}
                onClick={() =>
                  void onRun(async () => {
                    const order = await pharmacyMailAction(practiceId, open.id, {
                      action: 'reject',
                      notes: rejectNotes.trim() || undefined,
                      subject: rejectSubject.trim() || undefined,
                      message: undefined,
                    });
                    await sendClientText(rejectMessage.trim(), 'Mail order text');
                    return addMailApprovalNote(practiceId, order.id, 'Rejection text sent');
                  })
                }
              >
                Reject + refund + text
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function clientEmail(row: ClientSearchRow): string | undefined {
  const value = row.email ?? row.emailAddress;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function StaffCreate({
  practiceId,
  createdByEmployeeId,
  onClose,
  onCreate,
}: {
  practiceId: number;
  createdByEmployeeId: number | null;
  onClose: () => void;
  onCreate: (body: Parameters<typeof createStaffMailOrder>[1]) => Promise<void>;
}) {
  const [clientQ, setClientQ] = useState('');
  const [clientHits, setClientHits] = useState<ClientSearchRow[]>([]);
  const [client, setClient] = useState<ClientSearchRow | null>(null);
  const [includeInactiveClients, setIncludeInactiveClients] = useState(false);
  const [patientQ, setPatientQ] = useState('');
  const [patientHits, setPatientHits] = useState<PatientSearchRow[]>([]);
  const [patient, setPatient] = useState<PatientSearchRow | null>(null);
  const [includeInactivePatients, setIncludeInactivePatients] = useState(false);
  const [packageInfo, setPackageInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = clientQ.trim();
    if (client || q.length < 2) {
      setClientHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchClientsStaff(q, { includeInactive: includeInactiveClients })
        .then(setClientHits)
        .catch(() => setClientHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [clientQ, client, includeInactiveClients]);

  useEffect(() => {
    const q = patientQ.trim();
    if (patient || (q.length < 2 && !client)) {
      setPatientHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      const req = client
        ? searchPatients({
            name: q || undefined,
            clientId: client.id,
            practiceId,
            activeOnly: !includeInactivePatients,
          }).then((res) =>
            extractPatientListFromSearchResponse(res.data).map((r) => r as PatientSearchRow),
          )
        : searchPatientsStaff(q, { practiceId, activeOnly: !includeInactivePatients });
      void req.then(setPatientHits).catch(() => setPatientHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [patientQ, patient, client, practiceId, includeInactivePatients]);

  const pickPatient = (row: PatientSearchRow) => {
    setPatient(row);
    setPatientQ(patientDisplayName(row));
    setPatientHits([]);
    const cid = clientIdFromPatientRow(row);
    const cname = clientNameFromPatientRow(row);
    if (cid != null && !client) {
      setClient({ id: cid, firstName: cname || '', lastName: '' });
      setClientQ(cname || String(cid));
    }
  };

  return (
    <div
      className="settings-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-labelledby="new-mail-order-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3 id="new-mail-order-title">New mail order</h3>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p className="settings-muted" style={{ marginTop: 0 }}>
            For ashes and other packages that are not a pharmacy fill. This skips
            approval, fill, and second check so you can print a label.
          </p>
          <div className="mail-queue__field-row">
            <label className="settings-label" style={{ flex: 1 }}>
              Client
              <input
                className="settings-input"
                value={clientQ}
                onChange={(e) => {
                  setClient(null);
                  setClientQ(e.target.value);
                }}
                placeholder="Search client"
              />
            </label>
            <label className="mail-queue__inactive">
              <input
                type="checkbox"
                checked={includeInactiveClients}
                onChange={(e) => setIncludeInactiveClients(e.target.checked)}
              />
              Include inactive
            </label>
          </div>
          {clientHits.length ? (
            <ul className="mail-queue__hits">
              {clientHits.slice(0, 8).map((row) => (
                <li key={String(row.id)}>
                  <button
                    type="button"
                    className="brief-text-btn"
                    onClick={() => {
                      setClient(row);
                      setClientQ(clientDisplayName(row));
                      setClientHits([]);
                    }}
                  >
                    {clientDisplayName(row)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mail-queue__field-row">
            <label className="settings-label" style={{ flex: 1 }}>
              Patient
              <input
                className="settings-input"
                value={patientQ}
                onChange={(e) => {
                  setPatient(null);
                  setPatientQ(e.target.value);
                }}
                placeholder="Search patient"
              />
            </label>
            <label className="mail-queue__inactive">
              <input
                type="checkbox"
                checked={includeInactivePatients}
                onChange={(e) => setIncludeInactivePatients(e.target.checked)}
              />
              Include inactive
            </label>
          </div>
          {patientHits.length ? (
            <ul className="mail-queue__hits">
              {patientHits.slice(0, 8).map((row) => (
                <li key={String(row.id)}>
                  <button type="button" className="brief-text-btn" onClick={() => pickPatient(row)}>
                    {patientDisplayName(row)}
                    {clientNameFromPatientRow(row) ? ` — ${clientNameFromPatientRow(row)}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="settings-label">
            Package info
            <textarea
              className="settings-input"
              rows={3}
              value={packageInfo}
              onChange={(e) => setPackageInfo(e.target.value)}
              placeholder="e.g. Ashes — small urn for Maple"
            />
          </label>
          <div className="settings-modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !client || !packageInfo.trim()}
              onClick={() => {
                const clientId = Number(client?.id);
                const patientId = patient ? Number(patient.id) : null;
                const zip =
                  (typeof client?.zip === 'string' && client.zip) ||
                  (typeof client?.zipcode === 'string' && client.zipcode) ||
                  '';
                setBusy(true);
                void onCreate({
                  origin: 'staff_mail',
                  packageShipment: true,
                  customerName: client ? clientDisplayName(client) : 'Client',
                  customerEmail: client ? clientEmail(client) : undefined,
                  clientId: Number.isFinite(clientId) ? clientId : null,
                  patientId: Number.isFinite(patientId) ? patientId : null,
                  patientName: patient ? patientDisplayName(patient) : null,
                  paymentStatus: 'paid',
                  shippingPaymentStatus: 'paid',
                  shippingChargeName: 'package mail',
                  shipping: 0,
                  notes: packageInfo.trim(),
                  createdByEmployeeId,
                  ship: client
                    ? {
                        name: clientDisplayName(client),
                        line1: typeof client.address1 === 'string' ? client.address1 : undefined,
                        city: typeof client.city === 'string' ? client.city : undefined,
                        state: typeof client.state === 'string' ? client.state : undefined,
                        postal: zip || undefined,
                      }
                    : undefined,
                  lines: [{ name: packageInfo.trim(), quantity: 1 }],
                }).finally(() => setBusy(false));
              }}
            >
              {busy ? 'Adding…' : 'Add to queue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
