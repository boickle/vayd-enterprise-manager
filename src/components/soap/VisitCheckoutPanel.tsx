import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CreditCard, Pencil, Receipt, RotateCcw, Smartphone, ShieldCheck, X } from 'lucide-react';
import {
  VISIT_WORKFLOW_PRACTICE_ID,
  addCounterInvoiceLine,
  cancelTerminalCheckout,
  authorizeSavedCard,
  captureAuthorization,
  chargeSavedCard,
  getInvoiceCardOnFile,
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
  type StockDraw,
  type InvoiceCardOnFile,
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
import { attachTagalongLines, tagalongTaxHint } from '../../utils/invoiceTagalongs';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import PostVisitMembershipSignup from './PostVisitMembershipSignup';
import StockLotPicker from '../inventory/StockLotPicker';
import LinkedStockInvoiceDetails from '../invoice/LinkedStockInvoiceDetails';
import InvoiceVaccineDoseEditor from '../pims/InvoiceVaccineDoseEditor';
import { linkedStockFromLine } from '../../utils/linkedInvoiceStock';
import VisitDoseAndRxSection from './VisitDoseAndRxSection';
import PlanOrdersSection from './PlanOrdersSection';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';

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
  /**
   * Dose / Rx recording used to live above the invoice lines (duplicating every item).
   * Clinical details now expand under each line — keep these for that embedded UI.
   */
  clientId?: number | null;
  patientId?: number | null;
  practiceId?: number;
  onClinicalRecorded?: () => void;
  onChronicMedicationsMaybeChanged?: () => void;
  /** Bump when dose/Rx clinical details change so Approve sees fresh sigs. */
  clinicalRefreshSignal?: number;
  onInvoiceChange: (invoice: VisitInvoice) => void;
  onOpenEuthanasiaPrepay: () => void;
  /** After removing a line's order, drop it from local order state and refresh the invoice. */
  onOrderRemoved?: (orderId: string) => void;
  onOrdersChange?: (orders: EncounterOrder[]) => void;
  /** Refresh invoice after a catalog add (works even before the first line exists). */
  onInvoiceShouldRefresh?: () => void;
  /** Inventory catalog picks also go under Treatment Plan/Medications in the Plan narrative. */
  onInventoryItemAdded?: (item: { name: string; isVaccine?: boolean }) => void;
  onInventoryItemRemoved?: (itemName: string) => void;
};

function isCheckoutRxLine(line: VisitInvoiceLine, order: EncounterOrder | null): boolean {
  if (order?.kind === 'med') return true;
  if (line.catalogIsMedication === true || line.catalogIsDispensable === true) return true;
  return Boolean(line.instructions?.trim() || line.refillCount != null);
}

function money(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** Compact provider label for tight checkout columns — e.g. "H. Crispell". */
function shortProviderName(
  full?: string | null,
  firstName?: string | null,
  lastName?: string | null,
): string {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first && last) return `${first[0]!.toUpperCase()}. ${last}`;
  const cleaned = (full ?? '')
    .replace(/^(dr|dra|mr|mrs|ms)\.?\s+/i, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  while (
    parts.length > 1 &&
    /^(dvm|vmd|phd|dacv[a-z]*|vm\.?d)\.?$/i.test(parts[parts.length - 1]!)
  ) {
    parts.pop();
  }
  if (parts.length >= 2) {
    const given = parts[0]!;
    const surname = parts[parts.length - 1]!;
    return `${given[0]!.toUpperCase()}. ${surname}`;
  }
  return cleaned || '—';
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
  clientId,
  patientId,
  practiceId = VISIT_WORKFLOW_PRACTICE_ID,
  onClinicalRecorded,
  onChronicMedicationsMaybeChanged,
  clinicalRefreshSignal = 0,
  onInvoiceChange,
  onOpenEuthanasiaPrepay,
  onOrderRemoved,
  onOrdersChange,
  onInvoiceShouldRefresh,
  onInventoryItemAdded,
  onInventoryItemRemoved,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postVisitSignupOpen, setPostVisitSignupOpen] = useState(false);
  const [activeCheckoutId, setActiveCheckoutId] = useState<string | null>(null);
  const [readerCatalog, setReaderCatalog] = useState<TerminalReaderCatalog | null>(null);
  const [prescriptionsByOrderId, setPrescriptionsByOrderId] = useState<
    Record<string, OrderPrescription>
  >({});
  const [vaccineOrderIds, setVaccineOrderIds] = useState<ReadonlySet<string>>(new Set());
  const [vaccinationsByOrderId, setVaccinationsByOrderId] = useState<
    Record<string, OrderVaccination>
  >({});
  const [stockDrawsByOrderId, setStockDrawsByOrderId] = useState<Record<string, StockDraw>>({});
  const [mailOrders, setMailOrders] = useState<MailOrder[]>([]);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [editingPriceLineId, setEditingPriceLineId] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [cardOnFile, setCardOnFile] = useState<InvoiceCardOnFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPrimaryProviders()
      .then((rows) => {
        if (!cancelled) {
          setProviders(
            [...rows]
              .filter((e) => e?.id != null && Number(e.id) > 0)
              .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!invoice?.id) {
      setCardOnFile(null);
      return;
    }
    let cancelled = false;
    void getInvoiceCardOnFile(invoice.id)
      .then((card) => {
        if (!cancelled) setCardOnFile(card);
      })
      .catch(() => {
        if (!cancelled) setCardOnFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice?.id]);

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
        setStockDrawsByOrderId(
          Object.fromEntries(details.stockDraws.map((d) => [d.orderId, d])),
        );
      })
      .catch(() => {
        if (!canceled) {
          setPrescriptionsByOrderId({});
          setVaccineOrderIds(new Set());
          setVaccinationsByOrderId({});
          setStockDrawsByOrderId({});
        }
      });
    return () => {
      canceled = true;
    };
  }, [encounterId, invoice?.id, clinicalRefreshSignal]);

  // Stamp the visit provider onto production lines that still lack one (SOAP used to leave these blank).
  useEffect(() => {
    if (!invoice?.id || invoice.status !== 'open' || disabled) return;
    const visitProvider = rxLabel?.veterinarianEmployeeId ?? null;
    if (visitProvider == null || visitProvider <= 0) return;
    const missing = (invoice.lines ?? []).filter((l) => {
      if (l.isDeleted) return false;
      if (isInvoiceShippingLine(l)) return false;
      if (l.excludeFromProduction === true) return false;
      return l.providerEmployeeId == null;
    });
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      let next = invoice;
      for (const line of missing) {
        if (cancelled) return;
        try {
          next = await updateCounterInvoiceLine(invoice.id, line.id, {
            providerEmployeeId: visitProvider,
          });
        } catch {
          /* keep going — UI still lets staff pick */
        }
      }
      if (!cancelled && next !== invoice) onInvoiceChange(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.status, rxLabel?.veterinarianEmployeeId, disabled]);

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

  const chargeCardOnFile = () =>
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
  const hasSavedCard = Boolean(cardOnFile || invoice?.savedPaymentMethodId);
  const branchReady =
    invoice?.status !== 'open' ||
    (invoice.inventoryBranchId != null && invoice.inventoryLocationId != null);
  const canEditLines = Boolean(encounterId) && !isPaid && !isVoid && status === 'open';
  const payDisabled = disabled || busy != null || !branchReady;

  const activeCheckoutLines = (invoice?.lines ?? []).filter((row) => !row.isDeleted);
  const checkoutTagalongs = attachTagalongLines(activeCheckoutLines);
  const checkoutLineGroups = attachShippingLines(
    [...checkoutTagalongs.parents, ...checkoutTagalongs.leftover],
    (row) => isInvoiceShippingLine(row),
    (row) => String(row.catalogItemType ?? '').toLowerCase() === 'inventory'
  );

  const shippedMailForLine = (line: VisitInvoiceLine): MailOrder | null => {
    if (!invoice) return null;
    const match = matchingMailOrderForLine(mailOrders, invoice.id, line);
    return match && isMailOrderShipped(match) ? match : null;
  };

  const removeLine = (line: VisitInvoiceLine) => {
    const shipped = shippedMailForLine(line);
    if (shipped) {
      setError(shippedMailMessage(shipped));
      return;
    }
    if (line.tagalongOfLineId) {
      if (!canEditLines || !invoice) return;
      void run(`remove:${line.id}`, async () => {
        onInvoiceChange(await removeCounterInvoiceLine(invoice.id, line.id));
      });
      return;
    }
    if (!encounterId || !line.orderId || !canEditLines) return;
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

      {encounterId && onOrdersChange ? (
        <PlanOrdersSection
          key={`checkout-add-${encounterId}`}
          className="soap-checkout-add"
          encounterId={encounterId}
          orders={orders}
          disabled={disabled}
          patientId={patientId ?? undefined}
          clientId={clientId ?? undefined}
          practiceId={practiceId}
          showList={false}
          showSearch={!disabled}
          onChange={onOrdersChange}
          onInvoiceShouldRefresh={() => {
            if (onInvoiceShouldRefresh) {
              onInvoiceShouldRefresh();
              return;
            }
            if (!invoice?.id) return;
            void getInvoice(invoice.id)
              .then(onInvoiceChange)
              .catch(() => undefined);
          }}
          onInventoryItemAdded={onInventoryItemAdded}
          onInventoryItemRemoved={onInventoryItemRemoved}
        />
      ) : null}

      {!invoice ? (
        <div className="soap-empty">
          No invoice yet — add a charge above to open one.
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
            <div className="soap-invoice-lines-head" aria-hidden>
              <span />
              <span>Item</span>
              <span>Provider</span>
              <span>Qty</span>
              <span>Amt</span>
              <span />
            </div>
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
                const attachedTagalongs = checkoutTagalongs.attached.get(l.id) ?? [];
                const mailed = matchingMailOrderForLine(mailOrders, invoice.id, l);
                const isVaccineLine =
                  Boolean(order && vaccineOrderIds.has(order.id)) ||
                  l.catalogIsVaccine === true;
                const excludesProduction =
                  order?.catalogFlags?.excludeFromProduction === true ||
                  l.excludeFromProduction === true;
                const needsProvider =
                  !excludesProduction && !isInvoiceShippingLine(l);
                const lotReady =
                  !l.trackLots ||
                  Boolean(mailed) ||
                  isVaccineLine ||
                  l.inventoryLotBalanceId != null;
                const clinicalReady = order && vaccineOrderIds.has(order.id)
                  ? Boolean(vaccinationsByOrderId[order.id])
                  : showRxLabel
                    ? scriptApproved && Boolean(String(instructions).trim())
                    : true;
                const lineReady =
                  clinicalReady &&
                  (!needsProvider || l.providerEmployeeId != null) &&
                  lotReady;
                const effectiveProviderId =
                  providerId ?? rxLabel?.veterinarianEmployeeId ?? null;
                const needsClinical =
                  Boolean(order) &&
                  (isVaccineLine || showRxLabel || order?.kind === 'med');
                const canEditLineMeta =
                  Boolean(order) && Boolean(encounterId) && canEditLines && !l.isCovered;
                const stockDraw = l.orderId ? stockDrawsByOrderId[l.orderId] ?? null : null;
                const stock = linkedStockFromLine(l, stockDraw);
                const canExpand = needsClinical || showClientNote || isVaccineLine;
                const lineExpanded = expandedLineId === l.id;
                const approveBlockedReason = !String(instructions).trim()
                  ? 'Record the script (sig) first — expand this line'
                  : effectiveProviderId == null
                    ? 'Set the visit provider before approving'
                    : null;
                const mailBlockedReason = showRxLabel
                  ? effectiveProviderId == null
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
                  <Fragment key={l.id}>
                  <div
                    className={`soap-invoice-line ${lineReady ? 'is-ready' : 'is-pending'}`}
                  >
                    {canExpand ? (
                      <button
                        type="button"
                        className="soap-invoice-line-expand"
                        title={
                          lineExpanded
                            ? 'Collapse'
                            : needsClinical
                              ? 'Enter dose / Rx details'
                              : 'More details'
                        }
                        aria-expanded={lineExpanded}
                        onClick={() =>
                          setExpandedLineId(lineExpanded ? null : l.id)
                        }
                      >
                        {lineExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="soap-invoice-line-expand" aria-hidden />
                    )}
                    <span className="soap-invoice-line-desc">
                      <span className="soap-invoice-line-title">
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
                        {lineReady ? (
                          <Check className="soap-invoice-line-check" size={14} aria-label="All set" />
                        ) : null}
                      </span>
                      {showRxLabel && canEditLines && !scriptApproved ? (
                        <button
                          type="button"
                          className="soap-dose-dymo soap-checkout-approve"
                          title={approveBlockedReason ?? 'Approve this script'}
                          disabled={disabled || busy != null || Boolean(approveBlockedReason)}
                          onClick={() => {
                            void updateCounterInvoiceLine(invoice.id, l.id, {
                              instructions: String(instructions).trim() || null,
                              rxApproved: true,
                              ...(l.providerEmployeeId == null &&
                              rxLabel?.veterinarianEmployeeId != null
                                ? { providerEmployeeId: rxLabel.veterinarianEmployeeId }
                                : {}),
                            })
                              .then(onInvoiceChange)
                              .catch((e) => setError(apiErrorMessage(e)));
                          }}
                        >
                          Approve
                        </button>
                      ) : null}
                      {showRxLabel && scriptApproved ? (
                        <span className="soap-checkout-approved-pill">
                          Approved
                          {l.rxApprovedByName
                            ? ` · ${shortProviderName(l.rxApprovedByName)}`
                            : ''}
                        </span>
                      ) : null}
                    </span>
                    {needsProvider ? (
                      canEditLines ? (
                        <select
                          className="soap-select soap-checkout-provider-select"
                          title="Provider"
                          aria-label="Provider"
                          value={l.providerEmployeeId ?? ''}
                          disabled={disabled || busy != null}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const next = e.target.value ? Number(e.target.value) : null;
                            if (next == null || !Number.isFinite(next)) {
                              setError('Provider is required on invoice line items.');
                              return;
                            }
                            void updateCounterInvoiceLine(invoice.id, l.id, {
                              providerEmployeeId: next,
                            })
                              .then(onInvoiceChange)
                              .catch((err) => setError(apiErrorMessage(err)));
                          }}
                        >
                          {l.providerEmployeeId == null ? (
                            <option value="" disabled>
                              Provider…
                            </option>
                          ) : null}
                          {providers.map((emp) => (
                            <option key={String(emp.id)} value={emp.id}>
                              {shortProviderName(emp.name, emp.firstName, emp.lastName)}
                            </option>
                          ))}
                          {l.providerEmployeeId != null &&
                          !providers.some((e) => Number(e.id) === l.providerEmployeeId) ? (
                            <option value={l.providerEmployeeId}>
                              {shortProviderName(
                                rxLabel?.veterinarianEmployeeId === l.providerEmployeeId
                                  ? rxLabel.veterinarianName
                                  : `Provider #${l.providerEmployeeId}`,
                              )}
                            </option>
                          ) : null}
                        </select>
                      ) : (
                        <span className="soap-checkout-provider-ro">
                          {(() => {
                            const emp = providers.find(
                              (e) => Number(e.id) === l.providerEmployeeId,
                            );
                            if (emp) {
                              return shortProviderName(emp.name, emp.firstName, emp.lastName);
                            }
                            if (rxLabel && rxLabel.veterinarianEmployeeId === l.providerEmployeeId) {
                              return shortProviderName(rxLabel.veterinarianName);
                            }
                            return l.providerEmployeeId != null
                              ? `#${l.providerEmployeeId}`
                              : '—';
                          })()}
                        </span>
                      )
                    ) : (
                      <span className="soap-checkout-provider-ro" aria-hidden>
                        —
                      </span>
                    )}
                    {canEditLineMeta && order && encounterId ? (
                      <input
                        className="soap-input soap-checkout-line-qty-input"
                        type="number"
                        min={0.001}
                        step="any"
                        title="Quantity"
                        aria-label="Quantity"
                        key={`qty-${order.id}-${order.qty}`}
                        defaultValue={Number(order.qty) || Number(l.qty) || 1}
                        disabled={disabled || busy != null}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n) || n <= 0) return;
                          if (Math.abs(n - Number(order.qty)) < 0.0001) return;
                          void (async () => {
                            const updated = await updateOrder(encounterId, order.id, {
                              qty: n,
                            });
                            onOrdersChange?.(
                              orders.map((o) => (o.id === order.id ? updated : o))
                            );
                          })();
                        }}
                      />
                    ) : (
                      <span className="soap-checkout-line-qty--ro">
                        {Number(l.qty) || 1}
                      </span>
                    )}
                    <span className="soap-invoice-line-amt">
                      {l.isCovered ? (
                        'covered'
                      ) : (
                        <>
                          {money(l.amount)}
                          {canEditLineMeta && order && allowPrice ? (
                            editingPriceLineId === l.id ? (
                              <input
                                className="soap-input soap-checkout-inline-price"
                                type="number"
                                min={0}
                                step="0.01"
                                autoFocus
                                key={`price-${order.id}-${order.unitPrice}`}
                                defaultValue={Number(order.unitPrice) || 0}
                                disabled={disabled || busy != null}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => {
                                  const n = Number(e.target.value);
                                  setEditingPriceLineId(null);
                                  if (!Number.isFinite(n) || n < 0) return;
                                  if (Math.abs(n - Number(order.unitPrice)) < 0.0001) return;
                                  void (async () => {
                                    const updated = await updateOrder(encounterId!, order.id, {
                                      unitPrice: n,
                                    });
                                    onOrdersChange?.(
                                      orders.map((o) => (o.id === order.id ? updated : o))
                                    );
                                    try {
                                      onInvoiceChange(await getInvoice(invoice.id));
                                    } catch {
                                      /* ignore */
                                    }
                                  })();
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="soap-checkout-price-edit-btn"
                                title="Edit unit price (catalog allows price change)"
                                disabled={disabled || busy != null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPriceLineId(l.id);
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                            )
                          ) : null}
                        </>
                      )}
                    </span>
                    {canEditLines && (l.orderId || l.tagalongOfLineId) ? (
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
                    ) : (
                      <span className="soap-invoice-line-remove" aria-hidden />
                    )}

                    {attachedShipping.map((ship) => (
                      <div key={ship.id} className="soap-invoice-line-extra soap-invoice-line-ship">
                        <span>{ship.description}</span>
                        <span className="soap-invoice-line-amt">
                          {ship.isCovered ? 'covered' : money(ship.amount)}
                        </span>
                      </div>
                    ))}
                    {attachedTagalongs.map((child) => (
                      <div key={child.id} className="soap-invoice-line-extra soap-invoice-line-ship soap-invoice-line-tagalong">
                        <span>
                          {child.description}
                          {tagalongTaxHint(child) ? (
                            <span className="settings-muted"> · {tagalongTaxHint(child)}</span>
                          ) : null}
                        </span>
                        <span className="soap-checkout-line-qty--ro">{Number(child.qty) || 1}</span>
                        <span className="soap-invoice-line-amt">
                          {child.isCovered ? 'covered' : money(child.amount)}
                        </span>
                        {canEditLines ? (
                          <button
                            type="button"
                            className="soap-invoice-line-remove"
                            title="Remove tagalong"
                            disabled={disabled || busy != null}
                            onClick={() => removeLine(child)}
                          >
                            <X size={14} />
                          </button>
                        ) : null}
                      </div>
                    ))}

                    {lineExpanded ? (
                      <div className="soap-invoice-line-extra">
                        {showRxLabel && rxLabel ? (
                          <div className="soap-invoice-line-dymo">
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
                                  recorded?.instructions ||
                                  l.instructions ||
                                  l.catalogInstructions,
                                refill: recorded?.refill ?? l.refillCount ?? l.catalogRefill,
                                refillExpiration: recorded?.refillExpiration,
                                startDate: recorded?.startDate ?? invoice?.created,
                                rxNumber: recorded?.rxNumber,
                                acuity: recorded?.acuity,
                                onSavePrescription: async (value) => {
                                  if (encounterId && l.orderId) {
                                    const saved = await saveOrderPrescription(
                                      encounterId,
                                      l.orderId,
                                      {
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
                                      }
                                    );
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
                          </div>
                        ) : null}
                        {l.trackLots && !mailed && !isVaccineLine && !stock.linked ? (
                          <StockLotPicker
                            practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                            inventoryItemId={l.stockInventoryItemId ?? l.catalogItemId ?? null}
                            branchId={invoice.inventoryBranchId}
                            locationId={invoice.inventoryLocationId}
                            itemName={l.description}
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
                        ) : null}
                        {!isVaccineLine ? (
                          <MailInvoiceLineCheckbox
                            invoiceId={invoice.id}
                            line={{
                              ...l,
                              catalogItemId: l.catalogItemId ?? order?.catalogItemId ?? null,
                              catalogItemType:
                                l.catalogItemType ?? order?.catalogItemType ?? null,
                            }}
                            clientId={invoice.clientId}
                            clientName={rxLabel?.ownerName || 'Client'}
                            patientId={l.patientId ?? invoice.patientId ?? rxLabel?.patientId}
                            patientName={rxLabel?.patientName}
                            paymentStatus={invoiceMailPaymentStatus(invoice)}
                            doctorEmployeeId={effectiveProviderId}
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
                                providerEmployeeId: effectiveProviderId,
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
                              onInvoiceChange(
                                await removeCounterInvoiceLine(invoice.id, shippingLineId)
                              );
                            }}
                          />
                        ) : null}
                        {showClientNote && order && encounterId && canEditLines ? (
                          <label className="soap-checkout-client-note">
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
                            />
                          </label>
                        ) : null}
                        {isVaccineLine && !(encounterId && order) ? (
                          <div className="soap-invoice-line-clinical">
                            {stock.linked && !mailed ? (
                              <LinkedStockInvoiceDetails
                                line={l}
                                stockDraw={stockDraw}
                                practiceId={practiceId ?? VISIT_WORKFLOW_PRACTICE_ID}
                                providerId={l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId}
                                branchId={invoice.inventoryBranchId}
                                locationId={invoice.inventoryLocationId}
                                disabled={disabled || !canEditLines}
                                onSelectLot={(lot) => {
                                  void updateCounterInvoiceLine(invoice.id, l.id, {
                                    inventoryLotBalanceId: lot?.id ?? null,
                                    lotNumber: lot?.lotNumber || null,
                                  }).then(onInvoiceChange);
                                }}
                              />
                            ) : null}
                            <InvoiceVaccineDoseEditor
                              line={l}
                              disabled={disabled || !canEditLines}
                              hideLotPicker={stock.linked}
                              branchId={invoice.inventoryBranchId}
                              locationId={invoice.inventoryLocationId}
                              recorded={null}
                              onSaved={() => {
                                onClinicalRecorded?.();
                              }}
                              onLotPicked={(pick) => {
                                void updateCounterInvoiceLine(invoice.id, l.id, {
                                  inventoryLotBalanceId: pick.lotId,
                                  lotNumber: pick.lotNumber,
                                }).then(onInvoiceChange);
                              }}
                            />
                          </div>
                        ) : null}
                        {needsClinical && encounterId && order ? (
                          <div className="soap-invoice-line-clinical">
                            {stock.linked && !mailed ? (
                              <LinkedStockInvoiceDetails
                                line={l}
                                stockDraw={stockDraw}
                                practiceId={practiceId ?? VISIT_WORKFLOW_PRACTICE_ID}
                                providerId={l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId}
                                branchId={invoice.inventoryBranchId}
                                locationId={invoice.inventoryLocationId}
                                disabled={disabled || !canEditLines}
                                onSelectLot={(lot) => {
                                  void updateCounterInvoiceLine(invoice.id, l.id, {
                                    inventoryLotBalanceId: lot?.id ?? null,
                                    lotNumber: lot?.lotNumber || null,
                                  }).then(onInvoiceChange);
                                }}
                              />
                            ) : null}
                            <VisitDoseAndRxSection
                              encounterId={encounterId}
                              orders={orders}
                              disabled={disabled}
                              patientId={patientId ?? rxLabel?.patientId ?? undefined}
                              clientId={clientId ?? invoice.clientId ?? undefined}
                              practiceId={practiceId}
                              providerId={rxLabel?.veterinarianEmployeeId}
                              inventoryBranchId={invoice.inventoryBranchId}
                              inventoryLocationId={invoice.inventoryLocationId}
                              patientName={rxLabel?.patientName ?? 'Patient'}
                              patientSpecies={rxLabel?.species}
                              ownerName={rxLabel?.ownerName}
                              providerName={rxLabel?.veterinarianName}
                              providerLicense={rxLabel?.veterinarianLicense}
                              onlyOrderIds={[order.id]}
                              embedded
                              forceOpenOrderId={order.id}
                              invoiceLots={{
                                [order.id]: {
                                  lotId: l.inventoryLotBalanceId ?? null,
                                  lotNumber: l.lotNumber ?? null,
                                },
                              }}
                              onOrderUpdated={(updated) => {
                                onOrdersChange?.(
                                  orders.map((o) => (o.id === updated.id ? updated : o))
                                );
                              }}
                              onInvoiceShouldRefresh={() => {
                                void getInvoice(invoice.id)
                                  .then(onInvoiceChange)
                                  .catch(() => undefined);
                              }}
                              onChronicMedicationsMaybeChanged={onChronicMedicationsMaybeChanged}
                              onClinicalRecorded={onClinicalRecorded}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  </Fragment>
                );
              })}
          </div>

          {Array.isArray(invoice.staffAudit) && invoice.staffAudit.length > 0 ? (
            <details className="soap-checkout-staff-audit">
              <summary>Staff audit · {invoice.staffAudit.length}</summary>
              <ul>
                {invoice.staffAudit.map((row, i) => (
                  <li key={`${row.at}-${i}`}>
                    {(row.at || '').slice(0, 16).replace('T', ' ')}
                    {row.employeeName ? ` · ${row.employeeName}` : ''}
                    {' — '}
                    {row.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

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

          {/* Clients can join within 24h of the visit; this re-prices the bill,
              refunds the difference and emails them, instead of the manual
              void / refund / re-enter dance. */}
          {Number(invoice.amountPaid) > 0 && (
            <button
              type="button"
              className="btn secondary soap-postvisit-signup-btn"
              onClick={() => setPostVisitSignupOpen(true)}
              disabled={disabled || busy != null}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Post-visit sign-up for membership
            </button>
          )}

          {postVisitSignupOpen && (
            <PostVisitMembershipSignup
              visitInvoiceId={invoice.id}
              patientName={rxLabel?.patientName ?? null}
              onClose={() => setPostVisitSignupOpen(false)}
              onCompleted={() => {
                void getInvoice(invoice.id).then(onInvoiceChange).catch(() => undefined);
              }}
            />
          )}

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
                        ? cardOnFile
                          ? `${(cardOnFile.brand || 'Card').replace(/^./, (c) => c.toUpperCase())} ${cardOnFile.last4 ? `•••• ${cardOnFile.last4}` : 'on file'}`
                          : ''
                        : 'No card saved on file'
                  }
                  onClick={chargeCardOnFile}
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
