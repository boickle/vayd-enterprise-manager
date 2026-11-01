import VaccineLotPicker from '../soap/VaccineLotPicker';
import MultiLotEditor, { lotEditorProps } from '../inventory/MultiLotEditor';
import type { InventoryLotBalance } from '../../api/branchInventory';
import type { InvoiceLineLot, StockDraw, VisitInvoiceLine } from '../../api/visitWorkflow';
import { linkedStockFromLine } from '../../utils/linkedInvoiceStock';
import './LinkedStockInvoiceDetails.css';

type Props = {
  line: VisitInvoiceLine;
  stockDraw?: StockDraw | null;
  practiceId: number;
  providerId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
  disabled?: boolean;
  onSelectLot: (lot: InventoryLotBalance | null) => void;
  /** Offer "Existing stock — shelf not counted yet" before the shelf's first count (not for vaccines). */
  offerUncountedShelf?: boolean;
  /** Several lots on one line (not for vaccines). Without this the lot picker is single-lot as before. */
  onSaveLots?: (lots: InvoiceLineLot[]) => Promise<boolean | void> | boolean | void;
};

/** Lot picker for the inventory SKU that actually decrements — not the billed service. */
export default function LinkedStockInvoiceDetails({
  line,
  stockDraw,
  practiceId,
  providerId,
  branchId,
  locationId,
  disabled,
  onSelectLot,
  offerUncountedShelf = false,
  onSaveLots,
}: Props) {
  const stock = linkedStockFromLine(line, stockDraw);
  if (!stock.linked || stock.stockId == null) return null;
  const stockId = stock.stockId;
  return (
    <div className="linked-stock-invoice">
      <div className="linked-stock-invoice__head">
        <strong>{stock.stockName}</strong>
        {stock.stockCode ? <span> · {stock.stockCode}</span> : null}
        <span className="linked-stock-invoice__note">
          {' '}
          · decremented at checkout · not a charge
        </span>
      </div>
      <MultiLotEditor
        practiceId={practiceId}
        inventoryItemId={stock.stockId}
        itemName={stock.stockName}
        branchId={branchId}
        locationId={locationId}
        disabled={disabled}
        {...lotEditorProps(line)}
        singleOnly={!onSaveLots || line.lotsSingleOnly === true}
        onSaveLots={(lots) => onSaveLots?.(lots)}
        renderSingle={() => (
          <VaccineLotPicker
            practiceId={practiceId}
            inventoryItemId={stockId}
            itemName={stock.stockName}
            providerId={providerId}
            branchId={branchId}
            locationId={locationId}
            disabled={disabled}
            selectedLotId={line.inventoryLotBalanceId ?? null}
            selectedLotNumber={line.lotNumber ?? null}
            onSelectLot={onSelectLot}
            offerUncountedShelf={offerUncountedShelf}
          />
        )}
      />
    </div>
  );
}
