import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  publicCheckout,
  publicStoreCardOnFile,
  storeApiError,
  type GiftCardCheckoutLine,
  type StoreSavedCard,
} from '../../api/onlineStore';
import {
  checkGiftCardBalance,
  formatGiftCardInput,
  giftCardCodeComplete,
} from '../../api/giftCards';
import StoreCartCardEntry, { type StoreCartCardEntryHandle } from './StoreCartCardEntry';
import {
  removeGiftCardFromCart,
  storeGiftCartTotal,
  writeStoreGiftCart,
  type StoreGiftCardLine,
} from './storeCartState';
import './Store.css';

export function giftCardCheckoutLines(lines: StoreGiftCardLine[]): GiftCardCheckoutLine[] {
  return lines.map((line) => ({
    kind: 'gift_card',
    listingId: line.listingId,
    amount: line.amount,
    quantity: line.quantity,
    sendToSelf: line.sendToSelf,
    recipientName: line.recipientName || null,
    recipientEmail: line.recipientEmail || null,
    fromName: line.fromName || null,
    message: line.message || null,
    deliverAt: line.deliverAt || null,
  }));
}

function deliveryLabel(line: StoreGiftCardLine) {
  const who = line.sendToSelf
    ? 'Emailed to you'
    : `To ${line.recipientName || line.recipientEmail} · ${line.recipientEmail}${
        line.fromName ? ` · From ${line.fromName}` : ''
      }`;
  if (!line.deliverAt) return `${who} · sends right away`;
  const [y, m, d] = line.deliverAt.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${who} · sends ${date}`;
}

export function StoreGiftCardCartLines({ lines }: { lines: StoreGiftCardLine[] }) {
  if (!lines.length) return null;
  return (
    <table className="vayd-store__cart-table vayd-store__gift-lines">
      <thead>
        <tr>
          <th>Gift card</th>
          <th>Qty</th>
          <th>Total</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.key}>
            <td>
              <strong>${line.amount.toFixed(2)} gift card</strong>
              <div className="vayd-store__muted" style={{ margin: '4px 0 0' }}>
                {deliveryLabel(line)}
              </div>
              {line.message ? (
                <div className="vayd-store__gift-line-msg">“{line.message}”</div>
              ) : null}
            </td>
            <td>{line.quantity}</td>
            <td>
              {line.price < line.amount - 0.005 ? (
                <span className="vayd-store__price-was">
                  ${(line.amount * line.quantity).toFixed(2)}
                </span>
              ) : null}
              ${(line.price * line.quantity).toFixed(2)}
            </td>
            <td>
              <button
                type="button"
                className="ghost"
                onClick={() => removeGiftCardFromCart(line.key)}
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type AppliedGiftCard = { code: string; last4: string; balance: number };

/** "Have a gift card?" box. Checks each code's balance before it is applied. */
export function StoreGiftCardCodeEntry({
  practiceId,
  applied,
  onChange,
  note,
}: {
  practiceId: number;
  applied: AppliedGiftCard[];
  onChange: (next: AppliedGiftCard[]) => void;
  note?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(applied.length > 0);

  const apply = async () => {
    if (!giftCardCodeComplete(code)) {
      setErr('Gift card codes are 16 letters and numbers.');
      return;
    }
    const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (applied.some((row) => row.code === normalized)) {
      setErr('That gift card is already applied.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const view = await checkGiftCardBalance(practiceId, normalized);
      if (!view.spendable) {
        setErr(
          view.status === 'void'
            ? 'That gift card is no longer valid.'
            : 'That gift card has no balance left.'
        );
        return;
      }
      onChange([...applied, { code: normalized, last4: view.last4, balance: view.balance }]);
      setCode('');
    } catch (e) {
      setErr(storeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="vayd-store__card-link" onClick={() => setOpen(true)}>
        Have a gift card?
      </button>
    );
  }
  return (
    <div className="vayd-store__gift-code">
      <label className="vayd-store__cart-coupon">
        Gift card
        <span>
          <input
            value={code}
            onChange={(e) => setCode(formatGiftCardInput(e.target.value))}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void apply();
              }
            }}
          />
          <button type="button" className="ghost" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Checking…' : 'Apply'}
          </button>
        </span>
      </label>
      {applied.map((row) => (
        <div key={row.code} className="vayd-store__gift-applied">
          <span>
            Gift card ••••{row.last4} · ${row.balance.toFixed(2)} available
          </span>
          <button
            type="button"
            className="vayd-store__card-link"
            onClick={() => onChange(applied.filter((r) => r.code !== row.code))}
          >
            Remove
          </button>
        </div>
      ))}
      {note ? <p className="vayd-store__muted">{note}</p> : null}
      {err ? <p className="vayd-store__err">{err}</p> : null}
    </div>
  );
}

/**
 * Checkout for a cart that only holds gift cards: no login, pet, address, or shipping.
 * Logged-in clients get their details and cards on file prefilled.
 */
export function StoreGiftCardCheckout({
  practiceId,
  lines,
  clientId,
  prefill,
}: {
  practiceId: number;
  lines: StoreGiftCardLine[];
  clientId: number | null;
  prefill: { name: string; email: string };
}) {
  const nav = useNavigate();
  const [name, setName] = useState(prefill.name);
  const [email, setEmail] = useState(prefill.email);
  const [cards, setCards] = useState<StoreSavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [enterNewCard, setEnterNewCard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cardRef = useRef<StoreCartCardEntryHandle>(null);
  const total = storeGiftCartTotal(lines);
  const faceTotal = lines.reduce((n, l) => n + l.amount * l.quantity, 0);
  const onFileEmail = clientId ? prefill.email.trim() : '';

  useEffect(() => {
    // Only a logged-in household sees its saved cards; guests always enter one.
    if (!onFileEmail) return;
    let cancelled = false;
    void publicStoreCardOnFile(practiceId, onFileEmail).then((row) => {
      if (cancelled) return;
      const next = row.hasCard ? (row.cards ?? []) : [];
      setCards(next);
      const recommended = next.find((c) => c.recommended) ?? next[0];
      setSelectedCardId(recommended?.paymentMethodId || '');
      setEnterNewCard(!next.length);
    });
    return () => {
      cancelled = true;
    };
  }, [onFileEmail, practiceId]);

  useEffect(() => {
    setName((current) => current || prefill.name);
    setEmail((current) => current || prefill.email);
  }, [prefill.email, prefill.name]);

  const place = async () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErr('Enter your name and email for the receipt.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let paymentMethodId: string | null = null;
      let saveCard = Boolean(clientId);
      if (enterNewCard || !cards.length) {
        const created = await cardRef.current?.createPaymentMethod();
        paymentMethodId = created?.paymentMethodId ?? null;
        saveCard = Boolean(clientId) && created?.saveCard !== false;
      } else {
        paymentMethodId = selectedCardId || null;
      }
      if (!paymentMethodId) throw new Error('Enter a card to pay for the gift card.');
      const result = await publicCheckout(practiceId, {
        customerName: name.trim(),
        customerEmail: email.trim(),
        clientId,
        paymentMethodId,
        saveCard,
        ship: {},
        lines: giftCardCheckoutLines(lines),
      });
      writeStoreGiftCart([]);
      nav('/store/thanks/gift-cards', { state: { order: result } });
    } catch (e) {
      setErr(storeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vayd-store__cart-grid">
      <section>
        <h2>Your details</h2>
        <p className="vayd-store__muted">
          We email your receipt and a printable copy of each gift card here.
          {clientId ? null : ' No account needed.'}
        </p>
        <div className="vayd-store__cart-fields">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
        </div>
      </section>
      <aside className="vayd-store__cart-summary">
        <h2>Total</h2>
        <table>
          <tbody>
            <tr>
              <th>Gift card value</th>
              <td>${faceTotal.toFixed(2)}</td>
            </tr>
            {faceTotal - total > 0.009 ? (
              <tr>
                <th>You save</th>
                <td>−${(faceTotal - total).toFixed(2)}</td>
              </tr>
            ) : null}
            <tr className="vayd-store__cart-grand">
              <th>Due today</th>
              <td>${total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <p className="vayd-store__muted">No tax or shipping on gift cards.</p>
        {cards.length && !enterNewCard ? (
          <div className="vayd-store__card-pay">
            <label>
              Card on file
              <select
                className="vayd-store__card-select"
                value={selectedCardId}
                onChange={(e) => setSelectedCardId(e.target.value)}
              >
                {cards.map((saved) => (
                  <option key={saved.paymentMethodId} value={saved.paymentMethodId}>
                    {(saved.brand || 'Card').replace(/^./, (c) => c.toUpperCase())} ••••{' '}
                    {saved.last4 || '••••'}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="vayd-store__card-link"
              onClick={() => setEnterNewCard(true)}
            >
              Use a different card
            </button>
          </div>
        ) : (
          <StoreCartCardEntry
            ref={cardRef}
            billingPrefill={{ name, email, line1: '', line2: '', city: '', state: '', postal: '' }}
            onClose={cards.length ? () => setEnterNewCard(false) : undefined}
          />
        )}
        {err ? <p className="vayd-store__place-err">{err}</p> : null}
        <button
          type="button"
          className="primary vayd-store__place"
          disabled={busy}
          onClick={() => void place()}
        >
          {busy ? 'Placing order…' : `Pay $${total.toFixed(2)}`}
        </button>
      </aside>
    </div>
  );
}
