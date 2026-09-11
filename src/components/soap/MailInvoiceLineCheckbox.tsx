import { useEffect, useState } from 'react';
import {
  createStaffMailOrder,
  listMailOrders,
  patchMailOrder,
  type MailOrder,
} from '../../api/onlineStore';
import { VISIT_WORKFLOW_PRACTICE_ID, type VisitInvoiceLine } from '../../api/visitWorkflow';
import MailOrderPrompt, { type MailOrderPromptResult } from './MailOrderPrompt';

export function invoiceMailNote(invoiceId: string) {
  return `invoice:${invoiceId}`;
}

export function shippingLineFromNotes(notes: string | null | undefined): string | null {
  return notes?.match(/shippingLine:([0-9a-f-]{36})/i)?.[1] ?? null;
}

export function invoiceLineMailNote(lineId: string) {
  return `invoiceLine:${lineId}`;
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
    await patchMailOrder(VISIT_WORKFLOW_PRACTICE_ID, match.id, { status: 'cancelled' });
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
  disabled,
  onError,
  onChargeShipping,
  onRemoveShipping,
}: Props) {
  const [on, setOn] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [shippingLineId, setShippingLineId] = useState<string | null>(null);
  const [shipped, setShipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    if (!isInventoryLine(line) || line.catalogItemId == null) return;
    const itemId = line.catalogItemId;
    void listMailOrders(VISIT_WORKFLOW_PRACTICE_ID)
      .then((rows) => {
        const match = matchingMailOrder(rows, invoiceId, itemId, line.id);
        setOn(match != null);
        setOrderId(match?.id ?? null);
        setShippingLineId(shippingLineFromNotes(match?.notes));
        setShipped(match ? isMailOrderShipped(match) : false);
      })
      .catch(() => {
        /* keep unchecked if the queue cannot be read */
      });
  }, [invoiceId, line.id, line.catalogItemId, line.catalogItemType]);

  if (!isInventoryLine(line)) return null;

  const locked = on && shipped;
  const blocked = Boolean(blockedReason) && !on;
  const canAdd = !on && Boolean(clientId) && line.catalogItemId != null && !blocked;
  const canRemove = on && !shipped && orderId != null;

  return (
    <>
      <label
        className={`mail-line-check${on || ask ? ' mail-line-check--on' : ''}${locked || blocked ? ' mail-line-check--locked' : ''}`}
        onClick={(e) => e.stopPropagation()}
        title={
          locked
            ? 'Already shipped or picked up — cannot remove from the mail queue'
            : blocked
              ? blockedReason ?? undefined
              : on
                ? 'Uncheck to remove from the mail queue'
                : undefined
        }
      >
        <input
          type="checkbox"
          checked={on || ask}
          disabled={disabled || busy || locked || blocked || (!on && !clientId)}
          onChange={(e) => {
            if (e.target.checked) {
              if (!canAdd) return;
              setAsk(true);
              return;
            }
            if (!canRemove || orderId == null) return;
            setBusy(true);
            const removeShippingId = shippingLineId;
            void patchMailOrder(VISIT_WORKFLOW_PRACTICE_ID, orderId, {
              status: 'cancelled',
            })
              .then(async () => {
                if (removeShippingId && onRemoveShipping) {
                  await onRemoveShipping(removeShippingId);
                }
                setOn(false);
                setOrderId(null);
                setShippingLineId(null);
                setShipped(false);
              })
              .catch((err) =>
                onError?.(
                  err instanceof Error ? err.message : 'Could not remove from mail orders'
                )
              )
              .finally(() => setBusy(false));
          }}
        />
        {on ? '✓ On mail queue' : 'Mail to client'}
        {on && Number(line.qty) > 1 ? ` (${Number(line.qty)})` : ''}
      </label>
      {ask ? (
        <MailOrderPrompt
          practiceId={VISIT_WORKFLOW_PRACTICE_ID}
          itemName={line.description}
          maxQty={Number(line.qty) || 1}
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
                shippingChargeName: result.shippingChargeName,
                shipping: result.shipping,
                doctorEmployeeId:
                  doctorEmployeeId ?? mailedLine.providerEmployeeId ?? line.providerEmployeeId ?? null,
                lines: [
                  {
                    inventoryItemId: mailedLine.catalogItemId ?? line.catalogItemId,
                    name: mailedLine.description,
                    quantity: result.mailQty || Number(mailedLine.qty) || 1,
                  },
                ],
              });
              setOn(mailedLine.id === line.id);
              setOrderId(mailedLine.id === line.id ? created.id : null);
              setShippingLineId(mailedLine.id === line.id ? addedShippingId : null);
              setShipped(mailedLine.id === line.id ? isMailOrderShipped(created) : false);
              setAsk(false);
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
