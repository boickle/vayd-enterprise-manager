import { useEffect, useState, type ReactNode } from 'react';
import { Check, CreditCard, Receipt, RotateCcw, Smartphone, ShieldCheck, X } from 'lucide-react';
import {
  VISIT_WORKFLOW_PRACTICE_ID,
  addCounterInvoiceLine,
  cancelTerminalCheckout,
  authorizeSavedCard,
  captureAuthorization,
  chargeSavedCard,
  deleteOrder,
  getInvoice,
  getOrderClinicalDetails,
  removeCounterInvoiceLine,
  reopenInvoice,
  saveOrderPrescription,
  startTerminalCheckout,
  updateCounterInvoiceLine,
  updateOrder,
  voidInvoice,
  type EncounterOrder,
  type OrderPrescription,
  type OrderVaccination,
  type TerminalReaderCatalog,
  type VisitInvoice,
  type VisitInvoiceLine,
} from '../../api/visitWorkflow';
import { subscribeTerminalCheckout } from '../../utils/terminalCheckoutRealtime';
import { appConfirm } from '../../utils/appDialog';
import TerminalReaderPicker from './TerminalReaderPicker';
import CheckoutInventoryBranchField from './CheckoutInventoryBranchField';
import SendRxLabelButton from './SendRxLabelButton';
import MailInvoiceLineCheckbox, {
  cancelMailOrdersForInvoiceLines,
  isMailOrderShipped,
  matchingMailOrderForLine,
  shippedMailMessage,
} from './MailInvoiceLineCheckbox';
import { listMailOrders, type MailOrder } from '../../api/onlineStore';
import { attachShippingLines, isInvoiceShippingLine } from '../../utils/mailShippingTypes';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import StockLotPicker from '../inventory/StockLotPicker';

export type CheckoutRxLabelContext = {
  patientId?: number | null;
  patientName: string;
  species?: string | null;
  ownerName: string;
  veterinarianName?: string | null;
  veterinarianLicense?: string | null;
  veterinarianEmployeeId?: number | null;
};

type Props = {
  /** Needed to delete the encounter order behind an invoice line. */
  encounterId?: string | null;
  invoice: VisitInvoice | null;
  /** Used to show / edit client notes and price overrides on checkout lines. */
  orders?: EncounterOrder[];
  disabled?: boolean;
  rxLabel?: CheckoutRxLabelContext | null;
  /** Rendered below the payment actions — the follow-up question, asked while
   * the client is still here (see CheckoutFollowUpPrompt). */
  followUpSlot?: ReactNode;
  onInvoiceChange: (invoice: VisitInvoice) => void;
  onOpenEuthanasiaPrepay: () => void;
  /** After removing a line's order, drop it from local order state and refresh the invoice. */
  onOrderRemoved?: (orderId: string) => void;
  onOrdersChange?: (orders: EncounterOrder[]) => void;
};

function isCheckoutRxLine(line: VisitInvoiceLine, order: EncounterOrder | null): boolean {
  if (order?.kind === 'med') return true;
  return Boolean(
    line.instructions?.trim() ||
      line.catalogInstructions?.trim() ||
      line.refillCount != null ||
      line.catalogRefill != null
  );
}

function money(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function invoiceMailPaymentStatus(inv: VisitInvoice): 'paid' | 'awaiting_payment' {
  const due = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
  return due <= 0.009 ? 'paid' : 'awaiting_payment';
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
  rxLabel,
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
  const [prescriptionsByOrderId, setPrescriptionsByOrderId] = useState<
    Record<string, OrderPrescription>
  >({});
  const [vaccineOrderIds, setVaccineOrderIds] = useState<ReadonlySet<string>>(new Set());
  const [vaccinationsByOrderId, setVaccinationsByOrderId] = useState<
    Record<string, OrderVaccination>
  >({});
  const [mailOrders, setMailOrders] = useState<MailOrder[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listMailOrders(VISIT_WORKFLOW_PRACTICE_ID)
      .then((rows) => {
        if (!cancelled) setMailOrders(rows);
      })
      .catch(() => {
        if (!cancelled) setMailOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice?.id]);

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

  useEffect(() => {
    if (!encounterId) return;
    let canceled = false;
    void getOrderClinicalDetails(encounterId)
      .then((details) => {
        if (canceled) return;
        const next: Record<string, OrderPrescription> = {};
        for (const rx of details.prescriptions) {
          if (rx.encounterOrderId) next[rx.encounterOrderId] = rx;
        }
        setPrescriptionsByOrderId(next);
        setVaccineOrderIds(new Set(details.vaccineOrderIds));
        const shots: Record<string, OrderVaccination> = {};
        for (const shot of details.vaccinations) {
          if (shot.encounterOrderId) shots[shot.encounterOrderId] = shot;
        }
        setVaccinationsByOrderId(shots);
      })
      .catch(() => {
        if (!canceled) {
          setPrescriptionsByOrderId({});
          setVaccineOrderIds(new Set());
          setVaccinationsByOrderId({});
        }
      });
    return () => {
      canceled = true;
    };
  }, [encounterId, invoice?.id]);

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

  const authorizeCard = () =>
    run('authorize', async () => {
      if (!invoice) return;
      onInvoiceChange(await authorizeSavedCard(invoice.id));
      setNote('Card authorized. Future appointments stay on the books until you convert this to payment.');
    });

  const convertAuthorization = () =>
    run('capture', async () => {
      if (!invoice) return;
      onInvoiceChange(await captureAuthorization(invoice.id));
      setNote('Authorization converted to payment.');
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
  const branchReady =
    invoice?.status !== 'open' ||
    (invoice.inventoryBranchId != null && invoice.inventoryLocationId != null);
  const canEditLines = Boolean(encounterId) && !isPaid && !isVoid && status === 'open';
  const payDisabled = disabled || busy != null || !branchReady;

  const checkoutLineGroups = attachShippingLines(
    (invoice?.lines ?? []).filter((row) => !row.isDeleted),
    (row) => isInvoiceShippingLine(row),
    (row) => String(row.catalogItemType ?? '').toLowerCase() === 'inventory'
  );

  const shippedMailForLine = (line: VisitInvoiceLine): MailOrder | null => {
    if (!invoice) return null;
    const match = matchingMailOrderForLine(mailOrders, invoice.id, line);
    return match && isMailOrderShipped(match) ? match : null;
  };

  const removeLine = (line: VisitInvoiceLine) => {
    if (!encounterId || !line.orderId || !canEditLines) return;
    const shipped = shippedMailForLine(line);
    if (shipped) {
      setError(shippedMailMessage(shipped));
      return;
    }
    void run(`remove:${line.id}`, async () => {
      if (invoice) {
        const shippingIds = await cancelMailOrdersForInvoiceLines(invoice.id, [line]);
        for (const shippingId of shippingIds) {
          if (shippingId === line.id) continue;
          await removeCounterInvoiceLine(invoice.id, shippingId).catch(() => undefined);
        }
      }
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
          <span className="soap-invoice-badge euthanasia">
            {invoice.lastChargeStatus === 'requires_capture' ? 'authorized' : 'euthanasia auth'}
          </span>
        )}
      </div>

      {!invoice ? (
        <div className="soap-empty">
          No invoice yet — placing an order in the Plan opens one automatically.
        </div>
      ) : (
        <>
          <CheckoutInventoryBranchField
            invoice={invoice}
            disabled={disabled || busy != null}
            onInvoiceChange={onInvoiceChange}
            className="soap-checkout-branch"
            selectClassName="soap-select"
          />
          <div className="soap-invoice-lines">
            {[...checkoutLineGroups.parents, ...checkoutLineGroups.leftover].map((l) => {
                const order =
                  l.orderId != null
                    ? orders.find((o) => o.id === l.orderId) ?? null
                    : null;
                const showClientNote = order?.catalogFlags?.hasClientNotes === true;
                const allowPrice = order?.catalogFlags?.allowPriceChange === true;
                const recorded = l.orderId ? prescriptionsByOrderId[l.orderId] ?? null : null;
                const showRxLabel = Boolean(rxLabel) && isCheckoutRxLine(l, order);
                const instructions =
                  recorded?.instructions || l.instructions || l.catalogInstructions || '';
                const scriptApproved = Boolean(l.rxApprovedAt);
                const providerId = l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId ?? null;
                const attachedShipping = checkoutLineGroups.attached.get(l.id) ?? [];
                const mailed = matchingMailOrderForLine(mailOrders, invoice.id, l);
                const isVaccineLine = Boolean(order && vaccineOrderIds.has(order.id));
                const lotReady =
                  !l.trackLots ||
                  Boolean(mailed) ||
                  isVaccineLine ||
                  l.inventoryLotBalanceId != null;
                const lineReady = (order && vaccineOrderIds.has(order.id)
                  ? Boolean(vaccinationsByOrderId[order.id])
                  : showRxLabel
                    ? scriptApproved && Boolean(String(instructions).trim())
                    : isInvoiceShippingLine(l) ||
                        order?.catalogFlags?.excludeFromProduction === true
                      ? true
                      : l.providerEmployeeId != null || Boolean(l.orderId)) && lotReady;
                const mailBlockedReason = showRxLabel
                  ? providerId == null
                    ? 'Provider is required'
                    : !String(instructions).trim()
                      ? 'Enter the script first'
                      : !scriptApproved
                        ? 'Approve the script first'
                        : invoice.inventoryBranchId == null
                          ? 'Select a branch'
                          : invoice.inventoryLocationId == null
                            ? 'Select a fill location'
                            : null
                  : null;
                return (
                  <div
                    key={l.id}
                    className={`soap-invoice-line ${lineReady ? 'is-ready' : 'is-pending'}`}
                    style={{ flexWrap: 'wrap' }}
                  >
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
                      {lineReady ? (
                        <Check className="soap-invoice-line-check" size={14} aria-label="All set" />
                      ) : null}
                      {showRxLabel && canEditLines && !scriptApproved ? (
                        <button
                          type="button"
                          className="soap-dose-dymo"
                          disabled={disabled || busy != null || !String(instructions).trim() || providerId == null}
                          onClick={() => {
                            void updateCounterInvoiceLine(invoice.id, l.id, {
                              instructions: String(instructions).trim() || null,
                              rxApproved: true,
                            })
                              .then(onInvoiceChange)
                              .catch((e) => setError(apiErrorMessage(e)));
                          }}
                        >
                          Approve
                        </button>
                      ) : null}
                      {showRxLabel && scriptApproved ? (
                        <span className="soap-invoice-line-amt" style={{ fontWeight: 600, color: '#64748b' }}>
                          Approved
                          {l.rxApprovedByName ? ` by ${l.rxApprovedByName}` : ''}
                        </span>
                      ) : null}
                    </span>
                    <span className="soap-invoice-line-amt">
                      {l.isCovered ? 'covered' : money(l.amount)}
                    </span>
                    {canEditLines && l.orderId && (
                      <button
                        type="button"
                        className="soap-invoice-line-remove"
                        title={
                          shippedMailForLine(l)
                            ? shippedMailMessage(shippedMailForLine(l))
                            : 'Remove from checkout'
                        }
                        disabled={disabled || busy != null || Boolean(shippedMailForLine(l))}
                        onClick={() => removeLine(l)}
                      >
                        <X size={14} />
                      </button>
                    )}
                    {showRxLabel && rxLabel && (
                      <span className="soap-invoice-line-dymo">
                        <SendRxLabelButton
                          className="soap-dose-dymo"
                          disabled={!scriptApproved}
                          source={{
                            patientId: rxLabel.patientId,
                            patientName: rxLabel.patientName,
                            species: rxLabel.species,
                            ownerName: rxLabel.ownerName,
                            veterinarianName: rxLabel.veterinarianName,
                            veterinarianLicense: rxLabel.veterinarianLicense,
                            providerEmployeeId: rxLabel.veterinarianEmployeeId,
                            quantity: l.qty,
                            name: recorded?.name || order?.name || l.description,
                            strength: recorded?.strength,
                            instructions:
                              recorded?.instructions || l.instructions || l.catalogInstructions,
                            refill: recorded?.refill ?? l.refillCount ?? l.catalogRefill,
                            refillExpiration: recorded?.refillExpiration,
                            startDate: recorded?.startDate ?? invoice?.created,
                            rxNumber: recorded?.rxNumber,
                            acuity: recorded?.acuity,
                            onSavePrescription: async (value) => {
                              if (encounterId && l.orderId) {
                                const saved = await saveOrderPrescription(encounterId, l.orderId, {
                                  name: value.name,
                                  strength: value.strength,
                                  instructions: value.instructions,
                                  refill: value.refill,
                                  refillExpiration: value.refillExpiration || undefined,
                                  startDate: value.startDate || undefined,
                                  acuity:
                                    value.acuity === 'acute' || value.acuity === 'chronic'
                                      ? value.acuity
                                      : undefined,
                                  employeeId: rxLabel.veterinarianEmployeeId ?? undefined,
                                });
                                setPrescriptionsByOrderId((prev) => ({
                                  ...prev,
                                  [l.orderId!]: saved,
                                }));
                                if (saved.rxNumber != null) return { rxNumber: saved.rxNumber };
                              }
                              const rxNumber = await ensurePrintRxNumber({
                                existingNumber: recorded?.rxNumber,
                                patientId: rxLabel.patientId,
                                name: value.name,
                                inventoryItemId: order?.catalogItemId ?? l.catalogItemId,
                                instructions: value.instructions,
                                refill: value.refill,
                                startDate: value.startDate,
                                refillExpiration: value.refillExpiration,
                                acuity: value.acuity,
                              });
                              return { rxNumber };
                            },
                          }}
                        />
                      </span>
                    )}
                    {attachedShipping.map((ship) => (
                      <span
                        key={ship.id}
                        className="soap-invoice-line-dymo"
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
                      >
                        <span>{ship.description}</span>
                        <span className="soap-invoice-line-amt">
                          {ship.isCovered ? 'covered' : money(ship.amount)}
                        </span>
                      </span>
                    ))}
                    {l.trackLots && !mailed && !isVaccineLine ? (
                      <div style={{ flex: '1 1 100%' }}>
                        <StockLotPicker
                          practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                          inventoryItemId={l.stockInventoryItemId ?? l.catalogItemId ?? null}
                          branchId={invoice.inventoryBranchId}
                          locationId={invoice.inventoryLocationId}
                          disabled={disabled || !canEditLines}
                          selectedLotId={l.inventoryLotBalanceId ?? null}
                          lotNumber={l.lotNumber ?? ''}
                          onChange={(pick) => {
                            void updateCounterInvoiceLine(invoice.id, l.id, {
                              inventoryLotBalanceId: pick.lotId,
                              lotNumber: pick.lotNumber || null,
                            }).then(onInvoiceChange);
                          }}
                        />
                      </div>
                    ) : null}
                    <MailInvoiceLineCheckbox
                      invoiceId={invoice.id}
                      line={{
                        ...l,
                        catalogItemId: l.catalogItemId ?? order?.catalogItemId ?? null,
                        catalogItemType: l.catalogItemType ?? order?.catalogItemType ?? null,
                      }}
                      clientId={invoice.clientId}
                      clientName={rxLabel?.ownerName || 'Client'}
                      patientId={l.patientId ?? invoice.patientId ?? rxLabel?.patientId}
                      patientName={rxLabel?.patientName}
                      paymentStatus={invoiceMailPaymentStatus(invoice)}
                      doctorEmployeeId={providerId}
                      blockedReason={mailBlockedReason}
                      disabled={disabled || busy != null}
                      onError={setError}
                      onChargeShipping={async (result) => {
                        const next = await addCounterInvoiceLine(invoice.id, {
                          description: result.shippingChargeName,
                          qty: 1,
                          unitPrice: result.shipping,
                          catalogItemId: result.type.catalogItemId ?? null,
                          catalogItemType: result.type.catalogItemType ?? 'procedure',
                          patientId: l.patientId ?? invoice.patientId ?? null,
                          providerEmployeeId: providerId,
                          miscCharge: true,
                        });
                        onInvoiceChange(next);
                        const matches = (next.lines ?? []).filter(
                          (row) =>
                            !row.isDeleted &&
                            row.description === result.shippingChargeName &&
                            Math.abs(Number(row.unitPrice) - result.shipping) < 0.009
                        );
                        return matches[matches.length - 1]?.id ?? null;
                      }}
                      onRemoveShipping={async (shippingLineId) => {
                        onInvoiceChange(await removeCounterInvoiceLine(invoice.id, shippingLineId));
                      }}
                    />
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
            {!isPaid && !isVoid && invoice?.isEuthanasiaPrepay && (
              <>
                <button
                  type="button"
                  className="soap-btn ghost"
                  disabled={disabled || busy != null}
                  onClick={onOpenEuthanasiaPrepay}
                >
                  <ShieldCheck size={14} /> Save card
                </button>
                {invoice.lastChargeStatus === 'requires_capture' ? (
                  <button
                    type="button"
                    className="soap-btn"
                    disabled={payDisabled}
                    onClick={convertAuthorization}
                  >
                    <CreditCard size={14} /> Convert Authorization to Payment
                  </button>
                ) : (
                  <button
                    type="button"
                    className="soap-btn"
                    disabled={payDisabled || !hasSavedCard}
                    title={hasSavedCard ? '' : 'Save a card before authorizing'}
                    onClick={authorizeCard}
                  >
                    <ShieldCheck size={14} /> Authorize card
                  </button>
                )}
              </>
            )}
            {!isPaid && !isVoid && !invoice?.isEuthanasiaPrepay && (
              <>
                <button
                  type="button"
                  className="soap-btn"
                  disabled={payDisabled || !readerReady}
                  title={
                    !branchReady
                      ? 'Choose the branch and location inventory is drawn from'
                      : !selectedReader
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
                  disabled={payDisabled || !hasSavedCard}
                  title={
                    !branchReady
                      ? 'Choose the branch and location inventory is drawn from'
                      : hasSavedCard
                        ? ''
                        : 'No card saved on file'
                  }
                  onClick={cardOnFile}
                >
                  <CreditCard size={14} /> Card on file
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
