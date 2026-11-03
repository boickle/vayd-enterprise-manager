import { useCallback, useEffect, useState } from 'react';
import { Check, CreditCard, ShieldCheck, X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import {
  authorizeEstimate,
  getEstimateForAppointment,
  hasLiveAuthorization,
  markEstimateDeclined,
  setEstimateLineDecision,
  settleEstimate,
  type EstimateLineDecision,
  type VisitEstimate,
  type VisitEstimateLine,
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

/** What the line adds to the bill, tax included. Covered lines add nothing. */
const lineCharge = (l: VisitEstimateLine) =>
  l.isCovered ? 0 : (Number(l.amount) || 0) + (Number(l.taxAmount) || 0);

/**
 * The quote, at checkout. Renders nothing unless a live estimate is attached to
 * this visit, so it stays out of the way on ordinary appointments.
 *
 * Owner decision D4: the items are listed and staff mark each Accept or Decline
 * with the family present, like the Room Loader. Declined items never reach the
 * invoice, and only the accepted total is taken from the hold.
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
  const [busy, setBusy] = useState<'authorize' | 'settle' | 'decide' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown after the panel's work is done: a lapsed hold (EMR-12), or a declined estimate. */
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    if (appointmentId == null) {
      setEstimate(null);
      return;
    }
    setNotice(null);
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

  const decide = useCallback(
    async (lineIds: string[], decision: EstimateLineDecision | null) => {
      if (!estimate || !lineIds.length) return;
      setBusy('decide');
      setError(null);
      try {
        let next = estimate;
        for (const lineId of lineIds) {
          next = await setEstimateLineDecision(estimate.id, lineId, decision);
        }
        setEstimate(next);
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [estimate]
  );

  const settle = useCallback(async () => {
    if (!estimate) return;
    setBusy('settle');
    setError(null);
    try {
      const invoice = await settleEstimate(estimate.id);
      onSettled?.(invoice.id);
      // The hold had lapsed at Stripe: the saved card was charged instead. Staff should know.
      setNotice(invoice.holdNotice ?? null);
      setEstimate(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [estimate, onSettled]);

  /** The family said no at the door: release the hold, withdraw the consent, charge nothing. */
  const decline = useCallback(async () => {
    if (!estimate) return;
    setBusy('decline');
    setError(null);
    try {
      await markEstimateDeclined(estimate.id);
      setConfirmDecline(false);
      setNotice(
        'Estimate declined. The card hold was released and nothing was charged. The signed consent is marked withdrawn. Cancel the visit if it will not go ahead.'
      );
      setEstimate(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [estimate]);

  if (!estimate) {
    return notice ? (
      <div className="estimate-settle estimate-settle-notice" role="status" data-testid="estimate-settle-notice">
        {notice}
      </div>
    ) : null;
  }

  const held = hasLiveAuthorization(estimate);
  const total = Number(estimate.total) || 0;
  const heldAmount = Number(estimate.authorizedAmount) || 0;
  const hasCard = Boolean(estimate.savedPaymentMethodId);
  const lines = estimate.lines ?? [];
  const undecided = lines.filter((l) => l.decision !== 'accepted' && l.decision !== 'declined');
  const allDecided = undecided.length === 0;
  const acceptedTotal = lines
    .filter((l) => l.decision === 'accepted')
    .reduce((sum, l) => sum + lineCharge(l), 0);
  const showPets = new Set(lines.map((l) => l.patientId ?? null)).size > 1;

  return (
    <div className="estimate-settle">
      <div className="estimate-settle-head">
        <span>Estimate given to the family</span>
        <strong>{money(total)}</strong>
      </div>

      <p className="estimate-settle-status">
        {held
          ? allDecided && acceptedTotal + 0.005 < heldAmount
            ? `${money(heldAmount)} is held on their card. Only the accepted ${money(
                acceptedTotal
              )} is taken; the rest of the hold is released.`
            : heldAmount + 0.005 < total
              ? `${money(heldAmount)} is held on their card. The rest is charged when you take payment.`
              : `${money(heldAmount)} is held on their card. Nothing has been taken yet.`
          : hasCard
            ? 'A card is saved. No hold has been placed yet.'
            : 'No card on file for this estimate.'}
      </p>

      {lines.length > 0 && (
        <div className="estimate-settle-lines" data-testid="estimate-settle-lines">
          <p className="estimate-settle-hint">
            Go through each item with the family and mark it Accept or Decline. Declined items are
            not billed.
          </p>
          {lines.map((l) => {
            const accepted = l.decision === 'accepted';
            const declined = l.decision === 'declined';
            return (
              <div
                key={l.id}
                className={`estimate-settle-line${declined ? ' is-declined' : ''}${
                  accepted ? ' is-accepted' : ''
                }`}
                data-testid="estimate-settle-line"
              >
                <div className="estimate-settle-line-name">
                  <span>{l.description}</span>
                  {showPets && l.patientName ? <em>{l.patientName}</em> : null}
                  {Number(l.qty) !== 1 ? <em>× {Number(l.qty)}</em> : null}
                </div>
                <span className="estimate-settle-line-amount">
                  {l.isCovered ? 'Covered' : money(lineCharge(l))}
                </span>
                <div
                  className="estimate-settle-line-choice"
                  role="group"
                  aria-label={l.description}
                >
                  <button
                    type="button"
                    className={`estimate-settle-choice accept${accepted ? ' on' : ''}`}
                    aria-pressed={accepted}
                    disabled={disabled || busy != null}
                    onClick={() => void decide([l.id], accepted ? null : 'accepted')}
                  >
                    <Check size={13} /> Accept
                  </button>
                  <button
                    type="button"
                    className={`estimate-settle-choice decline${declined ? ' on' : ''}`}
                    aria-pressed={declined}
                    disabled={disabled || busy != null}
                    onClick={() => void decide([l.id], declined ? null : 'declined')}
                  >
                    <X size={13} /> Decline
                  </button>
                </div>
              </div>
            );
          })}
          <div className="estimate-settle-accepted">
            <span>Accepted</span>
            <strong data-testid="estimate-settle-accepted-total">{money(acceptedTotal)}</strong>
          </div>
          {!allDecided && (
            <button
              type="button"
              className="soap-btn ghost estimate-settle-accept-rest"
              disabled={disabled || busy != null}
              onClick={() =>
                void decide(
                  undecided.map((l) => l.id),
                  'accepted'
                )
              }
            >
              <Check size={14} /> Accept the{' '}
              {undecided.length === 1 ? 'remaining item' : `${undecided.length} remaining items`}
            </button>
          )}
        </div>
      )}

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
        {!confirmDecline && (
          <button
            type="button"
            className="soap-btn ghost danger"
            disabled={disabled || busy != null}
            title="The family decided not to go ahead. Releases the hold; nothing is charged."
            onClick={() => setConfirmDecline(true)}
          >
            <X size={14} /> Family declined
          </button>
        )}
        <button
          type="button"
          className="soap-btn"
          disabled={disabled || busy != null || total <= 0 || !allDecided}
          title={
            !allDecided
              ? 'Accept or decline every item first'
              : hasCard
                ? ''
                : 'Take a card before collecting'
          }
          onClick={() => void settle()}
        >
          <CreditCard size={14} />
          {busy === 'settle' ? 'Collecting…' : 'Convert to invoice & take payment'}
        </button>
      </div>

      {confirmDecline && (
        <div className="estimate-settle-decline" role="group" aria-label="Confirm the family declined">
          <p>
            Decline this estimate? {held ? `The ${money(heldAmount)} hold comes off their card` : 'Nothing is held'},
            nothing is charged, and the signed consent is marked withdrawn.
          </p>
          <button
            type="button"
            className="soap-btn danger"
            disabled={disabled || busy != null}
            onClick={() => void decline()}
          >
            {busy === 'decline' ? 'Declining…' : 'Yes, the family declined'}
          </button>
          <button
            type="button"
            className="soap-btn ghost"
            disabled={busy != null}
            onClick={() => setConfirmDecline(false)}
          >
            Keep the estimate
          </button>
        </div>
      )}

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
