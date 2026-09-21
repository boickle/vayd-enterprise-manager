import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  Printer,
  Syringe,
} from 'lucide-react';
import {
  getOrderClinicalDetails,
  getPrescriptionDefaults,
  getVaccineDefaults,
  saveOrderPrescription,
  saveOrderVaccination,
  updateOrder,
  type EncounterOrder,
  type OrderPrescription,
  type OrderVaccination,
  type PrescriptionAcuity,
  type PrescriptionDefaults,
  type StockDraw,
} from '../../api/visitWorkflow';
import {
  fetchCatalogPricingForOrder,
  getCatalogLinePrice,
  type CatalogPricingItem,
} from '../../utils/catalogItemPricing';
import VaccineLotPicker from './VaccineLotPicker';
import RxLabelModal, { type RxLabelPrescriptionInput } from './RxLabelModal';
import DirectionsLimitHint, { directionsMaxLength } from './DirectionsLimitHint';
import { BookPatientChartButton } from '../BookPatientChartButton';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import {
  clampRefillExpiration,
  maxRefillExpirationInput,
  refillExpirationExceedsMax,
} from '../../utils/printRxLabel';
import type { InventoryLotBalance } from '../../api/branchInventory';

type Props = {
  encounterId: string;
  /** Every order on the encounter, including Room Loader lines that charge straight to Checkout. */
  orders: EncounterOrder[];
  disabled?: boolean;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  /** Visit primary provider — used to default lot picker to their branch. */
  providerId?: number | null;
  patientName: string;
  patientSpecies?: string | null;
  ownerName?: string | null;
  providerName?: string | null;
  providerLicense?: string | null;
  /** Qty changes reprice the charge — bubble the updated order up so Checkout stays in sync. */
  onOrderUpdated: (order: EncounterOrder) => void;
  onInvoiceShouldRefresh: () => void;
  /** Fired after a prescription is saved so the chronic-meds pin can refresh. */
  onChronicMedicationsMaybeChanged?: () => void;
  /** Fired after any vaccine or prescription is recorded so checkout Approve can refresh. */
  onClinicalRecorded?: () => void;
  /** When set, only these order ids are listed (for per-line expand in checkout). */
  onlyOrderIds?: ReadonlySet<string> | string[];
  /** Hide the section chrome — used when embedded under an invoice line. */
  embedded?: boolean;
  /** Force a single row open (embedded expand). */
  forceOpenOrderId?: string | null;
  /** Lot chosen on the linked inventory invoice row (not the billed service). */
  invoiceLots?: Record<string, { lotId: number | null; lotNumber: string | null }>;
  inventoryBranchId?: number | null;
  inventoryLocationId?: number | null;
};

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

/** `input[type=date]` wants yyyy-MM-dd, and only the date half of an ISO timestamp. */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function addMonths(dateInput: string, months: number): string {
  const [y, m, d] = dateInput.split('-').map(Number);
  if (!y || !m || !d) return '';
  const shifted = new Date(Date.UTC(y, m - 1 + months, d));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function addDays(dateInput: string, days: number): string {
  const [y, m, d] = dateInput.split('-').map(Number);
  if (!y || !m || !d) return '';
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

/** Turn a catalog refill-validity period into a concrete date off the chosen start date. */
function applyExpiration(start: string, period: PrescriptionDefaults['refillExpiration']): string {
  if (!period) return '';
  return period.unit === 'months' ? addMonths(start, period.amount) : addDays(start, period.amount);
}

/**
 * The doses given and prescriptions written on this visit.
 *
 * Lives inside Checkout (alongside the invoice lines) so the tech flow matches counter
 * checkout: clinical details and the bill stay together. Vaccines often arrive from the
 * Room Loader estimate and charge straight to Checkout without ever appearing in the Plan
 * list — so recording them here (not only under Plan search) is required.
 *
 * Saving writes a real `vaccination_logs` / `prescriptions` row, which is what puts the dose on
 * the patient chart, on the vaccination certificate, and in the reminder queue.
 */
export default function VisitDoseAndRxSection({
  encounterId,
  orders,
  disabled,
  patientId,
  clientId,
  practiceId,
  providerId,
  patientName,
  patientSpecies,
  ownerName,
  providerName,
  providerLicense,
  onOrderUpdated,
  onInvoiceShouldRefresh,
  onChronicMedicationsMaybeChanged,
  onClinicalRecorded,
  onlyOrderIds,
  embedded,
  forceOpenOrderId,
  invoiceLots,
  inventoryBranchId,
  inventoryLocationId,
}: Props) {
  const [vaccineOrderIds, setVaccineOrderIds] = useState<ReadonlySet<string>>(new Set());
  const [vaccinations, setVaccinations] = useState<Record<string, OrderVaccination>>({});
  const [prescriptions, setPrescriptions] = useState<Record<string, OrderPrescription>>({});
  const [stockDraws, setStockDraws] = useState<Record<string, StockDraw>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** One Room Loader pricing snapshot per order — qty changes reuse it for tier math. */
  const [pricingByOrderId, setPricingByOrderId] = useState<Record<string, CatalogPricingItem>>({});

  const accepted = useMemo(() => orders.filter((o) => o.state === 'accepted'), [orders]);

  const refresh = useCallback(async () => {
    const details = await getOrderClinicalDetails(encounterId);
    setVaccineOrderIds(new Set(details.vaccineOrderIds));
    setVaccinations(
      Object.fromEntries(
        details.vaccinations
          .filter((v) => v.encounterOrderId)
          .map((v) => [v.encounterOrderId as string, v])
      )
    );
    setPrescriptions(
      Object.fromEntries(
        details.prescriptions
          .filter((p) => p.encounterOrderId)
          .map((p) => [p.encounterOrderId as string, p])
      )
    );
    setStockDraws(Object.fromEntries(details.stockDraws.map((d) => [d.orderId, d])));
    setLoaded(true);
  }, [encounterId]);

  // Re-read whenever the set of accepted orders changes, since accepting a Room Loader vaccine
  // is what adds it to this list.
  const acceptedKey = accepted.map((o) => o.id).join(',');
  useEffect(() => {
    void refresh();
  }, [refresh, acceptedKey]);

  /**
   * Same qty → tier path as PlanOrdersSection: one check-item-pricing fetch, then local
   * `getCatalogLinePrice` on every step so Bravecto 2/3/4-dose rebates apply.
   */
  const repriceQty = useCallback(
    async (order: EncounterOrder, qty: number) => {
      const q = Math.max(1, Math.round(qty));
      if (q === Number(order.qty)) return;

      let snapshot: CatalogPricingItem | null = pricingByOrderId[order.id] ?? null;
      if (!snapshot && patientId != null && order.catalogItemId != null) {
        snapshot = await fetchCatalogPricingForOrder({
          order,
          patientId,
          practiceId,
          clientId,
        });
        if (snapshot) {
          const cached = snapshot;
          setPricingByOrderId((prev) => ({ ...prev, [order.id]: cached }));
        }
      }

      if (snapshot) {
        const { unitFinal, isCovered } = getCatalogLinePrice(snapshot, q);
        const updated = await updateOrder(encounterId, order.id, {
          qty: q,
          unitPrice: unitFinal,
          isCovered,
        });
        onOrderUpdated(updated);
      } else {
        const updated = await updateOrder(encounterId, order.id, { qty: q });
        onOrderUpdated(updated);
      }
      onInvoiceShouldRefresh();
    },
    [
      pricingByOrderId,
      patientId,
      practiceId,
      clientId,
      encounterId,
      onOrderUpdated,
      onInvoiceShouldRefresh,
    ]
  );

  const onlySet =
    onlyOrderIds == null
      ? null
      : onlyOrderIds instanceof Set
        ? onlyOrderIds
        : new Set(onlyOrderIds);
  const vaccineOrders = accepted
    .filter((o) => vaccineOrderIds.has(o.id))
    .filter((o) => (onlySet ? onlySet.has(o.id) : true));
  const medOrders = accepted
    .filter((o) => o.kind === 'med')
    .filter((o) => (onlySet ? onlySet.has(o.id) : true));

  if (!loaded || (vaccineOrders.length === 0 && medOrders.length === 0)) return null;

  const missing =
    vaccineOrders.filter((o) => !vaccinations[o.id]).length +
    medOrders.filter((o) => !prescriptions[o.id]?.acuity).length;

  return (
    <div className={`soap-dose-rx${embedded ? ' soap-dose-rx--embedded' : ''}`}>
      {!embedded ? (
        <div className="soap-dose-rx-head">
          <span className="soap-dose-rx-title">
            <Syringe size={14} /> Doses given &amp; prescriptions
          </span>
          {missing > 0 ? (
            <span className="soap-dose-rx-missing">
              <AlertCircle size={12} /> {missing} still to record
            </span>
          ) : (
            <span className="soap-dose-rx-done">
              <Check size={12} /> All recorded
            </span>
          )}
        </div>
      ) : null}

      {vaccineOrders.map((order) => (
        <VaccineRow
          key={order.id}
          encounterId={encounterId}
          order={order}
          recorded={vaccinations[order.id] ?? null}
          stockDraw={stockDraws[order.id] ?? null}
          invoiceLot={invoiceLots?.[order.id]}
          practiceId={practiceId}
          providerId={providerId}
          branchId={inventoryBranchId}
          locationId={inventoryLocationId}
          disabled={disabled}
          embedded={Boolean(embedded)}
          open={forceOpenOrderId != null ? forceOpenOrderId === order.id : expanded === order.id}
          onToggle={() =>
            forceOpenOrderId != null
              ? undefined
              : setExpanded(expanded === order.id ? null : order.id)
          }
          onQtyChange={repriceQty}
          onSaved={(saved) => {
            setVaccinations((prev) => ({ ...prev, [order.id]: saved }));
            if (forceOpenOrderId == null) setExpanded(null);
            onClinicalRecorded?.();
          }}
        />
      ))}

      {medOrders.map((order) => (
        <PrescriptionRow
          key={order.id}
          encounterId={encounterId}
          order={order}
          recorded={prescriptions[order.id] ?? null}
          stockDraw={stockDraws[order.id] ?? null}
          disabled={disabled}
          embedded={Boolean(embedded)}
          patientId={patientId}
          practiceId={practiceId}
          patientName={patientName}
          patientSpecies={patientSpecies}
          ownerName={ownerName}
          providerName={providerName}
          providerLicense={providerLicense}
          providerId={providerId}
          open={forceOpenOrderId != null ? forceOpenOrderId === order.id : expanded === order.id}
          onToggle={() =>
            forceOpenOrderId != null
              ? undefined
              : setExpanded(expanded === order.id ? null : order.id)
          }
          onQtyChange={repriceQty}
          onSaved={(saved) => {
            setPrescriptions((prev) => ({ ...prev, [order.id]: saved }));
            if (forceOpenOrderId == null) setExpanded(null);
            onChronicMedicationsMaybeChanged?.();
            onClinicalRecorded?.();
          }}
        />
      ))}
    </div>
  );
}

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** Qty stepper with tier-aware unit price — same math as Plan and Room Loader. */
function QtyField({
  order,
  disabled,
  onQtyChange,
}: {
  order: EncounterOrder;
  disabled?: boolean;
  onQtyChange: (order: EncounterOrder, qty: number) => Promise<void>;
}) {
  const qty = Number(order.qty) || 1;
  const [busy, setBusy] = useState(false);
  const setQty = (next: number) => {
    const q = Math.max(1, Math.round(next));
    if (q === qty || busy) return;
    setBusy(true);
    void onQtyChange(order, q).finally(() => setBusy(false));
  };
  return (
    <label className="soap-dose-qty">
      Quantity
      <span className="soap-qty-stepper">
        <button
          type="button"
          className="soap-icon-btn"
          title="Decrease"
          disabled={disabled || busy || qty <= 1}
          onClick={() => setQty(qty - 1)}
        >
          <Minus size={13} />
        </button>
        <input
          className="soap-qty-input"
          type="number"
          min={1}
          value={qty}
          disabled={disabled || busy}
          onChange={(e) => setQty(Number(e.target.value))}
        />
        <button
          type="button"
          className="soap-icon-btn"
          title="Increase"
          disabled={disabled || busy}
          onClick={() => setQty(qty + 1)}
        >
          <Plus size={13} />
        </button>
      </span>
      {!order.isCovered && (
        <span className="soap-dose-qty-price">{money(qty * Number(order.unitPrice))}</span>
      )}
    </label>
  );
}

function RowHeader({
  order,
  summary,
  complete,
  open,
  onToggle,
}: {
  order: EncounterOrder;
  summary: string;
  complete: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="soap-dose-row-head" onClick={onToggle}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <span className="soap-dose-row-name">
        {order.name}
        {complete ? <Check className="soap-dose-row-check" size={14} aria-label="All set" /> : null}
      </span>
      <span className={`soap-dose-row-status ${complete ? 'ok' : 'pending'}`}>{summary}</span>
    </button>
  );
}

function DymoLink({
  label,
  disabled = true,
  title,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="soap-dose-dymo"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <Printer size={12} /> {label}
    </button>
  );
}

function StockDrawBanner({ stockDraw }: { stockDraw: StockDraw }) {
  const where = [stockDraw.branchName, stockDraw.locationName].filter(Boolean).join(' / ');
  return (
    <p className="soap-dose-stock">
      At checkout, will decrement <strong>{stockDraw.quantity}</strong> ×{' '}
      <strong>{stockDraw.inventoryItemName}</strong>
      {stockDraw.inventoryItemCode ? ` (${stockDraw.inventoryItemCode})` : ''}
      {where ? (
        <>
          {' '}
          from <strong>{where}</strong>
        </>
      ) : (
        <> from the provider&apos;s assigned branch/location</>
      )}
      .
    </p>
  );
}

function VaccineRow({
  encounterId,
  order,
  recorded,
  stockDraw,
  invoiceLot,
  practiceId,
  providerId,
  branchId,
  locationId,
  disabled,
  embedded,
  open,
  onToggle,
  onQtyChange,
  onSaved,
}: {
  encounterId: string;
  order: EncounterOrder;
  recorded: OrderVaccination | null;
  stockDraw: StockDraw | null;
  invoiceLot?: { lotId: number | null; lotNumber: string | null };
  practiceId: number;
  providerId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
  disabled?: boolean;
  embedded?: boolean;
  open: boolean;
  onToggle: () => void;
  onQtyChange: (order: EncounterOrder, qty: number) => Promise<void>;
  onSaved: (saved: OrderVaccination) => void;
}) {
  const [lotNumber, setLotNumber] = useState('');
  const [lotBalanceId, setLotBalanceId] = useState<number | null>(null);
  const [lotQoh, setLotQoh] = useState<number | null>(null);
  const [zeroOverrideReason, setZeroOverrideReason] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [vaccineExpiration, setVaccineExpiration] = useState('');
  const [dateVaccinated, setDateVaccinated] = useState(today());
  const [nextDue, setNextDue] = useState('');
  const [tagNumber, setTagNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [vaccineType, setVaccineType] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const isRabies = /rabies/i.test(order.name);
  const lotInventoryItemId = stockDraw?.inventoryItemId ?? order.catalogItemId ?? null;
  const lotsOnLinkedStock =
    stockDraw != null &&
    order.catalogItemId != null &&
    Number(stockDraw.inventoryItemId) !== Number(order.catalogItemId);

  useEffect(() => {
    if (recorded) {
      setLotNumber(recorded.lotNumber ?? '');
      setLotBalanceId(recorded.inventoryLotBalanceId ?? null);
      setSerialNumber(recorded.serialNumber ?? '');
      setVaccineExpiration(toDateInput(recorded.vaccineExpiration));
      setDateVaccinated(toDateInput(recorded.dateVaccinated) || today());
      setNextDue(toDateInput(recorded.nextVaccinationDate));
      const tag = (recorded.tagNumber ?? '').trim();
      setTagNumber(!tag || tag === '0' ? '' : tag);
      setManufacturer(recorded.manufacturer ?? '');
      setVaccineType(recorded.vaccineType ?? '');
      setPrefilled(true);
      return;
    }
    if (invoiceLot?.lotId != null || invoiceLot?.lotNumber) {
      setLotBalanceId(invoiceLot.lotId ?? null);
      setLotNumber(invoiceLot.lotNumber ?? '');
    }
  }, [recorded, invoiceLot?.lotId, invoiceLot?.lotNumber]);

  // eVet pre-fills next-due from the vaccine's licensing period. Scout doesn't import that yet,
  // so the interval comes from the last time this practice gave the same vaccine.
  useEffect(() => {
    if (!open || prefilled || recorded || order.catalogItemId == null) return;
    let canceled = false;
    void getVaccineDefaults(encounterId, order.id, order.catalogItemId)
      .then((defaults) => {
        if (canceled) return;
        if (defaults.nextDueMonths) {
          setNextDue(addMonths(today(), defaults.nextDueMonths));
        }
        if (defaults.manufacturer) setManufacturer(defaults.manufacturer);
        if (defaults.vaccineType) setVaccineType(defaults.vaccineType);
        if (defaults.serialNumber) setSerialNumber(defaults.serialNumber);
        setPrefilled(true);
      })
      .catch(() => {
        if (!canceled) setPrefilled(true);
      });
    return () => {
      canceled = true;
    };
  }, [open, prefilled, recorded, encounterId, order.id, order.catalogItemId]);

  function applyLot(lot: InventoryLotBalance | null) {
    if (!lot) {
      setLotBalanceId(null);
      setLotNumber('');
      setLotQoh(null);
      setVaccineExpiration('');
      setZeroOverrideReason('');
      return;
    }
    setLotBalanceId(lot.id);
    setLotNumber(lot.lotNumber);
    setLotQoh(Number(lot.quantityOnHand) || 0);
    if (lot.serialNumber) setSerialNumber(lot.serialNumber);
    if (lot.expirationDate) setVaccineExpiration(lot.expirationDate.slice(0, 10));
    if (Number(lot.quantityOnHand) > 0) setZeroOverrideReason('');
  }

  const save = async () => {
    if (!nextDue) {
      setError('Next due date is required so the patient gets a reminder.');
      return;
    }
    if (isRabies) {
      const tag = tagNumber.trim();
      if (!tag || tag === '0') {
        setError('Rabies tag is required.');
        return;
      }
    }
    if (lotInventoryItemId != null && lotBalanceId == null) {
      setError('Select a vaccine lot from inventory.');
      return;
    }
    if (lotQoh != null && lotQoh <= 0 && !zeroOverrideReason.trim()) {
      setError('This lot shows zero on hand. Enter a reason to use it anyway.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveOrderVaccination(encounterId, order.id, {
        vaccineName: order.name,
        dateVaccinated,
        nextVaccinationDate: nextDue,
        lotNumber: lotNumber.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        vaccineExpiration: vaccineExpiration || undefined,
        tagNumber: tagNumber.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        vaccineType: vaccineType || undefined,
        inventoryLotBalanceId: lotBalanceId,
        ...(lotQoh != null && lotQoh <= 0
          ? { lotZeroOverrideReason: zeroOverrideReason.trim() }
          : {}),
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this dose.');
    } finally {
      setSaving(false);
    }
  };

  const summary = recorded
    ? `Lot ${recorded.lotNumber || '—'} · next due ${toDateInput(recorded.nextVaccinationDate) || '—'}`
    : 'Needs lot & expiration';

  return (
    <div className={`soap-dose-row ${recorded ? 'recorded' : ''}${embedded ? ' soap-dose-row--embedded' : ''}`}>
      {!embedded ? (
        <RowHeader
          order={order}
          summary={summary}
          complete={Boolean(recorded)}
          open={open}
          onToggle={onToggle}
        />
      ) : null}
      {open && (
        <div className="soap-dose-body">
          {stockDraw && !lotsOnLinkedStock ? <StockDrawBanner stockDraw={stockDraw} /> : null}
          <div className="soap-dose-grid">
            {!embedded ? (
              <QtyField order={order} disabled={disabled} onQtyChange={onQtyChange} />
            ) : null}
            {!lotsOnLinkedStock && lotInventoryItemId != null ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <VaccineLotPicker
                  practiceId={practiceId}
                  inventoryItemId={lotInventoryItemId}
                  itemName={order.name}
                  providerId={providerId}
                  branchId={branchId}
                  locationId={locationId}
                  disabled={disabled || saving}
                  selectedLotId={lotBalanceId}
                  onSelectLot={applyLot}
                  zeroOverrideReason={zeroOverrideReason}
                  onZeroOverrideReasonChange={setZeroOverrideReason}
                />
              </div>
            ) : !lotsOnLinkedStock ? (
              <p className="soap-dose-stock" style={{ gridColumn: '1 / -1' }}>
                No linked inventory item — lot details are not available on this order.
              </p>
            ) : null}
            {!lotsOnLinkedStock ? (
              <>
            <div className="soap-dose-readonly">
              <span className="soap-dose-readonly-label">Lot number</span>
              <span className="soap-dose-readonly-value">{lotNumber || '—'}</span>
            </div>
            <div className="soap-dose-readonly">
              <span className="soap-dose-readonly-label">Drug expiration</span>
              <span className="soap-dose-readonly-value">
                {vaccineExpiration || '—'}
              </span>
            </div>
            <div className="soap-dose-readonly">
              <span className="soap-dose-readonly-label">Manufacturer</span>
              <span className="soap-dose-readonly-value">{manufacturer || '—'}</span>
            </div>
            <label>
              Serial number
              <input
                className="soap-input"
                value={serialNumber}
                disabled={disabled || saving}
                onChange={(e) => setSerialNumber(e.target.value)}
              />
            </label>
              </>
            ) : null}
            <label>
              Date given
              <input
                className="soap-input"
                type="date"
                value={dateVaccinated}
                disabled={disabled || saving}
                onChange={(e) => setDateVaccinated(e.target.value)}
              />
            </label>
            <label>
              Next due
              <input
                className="soap-input"
                type="date"
                value={nextDue}
                disabled={disabled || saving}
                onChange={(e) => setNextDue(e.target.value)}
              />
            </label>
            {isRabies && (
              <label>
                Rabies tag *
                <input
                  className="soap-input"
                  value={tagNumber}
                  disabled={disabled || saving}
                  onChange={(e) => setTagNumber(e.target.value)}
                />
              </label>
            )}
            <div className="soap-dose-readonly">
              <span className="soap-dose-readonly-label">Vaccine type</span>
              <span className="soap-dose-readonly-value">{vaccineType || '—'}</span>
            </div>
          </div>

          {error && <p className="soap-dose-error">{error}</p>}

          <div className="soap-dose-actions">
            <button
              type="button"
              className="soap-btn small primary"
              disabled={disabled || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : recorded ? 'Update dose' : 'Record dose'}
            </button>
            <DymoLink label="Send treatment label to DYMO" />
          </div>
        </div>
      )}
    </div>
  );
}

function PrescriptionRow({
  encounterId,
  order,
  recorded,
  stockDraw,
  disabled,
  embedded,
  patientId,
  practiceId,
  patientName,
  patientSpecies,
  ownerName,
  providerName,
  providerLicense,
  providerId,
  open,
  onToggle,
  onQtyChange,
  onSaved,
}: {
  encounterId: string;
  order: EncounterOrder;
  recorded: OrderPrescription | null;
  stockDraw: StockDraw | null;
  disabled?: boolean;
  embedded?: boolean;
  patientId?: number;
  practiceId: number;
  patientName: string;
  patientSpecies?: string | null;
  ownerName?: string | null;
  providerName?: string | null;
  providerLicense?: string | null;
  providerId?: number | null;
  open: boolean;
  onToggle: () => void;
  onQtyChange: (order: EncounterOrder, qty: number) => Promise<void>;
  onSaved: (saved: OrderPrescription) => void;
}) {
  const [name, setName] = useState(order.name);
  const [refill, setRefill] = useState('0');
  const [refillExpiration, setRefillExpiration] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [acuity, setAcuity] = useState<PrescriptionAcuity | ''>('');
  const [instructions, setInstructions] = useState('');
  const [strength, setStrength] = useState<string | null>(null);
  const [sigSource, setSigSource] = useState<PrescriptionDefaults['source']>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    if (!recorded) return;
    setName(recorded.name ?? order.name);
    setRefill(String(recorded.refill ?? 0));
    setRefillExpiration(toDateInput(recorded.refillExpiration));
    setStartDate(toDateInput(recorded.startDate) || today());
    setAcuity(recorded.acuity ?? '');
    setInstructions(recorded.instructions ?? '');
    if (recorded.strength) setStrength(recorded.strength);
    setPrefilled(true);
  }, [recorded, order.name]);

  /**
   * Open the form on the sig the patient is already on, falling back to the practice's default
   * prescription text for the item. Only ever seeds a blank form, so it cannot overwrite typing.
   */
  useEffect(() => {
    if (!open || prefilled || recorded || order.catalogItemId == null) return;
    let canceled = false;
    void getPrescriptionDefaults(encounterId, order.id, order.catalogItemId)
      .then((defaults) => {
        if (canceled) return;
        if (defaults.instructions) setInstructions(defaults.instructions);
        if (defaults.strength) setStrength(defaults.strength);
        if (defaults.refill != null) setRefill(String(defaults.refill));
        const expiry = defaults.refillExpirationDate
          ? toDateInput(defaults.refillExpirationDate)
          : applyExpiration(startDate || today(), defaults.refillExpiration);
        if (expiry) setRefillExpiration(clampRefillExpiration(expiry));
        setSigSource(defaults.source);
        setPrefilled(true);
      })
      .catch(() => {
        if (!canceled) setPrefilled(true);
      });
    return () => {
      canceled = true;
    };
    // `startDate` is read for the expiry offset but must not retrigger the fetch — the doctor
    // changing it should not pull the default sig back over their edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefilled, recorded, encounterId, order.id, order.catalogItemId]);

  const save = async (
    labelValues?: RxLabelPrescriptionInput
  ): Promise<OrderPrescription | null> => {
    if (!acuity) {
      setError('Choose acute or chronic for this prescription.');
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveOrderPrescription(encounterId, order.id, {
        name: labelValues?.name.trim() || name.trim() || order.name,
        // Not collected on the form any more — it comes off the catalog drug record, and the
        // label needs it stored on the prescription.
        strength: labelValues?.strength.trim() || recorded?.strength || strength || undefined,
        instructions: labelValues?.instructions.trim() || instructions.trim() || undefined,
        refill: labelValues?.refill ?? (Number(refill) || 0),
        refillExpiration: labelValues?.refillExpiration || refillExpiration || undefined,
        startDate: labelValues?.startDate || startDate || undefined,
        acuity: labelValues?.acuity === 'acute' || labelValues?.acuity === 'chronic' ? labelValues.acuity : acuity,
      });
      if (labelValues) {
        setName(labelValues.name);
        setStrength(labelValues.strength);
        setInstructions(labelValues.instructions);
        setRefill(String(labelValues.refill));
        setRefillExpiration(labelValues.refillExpiration);
        setStartDate(labelValues.startDate);
        if (labelValues.acuity === 'acute' || labelValues.acuity === 'chronic') {
          setAcuity(labelValues.acuity);
        }
      }
      onSaved(saved);
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this prescription.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const summary = recorded
    ? `${recorded.acuity === 'chronic' ? 'Chronic' : recorded.acuity === 'acute' ? 'Acute' : 'Unclassified'} · ${recorded.refill ?? 0} refills${
        recorded.instructions ? ' · sig on file' : ''
      }`
    : 'Needs acute/chronic + sig';

  return (
    <div className={`soap-dose-row ${recorded?.acuity ? 'recorded' : ''}${embedded ? ' soap-dose-row--embedded' : ''}`}>
      {!embedded ? (
        <RowHeader
          order={order}
          summary={summary}
          complete={Boolean(recorded?.acuity)}
          open={open}
          onToggle={onToggle}
        />
      ) : null}
      {open && (
        <div className="soap-dose-body">
          {stockDraw && <StockDrawBanner stockDraw={stockDraw} />}
          {(strength || sigSource) && (
            <p className="soap-dose-stock">
              {strength ? `Strength ${strength}` : ''}
              {strength && sigSource ? ' · ' : ''}
              {sigSource === 'patient-history'
                ? 'Sig carried over from this patient’s last fill'
                : sigSource === 'catalog'
                  ? 'Sig from the item’s default prescription text'
                  : ''}
            </p>
          )}
          <div className="soap-dose-grid">
            {!embedded ? (
              <QtyField order={order} disabled={disabled} onQtyChange={onQtyChange} />
            ) : null}
            <label>
              Name
              <input
                className="soap-input"
                value={name}
                disabled={disabled || saving}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              <span className="soap-rx-label-field-head">
                Refills
                {patientId != null ? (
                  <BookPatientChartButton
                    patientId={String(patientId)}
                    patientName={patientName}
                    practiceId={practiceId}
                    practiceTz={PRACTICE_TZ}
                    showAlerts
                    label="View details"
                    className="soap-rx-label-details-link"
                    onApplyRefillExpiration={(dateInput) => {
                      if (refillExpirationExceedsMax(dateInput)) {
                        setError('Refill expiration cannot be more than 1 year from today.');
                        setRefillExpiration(maxRefillExpirationInput());
                        return;
                      }
                      setError(null);
                      setRefillExpiration(dateInput);
                    }}
                  />
                ) : null}
              </span>
              <input
                className="soap-input"
                type="number"
                min={0}
                value={refill}
                disabled={disabled || saving}
                onChange={(e) => setRefill(e.target.value)}
              />
            </label>
            <label className="soap-dose-date-field">
              <span className="soap-dose-date-label">
                <span>Refill expiration</span>
                <div
                  className="soap-dose-date-chips"
                  role="group"
                  aria-label="Set refill expiration from start date"
                >
                  {([3, 6, 12] as const).map((months) => {
                    const value = addMonths(startDate || today(), months);
                    const active = Boolean(value) && refillExpiration === value;
                    return (
                      <button
                        key={months}
                        type="button"
                        className={`soap-dose-date-chip${active ? ' is-active' : ''}`}
                        disabled={disabled || saving || !value}
                        onClick={() => setRefillExpiration(clampRefillExpiration(value))}
                      >
                        +{months}m
                      </button>
                    );
                  })}
                </div>
              </span>
              <input
                className="soap-input"
                type="date"
                max={maxRefillExpirationInput()}
                value={refillExpiration}
                disabled={disabled || saving}
                onChange={(e) => {
                  const next = e.target.value;
                  if (refillExpirationExceedsMax(next)) {
                    setError('Refill expiration cannot be more than 1 year from today.');
                    setRefillExpiration(maxRefillExpirationInput());
                    return;
                  }
                  setError(null);
                  setRefillExpiration(next);
                }}
              />
            </label>
            <label>
              Start date
              <input
                className="soap-input"
                type="date"
                value={startDate}
                disabled={disabled || saving}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              Acute or chronic
              <select
                className="soap-input soap-select"
                value={acuity}
                disabled={disabled || saving}
                aria-label="Acute or chronic prescription"
                title="Chronic meds are what a future client portal refill flow will offer"
                onChange={(e) => setAcuity(e.target.value as PrescriptionAcuity | '')}
              >
                <option value="">Select…</option>
                <option value="acute">Acute</option>
                <option value="chronic">Chronic</option>
              </select>
            </label>
          </div>

          <label className="soap-dose-sig">
            <span className="soap-rx-label-field-head">
              Instructions (sig)
              <DirectionsLimitHint value={instructions} />
            </span>
            <textarea
              className="soap-input"
              rows={4}
              maxLength={directionsMaxLength()}
              value={instructions}
              disabled={disabled || saving}
              placeholder="No default sig set up for this item — type the directions."
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>

          {error && <p className="soap-dose-error">{error}</p>}

          <div className="soap-dose-actions">
            <button
              type="button"
              className="soap-btn small primary"
              disabled={disabled || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : recorded ? 'Update Rx' : 'Save Rx'}
            </button>
            <DymoLink
              label="Send Rx label to DYMO"
              disabled={disabled || saving}
              title="Review and print a prescription label"
              onClick={() => {
                setError(null);
                setShowLabel(true);
              }}
            />
          </div>
        </div>
      )}
      {showLabel && (
        <RxLabelModal
          patientId={patientId}
          patientName={patientName}
          species={patientSpecies ?? ''}
          ownerName={ownerName ?? ''}
          veterinarianName={providerName ?? ''}
          veterinarianLicense={providerLicense ?? ''}
          providerEmployeeId={providerId}
          quantity={Number(order.qty) || 1}
          prescription={{
            name,
            strength: recorded?.strength ?? strength ?? '',
            instructions,
            refill: Number(refill) || 0,
            refillExpiration,
            startDate,
            rxNumber: recorded?.rxNumber,
            acuity,
          }}
          onSavePrescription={async (value) => {
            const saved = await save(value);
            if (!saved) throw new Error('Could not save the prescription before printing.');
            if (saved.rxNumber != null) return { rxNumber: saved.rxNumber };
            const rxNumber = await ensurePrintRxNumber({
              existingNumber: saved.rxNumber,
              patientId,
              name: value.name,
              inventoryItemId: order.catalogItemId,
              instructions: value.instructions,
              refill: value.refill,
              startDate: value.startDate,
              refillExpiration: value.refillExpiration,
              acuity: value.acuity,
            });
            return { rxNumber };
          }}
          onClose={() => setShowLabel(false)}
        />
      )}
    </div>
  );
}
