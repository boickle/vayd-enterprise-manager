import { useEffect, useState, type ReactNode } from 'react';
import { CreditCard, Receipt, RotateCcw, Smartphone, ShieldCheck, X } from 'lucide-react';
import {
  VISIT_WORKFLOW_PRACTICE_ID,
  cancelTerminalCheckout,
  chargeSavedCard,
  deleteOrder,
  getInvoice,
  reopenInvoice,
  startTerminalCheckout,
  updateOrder,
  voidInvoice,
  type EncounterOrder,
  type TerminalReaderCatalog,
  type VisitInvoice,
  type VisitInvoiceLine,
} from '../../api/visitWorkflow';
import { subscribeTerminalCheckout } from '../../utils/terminalCheckoutRealtime';
import { appConfirm } from '../../utils/appDialog';
import TerminalReaderPicker from './TerminalReaderPicker';

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

/** Nest returns the useful text in `response.data.message`, not `Error.message`. */
function apiErrorMessage(e: unknown): string {
  const res = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const message = res?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return e instanceof Error ? e.message : 'Action failed';
}

/**
 * Tech-run checkout (spec §7). Runs off the invoice and is independent of SOAP
 * completion — the tech can check the client out before the doctor finishes
 * notes, and the doctor can sign the chart before checkout ends.
 *
 * Payment is the invoice's lock: it finalizes and publishes charges to the chart,
 * so there is no separate Finalize step. Checkout never marks the visit completed
 * (that is End Visit on the schedule) and never mutates the visit (spec §2).
 *
 * Tap to Pay starts a Scout Terminal checkout job; the reader app collects.
 * Invoice is marked paid via Stripe webhook (socket `invoice.paid` refreshes UI).
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
  const [activeCheckoutId, setActiveCheckoutId] = useState<string | null>(null);
  const [readerCatalog, setReaderCatalog] = useState<TerminalReaderCatalog | null>(null);

  useEffect(() => {
    if (!invoice?.id) return;
    const invoiceId = invoice.id;
    return subscribeTerminalCheckout({
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      onInvoicePaid: (payload) => {
        if (payload.invoiceId !== invoiceId) return;
        setActiveCheckoutId(null);
        setNote('Payment received on Scout Terminal — invoice marked paid.');
        onInvoiceChange({
          ...invoice,
          status: 'paid',
          amountPaid: invoice.total,
          paidAt: new Date().toISOString(),
          stripePaymentIntentId: payload.paymentIntentId,
          lastChargeStatus: 'succeeded',
        });
      },
    });
    // Re-subscribe when the open invoice id changes, not on every invoice field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const selectedReader =
    readerCatalog?.readers.find((r) => r.id === readerCatalog.selectedId) ?? null;
  const readerReady = Boolean(selectedReader?.online);

  // Socket fallback: while a reader job is live, poll until the invoice settles
  // so a dropped `invoice.paid` cannot leave this panel showing an open invoice.
  useEffect(() => {
    if (!activeCheckoutId || !invoice?.id) return;
    const invoiceId = invoice.id;
    let stopped = false;

    const timer = window.setInterval(async () => {
      try {
        const fresh = await getInvoice(invoiceId);
        if (stopped || fresh.status !== 'paid') return;
        setActiveCheckoutId(null);
        setNote('Payment received on Scout Terminal — invoice marked paid.');
        onInvoiceChange(fresh);
      } catch {
        /* keep polling; a transient failure should not end the wait */
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCheckoutId, invoice?.id]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const voidInv = () =>
    run('void', async () => {
      if (!invoice) return;
      const ok = await appConfirm({
        title: 'Void invoice?',
        message:
          'Void this whole invoice? Every charge comes off the bill and no payment can be taken until it is reopened. Nothing has been collected yet.',
        confirmLabel: 'Void',
        danger: true,
      });
      if (!ok) return;
      if (activeCheckoutId) {
        await cancelTerminalCheckout(activeCheckoutId).catch(() => undefined);
        setActiveCheckoutId(null);
      }
      onInvoiceChange(
        await voidInvoice(invoice.id, { reason: 'Voided from visit checkout' }),
      );
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
      try {
        const session = await startTerminalCheckout(invoice.id);
        setActiveCheckoutId(session.checkoutId);
        if (session.invoice) onInvoiceChange(session.invoice);
        const dollars = (session.amountCents / 100).toFixed(2);
        const dest = selectedReader?.label ?? 'the selected reader';
        setNote(
          `Sent $${dollars} to ${dest}. Present the card on the reader — this screen updates when payment succeeds.`
        );
      } catch (e) {
        // The reader may have collected while this panel still showed the
        // invoice as open (missed `invoice.paid`). Re-sync instead of erroring.
        if (!/already paid/i.test(apiErrorMessage(e))) throw e;
        setActiveCheckoutId(null);
        onInvoiceChange(await getInvoice(invoice.id));
        setNote('This invoice was already paid on Scout Terminal.');
      }
    });

  const cancelReader = () =>
    run('cancel-terminal', async () => {
      if (!activeCheckoutId) return;
      await cancelTerminalCheckout(activeCheckoutId);
      setActiveCheckoutId(null);
      setNote('Canceled the Terminal checkout job.');
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

          {!isPaid && !isVoid && (
            <TerminalReaderPicker
              disabled={disabled || busy != null}
              onCatalog={setReaderCatalog}
            />
          )}

          <div className="soap-checkout-actions">
            {!isPaid && !isVoid && (
              <>
                <button
                  type="button"
                  className="soap-btn"
                  disabled={disabled || busy != null || !readerReady}
                  title={
                    !selectedReader
                      ? 'Select a reader first'
                      : !readerReady
                        ? 'That reader is offline'
                        : ''
                  }
                  onClick={tapToPay}
                >
                  <Smartphone size={14} /> Tap to Pay
                </button>
                {activeCheckoutId ? (
                  <button
                    type="button"
                    className="soap-btn ghost"
                    disabled={disabled || busy != null}
                    onClick={cancelReader}
                  >
                    Cancel reader
                  </button>
                ) : null}
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
          {!isPaid && !isVoid && (
            <p className="soap-hint">
              {selectedReader
                ? `Tap to Pay goes to ${selectedReader.label} until you pick a different reader.`
                : 'Select a reader once — Scout Terminal or a WisePOS. That choice is saved for your account.'}
            </p>
          )}
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
