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
  type VaccineDosageType,
} from '../../api/visitWorkflow';
import {
  fetchCatalogPricingForOrder,
  getCatalogLinePrice,
  type CatalogPricingItem,
} from '../../utils/catalogItemPricing';
import VaccineLotPicker from './VaccineLotPicker';
import RxLabelModal, { type RxLabelPrescriptionInput } from './RxLabelModal';
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
};

const VACCINE_TYPES = ['Killed', 'Modified Live', 'Recombinant'];

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

/** eVet stores dosage type numerically; 1 = booster, 2 = initial. */
function dosageTypeFromValue(value: number | null): VaccineDosageType | '' {
  if (value === 1) return 'booster';
  if (value === 2) return 'initial';
  return '';
}

/**
 * The doses given and prescriptions written on this visit.
 *
 * Kept as its own section rather than a row expander because vaccines usually arrive on the
 * Room Loader estimate, and those lines charge straight to Checkout without ever appearing in
 * the Plan list — so a per-row editor there would leave them with nowhere to record a lot
 * number. One list of everything that needs recording also doubles as the checklist.
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

  const vaccineOrders = accepted.filter((o) => vaccineOrderIds.has(o.id));
  const medOrders = accepted.filter((o) => o.kind === 'med');

  if (!loaded || (vaccineOrders.length === 0 && medOrders.length === 0)) return null;

  const missing =
    vaccineOrders.filter((o) => !vaccinations[o.id]).length +
    medOrders.filter((o) => !prescriptions[o.id]?.acuity).length;

  return (
    <div className="soap-dose-rx">
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

      {vaccineOrders.map((order) => (
        <VaccineRow
          key={order.id}
          encounterId={encounterId}
          order={order}
          recorded={vaccinations[order.id] ?? null}
          stockDraw={stockDraws[order.id] ?? null}
          practiceId={practiceId}
          providerId={providerId}
          disabled={disabled}
          open={expanded === order.id}
          onToggle={() => setExpanded(expanded === order.id ? null : order.id)}
          onQtyChange={repriceQty}
          onSaved={(saved) => {
            setVaccinations((prev) => ({ ...prev, [order.id]: saved }));
            setExpanded(null);
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
          patientName={patientName}
          patientSpecies={patientSpecies}
          ownerName={ownerName}
          providerName={providerName}
          providerLicense={providerLicense}
          open={expanded === order.id}
          onToggle={() => setExpanded(expanded === order.id ? null : order.id)}
          onQtyChange={repriceQty}
          onSaved={(saved) => {
            setPrescriptions((prev) => ({ ...prev, [order.id]: saved }));
            setExpanded(null);
            onChronicMedicationsMaybeChanged?.();
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
      <span className="soap-dose-row-name">{order.name}</span>
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
  practiceId,
  providerId,
  disabled,
  open,
  onToggle,
  onQtyChange,
  onSaved,
}: {
  encounterId: string;
  order: EncounterOrder;
  recorded: OrderVaccination | null;
  stockDraw: StockDraw | null;
  practiceId: number;
  providerId?: number | null;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  onQtyChange: (order: EncounterOrder, qty: number) => Promise<void>;
  onSaved: (saved: OrderVaccination) => void;
}) {
  const [lotNumber, setLotNumber] = useState('');
  const [lotBalanceId, setLotBalanceId] = useState<number | null>(null);
  const [serialNumber, setSerialNumber] = useState('');
  const [vaccineExpiration, setVaccineExpiration] = useState('');
  const [dateVaccinated, setDateVaccinated] = useState(today());
  const [nextDue, setNextDue] = useState('');
  const [tagNumber, setTagNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [vaccineType, setVaccineType] = useState('');
  const [dosageType, setDosageType] = useState<VaccineDosageType | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const isRabies = /rabies/i.test(order.name);
  const lotInventoryItemId = stockDraw?.inventoryItemId ?? order.catalogItemId ?? null;

  useEffect(() => {
    if (recorded) {
      setLotNumber(recorded.lotNumber ?? '');
      setLotBalanceId(recorded.inventoryLotBalanceId ?? null);
      setSerialNumber(recorded.serialNumber ?? '');
      setVaccineExpiration(toDateInput(recorded.vaccineExpiration));
      setDateVaccinated(toDateInput(recorded.dateVaccinated) || today());
      setNextDue(toDateInput(recorded.nextVaccinationDate));
      setTagNumber(recorded.tagNumber ?? '');
      setManufacturer(recorded.manufacturer ?? '');
      setVaccineType(recorded.vaccineType ?? '');
      setDosageType(dosageTypeFromValue(recorded.dosageType));
      setPrefilled(true);
    }
  }, [recorded]);

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
      return;
    }
    setLotBalanceId(lot.id);
    setLotNumber(lot.lotNumber);
    if (lot.serialNumber) setSerialNumber(lot.serialNumber);
    if (lot.expirationDate) setVaccineExpiration(lot.expirationDate.slice(0, 10));
  }

  const save = async () => {
    if (!nextDue) {
      setError('Next due date is required so the patient gets a reminder.');
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
        dosageType: dosageType || undefined,
        inventoryLotBalanceId: lotBalanceId,
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
    <div className={`soap-dose-row ${recorded ? 'recorded' : ''}`}>
      <RowHeader
        order={order}
        summary={summary}
        complete={Boolean(recorded)}
        open={open}
        onToggle={onToggle}
      />
      {open && (
        <div className="soap-dose-body">
          {stockDraw && <StockDrawBanner stockDraw={stockDraw} />}
          <div className="soap-dose-grid">
            <QtyField order={order} disabled={disabled} onQtyChange={onQtyChange} />
            {lotInventoryItemId != null ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <VaccineLotPicker
                  practiceId={practiceId}
                  inventoryItemId={lotInventoryItemId}
                  providerId={providerId}
                  disabled={disabled || saving}
                  selectedLotId={lotBalanceId}
                  lotNumber={lotNumber}
                  onSelectLot={applyLot}
                  onLotNumberChange={(v) => {
                    setLotBalanceId(null);
                    setLotNumber(v);
                  }}
                />
              </div>
            ) : (
              <label>
                Lot number
                <input
                  className="soap-input"
                  value={lotNumber}
                  disabled={disabled || saving}
                  onChange={(e) => setLotNumber(e.target.value)}
                />
              </label>
            )}
            <label>
              Serial number
              <input
                className="soap-input"
                value={serialNumber}
                disabled={disabled || saving}
                onChange={(e) => setSerialNumber(e.target.value)}
              />
            </label>
            <label>
              Drug expiration
              <input
                className="soap-input"
                type="date"
                value={vaccineExpiration}
                disabled={disabled || saving}
                onChange={(e) => setVaccineExpiration(e.target.value)}
              />
            </label>
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
                Rabies tag
                <input
                  className="soap-input"
                  value={tagNumber}
                  disabled={disabled || saving}
                  onChange={(e) => setTagNumber(e.target.value)}
                />
              </label>
            )}
            <label>
              Manufacturer
              <input
                className="soap-input"
                value={manufacturer}
                disabled={disabled || saving}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </label>
            <label>
              Vaccine type
              <select
                className="soap-input"
                value={vaccineType}
                disabled={disabled || saving}
                onChange={(e) => setVaccineType(e.target.value)}
              >
                <option value="">—</option>
                {VACCINE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dose
              <select
                className="soap-input"
                value={dosageType}
                disabled={disabled || saving}
                onChange={(e) => setDosageType(e.target.value as VaccineDosageType | '')}
              >
                <option value="">—</option>
                <option value="initial">Initial</option>
                <option value="booster">Booster</option>
              </select>
            </label>
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
  patientName,
  patientSpecies,
  ownerName,
  providerName,
  providerLicense,
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
  patientName: string;
  patientSpecies?: string | null;
  ownerName?: string | null;
  providerName?: string | null;
  providerLicense?: string | null;
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
        if (expiry) setRefillExpiration(expiry);
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
        acuity,
      });
      if (labelValues) {
        setName(labelValues.name);
        setStrength(labelValues.strength);
        setInstructions(labelValues.instructions);
        setRefill(String(labelValues.refill));
        setRefillExpiration(labelValues.refillExpiration);
        setStartDate(labelValues.startDate);
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
    <div className={`soap-dose-row ${recorded ? 'recorded' : ''}`}>
      <RowHeader
        order={order}
        summary={summary}
        complete={Boolean(recorded?.acuity)}
        open={open}
        onToggle={onToggle}
      />
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
            <QtyField order={order} disabled={disabled} onQtyChange={onQtyChange} />
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
              Refills
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
                        onClick={() => setRefillExpiration(value)}
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
                value={refillExpiration}
                disabled={disabled || saving}
                onChange={(e) => setRefillExpiration(e.target.value)}
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
            Instructions (sig)
            <textarea
              className="soap-input"
              rows={2}
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
                if (!acuity) {
                  setError('Choose acute or chronic before printing this prescription.');
                  return;
                }
                setError(null);
                setShowLabel(true);
              }}
            />
          </div>
        </div>
      )}
      {showLabel && (
        <RxLabelModal
          patientName={patientName}
          species={patientSpecies ?? ''}
          ownerName={ownerName ?? ''}
          veterinarianName={providerName ?? ''}
          veterinarianLicense={providerLicense ?? ''}
          quantity={Number(order.qty) || 1}
          prescription={{
            name,
            strength: recorded?.strength ?? strength ?? '',
            instructions,
            refill: Number(refill) || 0,
            refillExpiration,
            startDate,
            rxNumber: recorded?.rxNumber,
          }}
          onSavePrescription={async (value) => {
            const saved = await save(value);
            if (!saved) throw new Error('Could not save the prescription before printing.');
            return { rxNumber: saved.rxNumber };
          }}
          onClose={() => setShowLabel(false)}
        />
      )}
    </div>
  );
}
