import {
  fetchGmailLabels,
  fetchGmailThread,
  flattenUserLabels,
  labelDisplayName,
  latestNonDraftThreadMessage,
  modifyGmailMessage,
  type GmailLabelNode,
} from '../api/gmail';
import {
  fetchAppointmentRequestGmailLink,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import {
  appointmentRequestSubmissionCountsAsBooked,
  appointmentRequestSubmissionGmailOnHold,
  type AppointmentRequestBookedApptSummary,
} from './appointmentRequestOnHold';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';

/**
 * The shared inbox where public appointment-request emails land. The in-Gmail
 * appointment-request panel and label sync are scoped to this mailbox only.
 */
export const APPOINTMENT_REQUEST_MAILBOX = 'info@vetatyourdoor.com';

/** Canonical Gmail user-label names that mirror appointment-request outcomes. */
export const APPT_REQUEST_LABEL_NAMES = {
  booked: 'BOOKED',
  notBooked: 'NOT BOOKED',
  contacted: 'Contacted',
  onHold: 'ON HOLD',
} as const;

export type ApptRequestLabelIds = {
  booked: string | null;
  notBooked: string | null;
  contacted: string | null;
  onHold: string | null;
};

export type ApptRequestOutcome = 'booked' | 'not_booked' | 'contacted';

export function isAppointmentRequestMailbox(mailbox: string | null | undefined): boolean {
  return (mailbox ?? '').trim().toLowerCase() === APPOINTMENT_REQUEST_MAILBOX;
}

function findLabelIdByName(labels: GmailLabelNode[], name: string): string | null {
  const target = name.trim().toLowerCase();
  for (const label of flattenUserLabels(labels)) {
    if (labelDisplayName(label).trim().toLowerCase() === target) return label.id;
    if (label.name.trim().toLowerCase() === target) return label.id;
  }
  return null;
}

/** Resolve the Gmail label ids for BOOKED / NOT BOOKED / Contacted / ON HOLD in this mailbox. */
export function resolveApptRequestLabelIds(labels: GmailLabelNode[]): ApptRequestLabelIds {
  return {
    booked: findLabelIdByName(labels, APPT_REQUEST_LABEL_NAMES.booked),
    notBooked: findLabelIdByName(labels, APPT_REQUEST_LABEL_NAMES.notBooked),
    contacted: findLabelIdByName(labels, APPT_REQUEST_LABEL_NAMES.contacted),
    onHold: findLabelIdByName(labels, APPT_REQUEST_LABEL_NAMES.onHold),
  };
}

/** True when the thread already carries a terminal BOOKED or NOT BOOKED label. */
export function threadHasOutcomeLabel(
  labelIds: readonly string[],
  ids: ApptRequestLabelIds,
): boolean {
  const set = new Set(labelIds);
  return Boolean((ids.booked && set.has(ids.booked)) || (ids.notBooked && set.has(ids.notBooked)));
}

/**
 * Scout outcome → Gmail label. Matches Scout Booked / Not booked chips and list tabs.
 * Terminal outcomes (booked, not_booked) take priority over contacted.
 */
export function resolveApptRequestGmailOutcome(
  item: AppointmentRequestSubmissionItem,
): ApptRequestOutcome | null {
  const status = item.status ?? 'new';
  if (status === 'dismissed') return 'not_booked';
  if (appointmentRequestSubmissionCountsAsBooked(item, new Map(), null)) return 'booked';
  if (status === 'contacted') return 'contacted';
  return null;
}

export function appointmentRequestGmailBookedEligible(
  item: AppointmentRequestSubmissionItem,
): boolean {
  return resolveApptRequestGmailOutcome(item) === 'booked';
}

export function appointmentRequestGmailNotBookedEligible(
  item: AppointmentRequestSubmissionItem,
): boolean {
  return resolveApptRequestGmailOutcome(item) === 'not_booked';
}

/** Dedup key — include submission fields that change when Scout status changes. */
export function apptRequestGmailLabelSyncSignature(
  item: AppointmentRequestSubmissionItem,
  outcome: ApptRequestOutcome,
): string {
  return [
    item.id,
    outcome,
    item.status ?? 'new',
    item.staffConfirmedAt ?? '',
    item.linkedVisitPoints ?? '',
    item.notBookedReason ?? '',
    item.updated ?? '',
  ].join(':');
}

/**
 * Compute the Gmail label add/remove set for an appointment-request outcome.
 * BOOKED and NOT BOOKED are mutually exclusive; Contacted is additive.
 * Returns `null` when the required label does not exist in the mailbox.
 */
export function outcomeLabelPatch(
  outcome: ApptRequestOutcome,
  currentLabelIds: readonly string[],
  ids: ApptRequestLabelIds,
): { addLabelIds?: string[]; removeLabelIds?: string[] } | null {
  const set = new Set(currentLabelIds);
  const add: string[] = [];
  const remove: string[] = [];

  if (outcome === 'booked') {
    if (!ids.booked) return null;
    if (!set.has(ids.booked)) add.push(ids.booked);
    if (ids.notBooked && set.has(ids.notBooked)) remove.push(ids.notBooked);
  } else if (outcome === 'not_booked') {
    if (!ids.notBooked) return null;
    if (!set.has(ids.notBooked)) add.push(ids.notBooked);
    if (ids.booked && set.has(ids.booked)) remove.push(ids.booked);
  } else {
    if (!ids.contacted) return null;
    if (!set.has(ids.contacted)) add.push(ids.contacted);
  }

  if (add.length === 0 && remove.length === 0) return null;
  return {
    ...(add.length ? { addLabelIds: add } : {}),
    ...(remove.length ? { removeLabelIds: remove } : {}),
  };
}

function apptRequestGmailOutcomeAlreadyApplied(
  outcome: ApptRequestOutcome,
  messageLabelIds: readonly string[],
  ids: ApptRequestLabelIds,
): boolean {
  if (outcome === 'booked') {
    return Boolean(ids.booked && messageLabelIds.includes(ids.booked));
  }
  if (outcome === 'not_booked') {
    return Boolean(ids.notBooked && messageLabelIds.includes(ids.notBooked));
  }
  return Boolean(ids.contacted && messageLabelIds.includes(ids.contacted));
}

export function apptRequestGmailNotBookedLabelPendingDismissal(
  labelIds: readonly string[],
  submission: AppointmentRequestSubmissionItem,
  ids: ApptRequestLabelIds,
): boolean {
  return (
    Boolean(ids.notBooked && labelIds.includes(ids.notBooked)) &&
    (submission.status ?? 'new') !== 'dismissed'
  );
}

/** Apply a Gmail outcome label; returns false when label ids are not loaded yet. */
export async function applyApptRequestGmailOutcomeLabel(args: {
  mailbox: string;
  message: { id: string; threadId: string; labelIds: readonly string[] };
  outcome: ApptRequestOutcome;
  userLabels: GmailLabelNode[];
}): Promise<{ ok: boolean; labelIds?: string[] }> {
  const ids = resolveApptRequestLabelIds(args.userLabels);
  if (apptRequestGmailOutcomeAlreadyApplied(args.outcome, args.message.labelIds, ids)) {
    return { ok: true, labelIds: [...args.message.labelIds] };
  }

  const requiredId =
    args.outcome === 'booked'
      ? ids.booked
      : args.outcome === 'not_booked'
        ? ids.notBooked
        : ids.contacted;
  if (!requiredId) return { ok: false };

  const patch = outcomeLabelPatch(args.outcome, args.message.labelIds, ids);
  if (!patch) return { ok: true, labelIds: [...args.message.labelIds] };

  try {
    const result = await modifyGmailMessage(
      args.mailbox,
      args.message.id,
      patch,
      args.message.threadId,
    );
    return { ok: true, labelIds: result.labelIds };
  } catch {
    return { ok: false };
  }
}

/**
 * ON HOLD is a managed toggle (unlike the add-only outcome labels): add it when the
 * linked visit is on hold, remove it when it is no longer on hold (converted to a
 * real appointment or the hold was removed). Returns `null` when nothing changes or
 * the label does not exist in the mailbox.
 */
export function onHoldLabelPatch(
  isOnHold: boolean,
  currentLabelIds: readonly string[],
  ids: ApptRequestLabelIds,
): { addLabelIds?: string[]; removeLabelIds?: string[] } | null {
  if (!ids.onHold) return null;
  const has = currentLabelIds.includes(ids.onHold);
  if (isOnHold && !has) return { addLabelIds: [ids.onHold] };
  if (!isOnHold && has) return { removeLabelIds: [ids.onHold] };
  return null;
}

/** Dedup key for ON HOLD reconcile — changes when hold state or hold-driving fields change. */
export function apptRequestGmailOnHoldSyncSignature(
  item: AppointmentRequestSubmissionItem,
  isOnHold: boolean,
): string {
  return [
    item.id,
    isOnHold ? 'hold' : 'off',
    item.status ?? 'new',
    item.bookedAppointmentId ?? '',
    item.linkedVisitPoints ?? '',
    item.updated ?? '',
  ].join(':');
}

/**
 * Apply (or remove) the ON HOLD Gmail label so it mirrors the linked visit's hold state.
 * Returns `{ ok: false }` when the label does not exist or the Gmail write failed.
 */
export async function applyApptRequestGmailOnHoldLabel(args: {
  mailbox: string;
  message: { id: string; threadId: string; labelIds: readonly string[] };
  isOnHold: boolean;
  userLabels: GmailLabelNode[];
}): Promise<{ ok: boolean; labelIds?: string[] }> {
  const ids = resolveApptRequestLabelIds(args.userLabels);
  if (!ids.onHold) return { ok: false };

  const patch = onHoldLabelPatch(args.isOnHold, args.message.labelIds, ids);
  if (!patch) return { ok: true, labelIds: [...args.message.labelIds] };

  try {
    const result = await modifyGmailMessage(
      args.mailbox,
      args.message.id,
      patch,
      args.message.threadId,
    );
    return { ok: true, labelIds: result.labelIds };
  } catch {
    return { ok: false };
  }
}

/** True when `labelId` is the managed ON HOLD outcome label for appointment requests. */
export function isApptRequestOnHoldLabelId(
  labelId: string,
  userLabels: GmailLabelNode[],
): boolean {
  const ids = resolveApptRequestLabelIds(userLabels);
  return Boolean(ids.onHold && ids.onHold === labelId);
}

/**
 * Apply Scout-managed Gmail labels (outcome + ON HOLD) as soon as the liaison thread is
 * linked — do not wait for a separate list reconcile pass.
 */
export async function syncManagedApptRequestGmailLabels(args: {
  mailbox: string;
  message: { id: string; threadId: string; labelIds: readonly string[] };
  submission: AppointmentRequestSubmissionItem;
  userLabels: GmailLabelNode[];
  bookedApptMeta?: ReadonlyMap<number, AppointmentRequestBookedApptSummary>;
  typeCatalog?: AppointmentTypeCatalog | null;
}): Promise<string[] | null> {
  if (!args.message.id?.trim()) return null;

  let labelIds = [...args.message.labelIds];

  const outcome = resolveApptRequestGmailOutcome(args.submission);
  if (outcome) {
    const outcomeResult = await applyApptRequestGmailOutcomeLabel({
      mailbox: args.mailbox,
      message: { ...args.message, labelIds },
      outcome,
      userLabels: args.userLabels,
    });
    if (outcomeResult.labelIds) labelIds = outcomeResult.labelIds;
  }

  let isOnHold = appointmentRequestSubmissionGmailOnHold(
    args.submission,
    args.bookedApptMeta ?? new Map(),
    args.typeCatalog ?? null,
  );
  const onHoldResult = await applyApptRequestGmailOnHoldLabel({
    mailbox: args.mailbox,
    message: { ...args.message, labelIds },
    isOnHold,
    userLabels: args.userLabels,
  });
  if (onHoldResult.labelIds) labelIds = onHoldResult.labelIds;

  return labelIds;
}

/**
 * Remove the ON HOLD Gmail label immediately after a calendar hold is converted or removed.
 * Call from the scheduler save/confirm path — do not wait for list reconcile.
 */
export async function clearApptRequestGmailOnHoldLabel(args: {
  submissionId: number;
  mailbox?: string;
  threadId?: string;
}): Promise<{ ok: boolean; labelIds?: string[] }> {
  try {
    let mailbox = args.mailbox?.trim() || APPOINTMENT_REQUEST_MAILBOX;
    let threadId = args.threadId?.trim() || '';
    if (!threadId) {
      const link = await fetchAppointmentRequestGmailLink(args.submissionId);
      threadId = link.threadId?.trim() || '';
      const resolvedMailbox = link.mailbox?.trim();
      if (resolvedMailbox) mailbox = resolvedMailbox;
    }
    if (!threadId) return { ok: false };

    const [{ labels }, thread] = await Promise.all([
      fetchGmailLabels(mailbox),
      fetchGmailThread(mailbox, threadId),
    ]);
    const userLabels = flattenUserLabels(labels);
    const latest = latestNonDraftThreadMessage(thread.messages ?? []);
    if (!latest?.id) return { ok: false };

    return await applyApptRequestGmailOnHoldLabel({
      mailbox,
      message: { id: latest.id, threadId, labelIds: latest.labelIds },
      isOnHold: false,
      userLabels,
    });
  } catch {
    return { ok: false };
  }
}

/** Keep Gmail labels aligned with the linked submission's Scout outcome. */
export async function syncApptRequestSubmissionGmailLabel(args: {
  mailbox: string;
  message: { id: string; threadId: string; labelIds: readonly string[] };
  submission: AppointmentRequestSubmissionItem;
  userLabels: GmailLabelNode[];
}): Promise<{ ok: boolean; outcome: ApptRequestOutcome | null; labelIds?: string[] }> {
  const outcome = resolveApptRequestGmailOutcome(args.submission);
  if (!outcome) return { ok: true, outcome: null };

  const result = await applyApptRequestGmailOutcomeLabel({
    mailbox: args.mailbox,
    message: args.message,
    outcome,
    userLabels: args.userLabels,
  });
  return { ...result, outcome };
}
