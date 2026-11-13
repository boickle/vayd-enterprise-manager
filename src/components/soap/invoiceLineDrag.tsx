import './invoiceLineDrag.css';
import { useState, type DragEvent } from 'react';

/**
 * Invoice order (owner, Nov 13, 2026): drag a pet's invoice lines into a new order, in the SOAP
 * checkout and in a direct invoice. Only the grip starts a drag, so price and quantity boxes on
 * the row still work; the whole row is a drop target. Lines of one pet move among that pet's
 * lines only (`groupKey`), so pets are never mixed.
 */
export function moveIdBefore(ids: string[], dragId: string, targetId: string): string[] {
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const out = [...ids];
  out.splice(from, 1);
  out.splice(to, 0, dragId);
  return out;
}

export function useInvoiceLineDrag(
  onReorder: (groupKey: string, orderedIds: string[]) => void | Promise<void>
) {
  const [drag, setDrag] = useState<{ groupKey: string; id: string } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const end = () => {
    setDrag(null);
    setOverId(null);
  };

  /** Props for the grip (the drag handle). */
  const gripProps = (groupKey: string, id: string, label: string) => ({
    draggable: true,
    role: 'button' as const,
    tabIndex: -1,
    'aria-label': `Drag ${label} to reorder`,
    title: 'Drag to reorder',
    className: 'invoice-line-grip',
    'data-testid': 'invoice-line-grip',
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer?.setData('text/plain', id);
      const row = (event.currentTarget as HTMLElement).closest('[data-invoice-line-row]');
      if (row instanceof HTMLElement && typeof event.dataTransfer?.setDragImage === 'function') {
        event.dataTransfer.setDragImage(row, 12, 12);
      }
      setDrag({ groupKey, id });
    },
    onDragEnd: end,
  });

  /** Props for the row: a drop target for lines of the same pet. */
  const rowDropProps = (groupKey: string, id: string, orderedIds: string[]) => ({
    'data-invoice-line-row': id,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!drag || drag.groupKey !== groupKey) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (overId !== id) setOverId(id);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!drag || drag.groupKey !== groupKey) return;
      event.preventDefault();
      const next = moveIdBefore(orderedIds, drag.id, id);
      end();
      if (next !== orderedIds) void onReorder(groupKey, next);
    },
  });

  /** Extra class for a row while dragging. */
  const rowDragClass = (id: string) =>
    drag?.id === id
      ? ' is-line-dragging'
      : overId === id && drag && drag.id !== id
        ? ' is-line-drop-target'
        : '';

  return { gripProps, rowDropProps, rowDragClass };
}

/** Grip icon (six dots). */
export function InvoiceLineGripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 16" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="2.5" cy="3" r="1.4" />
        <circle cx="7.5" cy="3" r="1.4" />
        <circle cx="2.5" cy="8" r="1.4" />
        <circle cx="7.5" cy="8" r="1.4" />
        <circle cx="2.5" cy="13" r="1.4" />
        <circle cx="7.5" cy="13" r="1.4" />
      </g>
    </svg>
  );
}

/** "Custom order" note with a reset, shown in a pet's section once staff dragged its lines. */
export function InvoiceSectionOrderReset({
  onReset,
  disabled,
}: {
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="invoice-order-custom" data-testid="invoice-order-custom">
      Custom order
      <button type="button" className="invoice-order-reset" onClick={onReset} disabled={disabled}>
        Reset to standard order
      </button>
    </span>
  );
}
