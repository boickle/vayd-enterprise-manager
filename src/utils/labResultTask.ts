/** Automatic missing-lab tasks stash the invoice line UUID after `:lab-line:`. */
export function labInvoiceLineIdFromTask(task: {
  idempotencyKey?: string | null;
}): string | null {
  const key = task.idempotencyKey ?? '';
  const m = key.match(
    /:lab-line:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m?.[1] ?? null;
}

/**
 * An in-house lab was charged and nobody entered the result. The task screen
 * opens that result. Older rows may lack `kind` and still carry the trigger
 * or the line UUID.
 */
export function isLabResultAutomationTask(task: {
  kind?: string | null;
  title?: string | null;
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  if (task.kind === 'lab_result') return true;
  if ((task.triggerDefinitionId ?? '').startsWith('lab_result_missing:')) return true;
  if (labInvoiceLineIdFromTask(task) != null) return true;
  return /^enter results for\b/i.test(task.title ?? '');
}
