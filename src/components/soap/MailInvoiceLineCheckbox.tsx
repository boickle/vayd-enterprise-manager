import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MAIL_CANCEL_REASON_LABELS,
  createStaffMailOrder,
  listMailOrders,
  mailCancelPending,
  mailOrderWorkedOn,
  requestMailOrderCancellation,
  respondMailApproval,
  withdrawMailOrder,
  type MailCancelReason,
  type MailOrder,
} from '../../api/onlineStore';
import { VISIT_WORKFLOW_PRACTICE_ID, type VisitInvoiceLine } from '../../api/visitWorkflow';
import MailOrderPrompt, { type MailOrderPromptResult } from './MailOrderPrompt';
import { saveMailingAddressOnFile, shipBodyFromFields } from './MailShipAddressPicker';
import './MailInvoiceLineCheckbox.css';

/** Where the order is, in words staff can read back to the client. */
export function mailStageLabel(order: MailOrder): string {
  if (order.status === 'picked_up') return 'Picked up';
  if (order.status === 'shipped' || order.processStatus === 'shipped') return 'Shipped';
  if (order.status === 'ready_for_pickup') return 'Ready for pickup';
  if (
    order.status === 'awaiting_doctor_approval' ||
    order.approvalStatus === 'needs_doctor_approval' ||
    order.approvalStatus === 'approval_pending'
  ) {
    return 'Waiting on doctor';
  }
  switch (order.processStatus) {
    case 'filled':
      return 'Filled';
    case 'first_check':
    case 'second_check':
      return 'Being checked';
    case 'packaged':
      return 'Packed';
    case 'rtg':
      return 'Ready to ship';
    default:
      return 'In mail queue';
  }
}

function resolvedCancelForLine(
  rows: MailOrder[],
  invoiceId: string,
  lineId: string
): MailOrder | null {
  const token = invoiceMailNote(invoiceId);
  const lineToken = invoiceLineMailNote(lineId);
  return (
    rows.find(
      (o) =>
        o.status === 'cancelled' &&
        Boolean(o.cancelResolution) &&
        (o.notes || '').includes(token) &&
        (o.notes || '').includes(lineToken)
    ) ?? null
  );
}

function MailCancelRequestModal({
  itemName,
  onClose,
  onSubmit,
}: {
  itemName: string;
  onClose: () => void;
  onSubmit: (reason: MailCancelReason, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<MailCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  return createPortal(
    <div className="mail-cancel-backdrop" role="dialog" aria-modal="true">
      <div className="mail-cancel">
        <h3>Request cancellation</h3>
        <p className="mail-cancel__hint">
          The mail team has already started on <strong>{itemName}</strong>. They’ll decide whether
          to cancel, refund, or follow up if it already shipped.
        </p>
        <fieldset className="mail-cancel__reasons">
          <legend>Reason</legend>
          {(Object.keys(MAIL_CANCEL_REASON_LABELS) as MailCancelReason[]).map((key) => (
            <label key={key} className="mail-cancel__reason">
              <input
                type="radio"
                name="mail-cancel-reason"
                checked={reason === key}
                onChange={() => setReason(key)}
              />
              <span>{MAIL_CANCEL_REASON_LABELS[key]}</span>
            </label>
          ))}
        </fieldset>
        <label className="mail-cancel__note">
          <span>Note for the mail team (optional)</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="mail-cancel__actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
            Back
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!reason || saving || (reason === 'other' && !note.trim())}
            onClick={() => {
              if (!reason) return;
              setSaving(true);
              void onSubmit(reason, note.trim()).finally(() => setSaving(false));
            }}
          >
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function invoiceMailNote(invoiceId: string) {
  return `invoice:${invoiceId}`;
}

export function shippingLineFromNotes(notes: string | null | undefined): string | null {
  return notes?.match(/shippingLine:([0-9a-f-]{36})/i)?.[1] ?? null;
}

export function invoiceLineMailNote(lineId: string) {
  return `invoiceLine:${lineId}`;
}

/** "Doctor approves first, then collect payment": the doctor decides from the mail queue, not the invoice. */
export function mailOrderWaitsForQueueApproval(order: MailOrder | null | undefined): boolean {
  return Boolean(order?.payAfterApproval);
}

/**
 * The doctor approved the script on the invoice, so the mail queue doesn't wait on a
 * second approval. Returns false when there was nothing on the order left to approve.
 */
export async function approveMailOrderFromInvoice(
  order: MailOrder,
  line: { catalogItemId?: number | null; stockInventoryItemId?: number | null },
  rx: { refills: number; refillExpiration?: string | null; instructions: string }
): Promise<boolean> {
  if (mailOrderWaitsForQueueApproval(order)) return false;
  const waiting = (order.lines || []).filter(
    (row) => row.lineStatus === 'awaiting_doctor_approval' || row.lineStatus === 'send_back'
  );
  const itemIds = new Set(
    [line.catalogItemId, line.stockInventoryItemId].filter((id): id is number => id != null)
  );
  const byItem = waiting.filter(
    (row) => row.inventoryItemId != null && itemIds.has(row.inventoryItemId)
  );
  const targets = byItem.length ? byItem : waiting.length === 1 ? waiting : [];
  if (!targets.length) return false;
  await respondMailApproval(VISIT_WORKFLOW_PRACTICE_ID, order.id, {
    outcome: 'approved',
    notes: 'Approved on the invoice',
    lineIds: targets.map((row) => row.id),
    lineRefills: targets.map((row) => ({
      lineId: row.id,
      refills: rx.refills,
      expiration: rx.refills > 0 ? rx.refillExpiration || null : null,
    })),
    lineScripts: targets.map((row) => ({ lineId: row.id, scriptText: rx.instructions.trim() })),
  });
  return true;
}

function isInventoryLine(line: VisitInvoiceLine): boolean {
  if (line.catalogItemId == null) return false;
  return !line.catalogItemType || line.catalogItemType === 'inventory';
}

export function isMailOrderShipped(order: MailOrder): boolean {
  return (
    order.processStatus === 'shipped' ||
    order.status === 'shipped' ||
    order.status === 'picked_up'
  );
}

export function shippedMailMessage(order?: MailOrder | null): string {
  return order?.status === 'picked_up'
    ? 'This item has already been picked up. Return it instead of deleting it.'
    : 'This item has already shipped. Return it instead of deleting it.';
}

export function matchingMailOrderForLine(
  rows: MailOrder[],
  invoiceId: string,
  line: { id: string; catalogItemId?: number | null }
): MailOrder | null {
  if (line.catalogItemId != null) {
    return matchingMailOrder(rows, invoiceId, line.catalogItemId, line.id);
  }
  const token = invoiceMailNote(invoiceId);
  return (
    rows.find(
      (o) =>
        o.status !== 'cancelled' &&
        (o.notes || '').includes(token) &&
        ((o.notes || '').includes(invoiceLineMailNote(line.id)) ||
          shippingLineFromNotes(o.notes) === line.id)
    ) ?? null
  );
}

export async function assertNoShippedMailOrdersForInvoiceLines(
  invoiceId: string,
  lines: Array<{ id: string; catalogItemId?: number | null }>
): Promise<void> {
  const rows = await listMailOrders(VISIT_WORKFLOW_PRACTICE_ID);
  for (const line of lines) {
    const match = matchingMailOrderForLine(rows, invoiceId, line);
    if (match && isMailOrderShipped(match)) {
      throw new Error(shippedMailMessage(match));
    }
  }
}

export async function cancelMailOrdersForInvoiceLines(
  invoiceId: string,
  lines: Array<{ id: string; catalogItemId?: number | null }>
): Promise<string[]> {
  const rows = await listMailOrders(VISIT_WORKFLOW_PRACTICE_ID);
  const shippingIds = new Set<string>();
  const seen = new Set<number>();
  for (const line of lines) {
    const match = matchingMailOrderForLine(rows, invoiceId, line);
    if (!match || seen.has(match.id)) continue;
    if (isMailOrderShipped(match)) {
      throw new Error(shippedMailMessage(match));
    }
    seen.add(match.id);
    await withdrawMailOrder(VISIT_WORKFLOW_PRACTICE_ID, match.id);
    const shippingId = shippingLineFromNotes(match.notes);
    if (shippingId) shippingIds.add(shippingId);
  }
  return [...shippingIds];
}

function matchingMailOrder(
  rows: MailOrder[],
  invoiceId: string,
  itemId: number,
  lineId: string
): MailOrder | null {
  const token = invoiceMailNote(invoiceId);
  const lineToken = invoiceLineMailNote(lineId);
  const active = rows.filter(
    (o) => o.status !== 'cancelled' && (o.notes || '').includes(token)
  );
  return (
    active.find((o) => (o.notes || '').includes(lineToken)) ??
    active.find((o) => shippingLineFromNotes(o.notes) === lineId) ??
    active.find(
      (o) =>
        !(o.notes || '').includes('invoiceLine:') &&
        (o.lines || []).some((l) => l.inventoryItemId === itemId)
    ) ??
    null
  );
}

type Props = {
  invoiceId: string;
  line: VisitInvoiceLine;
  clientId?: number | null;
  clientName: string;
  patientId?: number | null;
  patientName?: string | null;
  paymentStatus?: 'paid' | 'awaiting_payment';
  doctorEmployeeId?: number | null;
  blockedReason?: string | null;
  /** Set when the script isn't approved yet; the mail order then waits on the doctor. */
  approvalReason?: string | null;
  disabled?: boolean;
  onError?: (message: string) => void;
  onChargeShipping?: (
    result: MailOrderPromptResult
  ) => Promise<
    | string
    | { shippingLineId?: string | null; line?: VisitInvoiceLine | null }
    | null
    | void
  >;
  onRemoveShipping?: (shippingLineId: string) => Promise<void>;
  /** The line was added to or taken off the mail queue. */
  onQueueChange?: (mailedLine: VisitInvoiceLine, queued: boolean) => void;
};

export default function MailInvoiceLineCheckbox({
  invoiceId,
  line,
  clientId,
  clientName,
  patientId,
  patientName,
  paymentStatus = 'awaiting_payment',
  doctorEmployeeId,
  blockedReason,
  approvalReason,
  disabled,
  onError,
  onChargeShipping,
  onRemoveShipping,
  onQueueChange,
}: Props) {
  const [order, setOrder] = useState<MailOrder | null>(null);
  const [closedOrder, setClosedOrder] = useState<MailOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [askCancel, setAskCancel] = useState(false);

  useEffect(() => {
    if (!isInventoryLine(line) || line.catalogItemId == null) return;
    const itemId = line.catalogItemId;
    void listMailOrders(VISIT_WORKFLOW_PRACTICE_ID)
      .then((rows) => {
        const match = matchingMailOrder(rows, invoiceId, itemId, line.id);
        setOrder(match);
        setClosedOrder(match ? null : resolvedCancelForLine(rows, invoiceId, line.id));
      })
      .catch(() => {
        /* stay on dispense if the queue cannot be read */
      });
  }, [invoiceId, line.id, line.catalogItemId, line.catalogItemType]);

  if (!isInventoryLine(line)) return null;
  // Vaccines are given in clinic — never offer mail-order.
  if (line.catalogIsVaccine === true) return null;

  const on = order != null;
  const shipped = order ? isMailOrderShipped(order) : false;
  const pending = order ? mailCancelPending(order) : false;
  const blocked = Boolean(blockedReason) && !on;
  const canAdd = !on && Boolean(clientId) && line.catalogItemId != null && !blocked;
  const canWithdraw =
    on && !shipped && !pending && !mailOrderWorkedOn(order) && paymentStatus !== 'paid';
  const off = disabled || busy;

  const fail = (err: unknown, fallback: string) => {
    const msg =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (err instanceof Error ? err.message : '') ||
      fallback;
    onError?.(msg);
  };

  const withdraw = () => {
    if (!order) return;
    setBusy(true);
    const removeShippingId = shippingLineFromNotes(order.notes);
    void withdrawMailOrder(VISIT_WORKFLOW_PRACTICE_ID, order.id)
      .then(async () => {
        if (removeShippingId && onRemoveShipping) await onRemoveShipping(removeShippingId);
        setOrder(null);
        onQueueChange?.(line, false);
      })
      .catch((err) => fail(err, 'Could not take this off the mail queue'))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="mail-mode" onClick={(e) => e.stopPropagation()}>
        <div className="mail-mode__toggle" role="group" aria-label="How this item is filled">
          <button
            type="button"
            className={!on && !ask ? 'is-on' : ''}
            aria-pressed={!on && !ask}
            disabled={off || (on && !canWithdraw)}
            title={
              on && !canWithdraw
                ? pending
                  ? 'Cancellation requested — waiting on the mail team'
                  : 'The mail team has started on this. Request a cancellation instead.'
                : undefined
            }
            onClick={() => {
              if (on && canWithdraw) withdraw();
            }}
          >
            Dispense at visit
          </button>
          <button
            type="button"
            className={on || ask ? 'is-on' : ''}
            aria-pressed={on || ask}
            disabled={off || (!on && (!canAdd || !clientId))}
            title={blocked ? blockedReason ?? undefined : undefined}
            onClick={() => {
              if (!on && canAdd) setAsk(true);
            }}
          >
            Mail order
            {on && Number(line.qty) > 1 ? ` (${Number(line.qty)})` : ''}
          </button>
        </div>
        {order ? (
          <div className={`mail-mode__status${pending ? ' is-cancel-pending' : ''}`}>
            <span className="mail-mode__stage">{mailStageLabel(order)}</span>
            {pending ? (
              <span>
                Cancellation requested
                {order.cancelRequestedByName ? ` by ${order.cancelRequestedByName}` : ''} — waiting
                on the mail team
              </span>
            ) : order.cancelResolution === 'already_shipped' ? (
              <span>
                Couldn’t cancel — already shipped
                {order.cancelResolvedByName ? ` (${order.cancelResolvedByName})` : ''}
              </span>
            ) : order.cancelResolution === 'kept' ? (
              <span>
                Mail team kept the order
                {order.cancelResolvedByName ? ` (${order.cancelResolvedByName})` : ''}
              </span>
            ) : null}
            {!pending && !canWithdraw && order.status !== 'picked_up' ? (
              <button
                type="button"
                className="mail-mode__link"
                disabled={off}
                onClick={() => setAskCancel(true)}
              >
                Request cancellation
              </button>
            ) : null}
          </div>
        ) : closedOrder ? (
          <div className="mail-mode__status">
            <span className="mail-mode__stage">Mail order cancelled</span>
            <span>
              {closedOrder.cancelResolution === 'cancelled_refund' ? 'Refund issued' : 'Cancelled'}
              {closedOrder.cancelResolvedByName ? ` by ${closedOrder.cancelResolvedByName}` : ''}
            </span>
          </div>
        ) : null}
      </div>
      {askCancel && order ? (
        <MailCancelRequestModal
          itemName={line.description}
          onClose={() => setAskCancel(false)}
          onSubmit={async (reason, note) => {
            try {
              const next = await requestMailOrderCancellation(
                VISIT_WORKFLOW_PRACTICE_ID,
                order.id,
                { reason, note }
              );
              setOrder(next);
              setAskCancel(false);
            } catch (err) {
              fail(err, 'Could not send the cancellation request');
            }
          }}
        />
      ) : null}
      {ask ? (
        <MailOrderPrompt
          practiceId={VISIT_WORKFLOW_PRACTICE_ID}
          clientId={clientId ?? null}
          itemName={line.description}
          maxQty={Number(line.qty) || 1}
          paid={paymentStatus === 'paid'}
          approvalNote={
            approvalReason
              ? `${approvalReason} — approve it on this invoice, or the doctor approves it from the mail queue before anything is filled.`
              : null
          }
          onCancel={() => setAsk(false)}
          onConfirm={(result) => {
            if (!clientId || line.catalogItemId == null) return;
            setBusy(true);
            void (async () => {
              const prepared = onChargeShipping ? await onChargeShipping(result) : null;
              const addedShippingId =
                typeof prepared === 'string'
                  ? prepared
                  : prepared && typeof prepared === 'object'
                    ? prepared.shippingLineId ?? null
                    : null;
              const mailedLine =
                prepared && typeof prepared === 'object' && prepared.line
                  ? prepared.line
                  : line;
              const note = [
                invoiceMailNote(invoiceId),
                invoiceLineMailNote(mailedLine.id),
                addedShippingId ? `shippingLine:${addedShippingId}` : null,
              ]
                .filter(Boolean)
                .join(' ');
              const created = await createStaffMailOrder(VISIT_WORKFLOW_PRACTICE_ID, {
                origin: result.origin,
                clientId,
                patientId: patientId ?? mailedLine.patientId ?? line.patientId ?? null,
                patientName: patientName ?? null,
                customerName: clientName,
                notes: note,
                paymentStatus,
                shippingPaymentStatus:
                  result.shipping > 0 ? paymentStatus : result.shippingPaymentStatus,
                sendWithoutPayment: result.sendWithoutPayment,
                payAfterApproval: result.payAfterApproval,
                shippingChargeName: result.shippingChargeName,
                shipping: result.shipping,
                ship: result.ship ? shipBodyFromFields(result.ship.fields, clientName) : undefined,
                doctorEmployeeId:
                  doctorEmployeeId ?? mailedLine.providerEmployeeId ?? line.providerEmployeeId ?? null,
                lines: [
                  {
                    inventoryItemId: mailedLine.catalogItemId ?? line.catalogItemId,
                    name: mailedLine.description,
                    quantity: result.mailQty || Number(mailedLine.qty) || 1,
                    needsApproval: Boolean(approvalReason) || undefined,
                  },
                ],
              });
              setOrder(mailedLine.id === line.id ? created : null);
              setClosedOrder(null);
              setAsk(false);
              onQueueChange?.(mailedLine, true);
              if (result.ship?.saveAsMailing) {
                await saveMailingAddressOnFile(clientId, result.ship.fields).catch(() =>
                  onError?.('Sent to the mail queue, but the mailing address could not be saved on the client.')
                );
              }
            })()
              .catch((e) =>
                onError?.(e instanceof Error ? e.message : 'Could not send to mail orders')
              )
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </>
  );
}
