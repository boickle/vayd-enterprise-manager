import { useState } from 'react';
import {
  checkGiftCardBalance,
  formatGiftCardInput,
  giftCardCodeComplete,
  type GiftCardBalance,
} from '../../api/giftCards';
import { storeApiError } from '../../api/onlineStore';

export default function StoreGiftCardBalanceForm({ practiceId }: { practiceId: number }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GiftCardBalance | null>(null);

  const check = async () => {
    if (!giftCardCodeComplete(code)) {
      setErr('Gift card codes are 16 letters and numbers, printed on the card or in the email.');
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await checkGiftCardBalance(practiceId, code));
    } catch (e) {
      setErr(storeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form
        className="vayd-store__gift-balance-form"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <label>
          Gift card code
          <input
            value={code}
            onChange={(e) => setCode(formatGiftCardInput(e.target.value))}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Checking…' : 'Check balance'}
        </button>
      </form>
      {err ? <p className="vayd-store__err">{err}</p> : null}
      {result ? (
        <div className="vayd-store__note">
          <p style={{ margin: 0, fontSize: 18 }}>
            Gift card ••••{result.last4}: <strong>${result.balance.toFixed(2)}</strong> available
            {result.faceValue !== result.balance ? ` of $${result.faceValue.toFixed(2)}` : ''}
          </p>
          <p style={{ margin: '8px 0 0' }}>
            {result.status === 'void'
              ? 'This gift card is no longer valid.'
              : result.spendable
                ? 'Use it at checkout in this store, at your visit, or toward a bill in the client portal.'
                : 'This gift card has been fully used.'}
          </p>
        </div>
      ) : null}
    </>
  );
}
