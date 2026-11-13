import { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Lock } from 'lucide-react';
import {
  DEFAULT_INVOICE_CATEGORY_ORDER,
  INVOICE_CATEGORY_DESCRIPTIONS,
  INVOICE_CATEGORY_LABELS,
  moveInvoiceOrderKey,
  type InvoiceCategoryKey,
} from '../../../utils/roomLoaderInvoiceOrder';

/**
 * Settings → Room Loader → Invoice order. Every Room Loader lists a pet's items in this
 * category order, and so do the client's form, the PDF and the visit invoice.
 */
export default function InvoiceOrderEditor({
  categories,
  onChange,
}: {
  categories: InvoiceCategoryKey[];
  onChange: (next: InvoiceCategoryKey[]) => void;
}) {
  const [dragKey, setDragKey] = useState<InvoiceCategoryKey | null>(null);
  const [overKey, setOverKey] = useState<InvoiceCategoryKey | null>(null);
  const isDefault = categories.join('|') === DEFAULT_INVOICE_CATEGORY_ORDER.join('|');

  const move = (key: InvoiceCategoryKey, toIndex: number) => {
    const next = moveInvoiceOrderKey(categories, key, toIndex) as InvoiceCategoryKey[];
    if (next !== categories) onChange(next);
  };

  return (
    <div className="rl-cfg__invoice-order" data-testid="rl-cfg-invoice-order">
      <ol className="rl-cfg__invoice-order-list">
        {categories.map((key, index) => {
          const classes = ['rl-cfg__invoice-order-row'];
          if (dragKey === key) classes.push('is-dragging');
          if (overKey === key && dragKey && dragKey !== key) classes.push('is-over');
          return (
            <li
              key={key}
              className={classes.join(' ')}
              draggable
              data-key={key}
              onDragStart={(event) => {
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer?.setData('text/plain', key);
                setDragKey(key);
              }}
              onDragOver={(event) => {
                if (!dragKey) return;
                event.preventDefault();
                if (overKey !== key) setOverKey(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragKey && dragKey !== key) move(dragKey, index);
                setDragKey(null);
                setOverKey(null);
              }}
              onDragEnd={() => {
                setDragKey(null);
                setOverKey(null);
              }}
            >
              <GripVertical size={16} aria-hidden className="rl-cfg__invoice-order-grip" />
              <span className="rl-cfg__invoice-order-num">{index + 1}</span>
              <span className="rl-cfg__invoice-order-text">
                <strong>{INVOICE_CATEGORY_LABELS[key]}</strong>
                <span>{INVOICE_CATEGORY_DESCRIPTIONS[key]}</span>
              </span>
              <span className="rl-cfg__row-actions">
                <button
                  type="button"
                  aria-label={`Move ${INVOICE_CATEGORY_LABELS[key]} up`}
                  disabled={index === 0}
                  onClick={() => move(key, index - 1)}
                >
                  <ChevronUp size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${INVOICE_CATEGORY_LABELS[key]} down`}
                  disabled={index === categories.length - 1}
                  onClick={() => move(key, index + 1)}
                >
                  <ChevronDown size={15} aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
        <li className="rl-cfg__invoice-order-row rl-cfg__invoice-order-row--locked">
          <Lock size={14} aria-hidden className="rl-cfg__invoice-order-grip" />
          <span className="rl-cfg__invoice-order-num">—</span>
          <span className="rl-cfg__invoice-order-text">
            <strong>Anything else</strong>
            <span>Items that fit no category always go last</span>
          </span>
          <span />
        </li>
      </ol>
      <button
        type="button"
        className="btn secondary"
        disabled={isDefault}
        onClick={() => onChange([...DEFAULT_INVOICE_CATEGORY_ORDER])}
      >
        Reset to default order
      </button>
    </div>
  );
}
