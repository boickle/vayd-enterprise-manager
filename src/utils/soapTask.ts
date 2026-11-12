/** Automatic unfinished-SOAP tasks stash the encounter UUID after `:soap:`. */
export function soapEncounterIdFromTask(task: {
  idempotencyKey?: string | null;
}): string | null {
  const key = task.idempotencyKey ?? '';
  const m = key.match(/:soap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m?.[1] ?? null;
}

/**
 * Rows created before `kind` existed still carry the unfinished-SOAP trigger
 * or the encounter UUID. Those should open the SOAP, not a callback jot.
 */
export function isSoapAutomationTask(task: {
  kind?: string | null;
  title?: string | null;
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  if (task.kind === 'soap') return true;
  if ((task.triggerDefinitionId ?? '').startsWith('soap_unfinished:')) return true;
  if (soapEncounterIdFromTask(task) != null) return true;
  return /^finish the chart\b/i.test(task.title ?? '');
}

export function soapPathFromTaskLinks(
  links?: ReadonlyArray<{ entityType: string; entityId: number }> | null,
): string | null {
  const appointmentId = links?.find((l) => l.entityType === 'appointment')?.entityId;
  const patientId = links?.find((l) => l.entityType === 'patient')?.entityId;
  if (appointmentId == null || patientId == null) return null;
  const clientId = links?.find((l) => l.entityType === 'client')?.entityId;
  const qs = clientId != null ? `?clientId=${encodeURIComponent(String(clientId))}` : '';
  return `/schedule/soap/${appointmentId}/${patientId}${qs}`;
}
