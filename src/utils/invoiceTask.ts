/** Automatic invoice tasks stash the bill UUID in the idempotency key. */
export function invoiceIdFromTask(task: {
  idempotencyKey?: string | null;
}): string | null {
  const key = task.idempotencyKey ?? '';
  const m = key.match(/:invoice:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m?.[1] ?? null;
}

/**
 * Rows created before `kind` existed still carry the invoice trigger or the
 * bill UUID. The payment panel should show for those, not only new `invoice` rows.
 */
export function isInvoiceAutomationTask(task: {
  kind?: string | null;
  title?: string | null;
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  if (task.kind === 'invoice') return true;
  if ((task.triggerDefinitionId ?? '').startsWith('invoice_open:')) return true;
  if (invoiceIdFromTask(task) != null) return true;
  const title = task.title ?? '';
  return /\binvoice\b/i.test(title) && /pay|payment|bill/i.test(title);
}
