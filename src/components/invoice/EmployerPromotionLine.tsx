import { useState } from 'react';
import { confirmEmployerPromotion, type VisitInvoice } from '../../api/visitWorkflow';
import { apiErrorMessage } from '../../api/http';
import './EmployerPromotionLine.css';

type Props = {
  invoice: VisitInvoice | null;
  onInvoiceChange: (next: VisitInvoice) => void;
};

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * SCH-10 (D4): the client's employer promotion, offered on their first visit invoice. It is a
 * pending line (not counted in the total) until staff confirm it at checkout.
 */
export default function EmployerPromotionLine({ invoice, onInvoiceChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = invoice?.pendingEmployerPromotion;
  if (!invoice || !pending || invoice.status !== 'open') return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onInvoiceChange(await confirmEmployerPromotion(invoice.id));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="employer-promo-line" data-testid="employer-promotion-line">
      <div className="employer-promo-line__text">
        <strong>
          {pending.label} –{money(pending.amount)}
        </strong>
        <span>
          {pending.companyName} · {pending.promotionName}. Pending: confirm to apply it to this
          invoice (once per client).
        </span>
        {error ? (
          <span className="employer-promo-line__error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="employer-promo-line__confirm"
        disabled={busy}
        onClick={() => void confirm()}
      >
        {busy ? 'Applying…' : 'Confirm promotion'}
      </button>
    </div>
  );
}
