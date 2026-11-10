import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../api/http';
import { getWasteAdmin, recordWaste } from '../../api/inventoryOps';
import WasteDetailFields, {
  useWitnessOptions,
  type WasteMethodOption,
} from '../inventory/WasteDetailFields';
import { useCan } from '../../permissions/PermissionContext';
import { getInvoice, type VisitInvoice, type VisitInvoiceLine } from '../../api/visitWorkflow';
import { lotShelf } from '../../utils/lotShelf';
import './ControlledDoseFields.css';

/** Matches the API's waste reason for a controlled dose drawn up and not given. */
const CONTROLLED_DOSE_WASTE_REASON = 'drawn_not_given';

type Props = {
  invoice: VisitInvoice;
  line: VisitInvoiceLine;
  practiceId: number;
  disabled?: boolean;
  onInvoiceChange: (invoice: VisitInvoice) => void;
};

function num(value: string): number | null {
  const n = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(n) ? n : null;
}

const ml = (n: number) => `${Math.round(n * 100) / 100} mL`;

/**
 * A controlled drug used in hospital, on the SOAP checkout and the client ledger alike. The
 * line's quantity is the mL given; mL drawn up and not given goes to the controlled log under
 * this charge and stays shown on the line. Counted in mL only — no bottle weights at launch
 * (owner decision, Oct 30, 2026).
 */
export default function ControlledDoseFields({
  invoice,
  line,
  practiceId,
  disabled,
  onInvoiceChange,
}: Props) {
  const [wasted, setWasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [methods, setMethods] = useState<WasteMethodOption[]>([]);
  const [disposalCode, setDisposalCode] = useState('');
  const [witnessId, setWitnessId] = useState<number | null>(null);
  // Used only to leave the signed-in person out of the Witness list; the API enforces it too.
  let employeeId: string | null | undefined = null;
  try {
    employeeId = (useAuth() as { employeeId?: string | null }).employeeId;
  } catch {
    employeeId = null;
  }
  const witnessOptions = useWitnessOptions();

  // Controlled waste always needs a disposal method (CAT-12). Reverse distribution is for
  // expired drugs only, so it is not offered for a dose drawn up and not given.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => getWasteAdmin(practiceId))
      .then((admin) => {
        if (!cancelled)
          setMethods(
            admin.methods
              .filter((m) => m.isActive && m.code !== 'reverse_distribution')
              .map((m) => ({ code: m.code, label: m.label }))
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  const canWaste = useCan('inventory.waste');
  const editable = invoice.status === 'open' && !disabled;
  const wastedSoFar = Number(line.controlledWastedMl) || 0;

  const wastedMl = num(wasted);
  const lotMissing =
    line.trackLots === true && line.inventoryLotBalanceId == null && !line.lotNumber;
  // The waste comes off the shelf the dose came from: the doctor's safe for a controlled drug,
  // not the bill's car (B1, Nov 9, 2026).
  const shelf = lotShelf(line, invoice);
  const shelfMissing = shelf.branchId == null || shelf.locationId == null;
  const wasteBlocked = lotMissing
    ? 'Pick the lot first'
    : shelfMissing
      ? 'Choose the branch and location first'
      : line.catalogItemId == null
        ? 'This line has no catalog item'
        : !disposalCode
          ? 'Choose a disposal method'
          : null;

  const saveWaste = async () => {
    if (wastedMl == null || wastedMl <= 0 || wasteBlocked) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const invoiceRef = invoice.scoutInvoiceNumber
        ? `invoice #${invoice.scoutInvoiceNumber}`
        : 'this visit';
      await recordWaste(practiceId, {
        branchId: shelf.branchId as number,
        fromBranchLocationId: shelf.locationId as number,
        inventoryItemId: line.catalogItemId as number,
        quantity: wastedMl,
        reasonCode: CONTROLLED_DOSE_WASTE_REASON,
        notes: `Drawn up for ${invoiceRef}, not given`,
        inventoryLotBalanceId: line.inventoryLotBalanceId ?? null,
        lotNumber: line.lotNumber ?? null,
        invoiceLineId: line.id,
        disposalMethodCode: disposalCode,
        ...(witnessId != null ? { witnessEmployeeId: witnessId } : {}),
      });
      setWasted('');
      setWitnessId(null);
      setNote(`Recorded ${ml(wastedMl)} wasted in the controlled drug log.`);
      // Re-read the bill so the line's wasted total includes this one.
      onInvoiceChange(await getInvoice(invoice.id));
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not record the waste.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="controlled-dose">
      <p className="controlled-dose__title">
        Controlled drug, used in hospital. Given: {ml(Number(line.qty) || 0)}
        {wastedSoFar > 0 ? ` · Wasted: ${ml(wastedSoFar)}` : ''}
      </p>
      {editable && canWaste ? (
        <div className="controlled-dose__row">
          <label>
            {wastedSoFar > 0 ? 'More wasted (mL)' : 'Wasted (mL)'}
            <input
              className="soap-input"
              inputMode="decimal"
              value={wasted}
              onChange={(e) => setWasted(e.target.value)}
              aria-label={`${line.description} mL wasted`}
            />
          </label>
          <button
            type="button"
            className="soap-btn ghost"
            disabled={wastedMl == null || wastedMl <= 0 || busy || Boolean(wasteBlocked)}
            title={wasteBlocked ?? ''}
            onClick={() => void saveWaste()}
          >
            {busy ? 'Recording…' : 'Record waste'}
          </button>
          {wasteBlocked ? <span className="controlled-dose__hint">{wasteBlocked}</span> : null}
        </div>
      ) : null}
      {editable && canWaste ? (
        <WasteDetailFields
          isControlled
          hideNotes
          methods={methods}
          disposalCode={disposalCode}
          onDisposalChange={setDisposalCode}
          witnessOptions={witnessOptions}
          witnessEmployeeId={witnessId}
          onWitnessChange={setWitnessId}
          currentEmployeeId={employeeId != null ? Number(employeeId) : null}
        />
      ) : null}
      {note ? <p className="controlled-dose__ok">{note}</p> : null}
      {error ? <div className="soap-error">{error}</div> : null}
    </div>
  );
}
