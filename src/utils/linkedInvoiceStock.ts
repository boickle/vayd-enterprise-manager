import type { StockDraw, VisitInvoiceLine } from '../api/visitWorkflow';

export type LinkedInvoiceStock = {
  linked: boolean;
  stockId: number | null;
  stockName: string;
  stockCode: string | null;
  quantity: number;
};

/**
 * True when checkout decrements a different SKU than the billed service.
 * Prefer the SOAP stock-draw (always knows the inventory item) and fall back
 * to flags attached on the invoice line.
 */
export function linkedStockFromLine(
  line: VisitInvoiceLine,
  stockDraw?: StockDraw | null,
): LinkedInvoiceStock {
  const catalogId = line.catalogItemId != null ? Number(line.catalogItemId) : null;
  const stockIdFromDraw =
    stockDraw?.inventoryItemId != null ? Number(stockDraw.inventoryItemId) : null;
  const stockIdFromLine =
    line.stockInventoryItemId != null ? Number(line.stockInventoryItemId) : null;
  const stockId =
    stockIdFromDraw != null && Number.isFinite(stockIdFromDraw)
      ? stockIdFromDraw
      : stockIdFromLine != null && Number.isFinite(stockIdFromLine)
        ? stockIdFromLine
        : null;
  const linked =
    stockId != null &&
    (catalogId == null || !Number.isFinite(catalogId) || stockId !== catalogId);
  const qtyFromDraw = stockDraw != null ? Number(stockDraw.quantity) : NaN;
  return {
    linked,
    stockId: linked ? stockId : null,
    stockName:
      (stockDraw?.inventoryItemName || line.stockInventoryItemName || '').trim() ||
      'Linked inventory',
    stockCode: stockDraw?.inventoryItemCode?.trim() || line.stockInventoryItemCode?.trim() || null,
    quantity: Number.isFinite(qtyFromDraw) && qtyFromDraw > 0
      ? qtyFromDraw
      : Math.max(1, Number(line.qty) || 1),
  };
}
