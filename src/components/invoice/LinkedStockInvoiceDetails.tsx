import VaccineLotPicker from '../soap/VaccineLotPicker';
import type { InventoryLotBalance } from '../../api/branchInventory';
import type { StockDraw, VisitInvoiceLine } from '../../api/visitWorkflow';
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
}: Props) {
  const stock = linkedStockFromLine(line, stockDraw);
  if (!stock.linked || stock.stockId == null) return null;
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
      <VaccineLotPicker
        practiceId={practiceId}
        inventoryItemId={stock.stockId}
        itemName={stock.stockName}
        providerId={providerId}
        branchId={branchId}
        locationId={locationId}
        disabled={disabled}
        selectedLotId={line.inventoryLotBalanceId ?? null}
        onSelectLot={onSelectLot}
      />
    </div>
  );
}
