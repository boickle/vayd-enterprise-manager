import { useEffect, useState } from 'react';
import {
  addVisitTender,
  fetchAvailableAccountCredit,
  type AvailableAccountCredit,
  type VisitInvoice,
} from '../../api/visitWorkflow';
import { useCan } from '../../permissions/PermissionContext';

/**
 * PAY-06: pay part or all of a bill with the client's account credit (Scout credits and eVet
 * credit, one shared total). Shows what is available, defaults to the smaller of that and what is
 * due, and won't take more. eVet credit is held while the practice's eVet sync is on.
 */
export default function AccountCreditTenderForm({
  invoiceId,
  clientId,
  due,
  cashierEmployeeId,
  onApplied,
  onCancel,
  className = 'soap-btn',
}: {
  invoiceId: string;
  clientId: number;
  due: number;
  cashierEmployeeId?: number | null;
  onApplied: (invoice: VisitInvoice, applied: number, leftAfter: number) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const allowed = useCan('payment.take');
  const [credit, setCredit] = useState<AvailableAccountCredit | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed || !clientId) return;
    let live = true;
    setErr(null);
    fetchAvailableAccountCredit(clientId)
      .then((found) => {
        if (!live) return;
        setCredit(found);
        setAmount(Math.max(0, Math.min(found.total, due)).toFixed(2));
      })
      .catch((e) => {
        if (live) setErr(e instanceof Error ? e.message : 'Could not load account credit');
      });
    return () => {
      live = false;
    };
  }, [allowed, clientId, due]);

  if (!allowed) return null;

  const available = credit?.total ?? 0;
  const max = Math.round(Math.max(0, Math.min(available, due)) * 100) / 100;

  const apply = async () => {
    const value = Math.round(Number(amount) * 100) / 100;
    if (!(value > 0)) {
      setErr('Enter an amount of credit to use.');
      return;
    }
    if (value > max + 0.001) {
      setErr(
        value > available + 0.001
          ? `Only $${available.toFixed(2)} credit is available.`
          : `Only $${due.toFixed(2)} is due.`
      );
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const invoice = await addVisitTender(invoiceId, {
        method: 'account_credit',
        amount: value,
        cashierEmployeeId,
      });
      onApplied(invoice, value, Math.round((available - value) * 100) / 100);
    } catch (e) {
      const data = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data;
      const msg = Array.isArray(data?.message) ? data?.message.join(' ') : data?.message;
      setErr(msg || (e instanceof Error ? e.message : 'Could not apply the account credit'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-credit-tender" style={{ display: 'grid', gap: 8, padding: '10px 0' }}>
      {credit ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>
            Account credit: <strong>${available.toFixed(2)} available</strong>
          </span>
          {max > 0 ? (
            <>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                Use $
                <input
                  className="settings-input"
                  aria-label="Account credit amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    // Can't type more than the credit or what is due.
                    setAmount(Number(raw) > max ? max.toFixed(2) : raw);
                  }}
                  style={{ width: 100 }}
                />
              </label>
              <button type="button" className={className} disabled={busy} onClick={() => void apply()}>
                {busy ? 'Applying…' : 'Apply credit'}
              </button>
            </>
          ) : null}
          {onCancel ? (
            <button type="button" className={`${className} ghost`} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : !err ? (
        <span>Loading account credit…</span>
      ) : null}
      {credit?.evetHeld ? (
        <p role="note" style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
          ${credit.evetHeldAmount.toFixed(2)} eVet credit is held until eVet sync is turned off.
        </p>
      ) : null}
      {err ? <p style={{ margin: 0, color: '#9b1c1c' }}>{err}</p> : null}
    </div>
  );
}
