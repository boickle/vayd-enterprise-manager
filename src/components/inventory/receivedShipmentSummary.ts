import type { InventoryShipment } from '../../api/inventoryOps';

type Who = Pick<
  InventoryShipment,
  'receivedByName' | 'receivedByEmployeeId' | 'receivedByUserId' | 'finalizedAt'
>;
type Deleted = Pick<InventoryShipment, 'deletedByName' | 'deletedByUserId' | 'deletedAt'>;

/** "Received by Jane Tech" — whoever finalized, so every receive is traceable (owner decision D3). */
export function receivedByText(row: Who): string | null {
  if (row.receivedByName) return `Received by ${row.receivedByName}`;
  if (row.receivedByEmployeeId != null) return `Received by staff #${row.receivedByEmployeeId}`;
  if (row.receivedByUserId != null) return `Received by login #${row.receivedByUserId}`;
  return null;
}

/** Supplier · office · who received it · when. */
export function receivedShipmentSummary(
  row: Who,
  where: { supplier?: string | null; office?: string | null }
): string {
  const when = row.finalizedAt ? new Date(row.finalizedAt).toLocaleString() : null;
  return [where.supplier, where.office, receivedByText(row), when].filter(Boolean).join(' · ');
}

/** "Deleted by Jane Tech · 10/28/2026, 2:11 PM". */
export function deletedShipmentText(row: Deleted): string {
  const who = row.deletedByName
    ? `Deleted by ${row.deletedByName}`
    : row.deletedByUserId != null
      ? `Deleted by login #${row.deletedByUserId}`
      : 'Deleted';
  const when = row.deletedAt ? new Date(row.deletedAt).toLocaleString() : null;
  return [who, when].filter(Boolean).join(' · ');
}
