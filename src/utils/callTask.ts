/**
 * "Call not filed" automatic tasks (trigger `call_unfiled`). T-B2: the task links to its call
 * (`openphone_call`, the Scout row id). Tasks made before that link existed still carry the
 * call's row id in their key (`rule:<ruleId>:call:<rowId>`), so the call is found either way.
 */
type CallTaskInput = {
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
  links?: ReadonlyArray<{ entityType: string; entityId: number }>;
};

const CALL_KEY = /^rule:\d+:call:(\d+)$/;

export function isCallFilingTask(task: CallTaskInput): boolean {
  if (task.triggerDefinitionId?.startsWith('call_unfiled:')) return true;
  if (task.links?.some((l) => l.entityType === 'openphone_call')) return true;
  return CALL_KEY.test(task.idempotencyKey?.trim() ?? '');
}

/** The call's Scout row id, or null when the task does not say which call it is. */
export function callRowIdFromTask(task: CallTaskInput): number | null {
  const linked = task.links?.find((l) => l.entityType === 'openphone_call')?.entityId;
  if (linked != null && Number.isInteger(linked) && linked > 0) return linked;
  const m = CALL_KEY.exec(task.idempotencyKey?.trim() ?? '');
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}
