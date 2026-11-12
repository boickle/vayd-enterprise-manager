import { useState } from 'react';
import { addVisitTender, type VisitInvoice } from '../../api/visitWorkflow';
import {
  formatGiftCardInput,
  giftCardCodeComplete,
  staffCheckGiftCard,
  type GiftCardBalance,
} from '../../api/giftCards';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import { useCan } from '../../permissions/PermissionContext';

/**
 * Take a gift card as payment on an invoice. Looks the code up first so staff can tell the
 * client the balance, then spends up to what is due.
 */
export default function GiftCardTenderForm({
  invoiceId,
  due,
  channel,
  cashierEmployeeId,
  onApplied,
  onCancel,
  className = 'soap-btn',
}: {
  invoiceId: string;
  due: number;
  channel: 'visit' | 'staff_ledger';
  cashierEmployeeId?: number | null;
  onApplied: (invoice: VisitInvoice, applied: number, card: GiftCardBalance) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const allowed = useCan('gift_card.redeem');
  const [code, setCode] = useState('');
  const [card, setCard] = useState<GiftCardBalance | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!allowed) return null;

  const lookUp = async () => {
    if (!giftCardCodeComplete(code)) {
      setErr('Gift card codes are 16 letters and numbers.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const found = await staffCheckGiftCard(currentPracticeId(), code);
      setCard(found);
      if (!found.spendable) {
        setErr(
          found.status === 'void'
            ? 'This gift card is void.'
            : 'This gift card has no balance left.'
        );
        return;
      }
      setAmount(Math.min(found.balance, due).toFixed(2));
    } catch (e) {
      setCard(null);
      setErr(e instanceof Error ? e.message : 'Could not find that gift card');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!card) return;
    const value = Math.round(Number(amount) * 100) / 100;
    if (!(value > 0)) {
      setErr('Enter an amount to take from the gift card.');
      return;
    }
    if (value > card.balance + 0.001) {
      setErr(`The card only has $${card.balance.toFixed(2)}.`);
      return;
    }
    if (value > due + 0.009) {
      setErr(`Only $${due.toFixed(2)} is due.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const invoice = await addVisitTender(invoiceId, {
        method: 'gift_card',
        amount: value,
        giftCardCode: code,
        giftCardChannel: channel,
        cashierEmployeeId,
      });
      onApplied(invoice, value, card);
      setCode('');
      setCard(null);
      setAmount('');
    } catch (e) {
      const data = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data;
      const msg = Array.isArray(data?.message) ? data?.message.join(' ') : data?.message;
      setErr(msg || (e instanceof Error ? e.message : 'Could not apply the gift card'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gift-card-tender" style={{ display: 'grid', gap: 8, padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="settings-input"
          value={code}
          onChange={(e) => {
            setCode(formatGiftCardInput(e.target.value));
            setCard(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookUp();
            }
          }}
          placeholder="Gift card code"
          autoComplete="off"
          spellCheck={false}
          style={{ minWidth: 220, letterSpacing: '0.05em' }}
        />
        <button type="button" className={className} disabled={busy} onClick={() => void lookUp()}>
          Check balance
        </button>
        {onCancel ? (
          <button type="button" className={`${className} ghost`} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {card && card.spendable ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>
            ••••{card.last4} has <strong>${card.balance.toFixed(2)}</strong>
          </span>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Use $
            <input
              className="settings-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              style={{ width: 100 }}
            />
          </label>
          <button type="button" className={className} disabled={busy} onClick={() => void apply()}>
            {busy ? 'Applying…' : 'Apply gift card'}
          </button>
        </div>
      ) : null}
      {err ? <p style={{ margin: 0, color: '#9b1c1c' }}>{err}</p> : null}
    </div>
  );
}
