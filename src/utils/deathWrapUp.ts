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
import { VISIT_WORKFLOW_PRACTICE_ID } from '../api/visitWorkflow';
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

export function membershipCancelMoneyLabel(
  preview: MembershipCancelPreview,
  kind: DeathWrapUpKind = 'invoice',
): string {
  if (kind === 'invoice') {
    if (preview.chargeAmount > 0.009) {
      return `${money(preview.chargeAmount)} already on this invoice (amount owed)`;
    }
    if (preview.refundAmount > 0.009) {
      return `${money(preview.refundAmount)} already on this invoice (credit)`;
    }
    return 'No extra charge or credit';
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
  };
}

export async function previewDeathWrapUp(args: {
  patientId: number;
  patientName?: string | null;
  appointmentId?: number | null;
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
    practiceId,
    practiceTz: args.practiceTz ?? 'America/New_York',
    subscriptions,
  });
}

export async function previewDeathWrapUpForPatients(args: {
  patients: readonly { patientId: number; patientName?: string | null }[];
  appointmentId?: number | null;
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
  const skipMoney = (args?.kind ?? 'invoice') === 'invoice';
  const reason = skipMoney ? DEATH_WRAP_UP_REASON : INACTIVATE_WRAP_UP_REASON;
  const errors: string[] = [];
  let membershipsCanceled = 0;
  let autoshipsCanceled = 0;
  let remindersCanceled = 0;

  for (const membership of preview.memberships) {
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
