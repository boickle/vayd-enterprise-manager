import { useEffect, useState } from 'react';
import {
  addVisitTender,
  fetchAvailableAccountCredit,
  type AvailableAccountCredit,
  type VisitInvoice,
} from '../../api/visitWorkflow';
import { useCan } from '../../permissions/PermissionContext';
import { appConfirm } from '../../utils/appDialog';

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * PAY-06: pay part or all of a bill with the client's account credit (Scout credits and eVet
 * credit, one shared total). Shows what is available, defaults to the smaller of that and what is
 * due, and won't take more. eVet credit is held while the practice's eVet sync is on.
 *
 * Appointment deposits (D7 option 3, Nov 12, 2026): a deposit for this bill's visit is included and
 * named. A deposit held for another visit isn't, but staff can tick it in (for a cancel or no-show
 * fee) after a warning.
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
  const [useHeld, setUseHeld] = useState(false);

  useEffect(() => {
    if (!allowed || !clientId) return;
    let live = true;
    setErr(null);
    setUseHeld(false);
    fetchAvailableAccountCredit(clientId, invoiceId)
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
  }, [allowed, clientId, due, invoiceId]);

  if (!allowed) return null;

  const deposits = credit?.deposits ?? [];
  const ownDeposits = deposits.filter((d) => d.held && d.forThisBill && d.amount > 0.009);
  const otherDeposits = deposits.filter((d) => d.held && !d.forThisBill && d.amount > 0.009);
  const heldElsewhere = Math.round((credit?.depositHeld ?? 0) * 100) / 100;
  const available = Math.round(((credit?.total ?? 0) + (useHeld ? heldElsewhere : 0)) * 100) / 100;
  const max = Math.round(Math.max(0, Math.min(available, due)) * 100) / 100;
  const depositName = (d: { label: string | null; amount: number }) =>
    `${d.label ? d.label.replace(/^Deposit/, 'the deposit') : 'an appointment deposit'} (${money(d.amount)})`;

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
    // Spending a deposit held for another visit: say so first (D7 option 3).
    const freeCredit = credit?.total ?? 0;
    if (useHeld && value > freeCredit + 0.001) {
      const ok = await appConfirm({
        title: 'Use a deposit for another visit?',
        message: `This is ${otherDeposits.map(depositName).join(' and ')}. Use it on this bill? Do this only for that visit's cancel or no-show fee.`,
        confirmLabel: 'Use the deposit',
      });
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      const invoice = await addVisitTender(invoiceId, {
        method: 'account_credit',
        amount: value,
        cashierEmployeeId,
        ...(useHeld ? { useHeldDeposits: true } : {}),
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
      {ownDeposits.length ? (
        <p role="note" style={{ margin: 0, fontSize: 12, color: '#64748b' }} data-testid="credit-own-deposit">
          Includes {ownDeposits.map(depositName).join(' and ')}, used first.
        </p>
      ) : null}
      {otherDeposits.length ? (
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: '#64748b' }}>
          <input
            type="checkbox"
            checked={useHeld}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.checked;
              setUseHeld(next);
              const total = (credit?.total ?? 0) + (next ? heldElsewhere : 0);
              setAmount(Math.max(0, Math.min(total, due)).toFixed(2));
            }}
            data-testid="credit-use-held-deposit"
          />
          <span>
            Not included: {otherDeposits.map(depositName).join(' and ')}, held for that visit. Tick to use it here,
            for example for that visit&apos;s cancel or no-show fee.
          </span>
        </label>
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
