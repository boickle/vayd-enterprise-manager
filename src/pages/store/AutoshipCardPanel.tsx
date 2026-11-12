import { useEffect, useRef, useState } from 'react';
import type { AutoshipCard, AutoshipCardResult, AutoshipCards } from '../../api/autoshipCard';
import StoreCartCardEntry, { type StoreCartCardEntryHandle } from './StoreCartCardEntry';
import './Store.css';
import './AutoshipCardPanel.css';

function cardLabel(c: AutoshipCard): string {
  const brand = c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : 'Card';
  const exp = c.expMonth && c.expYear ? ` · exp ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : '';
  return `${brand} ending ${c.last4}${exp}`;
}

function errorText(e: unknown, fallback: string): string {
  const msg =
    (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ??
    (e as { message?: string })?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

/**
 * Shows the card an auto-ship charges and lets the client or staff switch it to another
 * card on the same account or a newly entered one. A past-due charge is retried on the new card.
 */
export default function AutoshipCardPanel({
  load,
  save,
  name,
  email,
  buttonClass,
  secondaryButtonClass,
  onSaved,
}: {
  load: () => Promise<AutoshipCards>;
  save: (paymentMethodId: string) => Promise<AutoshipCardResult>;
  name: string;
  email?: string | null;
  buttonClass: string;
  secondaryButtonClass: string;
  onSaved?: (message: string) => void;
}) {
  const [data, setData] = useState<AutoshipCards | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>('');
  const [entering, setEntering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const entryRef = useRef<StoreCartCardEntryHandle>(null);

  useEffect(() => {
    load()
      .then((d) => {
        setData(d);
        setChoice(d.cards.find((c) => !c.current)?.paymentMethodId || '');
      })
      .catch((e) => setLoadError(errorText(e, 'Could not load the card for this auto-ship.')));
  }, []);

  if (loadError) return <div className="vayd-store__card-panel-error">{loadError}</div>;
  if (!data) return <div className="vayd-store__card-panel-muted">Loading card…</div>;

  const current = data.cards.find((c) => c.current);
  const others = data.cards.filter((c) => !c.current);
  const pastDue = data.status === 'past_due' || data.status === 'unpaid';

  async function submit() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let pm = choice;
      if (entering || !others.length) {
        const created = await entryRef.current?.createPaymentMethod();
        pm = created?.paymentMethodId ?? '';
      }
      if (!pm) {
        setError('Choose or enter a card.');
        return;
      }
      const result = await save(pm);
      setData(result);
      setEntering(false);
      setChoice(result.cards.find((c) => !c.current)?.paymentMethodId || '');
      const now = result.cards.find((c) => c.current);
      const text =
        result.retried === 'paid'
          ? `Card updated${now ? ` to ${cardLabel(now)}` : ''}, and the missed charge went through.`
          : result.retried === 'failed'
            ? `Card updated${now ? ` to ${cardLabel(now)}` : ''}, but the missed charge was declined again.`
            : `Card updated${now ? ` to ${cardLabel(now)}` : ''}.`;
      setMessage(text);
      onSaved?.(text);
    } catch (e) {
      setError(errorText(e, 'The card could not be updated.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vayd-store__card-panel">
      <div>
        <strong>Card for this auto-ship:</strong> {current ? cardLabel(current) : 'none on file'}
      </div>
      {pastDue ? (
        <div className="vayd-store__card-panel-error">
          The last charge didn’t go through. Updating the card will retry it right away.
        </div>
      ) : null}
      {others.length > 0 && !entering ? (
        <label className="vayd-store__card-panel-row">
          Switch to
          <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy}>
            {others.map((c) => (
              <option key={c.paymentMethodId} value={c.paymentMethodId}>
                {cardLabel(c)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {entering || others.length === 0 ? (
        <StoreCartCardEntry
          ref={entryRef}
          billingPrefill={{ name, email: email || undefined, line1: '', line2: '', city: '', state: '', postal: '' }}
        />
      ) : null}
      {error ? <div className="vayd-store__card-panel-error">{error}</div> : null}
      {message ? <div className="vayd-store__card-panel-ok">{message}</div> : null}
      <div className="vayd-store__card-panel-actions">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : entering || others.length === 0 ? 'Use this new card' : 'Use this card'}
        </button>
        {others.length > 0 ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() => setEntering((v) => !v)}
          >
            {entering ? 'Pick a saved card instead' : 'Enter a new card'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
