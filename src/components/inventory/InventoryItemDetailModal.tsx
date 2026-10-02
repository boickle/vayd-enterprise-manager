import Catalog from '../../pages/Catalog';

type Props = {
  /** Accepted for call-site compatibility; Catalog resolves practice from auth. */
  practiceId?: number;
  inventoryItemId: number;
  title?: string | null;
  onClose: () => void;
};

/** Full catalog view/edit modal for a stock item (same screen as Inventory → Products). */
export default function InventoryItemDetailModal({
  inventoryItemId,
  title,
  onClose,
}: Props) {
  return (
    <Catalog
      embed={{
        itemId: inventoryItemId,
        itemType: 'inventory',
        label: title?.trim() || undefined,
        onClose,
      }}
    />
  );
}
