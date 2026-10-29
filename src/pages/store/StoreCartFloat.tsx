import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { storeCartCount, storeCartSubtotal, storeGiftCartTotal } from './storeCartState';
import { useStoreCart, useStoreGiftCart } from './useStoreCart';
import './Store.css';

export default function StoreCartFloat() {
  const location = useLocation();
  const lines = useStoreCart();
  const giftLines = useStoreGiftCart();
  const count = storeCartCount(lines);
  const [pop, setPop] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = [
    ...lines.map((line, i) => ({
      key: `${line.inventoryItemId}-${i}`,
      name: line.name,
      quantity: line.quantity,
      amount: line.unitPrice * line.quantity,
    })),
    ...giftLines.map((line) => ({
      key: line.key,
      name: `$${line.amount.toFixed(2)} gift card`,
      quantity: line.quantity,
      amount: line.price * line.quantity,
    })),
  ];

  useEffect(() => {
    if (!count) return;
    setPop(true);
    const t = window.setTimeout(() => setPop(false), 400);
    return () => window.clearTimeout(t);
  }, [count]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!count) return null;
  if (location.pathname === '/store/cart' || location.pathname === '/store/autoship') return null;
  if (location.pathname.startsWith('/consent/')) return null;
  if (location.pathname.startsWith('/store/gift-cards/print/')) return null;

  return (
    <div
      ref={rootRef}
      className={`vayd-store__cart-float${pop ? ' is-pop' : ''}${open ? ' is-open' : ''}`}
    >
      <div className="vayd-store__cart-float-panel">
        <div className="vayd-store__cart-float-title">In your cart</div>
        <ul>
          {rows.slice(0, 4).map((row) => (
            <li key={row.key}>
              <span>
                {row.name}
                {row.quantity > 1 ? ` × ${row.quantity}` : ''}
              </span>
              <span>${row.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        {rows.length > 4 ? (
          <p className="vayd-store__cart-float-more">+{rows.length - 4} more</p>
        ) : null}
        <div className="vayd-store__cart-float-total">
          <span>Subtotal</span>
          <strong>${(storeCartSubtotal(lines) + storeGiftCartTotal(giftLines)).toFixed(2)}</strong>
        </div>
        <Link to="/store/cart" className="primary">
          View cart
        </Link>
      </div>
      <button
        type="button"
        className="vayd-store__cart-float-btn"
        aria-label={`Cart, ${count} items`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <span className="vayd-store__cart-float-count">{count}</span>
      </button>
    </div>
  );
}
