import { useCallback, useEffect, useState } from 'react';
import { CreditCard, FileText, ShieldCheck, X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import {
  authorizeEstimate,
  convertEstimateToInvoice,
  getEstimateForAppointment,
  getEstimateSettlePreview,
  hasLiveAuthorization,
  markEstimateDeclined,
  settleEstimate,
  type EstimateSettlePreview,
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
  /** Changes whenever the visit invoice changes, so the final-bill figure is read again. */
  invoiceKey?: string | number | null;
  /** The bill this estimate became, so the parent can reload it. */
  onSettled?: (invoiceId: string) => void;
};

export const RUN_PAYMENT_LABEL = 'Run Payment from Authorization';

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** What the line adds to the bill, tax included. Covered lines add nothing. */
const lineCharge = (l: VisitEstimateLine) =>
  l.isCovered ? 0 : (Number(l.amount) || 0) + (Number(l.taxAmount) || 0);

/**
 * The checkout bubble for a euthanasia estimate with a card authorization (owner decision,
 * Nov 3, 2026): what the owner approved and when, and what the button will take.
 */
export function authorizationBubbleText(preview: EstimateSettlePreview): string[] {
  const signed = preview.consentSignedAt ? ` on ${longDate(preview.consentSignedAt)}` : '';
  const lines = [
    `This owner approved ${money(preview.authorizedAmount)}${signed} — it will be charged when you click "${RUN_PAYMENT_LABEL}".`,
  ];
  if (preview.difference > 0.005) {
    lines.push(
      `An additional ${money(preview.difference)} will be charged to the same card when you click the button.`
    );
  } else if (preview.difference < -0.005) {
    lines.push(`${money(-preview.difference)} less than authorized — the rest of the hold is released.`);
  }
  return lines;
}

/**
 * The quote, at checkout. Renders nothing unless a live estimate is attached to this visit.
 *
 * Owner decisions (Nov 3, 2026): there is no per-item Accept / Decline here. The family chose their
 * items on the consent form (or staff added or removed them by hand), so every line on the quote is
 * billed. Only a euthanasia estimate takes a card: for those the bubble says what the owner
 * approved, and money moves only when staff click "Run Payment from Authorization". Any other
 * estimate is informational: its items can be copied to the invoice, and payment is taken at
 * checkout as usual.
 *
 * The hold is normally placed by the sweep about a day before the visit; "Authorize now" is for
 * the visit that got moved up, or the card that arrived late.
 */
export default function EstimateSettlePanel({
  appointmentId,
  clientName,
  clientEmail,
  disabled,
  invoiceKey,
  onSettled,
}: Props) {
  const [estimate, setEstimate] = useState<VisitEstimate | null>(null);
  const [preview, setPreview] = useState<EstimateSettlePreview | null>(null);
  const [busy, setBusy] = useState<'authorize' | 'settle' | 'convert' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown after the panel's work is done: a lapsed hold (EMR-12), nothing to bill, or a decline. */
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

  const euthanasia = estimate?.isEuthanasia === true;
  const held = hasLiveAuthorization(estimate);
  const previewKey = estimate
    ? `${estimate.id}|${estimate.total}|${estimate.authorizedAmount}|${estimate.lastChargeStatus}|${
        estimate.lines?.length ?? 0
      }|${invoiceKey ?? ''}`
    : '';

  useEffect(() => {
    const id = estimate?.id;
    if (!id || !euthanasia || !held) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void getEstimateSettlePreview(id)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
    // previewKey covers every estimate field the preview depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, euthanasia, held]);

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
      if (invoice.id) onSettled?.(invoice.id);
      // The hold had lapsed (the saved card was charged instead), or nothing was left to bill.
      setNotice(invoice.holdNotice ?? null);
      setEstimate(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [estimate, onSettled]);

  /** Informational estimate: copy its items onto the visit invoice. Nothing is charged. */
  const convert = useCallback(async () => {
    if (!estimate) return;
    setBusy('convert');
    setError(null);
    try {
      const invoice = await convertEstimateToInvoice(estimate.id);
      onSettled?.(invoice.id);
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

  const total = Number(estimate.total) || 0;
  const heldAmount = Number(estimate.authorizedAmount) || 0;
  const hasCard = Boolean(estimate.savedPaymentMethodId);
  const lines = estimate.lines ?? [];
  const showPets = new Set(lines.map((l) => l.patientId ?? null)).size > 1;

  const lineList =
    lines.length > 0 ? (
      <div className="estimate-settle-lines" data-testid="estimate-settle-lines">
        {lines.map((l) => (
          <div key={l.id} className="estimate-settle-line" data-testid="estimate-settle-line">
            <div className="estimate-settle-line-name">
              <span>{l.description}</span>
              {showPets && l.patientName ? <em>{l.patientName}</em> : null}
              {Number(l.qty) !== 1 ? <em>× {Number(l.qty)}</em> : null}
            </div>
            <span className="estimate-settle-line-amount">
              {l.isCovered ? 'Covered' : money(lineCharge(l))}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="estimate-settle-hint">No items are left on this estimate.</p>
    );

  if (!euthanasia) {
    return (
      <div className="estimate-settle" data-testid="estimate-settle-informational">
        <div className="estimate-settle-head">
          <span>Estimate given to the family</span>
          <strong>{money(total)}</strong>
        </div>
        <p className="estimate-settle-status">
          For information only: no card is held for this estimate. Take payment at checkout as usual.
        </p>
        {lineList}
        {error && <div className="soap-error">{error}</div>}
        {lines.length > 0 && (
          <div className="estimate-settle-actions">
            <button
              type="button"
              className="soap-btn ghost"
              disabled={disabled || busy != null}
              onClick={() => void convert()}
            >
              <FileText size={14} />
              {busy === 'convert' ? 'Adding…' : 'Add estimate items to the invoice'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="estimate-settle">
      <div className="estimate-settle-head">
        <span>Estimate given to the family</span>
        <strong>{money(total)}</strong>
      </div>

      {held && preview ? (
        <div className="estimate-settle-bubble" role="note" data-testid="estimate-authorization-bubble">
          {authorizationBubbleText(preview).map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      ) : (
        <p className="estimate-settle-status">
          {held
            ? `${money(heldAmount)} is held on their card. Nothing has been taken yet.`
            : hasCard
              ? 'A card is saved. No hold has been placed yet.'
              : 'No card on file for this estimate.'}
        </p>
      )}

      {lineList}

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
          disabled={disabled || busy != null}
          title={hasCard ? '' : 'Take a card before collecting'}
          onClick={() => void settle()}
        >
          <CreditCard size={14} />
          {busy === 'settle' ? 'Collecting…' : RUN_PAYMENT_LABEL}
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
