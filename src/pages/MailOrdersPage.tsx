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
  overrideMailLineApproval,
  splitMailOrder,
  type MailOrder,
  type MailOrderLine,
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
import EditAutoshipModal from '../components/soap/EditAutoshipModal';
import MailOrderClientCommsPanel from '../components/soap/MailOrderClientCommsPanel';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import StockLotPicker from '../components/inventory/StockLotPicker';
import InventoryItemDetailModal from '../components/inventory/InventoryItemDetailModal';
import {
  getPracticeSettings,
  parseMailOrderRxLinePhone,
  parseOnlineStoreFulfillmentBranchId,
  parseOnlineStoreFulfillmentLocationId,
} from '../api/practiceSettings';
import {
  clientIdFromPatientRow,
  clientNameFromPatientRow,
  patientDisplayName,
} from '../utils/briefDisplay';
import { appPrompt } from '../utils/appDialog';
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
  pending_client: 'Pending client',
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

const MAIL_ORDERS_SCROLL_KEY = 'mailOrders.returnScroll';

type MailOrdersScrollState = {
  orderId: number;
  filter: string;
  scrollY: number;
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
  const lines = order.lines || [];
  if (lines.length > 0) {
    return lines.every(
      (line) => Boolean(line.checkedAt) || Boolean(order.secondCheckedAt),
    );
  }
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

function lineIsApproved(line: MailOrderLine): boolean {
  return line.lineStatus === 'ok_to_mail';
}

function lineNeedsApproval(line: MailOrderLine): boolean {
  return (
    line.lineStatus === 'awaiting_doctor_approval' ||
    line.lineStatus === 'send_back' ||
    line.lineStatus === 'rejected'
  );
}

/** Lot-tracked lines are filled once a lot is picked; others follow the order fill stamp. */
function lineIsFilled(line: MailOrderLine, order: MailOrder): boolean {
  if (line.trackLots) {
    return Boolean(line.inventoryLotBalanceId || line.lotNumber);
  }
  return mailFillDone(order);
}

function lineIsChecked(line: MailOrderLine, order: MailOrder): boolean {
  return Boolean(line.checkedAt) || Boolean(order.secondCheckedAt);
}

function linesAllApproved(lines: MailOrderLine[]): boolean {
  return lines.length > 0 && lines.every(lineIsApproved);
}

function linesAllFilled(lines: MailOrderLine[], order: MailOrder): boolean {
  return lines.length > 0 && lines.every((line) => lineIsFilled(line, order));
}

function linesAllChecked(lines: MailOrderLine[], order: MailOrder): boolean {
  return lines.length > 0 && lines.every((line) => lineIsChecked(line, order));
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
  if (order.clientQuestionPendingAt) return 'pending_client';
  if (
    order.approvalStatus === 'needs_doctor_approval' ||
    order.approvalStatus === 'approval_pending' ||
    order.approvalStatus === 'send_back'
  ) {
    return 'needs_approval';
  }
  const paid = (order.paymentStatus || 'awaiting_payment') === 'paid';
  const allowUnpaid = Boolean(order.sendWithoutPayment);
  if (!paid && !allowUnpaid) return 'needs_payment';
  if (!mailFillDone(order)) return 'fill';
  if (!mailShipDone(order)) return isPickupOrder(order) ? 'ready_for_pickup' : 'ship';
  if (!mailCheckDone(order)) return 'check';
  if (!mailContactedDone(order)) return 'contacted';
  if (!paid) return 'needs_payment';
  return 'done';
}

function badgeClass(kind: 'go' | 'wait' | 'warn' | 'stop' | 'plain'): string {
  return `mail-queue__badge${kind === 'plain' ? '' : ` is-${kind}`}`;
}

function stageBadgeKind(stage: MailPharmacyStage): 'go' | 'wait' | 'warn' | 'stop' {
  if (stage === 'done') return 'go';
  if (stage === 'rejected') return 'stop';
  if (
    stage === 'needs_approval' ||
    stage === 'needs_payment' ||
    stage === 'pending_client'
  ) {
    return 'wait';
  }
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
  const [rxLinePhone, setRxLinePhone] = useState('');

  const reload = () =>
    listMailOrders(practiceId)
      .then(setRows)
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void reload();
  }, [practiceId]);

  useEffect(() => {
    void getPracticeSettings(practiceId)
      .then((settings) => setRxLinePhone(parseMailOrderRxLinePhone(settings)))
      .catch(() => setRxLinePhone(''));
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

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(MAIL_ORDERS_SCROLL_KEY);
      if (!raw) return;
      sessionStorage.removeItem(MAIL_ORDERS_SCROLL_KEY);
      const saved = JSON.parse(raw) as MailOrdersScrollState;
      if (saved.filter) setFilter(saved.filter as QueueFilter);
      if (saved.orderId) {
        setOpenId(saved.orderId);
        setSearchParams({ orderId: String(saved.orderId) }, { replace: true });
      }
      requestAnimationFrame(() => {
        window.scrollTo({ top: Number(saved.scrollY) || 0, behavior: 'auto' });
      });
    } catch {
      /* ignore */
    }
  }, [setSearchParams]);

  function rememberMailScroll(orderId: number) {
    try {
      const payload: MailOrdersScrollState = {
        orderId,
        filter,
        scrollY: window.scrollY || 0,
      };
      sessionStorage.setItem(MAIL_ORDERS_SCROLL_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

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
    setRows((rs) => {
      const exists = rs.some((r) => r.id === order.id);
      if (exists) return rs.map((r) => (r.id === order.id ? order : r));
      return [order, ...rs];
    });
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
            ['pending_client', 'Pending client'],
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rememberMailScroll(row.id);
                                }}
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
                  {row.sendWithoutPayment && row.paymentStatus !== 'paid' ? (
                    <span className={badgeClass('warn')}>Send without payment</span>
                  ) : null}
                  <span className={badgeClass('plain')}>{fulfillmentLabel(row)}</span>
                  {ship ? <span className={badgeClass('wait')}>{ship}</span> : null}
                </div>
                <div className="mail-queue__total">
                  <div>{money(row.total)}</div>
                  {Number(row.otherBalanceDue) > 0.009 ? (
                    <span className="mail-queue__owed" title="Account balance due (not this order)">
                      Acct {money(row.otherBalanceDue)}
                    </span>
                  ) : null}
                </div>
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
                  rxLinePhone={rxLinePhone}
                  onRememberScroll={() => rememberMailScroll(row.id)}
                  onOrderUpdated={(next) => {
                    setRows((prev) => {
                      const exists = prev.some((r) => r.id === next.id);
                      if (exists) return prev.map((r) => (r.id === next.id ? next : r));
                      return [next, ...prev];
                    });
                  }}
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
  rxLinePhone,
  onRememberScroll,
  onOrderUpdated,
}: {
  open: MailOrder;
  employeeId: string | null;
  weight: string;
  rates: MailRateQuote;
  onWeight: (v: string) => void;
  onRates: (v: MailRateQuote) => void;
  onRun: (fn: () => Promise<MailOrder>) => Promise<boolean>;
  practiceId: number;
  rxLinePhone: string;
  onRememberScroll: () => void;
  onOrderUpdated: (order: MailOrder) => void;
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
  const [viewStep, setViewStep] = useState<MailPharmacyStage>(() => {
    if (stage === 'done') return 'contacted';
    if (stage === 'pending_client') return 'needs_approval';
    return stage;
  });
  const [scriptsByLine, setScriptsByLine] = useState<Record<number, string>>(() => {
    const next: Record<number, string> = {};
    for (const line of open.lines || []) next[line.id] = line.scriptText || '';
    return next;
  });
  const [savingScriptId, setSavingScriptId] = useState<number | null>(null);
  const [editAutoshipLine, setEditAutoshipLine] = useState<MailOrderLine | null>(null);
  const [autoshipNote, setAutoshipNote] = useState<string | null>(null);
  const [inventoryDetail, setInventoryDetail] = useState<{
    inventoryItemId: number;
    name: string;
    lineId: number;
  } | null>(null);
  const [lotRefreshByLine, setLotRefreshByLine] = useState<Record<number, number>>({});
  const myId = employeeId ? Number(employeeId) : 0;
  const iFilled = Boolean(open.fillerEmployeeId && myId && open.fillerEmployeeId === myId);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [assigneeByLine, setAssigneeByLine] = useState<Record<number, string>>({});
  const [splitIds, setSplitIds] = useState<number[]>([]);
  const [taskNote, setTaskNote] = useState('');
  const [benchNote, setBenchNote] = useState('');
  const [checkNotes, setCheckNotes] = useState(open.checkNotes || '');
  const [sameCheckConfirm, setSameCheckConfirm] = useState<{
    patientId: number | null;
    lineIds: number[];
    label: string;
  } | null>(null);
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
  const orderPaid = (open.paymentStatus || 'awaiting_payment') === 'paid';
  const [rejectMessage, setRejectMessage] = useState(() =>
    orderPaid
      ? `Hi ${firstName(open.customerName)}, we were not able to fill order #${open.id}. If you were charged, a refund is on the way.`
      : `Hi ${firstName(open.customerName)}, we were not able to fill order #${open.id}.`,
  );
  const [rejectNotes, setRejectNotes] = useState('');
  const [fillBranches, setFillBranches] = useState<PracticeBranch[]>([]);
  const [fillLocations, setFillLocations] = useState<InventoryBranchLocation[]>([]);
  const [fillBranchId, setFillBranchId] = useState<number | ''>(open.fillBranchId ?? '');
  const [fillLocationId, setFillLocationId] = useState<number | ''>('');
  const [settingsFulfillment, setSettingsFulfillment] = useState<{
    branchId: number | null;
    locationId: number | null;
  }>({ branchId: null, locationId: null });
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
    setSameCheckConfirm(null);
    const next: Record<number, string> = {};
    for (const line of open.lines || []) next[line.id] = line.scriptText || '';
    setScriptsByLine(next);
  }, [open.id]);

  useEffect(() => {
    const next = stage === 'done' ? 'contacted' : stage;
    const nextRank = steps.indexOf(next);
    const currentRank = steps.indexOf(viewStep);
    if (nextRank < 0 || currentRank < 0 || nextRank <= currentRank) return;
    setViewStep(next);
    setSameCheckConfirm(null);
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
      const fromSettingsBranch = parseOnlineStoreFulfillmentBranchId(settings);
      const fromSettingsLoc = parseOnlineStoreFulfillmentLocationId(settings);
      setSettingsFulfillment({
        branchId: fromSettingsBranch,
        locationId: fromSettingsLoc,
      });
      if (open.fillBranchId) {
        setFillBranchId(open.fillBranchId);
        return;
      }
      const fallback =
        fromSettingsBranch ||
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
    if (fillBranchId === '') {
      setFillLocations([]);
      setFillLocationId('');
      return;
    }
    let cancelled = false;
    void listInventoryBranchLocations(practiceId, Number(fillBranchId)).then((locs) => {
      if (cancelled) return;
      const active = locs.filter((l) => l.isActive !== false);
      setFillLocations(active);
      const prefer =
        settingsFulfillment.branchId === Number(fillBranchId) &&
        settingsFulfillment.locationId != null &&
        active.some((l) => l.id === settingsFulfillment.locationId)
          ? settingsFulfillment.locationId
          : active.find((l) => l.isDefault)?.id ??
            active.find((l) => /mail\s*order/i.test(l.name))?.id ??
            active[0]?.id ??
            '';
      setFillLocationId(prefer || '');
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, fillBranchId, settingsFulfillment.branchId, settingsFulfillment.locationId]);

  useEffect(() => {
    const lots: Record<number, { lotId: number | null; lotNumber: string }> = {};
    for (const line of open.lines || []) {
      lots[line.id] = { lotId: null, lotNumber: '' };
    }
    setFillLots(lots);
  }, [fillBranchId, fillLocationId, open.id]);

  useEffect(() => {
    void fetchAllEmployees().then((rows) => {
      const active = rows.filter((row) => row.isActive !== false && !row.isDeleted);
      setStaff(active);
      const preferred =
        open.doctorEmployeeId ||
        active.find((row) => formatEmployeeDisplayName(row) === open.doctorName)?.id;
      if (!preferred) return;
      setAssigneeByLine((prev) => {
        const next = { ...prev };
        for (const line of open.lines || []) {
          if (!next[line.id]) next[line.id] = String(preferred);
        }
        return next;
      });
    });
  }, [open.id, open.doctorEmployeeId, open.doctorName, open.lines]);

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
      const lines = open.lines || [];
      if (lines.length) return linesAllApproved(lines);
      return !['needs_doctor_approval', 'approval_pending', 'send_back'].includes(
        open.approvalStatus || '',
      );
    }
    if (step === 'needs_payment') return (open.paymentStatus || 'awaiting_payment') === 'paid';
    if (step === 'fill') {
      const lines = open.lines || [];
      if (lines.some((line) => line.trackLots)) {
        return linesAllFilled(lines, open) && mailFillDone(open);
      }
      return mailFillDone(open);
    }
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
      {autoshipNote ? (
        <div className="settings-message" style={{ margin: '0 0 12px' }}>
          <span>{autoshipNote}</span>
          <button type="button" className="btn secondary" onClick={() => setAutoshipNote(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {open.sendWithoutPayment && !orderPaid ? (
        <p className="mail-queue__sent" role="status" style={{ marginBottom: 12 }}>
          Send without payment — pharmacy may proceed; not done until the owner pays.
        </p>
      ) : null}
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
                Use <strong>Split / approvals</strong> under the pet items to send each product to
                a different doctor, override with a reason, or split items onto a separate
                shipment. Doctors only decide the items on their own task.
              </p>
              {open.clientQuestionPendingAt ? (
                <p className="mail-queue__sent" role="status">
                  Pending client question — use Text / email client on the right.
                </p>
              ) : null}
            </>
          )}

          {viewStep === 'needs_payment' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                {open.sendWithoutPayment && !orderPaid
                  ? 'This order was sent without payment. Pharmacy work can finish, but the order is not done until the owner pays.'
                  : 'Email an invoice or text a pay link. You can edit the message before it goes out.'}
              </p>
              {open.sendWithoutPayment && !orderPaid ? (
                <p className="mail-queue__sent" role="status">
                  Send without payment — awaiting owner payment
                </p>
              ) : null}
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
                Mark this filled whenever the bag is ready, and choose the office and
                location you took stock from (defaults to the online-store fulfillment
                location). Ship and check stay locked until then.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  Filling from office
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
                        {settingsFulfillment.branchId === row.id
                          ? ' · mail fulfillment'
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  Location
                  <select
                    className="settings-input"
                    value={fillLocationId}
                    disabled={fillBranchId === ''}
                    onChange={(e) =>
                      setFillLocationId(e.target.value ? Number(e.target.value) : '')
                    }
                  >
                    <option value="">Choose location…</option>
                    {fillLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                        {loc.isDefault ? ' (default)' : ''}
                        {settingsFulfillment.locationId === loc.id
                          ? ' · mail order'
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(open.lines || []).some((line) => line.trackLots) ? (
                <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                  {(open.lines || [])
                    .filter((line) => line.trackLots)
                    .map((line) => {
                      const stockItemId =
                        line.stockInventoryItemId ?? line.inventoryItemId ?? null;
                      return (
                        <div key={`${line.id}:${fillBranchId}:${fillLocationId}`}>
                          {stockItemId != null ? (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'baseline',
                                gap: 8,
                                marginBottom: 4,
                              }}
                            >
                              <button
                                type="button"
                                style={{
                                  padding: 0,
                                  border: 'none',
                                  background: 'none',
                                  color: 'var(--primary, #1b5e20)',
                                  fontWeight: 600,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  textUnderlineOffset: 2,
                                  font: 'inherit',
                                }}
                                title="Open inventory item"
                                onClick={() =>
                                  setInventoryDetail({
                                    inventoryItemId: stockItemId,
                                    name: line.name,
                                    lineId: line.id,
                                  })
                                }
                              >
                                {line.name}
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{line.name}</div>
                          )}
                          <StockLotPicker
                            practiceId={practiceId}
                            inventoryItemId={stockItemId}
                            branchId={fillBranchId === '' ? null : Number(fillBranchId)}
                            locationId={
                              fillLocationId === '' ? null : Number(fillLocationId)
                            }
                            required
                            selectedLotId={fillLots[line.id]?.lotId ?? null}
                            lotNumber={fillLots[line.id]?.lotNumber ?? ''}
                            label="Lot / expiration"
                            refreshKey={lotRefreshByLine[line.id] ?? 0}
                            onChange={(pick) =>
                              setFillLots((prev) => ({
                                ...prev,
                                [line.id]: { lotId: pick.lotId, lotNumber: pick.lotNumber },
                              }))
                            }
                          />
                        </div>
                      );
                    })}
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
              {(() => {
                const missingLot = (open.lines || []).some(
                  (line) => line.trackLots && !fillLots[line.id]?.lotId,
                );
                const fillBlocked = !employeeId
                  ? 'Sign in as staff to mark filled.'
                  : !fillBranchId
                    ? 'Choose the office you filled from.'
                    : !fillLocationId
                      ? 'Choose the location you took stock from.'
                      : missingLot
                        ? 'Choose a lot for each item (or receive stock at this location first).'
                        : null;
                return (
                  <div className="mail-queue__actions">
                    {fillBlocked ? (
                      <p className="settings-muted" style={{ margin: '0 0 8px', color: '#b45309' }}>
                        {fillBlocked}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="btn primary"
                      disabled={Boolean(fillBlocked)}
                      title={fillBlocked ?? undefined}
                      onClick={() =>
                        void onRun(() =>
                          pharmacyMailAction(practiceId, open.id, {
                            action: 'fill',
                            checkNotes,
                            fillBranchId: Number(fillBranchId),
                            fillLocationId: Number(fillLocationId),
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
                );
              })()}
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

              <div className="mail-queue__section" style={{ marginTop: 4 }}>
                <p className="mail-queue__section-label">Check by patient</p>
                {groupedLines.map((group) => {
                  const done = linesAllChecked(group.lines, open);
                  const checker =
                    group.lines.find((line) => line.checkedByName)?.checkedByName ||
                    open.secondCheckerName ||
                    null;
                  const label = group.petName || 'Household';
                  const lineIds = group.lines.map((line) => line.id);
                  const patientId = group.petId;
                  return (
                    <div key={`check-${group.key}`} className="mail-queue__row" style={{ marginBottom: 8 }}>
                      <div style={{ flex: '1 1 160px', minWidth: 120 }}>
                        <strong style={{ fontSize: 13 }}>{label}</strong>
                        <div className="mail-queue__meta-line" style={{ marginTop: 2 }}>
                          {group.lines.map((line) => line.name).join(' · ')}
                        </div>
                        {done ? (
                          <div className="mail-queue__meta-line" style={{ marginTop: 2 }}>
                            ✓ Checked{checker ? ` by ${checker}` : ''}
                          </div>
                        ) : null}
                      </div>
                      {done ? (
                        <span className="mail-queue__badge is-go">✓ Checked</span>
                      ) : (
                        <button
                          type="button"
                          className="mail-queue__btn is-primary"
                          disabled={!employeeId || !mailFillDone(open)}
                          onClick={() => {
                            if (iFilled) {
                              setSameCheckConfirm({ patientId, lineIds, label });
                              return;
                            }
                            void onRun(async () => {
                              const order = await pharmacyMailAction(practiceId, open.id, {
                                action: 'check',
                                patientId: patientId ?? undefined,
                                lineIds: patientId == null ? lineIds : undefined,
                              });
                              if (mailCheckDone(order)) setViewStep('contacted');
                              return order;
                            });
                          }}
                        >
                          I checked {label}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {mailCheckDone(open) ? (
                <p className="settings-muted">
                  All patients checked. Use Contacted when you are ready to tell the client.
                </p>
              ) : sameCheckConfirm ? (
                <div className="mail-queue__same-check" role="status">
                  <p className="mail-queue__same-check-title">You filled this order</p>
                  <p>
                    A second person should check {sameCheckConfirm.label}. If no one else is
                    available, you can check it yourself — that is recorded on the order.
                  </p>
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="mail-queue__btn"
                      onClick={() => setSameCheckConfirm(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mail-queue__btn is-primary"
                      disabled={!employeeId || !mailFillDone(open)}
                      onClick={() =>
                        void onRun(async () => {
                          const order = await pharmacyMailAction(practiceId, open.id, {
                            action: 'check_override',
                            notes: `Checked by the person who filled this order (${sameCheckConfirm.label}).`,
                            patientId: sameCheckConfirm.patientId ?? undefined,
                            lineIds:
                              sameCheckConfirm.patientId == null
                                ? sameCheckConfirm.lineIds
                                : undefined,
                          });
                          setSameCheckConfirm(null);
                          if (mailCheckDone(order)) setViewStep('contacted');
                          return order;
                        })
                      }
                    >
                      Check {sameCheckConfirm.label}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mail-queue__actions">
                  <button
                    type="button"
                    className="mail-queue__btn"
                    onClick={() => printCheckSlip(open)}
                  >
                    Print check slip
                  </button>
                  {(open.lines || []).some((line) => !lineIsChecked(line, open)) &&
                  (open.lines || []).filter((line) => !lineIsChecked(line, open)).length > 1 ? (
                    <button
                      type="button"
                      className="mail-queue__btn"
                      disabled={!employeeId || !mailFillDone(open)}
                      onClick={() => {
                        if (iFilled) {
                          setSameCheckConfirm({
                            patientId: null,
                            lineIds: (open.lines || [])
                              .filter((line) => !lineIsChecked(line, open))
                              .map((line) => line.id),
                            label: 'all remaining',
                          });
                          return;
                        }
                        void onRun(() =>
                          pharmacyMailAction(practiceId, open.id, { action: 'check' }),
                        ).then((ok) => {
                          if (ok) setViewStep('contacted');
                        });
                      }}
                    >
                      Check all remaining
                    </button>
                  ) : null}
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

        <div
          className="mail-queue__side-card"
          style={{ margin: '0 0 12px', padding: 12 }}
        >
          <h3 style={{ marginTop: 0 }}>Split / approvals</h3>
          <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Check items to move onto a separate shipment, or send each item to a different doctor.
          </p>
          <label className="settings-label">
            Shared task note
            <input
              className="settings-input"
              value={taskNote}
              onChange={(e) => setTaskNote(e.target.value)}
              placeholder="Optional note on the doctor task"
            />
          </label>
          <div className="mail-queue__actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="mail-queue__btn is-primary"
              disabled={
                splitIds.length < 1 || splitIds.length >= (open.lines || []).length
              }
              onClick={() =>
                void onRun(async () => {
                  const result = await splitMailOrder(practiceId, open.id, splitIds);
                  setSplitIds([]);
                  onOrderUpdated(result.original);
                  onOrderUpdated(result.split);
                  return result.original;
                })
              }
            >
              Split selected
              {splitIds.length ? ` (${splitIds.length})` : ''}
            </button>
          </div>
        </div>

        {groupedLines.map((group) => {
          const weightLabel = formatPatientWeight(
            group.lines[0]?.weightLbs,
            group.lines[0]?.weightDate,
          );
          const petApproved = linesAllApproved(group.lines);
          const petFilled = linesAllFilled(group.lines, open);
          const petChecked = linesAllChecked(group.lines, open);
          return (
          <div key={group.key}>
            {group.petName ? (
              <div className="mail-queue__pet-block">
                <p className="mail-queue__pet">
                  {group.petId ? (
                    <Link
                      className="mail-queue__pet-link"
                      to={`/schedule/patients?patientId=${encodeURIComponent(String(group.petId))}`}
                      onClick={() => onRememberScroll()}
                    >
                      {group.petName}
                    </Link>
                  ) : (
                    group.petName
                  )}
                  {weightLabel ? <span className="mail-queue__weight"> · {weightLabel}</span> : null}
                </p>
                <div className="mail-queue__pet-steps" aria-label={`${group.petName} progress`}>
                  <span className={`mail-queue__badge ${petApproved ? 'is-go' : 'is-wait'}`}>
                    {petApproved ? '✓ Approved' : 'Approved'}
                  </span>
                  <span className={`mail-queue__badge ${petFilled ? 'is-go' : ''}`}>
                    {petFilled ? '✓ Fill' : 'Fill'}
                  </span>
                  <span className={`mail-queue__badge ${petChecked ? 'is-go' : ''}`}>
                    {petChecked ? '✓ Check' : 'Check'}
                  </span>
                </div>
              </div>
            ) : null}
            {group.lines.map((line) => {
              const lineBadge =
                line.lineStatus === 'ok_to_mail'
                  ? { label: 'Ready', className: 'is-go' }
                  : line.lineStatus === 'awaiting_doctor_approval'
                    ? { label: 'Awaiting doctor', className: 'is-wait' }
                    : line.lineStatus === 'rejected'
                      ? { label: 'Rejected', className: 'is-stop' }
                      : line.lineStatus === 'send_back'
                        ? { label: 'Send back', className: 'is-warn' }
                        : null;
              const currentScript = scriptsByLine[line.id] ?? line.scriptText ?? '';
              const scriptDirty = currentScript.trim() !== (line.scriptText || '').trim();
              return (
              <div key={line.id} className="mail-queue__line">
                <div className="mail-queue__line-head">
                  <h4>
                    {line.name} × {Number(line.quantity)}
                  </h4>
                  {lineBadge ? (
                    <span className={`mail-queue__badge ${lineBadge.className}`}>
                      {lineBadge.label}
                    </span>
                  ) : null}
                </div>
                <label className="mail-queue__check">
                  <input
                    type="checkbox"
                    checked={splitIds.includes(line.id)}
                    onChange={(e) =>
                      setSplitIds((prev) =>
                        e.target.checked
                          ? [...prev, line.id]
                          : prev.filter((id) => id !== line.id),
                      )
                    }
                  />
                  Split to new shipment
                </label>

                <div className="mail-queue__section">
                  <p className="mail-queue__section-label">Approval</p>
                  {lineIsApproved(line) ? (
                    <div className="mail-queue__row">
                      <span className="mail-queue__badge is-go">✓ Approved</span>
                      {line.approvalTaskId ? (
                        <Link
                          className="mail-queue__btn"
                          to={`/schedule/tasks?taskId=${encodeURIComponent(String(line.approvalTaskId))}`}
                        >
                          Open task
                        </Link>
                      ) : null}
                      <label className="settings-label">
                        Doctor
                        <select
                          className="settings-input"
                          value={assigneeByLine[line.id] || ''}
                          onChange={(e) =>
                            setAssigneeByLine((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Choose staff</option>
                          {staff.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {formatEmployeeDisplayName(emp) || emp.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="mail-queue__btn"
                        disabled={!assigneeByLine[line.id]}
                        onClick={() =>
                          void onRun(() =>
                            sendMailApprovalTask(practiceId, open.id, {
                              assignedToEmployeeId: Number(assigneeByLine[line.id]),
                              notes: taskNote.trim() || undefined,
                              lineIds: [line.id],
                            }).then((order) => {
                              onOrderUpdated(order);
                              setViewStep('needs_approval');
                              return order;
                            }),
                          )
                        }
                      >
                        Re-send approval
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="mail-queue__row">
                        <label className="settings-label">
                          Doctor
                          <select
                            className="settings-input"
                            value={assigneeByLine[line.id] || ''}
                            onChange={(e) =>
                              setAssigneeByLine((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Choose staff</option>
                            {staff.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {formatEmployeeDisplayName(emp) || emp.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="mail-queue__btn is-primary"
                          disabled={!assigneeByLine[line.id]}
                          onClick={() =>
                            void onRun(() =>
                              sendMailApprovalTask(practiceId, open.id, {
                                assignedToEmployeeId: Number(assigneeByLine[line.id]),
                                notes: taskNote.trim() || undefined,
                                lineIds: [line.id],
                              }).then((order) => {
                                onOrderUpdated(order);
                                setViewStep('needs_approval');
                                return order;
                              }),
                            )
                          }
                        >
                          Send to doctor
                        </button>
                        {line.approvalTaskId ? (
                          <Link
                            className="mail-queue__btn"
                            to={`/schedule/tasks?taskId=${encodeURIComponent(String(line.approvalTaskId))}`}
                          >
                            Open task
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="mail-queue__btn"
                          onClick={() =>
                            void (async () => {
                              const reason = await appPrompt({
                                title: 'No approval needed',
                                message:
                                  'Why can this fill proceed without a doctor task? (chart, refills on file, etc.)',
                                placeholder: 'e.g. Refills on file · chart OK',
                                confirmLabel: 'Confirm',
                                cancelLabel: 'Cancel',
                              });
                              if (!reason?.trim()) return;
                              await onRun(() =>
                                overrideMailLineApproval(
                                  practiceId,
                                  open.id,
                                  line.id,
                                  reason.trim(),
                                ).then((order) => {
                                  onOrderUpdated(order);
                                  return order;
                                }),
                              );
                            })()
                          }
                        >
                          No approval needed…
                        </button>
                      </div>
                      {lineNeedsApproval(line) && line.lineStatus === 'send_back' ? (
                        <p className="mail-queue__meta-line">Doctor sent this back for changes.</p>
                      ) : null}
                      {line.lineStatus === 'rejected' ? (
                        <p className="mail-queue__meta-line">This line was rejected.</p>
                      ) : null}
                    </>
                  )}
                </div>

                <p className="mail-queue__meta-line">
                  {line.autoshipFrequency
                    ? `Auto-ship ${formatAutoshipFrequency(line.autoshipFrequency)}${
                        line.renewalDate ? ` · next ${line.renewalDate}` : ''
                      }${line.subscriptionPaused ? ' · paused' : ''}`
                    : 'One-time fill'}
                  {' · '}
                  {line.primaryProviderName || open.doctorName || 'No primary provider'}
                  {line.autoshipFrequency ? (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="mail-queue__pet-link"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          font: 'inherit',
                        }}
                        onClick={() => setEditAutoshipLine(line)}
                      >
                        Edit
                      </button>
                    </>
                  ) : null}
                  {line.authorizedRefills != null ? (
                    <>
                      {' · '}
                      <span className="mail-queue__refills" style={{ display: 'inline' }}>
                        Add {line.authorizedRefills} refill
                        {line.authorizedRefills === 1 ? '' : 's'}
                        {line.authorizedRefillExpiration
                          ? ` · expire ${line.authorizedRefillExpiration}`
                          : ''}
                      </span>
                    </>
                  ) : null}
                  {' · '}
                  {line.refillsRemaining != null
                    ? `${line.refillsRemaining} remaining on prior Rx`
                    : line.refillNote || 'Prior refill count not on file'}
                  {line.refillExpiresAt
                    ? ` · expires ${new Date(line.refillExpiresAt).toLocaleDateString()}`
                    : ''}
                </p>

                <div className="mail-queue__section">
                  <div className="mail-queue__row" style={{ alignItems: 'flex-start' }}>
                    <label className="settings-label mail-queue__grow" style={{ flex: '1 1 100%' }}>
                      Directions
                      <textarea
                        className="settings-input mail-queue__script"
                        rows={2}
                        value={currentScript}
                        onChange={(e) =>
                          setScriptsByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="mail-queue__btn"
                      disabled={savingScriptId === line.id || !scriptDirty}
                      onClick={() =>
                        void (async () => {
                          setSavingScriptId(line.id);
                          try {
                            await onRun(() =>
                              pharmacyMailAction(practiceId, open.id, {
                                action: 'update_script',
                                lineId: line.id,
                                scriptText: currentScript.trim(),
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
                    <MailOrderFillLabels
                      className="mail-queue__btn"
                      order={open}
                      line={{
                        ...line,
                        scriptText: currentScript,
                      }}
                      checkNotes={checkNotes}
                    />
                  </div>
                </div>
              </div>
              );
            })}
          </div>
          );
        })}
      </div>

      <div className="mail-queue__side">
        <MailOrderClientCommsPanel
          practiceId={practiceId}
          order={open}
          rxLinePhone={rxLinePhone}
          onOrderUpdated={onOrderUpdated}
        />
        <div className="mail-queue__side-card">
          <h3>Ship to</h3>
          {Number(open.otherBalanceDue) > 0.009 ? (
            <p className="mail-queue__owed-detail" role="status">
              Account balance due {money(open.otherBalanceDue)} (outside this mail order)
            </p>
          ) : null}
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
              {orderPaid
                ? 'Refunds the Stripe charge, cancels linked auto-ship, and can email or text the client.'
                : 'Cancels the order and linked auto-ship. No refund is needed until they pay. You can email or text the client.'}
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
                {orderPaid ? 'Reject + refund + email' : 'Reject + email'}
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
                {orderPaid ? 'Reject + refund + text' : 'Reject + text'}
              </button>
            </div>
          </div>
        )}
      </div>
      {inventoryDetail ? (
        <InventoryItemDetailModal
          practiceId={practiceId}
          inventoryItemId={inventoryDetail.inventoryItemId}
          title={inventoryDetail.name}
          onClose={() => {
            const lineId = inventoryDetail.lineId;
            setInventoryDetail(null);
            setLotRefreshByLine((prev) => ({
              ...prev,
              [lineId]: (prev[lineId] ?? 0) + 1,
            }));
            setFillLots((prev) => ({
              ...prev,
              [lineId]: { lotId: null, lotNumber: '' },
            }));
          }}
        />
      ) : null}
      {editAutoshipLine ? (
        <EditAutoshipModal
          open
          practiceId={practiceId}
          line={editAutoshipLine}
          patientName={editAutoshipLine.patientName || open.patientName}
          customerName={open.customerName}
          customerEmail={open.customerEmail}
          preferredAssigneeId={open.doctorEmployeeId}
          staff={staff}
          onClose={() => setEditAutoshipLine(null)}
          onSaved={(message) => {
            setEditAutoshipLine(null);
            setAutoshipNote(message || 'Auto-ship updated.');
            void onRun(async () => {
              const rows = await listMailOrders(practiceId);
              const next = rows.find((row) => row.id === open.id);
              if (!next) throw new Error('Order not found after auto-ship update.');
              return next;
            });
          }}
        />
      ) : null}
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
