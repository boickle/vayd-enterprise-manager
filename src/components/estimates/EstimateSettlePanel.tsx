import { useCallback, useEffect, useState } from 'react';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import {
  authorizeEstimate,
  getEstimateForAppointment,
  hasLiveAuthorization,
  settleEstimate,
  type VisitEstimate,
} from '../../api/visitEstimates';
import EstimateCardModal from './EstimateCardModal';
import './EstimateSettlePanel.css';

type Props = {
  appointmentId: number | null;
  clientName?: string | null;
  clientEmail?: string | null;
  disabled?: boolean;
  /** The bill this estimate became, so the parent can reload it. */
  onSettled?: (invoiceId: string) => void;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * The quote, at checkout. Renders nothing unless a live estimate is attached to
 * this visit, so it stays out of the way on ordinary appointments.
 *
 * The hold is normally placed by the nightly sweep; the button here is for the
 * visit that got moved up, or the card that arrived late.
 */
export default function EstimateSettlePanel({
  appointmentId,
  clientName,
  clientEmail,
  disabled,
  onSettled,
}: Props) {
  const [estimate, setEstimate] = useState<VisitEstimate | null>(null);
  const [busy, setBusy] = useState<'authorize' | 'settle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    if (appointmentId == null) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    void getEstimateForAppointment(appointmentId)
      .then((next) => {
        if (!cancelled) setEstimate(next);
      })
      .catch(() => {
        if (!cancelled) setEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  const authorize = useCallback(async () => {
    if (!estimate) return;
    setBusy('authorize');
    setError(null);
    try {
      setEstimate(await authorizeEstimate(estimate.id));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [estimate]);

  const settle = useCallback(async () => {
    if (!estimate) return;
    setBusy('settle');
    setError(null);
    try {
      const invoice = await settleEstimate(estimate.id);
      onSettled?.(invoice.id);
      setEstimate(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [estimate, onSettled]);

  if (!estimate) return null;

  const held = hasLiveAuthorization(estimate);
  const total = Number(estimate.total) || 0;
  const heldAmount = Number(estimate.authorizedAmount) || 0;
  const hasCard = Boolean(estimate.savedPaymentMethodId);

  return (
    <div className="estimate-settle">
      <div className="estimate-settle-head">
        <span>Estimate given to the family</span>
        <strong>{money(total)}</strong>
      </div>

      <p className="estimate-settle-status">
        {held
          ? heldAmount + 0.005 < total
            ? `${money(heldAmount)} is held on their card. The rest is charged when you take payment.`
            : `${money(heldAmount)} is held on their card. Nothing has been taken yet.`
          : hasCard
            ? 'A card is saved. No hold has been placed yet.'
            : 'No card on file for this estimate.'}
      </p>

      {error && <div className="soap-error">{error}</div>}

      <div className="estimate-settle-actions">
        {!hasCard && (
          <button
            type="button"
            className="soap-btn ghost"
            disabled={disabled || busy != null}
            onClick={() => setCardOpen(true)}
          >
            <CreditCard size={14} /> Take card
          </button>
        )}
        {!held && hasCard && (
          <button
            type="button"
            className="soap-btn ghost"
            disabled={disabled || busy != null || total <= 0}
            onClick={() => void authorize()}
          >
            <ShieldCheck size={14} />
            {busy === 'authorize' ? 'Placing hold…' : 'Authorize now'}
          </button>
        )}
        <button
          type="button"
          className="soap-btn"
          disabled={disabled || busy != null || total <= 0}
          title={hasCard ? '' : 'Take a card before collecting'}
          onClick={() => void settle()}
        >
          <CreditCard size={14} />
          {busy === 'settle' ? 'Collecting…' : 'Convert to invoice & take payment'}
        </button>
      </div>

      {cardOpen && (
        <EstimateCardModal
          estimateId={estimate.id}
          clientName={clientName}
          clientEmail={clientEmail}
          onClose={() => setCardOpen(false)}
          onSaved={setEstimate}
        />
      )}
    </div>
  );
}
