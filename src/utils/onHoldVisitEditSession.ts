/** Scheduling Tools On hold → calendar preview → edit hold or return to list. */
export const ON_HOLD_VISIT_EDIT_SESSION_KEY = 'vayd:on-hold-visit-edit-v1';

export const ON_HOLD_VISIT_EDIT_RETURN_KEY = 'vayd:on-hold-visit-edit-return-v1';

export type OnHoldVisitEditListKind = 'forward_booking' | 'appointment_request';

export type OnHoldVisitEditFlowIntent = 'review' | 'remove';

const VALID_LIST_KINDS = new Set<OnHoldVisitEditListKind>([
  'forward_booking',
  'appointment_request',
]);

const VALID_FLOW_INTENTS = new Set<OnHoldVisitEditFlowIntent>(['review', 'remove']);

function isOnHoldVisitEditListKind(value: unknown): value is OnHoldVisitEditListKind {
  return typeof value === 'string' && VALID_LIST_KINDS.has(value as OnHoldVisitEditListKind);
}

export type OnHoldVisitEditSessionV1 = {
  v: 1;
  listEntryId: number;
  listKind: OnHoldVisitEditListKind;
  bookedAppointmentId: number;
  clientLabel?: string | null;
  returnPath: string;
  /** Holds board household row — restored for scroll + exit animation. */
  groupKey?: string | null;
  /** Default `review` — open hold preview. `remove` — remove hold from calendar. */
  flowIntent?: OnHoldVisitEditFlowIntent;
  /** Calendar appointment ids to cancel when `flowIntent` is `remove`. */
  removeAppointmentIds?: number[];
};

export type OnHoldVisitEditReturnExitKind = 'booked' | 'removed' | 'updated';

export type OnHoldVisitEditReturnV1 = {
  v: 1;
  listEntryId: number;
  listKind: OnHoldVisitEditListKind;
  exitKind: OnHoldVisitEditReturnExitKind;
};

export function writeOnHoldVisitEditSession(
  next: Omit<OnHoldVisitEditSessionV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      ON_HOLD_VISIT_EDIT_SESSION_KEY,
      JSON.stringify({ v: 1, ...next }),
    );
  } catch {
    /* quota */
  }
}

export function readOnHoldVisitEditSession(): OnHoldVisitEditSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ON_HOLD_VISIT_EDIT_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as OnHoldVisitEditSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.listEntryId !== 'number' ||
      !isOnHoldVisitEditListKind(o.listKind) ||
      typeof o.bookedAppointmentId !== 'number' ||
      !o.returnPath?.trim()
    ) {
      return null;
    }
    const flowIntent =
      o.flowIntent != null && VALID_FLOW_INTENTS.has(o.flowIntent as OnHoldVisitEditFlowIntent)
        ? (o.flowIntent as OnHoldVisitEditFlowIntent)
        : 'review';
    const removeAppointmentIds = Array.isArray(o.removeAppointmentIds)
      ? o.removeAppointmentIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      : undefined;
    const groupKey =
      typeof o.groupKey === 'string' && o.groupKey.trim() ? o.groupKey.trim() : null;
    return {
      v: 1,
      listEntryId: o.listEntryId,
      listKind: o.listKind,
      bookedAppointmentId: o.bookedAppointmentId,
      clientLabel:
        typeof o.clientLabel === 'string' && o.clientLabel.trim() ? o.clientLabel.trim() : null,
      returnPath: o.returnPath.trim(),
      groupKey,
      flowIntent,
      ...(removeAppointmentIds && removeAppointmentIds.length > 0
        ? { removeAppointmentIds }
        : {}),
    };
  } catch {
    return null;
  }
}

export function clearOnHoldVisitEditSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ON_HOLD_VISIT_EDIT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function writeOnHoldVisitEditReturnSession(
  next: Omit<OnHoldVisitEditReturnV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      ON_HOLD_VISIT_EDIT_RETURN_KEY,
      JSON.stringify({ v: 1, ...next }),
    );
  } catch {
    /* quota */
  }
}

export function readOnHoldVisitEditReturnSession(): OnHoldVisitEditReturnV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ON_HOLD_VISIT_EDIT_RETURN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as OnHoldVisitEditReturnV1;
    if (
      o?.v !== 1 ||
      typeof o.listEntryId !== 'number' ||
      !isOnHoldVisitEditListKind(o.listKind) ||
      (o.exitKind !== 'booked' &&
        o.exitKind !== 'removed' &&
        o.exitKind !== 'updated')
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function clearOnHoldVisitEditReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ON_HOLD_VISIT_EDIT_RETURN_KEY);
  } catch {
    /* ignore */
  }
}
