import {
  patchVisitInvoice,
  updateCounterInvoiceLine,
  type VisitInvoice,
  type VisitInvoiceLine,
} from '../api/visitWorkflow';
import { appConfirm } from './appDialog';

/**
 * Per-charge locations (owner decision, Nov 2, 2026). Changing one item's shelf changes that item
 * only unless staff choose otherwise, and controlled drugs never move with the rest of the invoice.
 */

export const ALL_EXCEPT_CONTROLLED = 'All items except controlled drugs';

type Shelf = { branchId: number; locationId: number; name: string };

const isControlled = (l: VisitInvoiceLine) => l.catalogIsControlled === true;
const follows = (l: VisitInvoiceLine) => l.inventoryLocationId == null;
const hasLot = (l: VisitInvoiceLine) => l.inventoryLotBalanceId != null || (l.lots?.length ?? 0) > 0;
/** Lines that take stock off a shelf. */
const stocky = (l: VisitInvoiceLine) => l.catalogItemType === 'inventory' || hasLot(l);
/** A controlled line with no shelf of its own and no doctor's safe falls back to the invoice's. */
const controlledOnInvoiceShelf = (l: VisitInvoiceLine) =>
  isControlled(l) && follows(l) && !l.controlledLocation;

/** True when changing the invoice's location could move items already on it. */
export function invoiceHasMovableItems(invoice: VisitInvoice): boolean {
  return (invoice.lines ?? []).some((l) => !isControlled(l) && stocky(l));
}

async function pin(invoice: VisitInvoice, lines: VisitInvoiceLine[], locationId: number) {
  let inv = invoice;
  for (const l of lines) {
    inv = await updateCounterInvoiceLine(inv.id, l.id, { inventoryLocationId: locationId });
  }
  return inv;
}

/**
 * Change the invoice's Branch / Location (the default for new items). `moveExisting` also moves
 * the items already on it; otherwise they stay on the shelf they were using. Controlled drugs
 * stay put either way.
 */
export async function setInvoiceShelf(
  invoice: VisitInvoice,
  next: { branchId: number; locationId?: number | null },
  opts: { moveExisting: boolean }
): Promise<VisitInvoice> {
  let inv = invoice;
  const old = invoice.inventoryLocationId ?? null;
  if (old != null) {
    const stay = (invoice.lines ?? []).filter(
      (l) =>
        controlledOnInvoiceShelf(l) || (!opts.moveExisting && !isControlled(l) && follows(l) && stocky(l))
    );
    inv = await pin(inv, stay, old);
  }
  if (next.branchId !== inv.inventoryBranchId) {
    inv = await patchVisitInvoice(inv.id, { inventoryBranchId: next.branchId });
  }
  if (next.locationId !== undefined && next.locationId !== inv.inventoryLocationId) {
    inv = await patchVisitInvoice(inv.id, { inventoryLocationId: next.locationId });
  }
  if (opts.moveExisting) {
    // Back to following the invoice; the server clears lots that aren't on the new shelf.
    const move = (inv.lines ?? []).filter((l) => !isControlled(l) && (!follows(l) || hasLot(l)));
    for (const l of move) {
      inv = await updateCounterInvoiceLine(inv.id, l.id, { inventoryLocationId: null });
    }
  }
  return inv;
}

/** Staff changed the Location on one item. */
export async function changeLineShelf(
  invoice: VisitInvoice,
  line: VisitInvoiceLine,
  shelf: Shelf
): Promise<VisitInvoice> {
  const justThis = () =>
    updateCounterInvoiceLine(invoice.id, line.id, { inventoryLocationId: shelf.locationId });
  if (isControlled(line)) return justThis();
  const all = await appConfirm({
    title: 'Change the location for this invoice?',
    message: `Use ${shelf.name} for all inventory on this invoice, including items added later? Controlled drugs keep their own location.`,
    confirmLabel: ALL_EXCEPT_CONTROLLED,
    cancelLabel: 'Just this item',
  });
  if (!all) return justThis();
  return setInvoiceShelf(invoice, shelf, { moveExisting: true });
}
