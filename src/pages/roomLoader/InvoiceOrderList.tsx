import { useState, type DragEvent } from 'react';

/**
 * Staff Room Loader: the pet's items in invoice order (owner request, Nov 13, 2026).
 * Matching stays on the reminder cards above; this list only sets the order the client's
 * form, the PDF and the visit invoice use. Drag a row by its grip, or use the arrows.
 */

export type InvoiceOrderListRow = {
  key: string;
  name: string;
  categoryLabel: string;
  source: string;
  qty: number;
  total: number;
};

export type InvoiceOrderWaitingRow = { key: string; label: string };

type Props = {
  petName: string;
  rows: InvoiceOrderListRow[];
  /** Reminders not placed yet: no catalog match, or a match nobody confirmed. */
  waiting: InvoiceOrderWaitingRow[];
  isCustom: boolean;
  readOnly: boolean;
  /** Keys staff moved in this session (shown with a "Moved" tag while the order is custom). */
  movedKeys: ReadonlySet<string>;
  onMove: (key: string, toIndex: number) => void;
  onReset: () => void;
};

function formatMoney(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

export default function InvoiceOrderList({
  petName,
  rows,
  waiting,
  isCustom,
  readOnly,
  movedKeys,
  onMove,
  onReset,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  if (rows.length === 0 && waiting.length === 0) return null;

  const endDrag = () => {
    setDragKey(null);
    setOverKey(null);
  };

  const onDrop = (event: DragEvent<HTMLLIElement>, targetKey: string) => {
    event.preventDefault();
    const from = dragKey ?? event.dataTransfer?.getData('text/plain');
    if (from && from !== targetKey) {
      const toIndex = rows.findIndex((r) => r.key === targetKey);
      if (toIndex >= 0) onMove(from, toIndex);
    }
    endDrag();
  };

  return (
    <section
      className="rl-invoice-order"
      aria-label={`Invoice order for ${petName}`}
      data-testid="rl-invoice-order"
    >
      <div className="rl-invoice-order__head">
        <div>
          <h4 className="rl-invoice-order__title">
            Invoice order
            {isCustom ? (
              <span className="rl-invoice-order__badge rl-invoice-order__badge--custom">
                Custom order
              </span>
            ) : (
              <span className="rl-invoice-order__badge rl-invoice-order__badge--standard">
                Standard order
              </span>
            )}
          </h4>
          <p className="rl-invoice-order__hint">
            What the client&apos;s form and the invoice will show, top to bottom.
            {readOnly ? '' : ' Drag the grip or use the arrows to move an item.'}
          </p>
        </div>
        {isCustom && !readOnly ? (
          <button type="button" className="rl-invoice-order__reset" onClick={onReset}>
            Reset to standard order
          </button>
        ) : null}
      </div>

      <ol className="rl-invoice-order__list">
        {rows.map((row, index) => {
          const classes = ['rl-invoice-order__row'];
          if (dragKey === row.key) classes.push('is-dragging');
          if (overKey === row.key && dragKey && dragKey !== row.key) classes.push('is-over');
          const moved = isCustom && movedKeys.has(row.key);
          if (moved) classes.push('is-moved');
          return (
            <li
              key={row.key}
              className={classes.join(' ')}
              draggable={!readOnly}
              data-testid="rl-invoice-order-row"
              data-key={row.key}
              onDragStart={(event) => {
                if (readOnly) return;
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer?.setData('text/plain', row.key);
                setDragKey(row.key);
              }}
              onDragOver={(event) => {
                if (readOnly || !dragKey) return;
                event.preventDefault();
                if (overKey !== row.key) setOverKey(row.key);
              }}
              onDrop={(event) => onDrop(event, row.key)}
              onDragEnd={endDrag}
            >
              <span className="rl-invoice-order__grip" aria-hidden="true">
                {readOnly ? null : (
                  <svg width="14" height="14" viewBox="0 0 16 16">
                    <g fill="currentColor">
                      <circle cx="5.5" cy="3.5" r="1.4" />
                      <circle cx="10.5" cy="3.5" r="1.4" />
                      <circle cx="5.5" cy="8" r="1.4" />
                      <circle cx="10.5" cy="8" r="1.4" />
                      <circle cx="5.5" cy="12.5" r="1.4" />
                      <circle cx="10.5" cy="12.5" r="1.4" />
                    </g>
                  </svg>
                )}
              </span>
              <span className="rl-invoice-order__cat">{row.categoryLabel}</span>
              <span className="rl-invoice-order__name">
                {row.name}
                {moved ? <span className="rl-invoice-order__tag">Moved</span> : null}
              </span>
              <span className="rl-invoice-order__source">{row.source}</span>
              <span className="rl-invoice-order__qty">{row.qty !== 1 ? `× ${row.qty}` : ''}</span>
              <span className="rl-invoice-order__price">{formatMoney(row.total)}</span>
              <span className="rl-invoice-order__move">
                {readOnly ? null : (
                  <>
                    <button
                      type="button"
                      className="rl-invoice-order__arrow"
                      aria-label={`Move ${row.name} up`}
                      disabled={index === 0}
                      onClick={() => onMove(row.key, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rl-invoice-order__arrow"
                      aria-label={`Move ${row.name} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => onMove(row.key, index + 1)}
                    >
                      ↓
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
        {waiting.map((row) => (
          <li
            key={row.key}
            className="rl-invoice-order__row rl-invoice-order__row--waiting"
            data-testid="rl-invoice-order-waiting"
          >
            <span className="rl-invoice-order__grip" aria-hidden="true" />
            <span className="rl-invoice-order__cat rl-invoice-order__cat--waiting">
              Needs a match
            </span>
            <span className="rl-invoice-order__name">{row.label}</span>
            <span className="rl-invoice-order__source">Reminder</span>
            <span className="rl-invoice-order__qty" />
            <span className="rl-invoice-order__price" />
            <span className="rl-invoice-order__move rl-invoice-order__waiting-note">
              Not placed yet
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
