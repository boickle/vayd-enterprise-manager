import { useEffect, useState } from 'react';
import {
  getOrderClinicalDetails,
  getVaccineDefaults,
  saveOrderVaccination,
  VISIT_WORKFLOW_PRACTICE_ID,
  type OrderVaccination,
  type StockDraw,
  type VisitInvoiceLine,
} from '../../api/visitWorkflow';
import type { InventoryLotBalance } from '../../api/branchInventory';
import VaccineLotPicker from '../soap/VaccineLotPicker';
import './InvoiceVaccineDoseEditor.css';

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

type Props = {
  line: VisitInvoiceLine;
  disabled?: boolean;
  recorded: OrderVaccination | null;
  onSaved: (saved: OrderVaccination) => void;
  onLotPicked?: (pick: { lotId: number | null; lotNumber: string | null }) => void;
  /** Lots belong on the linked inventory row, not this billed service. */
  hideLotPicker?: boolean;
  branchId?: number | null;
  locationId?: number | null;
};

/**
 * Ledger expand panel for vaccine invoice lines: pick lot + record/update dose
 * (same fields as SOAP checkout).
 */
export default function InvoiceVaccineDoseEditor({
  line,
  disabled,
  recorded,
  onSaved,
  onLotPicked,
  hideLotPicker,
  branchId,
  locationId,
}: Props) {
  const encounterId = line.encounterId ?? null;
  const orderId = line.orderId ?? null;
  const inventoryItemId = line.stockInventoryItemId ?? line.catalogItemId ?? null;
  const isRabies = /rabies/i.test(line.description || '');

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
    if (line.inventoryLotBalanceId != null || line.lotNumber) {
      setLotBalanceId(line.inventoryLotBalanceId ?? null);
      setLotNumber(line.lotNumber ?? '');
    }
  }, [recorded, line.inventoryLotBalanceId, line.lotNumber]);

  useEffect(() => {
    if (!encounterId || !orderId || prefilled || recorded || line.catalogItemId == null) return;
    let canceled = false;
    void getVaccineDefaults(encounterId, orderId, line.catalogItemId)
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
  }, [encounterId, orderId, prefilled, recorded, line.catalogItemId]);

  function applyLot(lot: InventoryLotBalance | null) {
    if (!lot) {
      setLotBalanceId(null);
      setLotNumber('');
      setLotQoh(null);
      setVaccineExpiration('');
      setZeroOverrideReason('');
      onLotPicked?.({ lotId: null, lotNumber: null });
      return;
    }
    setLotBalanceId(lot.id);
    setLotNumber(lot.lotNumber);
    setLotQoh(Number(lot.quantityOnHand) || 0);
    if (lot.serialNumber) setSerialNumber(lot.serialNumber);
    if (lot.expirationDate) setVaccineExpiration(lot.expirationDate.slice(0, 10));
    if (Number(lot.quantityOnHand) > 0) setZeroOverrideReason('');
    onLotPicked?.({ lotId: lot.id, lotNumber: lot.lotNumber || null });
  }

  const canSaveDose = Boolean(encounterId && orderId);
  const stockName = line.stockInventoryItemName?.trim();
  const stockIsLinked =
    Boolean(stockName) &&
    line.stockInventoryItemId != null &&
    line.catalogItemId != null &&
    Number(line.stockInventoryItemId) !== Number(line.catalogItemId);
  const stockBanner =
    stockIsLinked && !hideLotPicker ? (
      <p className="client-fin__vax-stock">
        At checkout, will decrement <strong>{Number(line.qty) || 1}</strong> ×{' '}
        <strong>{stockName}</strong>
        {line.stockInventoryItemCode ? ` (${line.stockInventoryItemCode})` : ''} from the
        provider&apos;s assigned branch/location. This charge stays{' '}
        <strong>{line.description}</strong> (the service). Lots and counts live on the inventory
        item, not this line.
      </p>
    ) : null;

  const lotPicker =
    !hideLotPicker && inventoryItemId != null ? (
    <VaccineLotPicker
      practiceId={VISIT_WORKFLOW_PRACTICE_ID}
      inventoryItemId={inventoryItemId}
      itemName={line.description}
      providerId={line.providerEmployeeId}
      branchId={branchId}
      locationId={locationId}
      disabled={disabled || saving}
      selectedLotId={lotBalanceId}
      onSelectLot={applyLot}
      zeroOverrideReason={zeroOverrideReason}
      onZeroOverrideReasonChange={setZeroOverrideReason}
    />
  ) : !hideLotPicker ? (
    <p className="client-fin__fulfill-note">
      No linked inventory item — lot details are not available on this charge.
    </p>
  ) : null;

  const save = async () => {
    if (!canSaveDose || !encounterId || !orderId) {
      setError('This vaccine is not linked to a visit order, so the dose cannot be saved here.');
      return;
    }
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
    if (inventoryItemId != null && lotBalanceId == null) {
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
      const saved = await saveOrderVaccination(encounterId, orderId, {
        vaccineName: line.description,
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

  if (!canSaveDose) {
    return (
      <div className="client-fin__vax-editor">
        {stockBanner}
        {lotPicker}
        <p className="client-fin__fulfill-note">
          This line is not linked to a SOAP order, so only the inventory lot can be set here.
        </p>
      </div>
    );
  }

  return (
    <div className="client-fin__vax-editor">
      {stockBanner}
      {lotPicker}
      <div className="client-fin__vax-grid">
        {!hideLotPicker ? (
          <>
        <div className="client-fin__vax-readonly">
          <span className="client-fin__vax-label">Lot number</span>
          <span>{lotNumber || '—'}</span>
        </div>
        <div className="client-fin__vax-readonly">
          <span className="client-fin__vax-label">Drug expiration</span>
          <span>{vaccineExpiration || '—'}</span>
        </div>
        <div className="client-fin__vax-readonly">
          <span className="client-fin__vax-label">Manufacturer</span>
          <span>{manufacturer || '—'}</span>
        </div>
        <label className="client-fin__rx-field">
          <span>Serial number</span>
          <input
            value={serialNumber}
            disabled={disabled || saving}
            onChange={(e) => setSerialNumber(e.target.value)}
          />
        </label>
          </>
        ) : null}
        <label className="client-fin__rx-field">
          <span>Date given</span>
          <input
            type="date"
            value={dateVaccinated}
            disabled={disabled || saving}
            onChange={(e) => setDateVaccinated(e.target.value)}
          />
        </label>
        <label className="client-fin__rx-field">
          <span>Next due *</span>
          <input
            type="date"
            value={nextDue}
            disabled={disabled || saving}
            onChange={(e) => setNextDue(e.target.value)}
          />
        </label>
        {isRabies ? (
          <label className="client-fin__rx-field">
            <span>Rabies tag *</span>
            <input
              value={tagNumber}
              disabled={disabled || saving}
              onChange={(e) => setTagNumber(e.target.value)}
            />
          </label>
        ) : null}
        <div className="client-fin__vax-readonly">
          <span className="client-fin__vax-label">Vaccine type</span>
          <span>{vaccineType || '—'}</span>
        </div>
      </div>
      {error ? <p className="client-fin__vax-error">{error}</p> : null}
      <div className="client-fin__vax-actions">
        <button
          type="button"
          className="client-fin__btn client-fin__btn-approve"
          disabled={disabled || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : recorded ? 'Update dose' : 'Record dose'}
        </button>
      </div>
    </div>
  );
}

/** Load vaccinations and stock draws for encounters on these invoice lines. */
export async function loadClinicalForInvoiceLines(
  lines: VisitInvoiceLine[]
): Promise<{
  vaccinations: Record<string, OrderVaccination>;
  stockDraws: Record<string, StockDraw>;
}> {
  const encounterIds = [
    ...new Set(lines.map((l) => l.encounterId).filter((id): id is string => Boolean(id))),
  ];
  const vaccinations: Record<string, OrderVaccination> = {};
  const stockDraws: Record<string, StockDraw> = {};
  if (!encounterIds.length) return { vaccinations, stockDraws };
  await Promise.all(
    encounterIds.map(async (encounterId) => {
      const details = await getOrderClinicalDetails(encounterId);
      for (const v of details.vaccinations) {
        if (v.encounterOrderId) vaccinations[v.encounterOrderId] = v;
      }
      for (const draw of details.stockDraws) {
        stockDraws[draw.orderId] = draw;
      }
    })
  );
  return { vaccinations, stockDraws };
}

/** Load vaccinations for every encounter represented on vaccine invoice lines. */
export async function loadVaccinationsForInvoiceLines(
  lines: VisitInvoiceLine[]
): Promise<Record<string, OrderVaccination>> {
  const { vaccinations } = await loadClinicalForInvoiceLines(lines);
  return vaccinations;
}
