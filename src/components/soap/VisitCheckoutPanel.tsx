import { useState } from 'react';
import {
  CreditCard,
  Lock,
  Receipt,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import {
  chargeSavedCard,
  createTerminalPaymentIntent,
  finalizeInvoice,
  markVisitCompleted,
  voidInvoice,
  type VisitInvoice,
} from '../../api/visitWorkflow';

type Props = {
  appointmentId: number;
  invoice: VisitInvoice | null;
  visitCompleted: boolean;
  disabled?: boolean;
  onInvoiceChange: (invoice: VisitInvoice) => void;
  onVisitCompleted: () => void;
  onOpenEuthanasiaPrepay: () => void;
};

function money(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/**
 * Tech-run checkout (spec §7). Runs off the invoice and is independent of SOAP
 * completion — the tech can check the client out before the doctor finishes
 * notes. Finalizing/paying never mutates the visit (spec §2).
 */
export default function VisitCheckoutPanel({
  appointmentId,
  invoice,
  visitCompleted,
  disabled,
  onInvoiceChange,
  onVisitCompleted,
  onOpenEuthanasiaPrepay,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const finalize = () =>
    run('finalize', async () => {
      if (!invoice) return;
      onInvoiceChange(await finalizeInvoice(invoice.id));
    });

  const voidInv = () =>
    run('void', async () => {
      if (!invoice) return;
      onInvoiceChange(await voidInvoice(invoice.id));
    });

  const cardOnFile = () =>
    run('saved', async () => {
      if (!invoice) return;
      onInvoiceChange(await chargeSavedCard(invoice.id));
      setNote('Charged the card on file.');
    });

  const tapToPay = () =>
    run('terminal', async () => {
      if (!invoice) return;
      const pi = await createTerminalPaymentIntent(invoice.id);
      setNote(
        `Tap to Pay ready (PaymentIntent ${pi.id}). Connect the Stripe reader to collect at card-present rates.`
      );
    });

  const completeVisit = () =>
    run('complete', async () => {
      const result = await markVisitCompleted(appointmentId);
      onVisitCompleted();
      if (result.euthanasiaCharge?.attempted) {
        setNote(
          result.euthanasiaCharge.success
            ? 'Visit completed. Euthanasia card charged off-session.'
            : `Visit completed. Euthanasia charge needs manual collection: ${
                result.euthanasiaCharge.message ?? 'card declined'
              }`
        );
      } else {
        setNote('Visit marked completed.');
      }
    });

  const status = invoice?.status ?? 'open';
  const isPaid = status === 'paid';
  const isVoid = status === 'void';
  const hasSavedCard = Boolean(invoice?.savedPaymentMethodId);

  return (
    <div className="soap-checkout">
      <div className="soap-checkout-head">
        <Receipt size={16} />
        <span>Checkout</span>
        <span className={`soap-invoice-badge status-${status}`}>{status}</span>
        {invoice?.isEuthanasiaPrepay && (
          <span className="soap-invoice-badge euthanasia">euthanasia prepay</span>
        )}
      </div>

      {!invoice ? (
        <div className="soap-empty">
          No invoice yet — placing an order in the Plan opens one automatically.
        </div>
      ) : (
        <>
          <div className="soap-invoice-lines">
            {(invoice.lines ?? [])
              .filter((l) => !l.isDeleted)
              .map((l) => (
              <div key={l.id} className="soap-invoice-line">
                <span>{l.description}</span>
                <span>{l.isCovered ? 'covered' : money(l.amount)}</span>
              </div>
            ))}
          </div>
          <div className="soap-invoice-totals">
            {Number(invoice.membershipAdjustments) !== 0 && (
              <div className="soap-invoice-row covered">
                <span>Membership covered</span>
                <span>{money(invoice.membershipAdjustments)}</span>
              </div>
            )}
            <div className="soap-invoice-row total">
              <span>Total</span>
              <span>{money(invoice.total)}</span>
            </div>
            {Number(invoice.amountPaid) > 0 && (
              <div className="soap-invoice-row">
                <span>Paid</span>
                <span>{money(invoice.amountPaid)}</span>
              </div>
            )}
          </div>

          {error && <div className="soap-error">{error}</div>}
          {note && <div className="soap-note-banner">{note}</div>}

          <div className="soap-checkout-actions">
            {!isPaid && !isVoid && status === 'open' && (
              <button
                type="button"
                className="soap-btn ghost"
                disabled={disabled || busy != null}
                onClick={finalize}
              >
                <Lock size={14} /> Finalize
              </button>
            )}
            {!isPaid && !isVoid && (
              <>
                <button
                  type="button"
                  className="soap-btn"
                  disabled={disabled || busy != null}
                  onClick={tapToPay}
                >
                  <Smartphone size={14} /> Tap to Pay
                </button>
                <button
                  type="button"
                  className="soap-btn"
                  disabled={disabled || busy != null || !hasSavedCard}
                  title={hasSavedCard ? '' : 'No card saved on file'}
                  onClick={cardOnFile}
                >
                  <CreditCard size={14} /> Card on file
                </button>
                <button
                  type="button"
                  className="soap-btn ghost"
                  disabled={disabled || busy != null}
                  onClick={onOpenEuthanasiaPrepay}
                >
                  <ShieldCheck size={14} /> Save card (euthanasia)
                </button>
              </>
            )}
            {!isPaid && !isVoid && status !== 'open' && (
              <button
                type="button"
                className="soap-btn ghost danger"
                disabled={disabled || busy != null}
                onClick={voidInv}
              >
                Void
              </button>
            )}
          </div>
        </>
      )}

      <div className="soap-visit-complete">
        {visitCompleted ? (
          <div className="soap-visit-complete-done">
            <CheckCircle2 size={15} /> Visit completed
          </div>
        ) : (
          <button
            type="button"
            className="soap-btn primary"
            disabled={busy != null}
            onClick={completeVisit}
          >
            <CheckCircle2 size={14} /> Mark visit completed (tech)
          </button>
        )}
        <p className="soap-hint">
          Marking the visit completed is independent of finishing notes and is the
          trigger for euthanasia off-session capture.
        </p>
      </div>
    </div>
  );
}
