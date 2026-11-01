import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { InvoiceLineLot, VisitInvoiceLine } from '../../api/visitWorkflow';
import { checkLotSplit, lotSplitSummary, type LotSplitRow } from '../../utils/lotSplit';
import StockLotPicker from './StockLotPicker';

type Props = {
  practiceId: number;
  inventoryItemId: number | null;
  branchId?: number | null;
  locationId?: number | null;
  otherShelvesFrom?: string | null;
  itemName?: string | null;
  disabled?: boolean;
  /** Quantity on the invoice line. */
  lineQty: number;
  /** The line's saved lots when it uses several (or part of its quantity); empty for one lot. */
  lots?: InvoiceLineLot[] | null;
  /** The single lot on the line today. */
  singleLotId: number | null;
  singleLotNumber?: string | null;
  /** Controlled drug / lot # required / vaccine: the lots must add up to the whole quantity. */
  mustCoverAll?: boolean;
  /** Vaccine: one lot only, so there is no "add another lot". */
  singleOnly?: boolean;
  /** The existing single-lot picker, shown unchanged until staff add a second lot. */
  renderSingle: () => ReactNode;
  /** Save the lots on the line. Return false when the save failed so the rows stay open. */
  onSaveLots: (lots: InvoiceLineLot[]) => Promise<boolean | void> | boolean | void;
};

/** The line facts the editor needs, so each screen only adds its own lot shelf and save call. */
export function lotEditorProps(
  line: Pick<
    VisitInvoiceLine,
    'qty' | 'lots' | 'inventoryLotBalanceId' | 'lotNumber' | 'lotsMustCoverAll' | 'lotsSingleOnly'
  >
) {
  return {
    lineQty: Number(line.qty) || 0,
    lots: line.lots ?? null,
    singleLotId: line.inventoryLotBalanceId ?? null,
    singleLotNumber: line.lotNumber ?? null,
    mustCoverAll: line.lotsMustCoverAll === true,
    singleOnly: line.lotsSingleOnly === true,
  };
}

function rowsFromLots(lots: InvoiceLineLot[]): LotSplitRow[] {
  return lots.map((l) => ({
    lotId: l.inventoryLotBalanceId ?? null,
    lotNumber: l.lotNumber ?? '',
    quantity: String(l.quantity),
  }));
}

/**
 * One invoice line can draw from several lots (12 from bottle A and 8 from bottle B for one
 * dispense of 20); the price stays one line. With one lot this is just the usual lot picker plus
 * an "Add another lot" link. Adding a lot turns it into rows of [lot, quantity] with a running
 * total, and Save is blocked until the total is right.
 */
export default function MultiLotEditor({
  practiceId,
  inventoryItemId,
  branchId,
  locationId,
  otherShelvesFrom,
  itemName,
  disabled,
  lineQty,
  lots,
  singleLotId,
  singleLotNumber,
  mustCoverAll = false,
  singleOnly = false,
  renderSingle,
  onSaveLots,
}: Props) {
  const stored = useMemo(() => lots ?? [], [lots]);
  const storedKey = JSON.stringify(stored);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<LotSplitRow[]>(() => rowsFromLots(stored));
  const [saving, setSaving] = useState(false);
  const [showProblem, setShowProblem] = useState(false);

  // A saved multi-lot line loads back into rows.
  useEffect(() => {
    if (stored.length > 0) {
      setRows(rowsFromLots(stored));
      setShowProblem(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  if (singleOnly) return <>{renderSingle()}</>;

  const multi = stored.length > 0 || editing;
  if (!multi) {
    return (
      <>
        {renderSingle()}
        {!disabled ? (
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: 6, fontSize: 12, padding: '2px 8px' }}
            onClick={() => {
              setRows([
                {
                  lotId: singleLotId,
                  lotNumber: singleLotNumber ?? '',
                  quantity: singleLotId != null || singleLotNumber ? String(lineQty) : '',
                },
                { lotId: null, lotNumber: '', quantity: '' },
              ]);
              setShowProblem(false);
              setEditing(true);
            }}
          >
            + Add another lot
          </button>
        ) : null}
      </>
    );
  }

  const check = checkLotSplit(rows, lineQty, { mustCoverAll });
  const setRow = (i: number, patch: Partial<LotSplitRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save(next: LotSplitRow[]) {
    setSaving(true);
    try {
      const ok = await onSaveLots(
        next.map((r) => ({
          inventoryLotBalanceId: r.lotId,
          lotNumber: r.lotNumber || null,
          quantity: Number(r.quantity),
        }))
      );
      if (ok !== false) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="multi-lot" data-testid="multi-lot-editor">
      {rows.map((row, i) => (
        <div
          key={i}
          className="multi-lot__row"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px auto',
            gap: 8,
            alignItems: 'end',
            marginBottom: 6,
          }}
        >
          <StockLotPicker
            forUse
            required={false}
            allowAddLot={false}
            label={`Lot ${i + 1}`}
            practiceId={practiceId}
            inventoryItemId={inventoryItemId}
            branchId={branchId}
            locationId={locationId}
            otherShelvesFrom={otherShelvesFrom}
            itemName={itemName}
            disabled={disabled || saving}
            selectedLotId={row.lotId}
            lotNumber={row.lotNumber}
            onChange={(pick) => setRow(i, { lotId: pick.lotId, lotNumber: pick.lotNumber })}
          />
          <label className="settings-label" style={{ marginBottom: 0 }}>
            Quantity
            <input
              className="settings-input"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              aria-label={`Quantity from lot ${i + 1}`}
              value={row.quantity}
              disabled={disabled || saving}
              onChange={(e) => setRow(i, { quantity: e.target.value })}
            />
          </label>
          {rows.length > 1 ? (
            <button
              type="button"
              className="btn secondary"
              aria-label={`Remove lot ${i + 1}`}
              disabled={disabled || saving}
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <p
        role="status"
        data-testid="multi-lot-total"
        style={{ margin: '4px 0', fontWeight: 600, color: check.ok ? '#0f766e' : '#b45309' }}
      >
        {lotSplitSummary(rows, lineQty)}
      </p>
      {showProblem && check.message ? (
        <p role="alert" style={{ color: '#b45309', margin: '4px 0' }}>
          {check.message}
        </p>
      ) : null}
      {!disabled ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn secondary"
            disabled={saving}
            onClick={() =>
              setRows((prev) => [...prev, { lotId: null, lotNumber: '', quantity: '' }])
            }
          >
            + Add another lot
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => {
              if (!check.ok) {
                setShowProblem(true);
                return;
              }
              void save(rows);
            }}
          >
            {saving ? 'Saving…' : 'Save lots'}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={saving}
            onClick={() => {
              const first = rows[0];
              if (stored.length > 0 && first && (first.lotId != null || first.lotNumber)) {
                void save([{ ...first, quantity: String(lineQty) }]);
              } else {
                setEditing(false);
              }
            }}
          >
            Use one lot
          </button>
        </div>
      ) : null}
    </div>
  );
}
