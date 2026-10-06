import { apiErrorMessage } from '../api/http';
import {
  listPatientOpenReminders,
  patchReminder,
  type UnscheduledReminder,
} from '../api/careOutreach';
import {
  cancelMembership,
  listPatientMemberships,
  previewMembershipCancel,
  type MembershipCancelPreview,
} from '../api/memberships';
import {
  listStoreSubscriptions,
  patchStoreSubscription,
  type StoreStaffSubscription,
} from '../api/onlineStore';
import { getEstimateForAppointment, listClientEstimates } from '../api/visitEstimates';
import {
  VISIT_WORKFLOW_PRACTICE_ID,
  getInvoiceByAppointment,
  listClientVisitInvoices,
} from '../api/visitWorkflow';
import { membershipCancelLineDescription } from './membershipCancelEstimateLine';
import {
  cancelEuthanasiaFutureAppointments,
  findFutureAppointmentsForPatients,
  type EuthanasiaFutureAppointmentRow,
} from './euthanasiaFutureAppointments';

export const DEATH_WRAP_UP_REASON = 'Pet passed away';
export const INACTIVATE_WRAP_UP_REASON = 'Patient inactivated';
export const DEATH_WRAP_UP_STORAGE_PREFIX = 'death-wrap-up-accepted:';

export type DeathWrapUpKind = 'invoice' | 'inactivate';

export type DeathWrapUpPreview = {
  patientId: number;
  patientName: string;
  memberships: MembershipCancelPreview[];
  autoships: StoreStaffSubscription[];
  reminders: UnscheduledReminder[];
  futureAppointments: EuthanasiaFutureAppointmentRow[];
  /**
   * Memberships whose cancel charge or credit is already a line on this visit's estimate or
   * invoice, or (from the chart, with no visit) on one of the owner's open estimates or bills.
   */
  moneyOnVisitMembershipIds: number[];
  /** True when those estimates or invoices could not be loaded, so we can't tell. */
  visitMoneyCheckFailed: boolean;
};

export type DeathWrapUpAcceptResult = {
  errors: string[];
  membershipsCanceled: number;
  autoshipsCanceled: number;
  remindersCanceled: number;
  appointmentsCanceled: number;
};

function money(n: number): string {
  return Number(n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export function deathWrapUpStorageKey(appointmentId: number, patientId: number): string {
  return `${DEATH_WRAP_UP_STORAGE_PREFIX}${appointmentId}:${patientId}`;
}

export function deathWrapUpAlreadyAccepted(appointmentId: number, patientId: number): boolean {
  try {
    return sessionStorage.getItem(deathWrapUpStorageKey(appointmentId, patientId)) === '1';
  } catch {
    return false;
  }
}

export function markDeathWrapUpAccepted(appointmentId: number, patientId: number): void {
  try {
    sessionStorage.setItem(deathWrapUpStorageKey(appointmentId, patientId), '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export function deathWrapUpHasWork(preview: DeathWrapUpPreview | null | undefined): boolean {
  if (!preview) return false;
  return (
    preview.memberships.length > 0 ||
    preview.autoships.length > 0 ||
    preview.reminders.length > 0 ||
    preview.futureAppointments.length > 0
  );
}

export function deathWrapUpHouseholdHasWork(
  previews: readonly DeathWrapUpPreview[] | null | undefined,
): boolean {
  return Boolean(previews?.some((preview) => deathWrapUpHasWork(preview)));
}

export function membershipCancelMoneyOnVisit(
  wrapUp: DeathWrapUpPreview,
  membershipId: number,
  kind: DeathWrapUpKind = 'invoice'
): boolean {
  return kind === 'invoice' || wrapUp.moneyOnVisitMembershipIds.includes(membershipId);
}

export function membershipCancelMoneyLabel(
  preview: MembershipCancelPreview,
  kind: DeathWrapUpKind = 'invoice',
  wrapUp?: DeathWrapUpPreview
): string {
  const onVisit = wrapUp
    ? membershipCancelMoneyOnVisit(wrapUp, preview.membershipId, kind)
    : kind === 'invoice';
  const hasMoney = preview.chargeAmount > 0.009 || preview.refundAmount > 0.009;
  if (onVisit) {
    const where = kind === 'invoice' ? 'this invoice' : 'an open estimate or bill';
    if (preview.chargeAmount > 0.009) {
      return `${money(preview.chargeAmount)} already on ${where} (amount owed)`;
    }
    if (preview.refundAmount > 0.009) {
      return `${money(preview.refundAmount)} already on ${where} (credit)`;
    }
    return 'No extra charge or credit';
  }
  if (hasMoney && wrapUp?.visitMoneyCheckFailed) {
    return "Couldn't check the open estimates and bills. Close and try again before accepting";
  }
  if (preview.chargeAmount > 0.009) {
    return `Will charge ${money(preview.chargeAmount)} on cancel`;
  }
  if (preview.refundAmount > 0.009) {
    return `Will refund ${money(preview.refundAmount)} on cancel`;
  }
  return 'No extra charge or credit';
}

async function previewOnePatient(
  args: {
    patientId: number;
    patientName?: string | null;
    appointmentId?: number | null;
    /** Owner to search for open estimates and bills when there is no visit (chart inactivate). */
    clientId?: number | null;
    practiceId: number;
    practiceTz: string;
    subscriptions: StoreStaffSubscription[];
  },
): Promise<DeathWrapUpPreview> {
  const patientId = args.patientId;
  const patientName = args.patientName?.trim() || `Pet #${patientId}`;
  const excludeAppointmentIds =
    args.appointmentId != null && Number.isFinite(args.appointmentId) && args.appointmentId > 0
      ? [args.appointmentId]
      : [];

  const [memberships, reminders, futureAppointments] = await Promise.all([
    listPatientMemberships({ patientId }).catch(() => []),
    listPatientOpenReminders(patientId).catch(() => [] as UnscheduledReminder[]),
    findFutureAppointmentsForPatients({
      practiceId: args.practiceId,
      practiceTz: args.practiceTz,
      patients: [{ patientId: String(patientId), patientName }],
      excludeAppointmentIds,
    }).catch(() => [] as EuthanasiaFutureAppointmentRow[]),
  ]);

  const membershipPreviews: MembershipCancelPreview[] = [];
  for (const membership of memberships.filter((row) => row.status === 'active')) {
    try {
      membershipPreviews.push(await previewMembershipCancel(membership.id));
    } catch {
      /* already canceled between list and preview */
    }
  }

  const clientId =
    args.clientId != null && Number.isFinite(args.clientId) && args.clientId > 0
      ? args.clientId
      : null;
  const visitMoney =
    membershipPreviews.length === 0
      ? { descriptions: new Set<string>(), failed: false }
      : excludeAppointmentIds.length > 0
        ? await membershipCancelLinesOnVisit(excludeAppointmentIds[0], patientId)
        : clientId != null
          ? await membershipCancelLinesOnOpenDocs(clientId, patientId)
          : { descriptions: new Set<string>(), failed: false };

  return {
    patientId,
    patientName,
    memberships: membershipPreviews,
    autoships: args.subscriptions.filter(
      (row) => row.active && Number(row.patientId) === Number(patientId),
    ),
    reminders: reminders.filter(
      (row) => Number(row.patient?.id ?? 0) === Number(patientId) || !row.patient,
    ),
    futureAppointments,
    moneyOnVisitMembershipIds: membershipPreviews
      .filter((row) => visitMoney.descriptions.has(membershipCancelLineDescription(row.planName)))
      .map((row) => row.membershipId),
    visitMoneyCheckFailed: visitMoney.failed,
  };
}

/**
 * Descriptions of "Membership cancellation — …" lines for this pet on the visit's live
 * estimate or its non-void invoice. Estimate lines are copied to the invoice and captured
 * with the authorization, so cancelling with money as well would bill the owner twice.
 */
async function membershipCancelLinesOnVisit(
  appointmentId: number,
  patientId: number
): Promise<{ descriptions: Set<string>; failed: boolean }> {
  const descriptions = new Set<string>();
  const forPet = (
    linePatientId: number | null | undefined,
    docPatientId: number | null | undefined
  ) => Number(linePatientId ?? docPatientId ?? patientId) === Number(patientId);
  try {
    const [estimate, invoice] = await Promise.all([
      getEstimateForAppointment(appointmentId),
      getInvoiceByAppointment(appointmentId),
    ]);
    for (const line of estimate?.lines ?? []) {
      if (forPet(line.patientId, estimate?.patientId)) descriptions.add(line.description.trim());
    }
    if (invoice && invoice.status !== 'void') {
      const returned = new Set(
        (invoice.lines ?? []).map((line) => line.returnOfLineId).filter(Boolean)
      );
      for (const line of invoice.lines ?? []) {
        if (line.returnOfLineId || returned.has(line.id)) continue;
        if (forPet(line.patientId, invoice.patientId)) descriptions.add(line.description.trim());
      }
    }
    return { descriptions, failed: false };
  } catch {
    return { descriptions, failed: true };
  }
}

/**
 * Same check for the chart, where there is no visit: the owner's live estimates and unpaid
 * bills. A euthanasia estimate made before the chart inactivation already holds the cancel money.
 */
async function membershipCancelLinesOnOpenDocs(
  clientId: number,
  patientId: number
): Promise<{ descriptions: Set<string>; failed: boolean }> {
  const descriptions = new Set<string>();
  const forPet = (
    linePatientId: number | null | undefined,
    docPatientId: number | null | undefined
  ) => Number(linePatientId ?? docPatientId ?? patientId) === Number(patientId);
  try {
    const [estimates, invoices] = await Promise.all([
      listClientEstimates(clientId),
      listClientVisitInvoices(clientId),
    ]);
    for (const estimate of estimates) {
      if (estimate.status === 'converted') continue;
      for (const line of estimate.lines ?? []) {
        if (forPet(line.patientId, estimate.patientId)) descriptions.add(line.description.trim());
      }
    }
    for (const invoice of invoices) {
      if (invoice.status !== 'open' && invoice.status !== 'finalized') continue;
      const returned = new Set(
        (invoice.lines ?? []).map((line) => line.returnOfLineId).filter(Boolean)
      );
      for (const line of invoice.lines ?? []) {
        if (line.returnOfLineId || returned.has(line.id)) continue;
        if (forPet(line.patientId, invoice.patientId)) descriptions.add(line.description.trim());
      }
    }
    return { descriptions, failed: false };
  } catch {
    return { descriptions, failed: true };
  }
}

export async function previewDeathWrapUp(args: {
  patientId: number;
  patientName?: string | null;
  appointmentId?: number | null;
  clientId?: number | null;
  practiceId?: number;
  practiceTz?: string;
}): Promise<DeathWrapUpPreview> {
  const practiceId = args.practiceId ?? VISIT_WORKFLOW_PRACTICE_ID;
  const subscriptions = await listStoreSubscriptions(practiceId).catch(
    () => [] as StoreStaffSubscription[],
  );
  return previewOnePatient({
    patientId: args.patientId,
    patientName: args.patientName,
    appointmentId: args.appointmentId,
    clientId: args.clientId,
    practiceId,
    practiceTz: args.practiceTz ?? 'America/New_York',
    subscriptions,
  });
}

export async function previewDeathWrapUpForPatients(args: {
  patients: readonly { patientId: number; patientName?: string | null }[];
  appointmentId?: number | null;
  clientId?: number | null;
  practiceId?: number;
  practiceTz?: string;
}): Promise<DeathWrapUpPreview[]> {
  const practiceId = args.practiceId ?? VISIT_WORKFLOW_PRACTICE_ID;
  const practiceTz = args.practiceTz ?? 'America/New_York';
  const seen = new Set<number>();
  const patients = args.patients.filter((patient) => {
    if (!Number.isFinite(patient.patientId) || patient.patientId <= 0) return false;
    if (seen.has(patient.patientId)) return false;
    seen.add(patient.patientId);
    return true;
  });
  if (patients.length === 0) return [];

  const subscriptions = await listStoreSubscriptions(practiceId).catch(
    () => [] as StoreStaffSubscription[],
  );
  const previews: DeathWrapUpPreview[] = [];
  for (const patient of patients) {
    previews.push(
      await previewOnePatient({
        patientId: patient.patientId,
        patientName: patient.patientName,
        appointmentId: args.appointmentId,
        clientId: args.clientId,
        practiceId,
        practiceTz,
        subscriptions,
      }),
    );
  }
  return previews;
}

export async function acceptDeathWrapUp(
  preview: DeathWrapUpPreview,
  args?: { practiceId?: number; kind?: DeathWrapUpKind },
): Promise<DeathWrapUpAcceptResult> {
  const practiceId = args?.practiceId ?? VISIT_WORKFLOW_PRACTICE_ID;
  const kind = args?.kind ?? 'invoice';
  const reason = kind === 'invoice' ? DEATH_WRAP_UP_REASON : INACTIVATE_WRAP_UP_REASON;
  const errors: string[] = [];
  let membershipsCanceled = 0;
  let autoshipsCanceled = 0;
  let remindersCanceled = 0;

  for (const membership of preview.memberships) {
    const skipMoney = membershipCancelMoneyOnVisit(preview, membership.membershipId, kind);
    const hasMoney = membership.chargeAmount > 0.009 || membership.refundAmount > 0.009;
    if (!skipMoney && hasMoney && preview.visitMoneyCheckFailed) {
      errors.push(
        `Could not check whether ${membership.planName} is already on an open estimate or bill, so it was not cancelled. Try again.`
      );
      continue;
    }
    try {
      await cancelMembership(membership.membershipId, reason, {
        chargeAmount: membership.chargeAmount,
        refundAmount: membership.refundAmount,
        skipMoney,
      });
      membershipsCanceled += 1;
    } catch (err) {
      errors.push(apiErrorMessage(err) || `Could not cancel ${membership.planName}`);
    }
  }

  for (const autoship of preview.autoships) {
    try {
      await patchStoreSubscription(practiceId, autoship.id, { cancel: true });
      autoshipsCanceled += 1;
    } catch (err) {
      errors.push(
        apiErrorMessage(err) || `Could not cancel auto-ship for ${autoship.itemName || 'item'}`,
      );
    }
  }

  for (const reminder of preview.reminders) {
    try {
      await patchReminder(reminder.id, { isHidden: true });
      remindersCanceled += 1;
    } catch (err) {
      errors.push(apiErrorMessage(err) || `Could not cancel reminder ${reminder.description}`);
    }
  }

  const appointments = await cancelEuthanasiaFutureAppointments({
    rows: preview.futureAppointments,
    practiceId,
    reason,
  });
  errors.push(...appointments.errors);

  return {
    errors,
    membershipsCanceled,
    autoshipsCanceled,
    remindersCanceled,
    appointmentsCanceled: appointments.cancelledIds.length,
  };
}

export async function acceptDeathWrapUpHousehold(
  previews: readonly DeathWrapUpPreview[],
  args?: { practiceId?: number; kind?: DeathWrapUpKind },
): Promise<DeathWrapUpAcceptResult> {
  const totals: DeathWrapUpAcceptResult = {
    errors: [],
    membershipsCanceled: 0,
    autoshipsCanceled: 0,
    remindersCanceled: 0,
    appointmentsCanceled: 0,
  };
  for (const preview of previews) {
    const next = await acceptDeathWrapUp(preview, args);
    totals.errors.push(...next.errors);
    totals.membershipsCanceled += next.membershipsCanceled;
    totals.autoshipsCanceled += next.autoshipsCanceled;
    totals.remindersCanceled += next.remindersCanceled;
    totals.appointmentsCanceled += next.appointmentsCanceled;
  }
  return totals;
}
