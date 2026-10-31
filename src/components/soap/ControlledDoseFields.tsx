import { useState } from 'react';
import { apiErrorMessage } from '../../api/http';
import { recordWaste } from '../../api/inventoryOps';
import { useCan } from '../../permissions/PermissionContext';
import { getInvoice, type VisitInvoice, type VisitInvoiceLine } from '../../api/visitWorkflow';
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

  const canWaste = useCan('inventory.waste');
  const editable = invoice.status === 'open' && !disabled;
  const wastedSoFar = Number(line.controlledWastedMl) || 0;

  const wastedMl = num(wasted);
  const lotMissing =
    line.trackLots === true && line.inventoryLotBalanceId == null && !line.lotNumber;
  const shelfMissing = invoice.inventoryBranchId == null || invoice.inventoryLocationId == null;
  const wasteBlocked = lotMissing
    ? 'Pick the lot first'
    : shelfMissing
      ? 'Choose the branch and location first'
      : line.catalogItemId == null
        ? 'This line has no catalog item'
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
        branchId: invoice.inventoryBranchId as number,
        fromBranchLocationId: invoice.inventoryLocationId as number,
        inventoryItemId: line.catalogItemId as number,
        quantity: wastedMl,
        reasonCode: CONTROLLED_DOSE_WASTE_REASON,
        notes: `Drawn up for ${invoiceRef}, not given`,
        inventoryLotBalanceId: line.inventoryLotBalanceId ?? null,
        lotNumber: line.lotNumber ?? null,
        invoiceLineId: line.id,
      });
      setWasted('');
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
      {note ? <p className="controlled-dose__ok">{note}</p> : null}
      {error ? <div className="soap-error">{error}</div> : null}
    </div>
  );
}
