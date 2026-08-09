import { useState, type ReactNode } from 'react';
import { CreditCard, Receipt, RotateCcw, Smartphone, ShieldCheck, X } from 'lucide-react';
import {
  chargeSavedCard,
  createTerminalPaymentIntent,
  deleteOrder,
  reopenInvoice,
  updateOrder,
  voidInvoice,
  type EncounterOrder,
  type VisitInvoice,
  type VisitInvoiceLine,
} from '../../api/visitWorkflow';

type Props = {
  /** Needed to delete the encounter order behind an invoice line. */
  encounterId?: string | null;
  invoice: VisitInvoice | null;
  /** Used to show / edit client notes and price overrides on checkout lines. */
  orders?: EncounterOrder[];
  disabled?: boolean;
  /** Rendered below the payment actions — the follow-up question, asked while
   * the client is still here (see CheckoutFollowUpPrompt). */
  followUpSlot?: ReactNode;
  onInvoiceChange: (invoice: VisitInvoice) => void;
  onOpenEuthanasiaPrepay: () => void;
  /** After removing a line's order, drop it from local order state and refresh the invoice. */
  onOrderRemoved?: (orderId: string) => void;
  onOrdersChange?: (orders: EncounterOrder[]) => void;
};

function money(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/**
 * Tech-run checkout (spec §7). Runs off the invoice and is independent of SOAP
 * completion — the tech can check the client out before the doctor finishes
 * notes, and the doctor can sign the chart before checkout ends.
 *
 * Payment is the invoice's lock: it finalizes and publishes charges to the chart,
 * so there is no separate Finalize step. Checkout never marks the visit completed
 * (that is End Visit on the schedule) and never mutates the visit (spec §2).
 */
export default function VisitCheckoutPanel({
  encounterId,
  invoice,
  orders = [],
  disabled,
  followUpSlot,
  onInvoiceChange,
  onOpenEuthanasiaPrepay,
  onOrderRemoved,
  onOrdersChange,
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

  const voidInv = () =>
    run('void', async () => {
      if (!invoice) return;
      const ok = window.confirm(
        'Void this whole invoice? Every charge comes off the bill and no payment can be taken until it is reopened. Nothing has been collected yet.'
      );
      if (!ok) return;
      onInvoiceChange(await voidInvoice(invoice.id));
      setNote('Invoice voided. Reopen it to take payment.');
    });

  const reopen = () =>
    run('reopen', async () => {
      if (!invoice) return;
      onInvoiceChange(await reopenInvoice(invoice.id));
      setNote('Invoice reopened — charges are editable and payment can be taken.');
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
      if (pi.invoice) onInvoiceChange(pi.invoice);
      setNote(
        `Tap to Pay ready (PaymentIntent ${pi.id}). Connect the Stripe reader to collect at card-present rates.`
      );
    });

  const status = invoice?.status ?? 'open';
  const isPaid = status === 'paid';
  const isVoid = status === 'void';
  const hasSavedCard = Boolean(invoice?.savedPaymentMethodId);
  const canEditLines = Boolean(encounterId) && !isPaid && !isVoid && status === 'open';

  const removeLine = (line: VisitInvoiceLine) => {
    if (!encounterId || !line.orderId || !canEditLines) return;
    void run(`remove:${line.id}`, async () => {
      await deleteOrder(encounterId, line.orderId!);
      onOrderRemoved?.(line.orderId!);
    });
  };

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
              .map((l) => {
                const order =
                  l.orderId != null
                    ? orders.find((o) => o.id === l.orderId) ?? null
                    : null;
                const showClientNote = order?.catalogFlags?.hasClientNotes === true;
                const allowPrice = order?.catalogFlags?.allowPriceChange === true;
                return (
                  <div key={l.id} className="soap-invoice-line" style={{ flexWrap: 'wrap' }}>
                    <span className="soap-invoice-line-desc">
                      {l.isCovered ? (
                        <span
                          className="soap-invoice-heart"
                          title="Membership covered"
                          aria-label="Membership covered"
                        >
                          ❤️{' '}
                        </span>
                      ) : null}
                      {l.description}
                      {Number(l.qty) > 1 ? ` ×${Number(l.qty)}` : ''}
                    </span>
                    <span className="soap-invoice-line-amt">
                      {l.isCovered ? 'covered' : money(l.amount)}
                    </span>
                    {canEditLines && l.orderId && (
                      <button
                        type="button"
                        className="soap-invoice-line-remove"
                        title="Remove from checkout"
                        disabled={disabled || busy != null}
                        onClick={() => removeLine(l)}
                      >
                        <X size={14} />
                      </button>
                    )}
                    {showClientNote && order && encounterId && canEditLines && (
                      <label
                        style={{
                          flex: '1 1 100%',
                          fontSize: 12,
                          color: '#475569',
                          marginTop: 4,
                        }}
                      >
                        Client note
                        <textarea
                          className="soap-input"
                          rows={2}
                          defaultValue={order.clientNote ?? ''}
                          disabled={disabled || busy != null}
                          onBlur={(e) => {
                            const next = e.target.value.trim() || null;
                            if ((order.clientNote ?? null) === next) return;
                            void (async () => {
                              const updated = await updateOrder(encounterId, order.id, {
                                clientNote: next,
                              });
                              onOrdersChange?.(
                                orders.map((o) => (o.id === order.id ? updated : o))
                              );
                            })();
                          }}
                          style={{ marginTop: 4, width: '100%', resize: 'vertical' }}
                        />
                      </label>
                    )}
                    {allowPrice && order && encounterId && canEditLines && !l.isCovered && (
                      <label
                        style={{
                          flex: '1 1 100%',
                          fontSize: 12,
                          color: '#475569',
                          marginTop: 4,
                          maxWidth: 160,
                        }}
                      >
                        Unit price
                        <input
                          className="soap-input"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={Number(order.unitPrice) || 0}
                          disabled={disabled || busy != null}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n) || n < 0) return;
                            if (Math.abs(n - Number(order.unitPrice)) < 0.0001) return;
                            void (async () => {
                              const updated = await updateOrder(encounterId, order.id, {
                                unitPrice: n,
                              });
                              onOrdersChange?.(
                                orders.map((o) => (o.id === order.id ? updated : o))
                              );
                            })();
                          }}
                          style={{ marginTop: 4, width: '100%' }}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
          </div>
          <div className="soap-invoice-totals">
            {Number(invoice.membershipAdjustments) !== 0 && (
              <div className="soap-invoice-row covered">
                <span>Membership covered</span>
                <span>{money(invoice.membershipAdjustments)}</span>
              </div>
            )}
            {Number(invoice.subtotal) !== Number(invoice.total) && (
              <div className="soap-invoice-row">
                <span>Subtotal</span>
                <span>{money(invoice.subtotal)}</span>
              </div>
            )}
            {Number(invoice.taxTotal) > 0 && (
              <div className="soap-invoice-row">
                <span>Sales tax</span>
                <span>{money(invoice.taxTotal)}</span>
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
          {isVoid && (
            <p className="soap-hint">
              This invoice is voided, so no payment can be taken and charges are locked. Nothing was
              collected. Reopen it to correct the bill and take payment.
            </p>
          )}

          <div className="soap-checkout-actions">
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
                title="Cancel this entire bill. Nothing has been collected yet."
                onClick={voidInv}
              >
                Void invoice
              </button>
            )}
            {isVoid && (
              <button
                type="button"
                className="soap-btn"
                disabled={disabled || busy != null}
                title="Back to open so charges can be edited and payment taken"
                onClick={reopen}
              >
                <RotateCcw size={14} /> Reopen invoice
              </button>
            )}
          </div>
        </>
      )}

      {followUpSlot}

      <div className="soap-visit-complete">
        <p className="soap-hint">
          Payment locks the invoice and posts these charges to the chart. Ending the visit on the
          schedule and signing the SOAP are separate steps — neither one waits on this.
        </p>
      </div>
    </div>
  );
}
