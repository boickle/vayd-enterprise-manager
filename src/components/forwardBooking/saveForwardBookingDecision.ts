import { patchForwardBookingDisposition } from '../../api/forwardBookingDisposition';
import type { ForwardBookingDisposition } from '../../api/forwardBookingDisposition';
import { createForwardBooking, type ForwardBookingEntry } from '../../api/forwardBooking';
import { createTask } from '../../api/tasks';
import { updateEncounter } from '../../api/visitWorkflow';
import {
  buildForwardBookingDispositionPayload,
  type ForwardBookingDispositionFormState,
} from '../../utils/forwardBookingDisposition';
import { LABS_PENDING_FORWARD_BOOKING_TASK_BODY } from '../../utils/forwardBookingCreateLink';
import { validateTaskScheduleOrder } from '../../utils/taskDateTime';
import { notifyTasksChanged } from '../../utils/taskOwnership';

export type ForwardBookingDecisionTarget = {
  appointmentId: number;
  patientId: number;
  patientName?: string | null;
  clientId: number | null;
  /** Mirror the choice onto the SOAP encounter when the visit has a chart. */
  soapEncounterId?: string | null;
  /** Provider the follow-up should be booked with, when known from the visit. */
  providerId?: number | null;
};

export type ForwardBookingDecisionResult = {
  disposition: ForwardBookingDisposition;
  /** The queue row "Forward book" created, for handing straight off to Routing. */
  entry: ForwardBookingEntry | null;
  taskId: number | null;
};

/**
 * Saves one pet's follow-up choice and performs the side effects the chosen mode
 * implies: "Forward book" adds a row to the forward-booking queue for scheduling
 * staff to work, "Labs pending" creates the task that chases the result.
 *
 * Shared by every surface that asks the follow-up question (tech checkout, the
 * visit wrap-up) so a choice means the same thing and lands in the same places
 * regardless of who recorded it.
 *
 * The disposition is written to both the appointment and the SOAP encounter on
 * purpose. They are independent stores here and only the encounter's copy gates
 * completing the chart, so writing one without the other is how a visit ends up
 * looking booked on the calendar and unbooked in the record.
 */
export async function saveForwardBookingDecision(
  target: ForwardBookingDecisionTarget,
  form: ForwardBookingDispositionFormState,
  opts: {
    practiceId: number;
    /** Required for "Labs pending" — tasks are branch-scoped. */
    branchIds: number[];
    /** Used when the task title was left empty. */
    labsTaskTitleFallback: string;
  }
): Promise<ForwardBookingDecisionResult> {
  const disposition = buildForwardBookingDispositionPayload(form);
  let entry: ForwardBookingEntry | null = null;
  let taskId: number | null = null;

  if (disposition.mode === 'forward_book_fields') {
    if (target.clientId == null) {
      throw new Error(
        'This visit has no client on file, so it cannot be added to the forward booking list.'
      );
    }
    entry = await createForwardBooking({
      practiceId: opts.practiceId,
      sourceAppointmentId: target.appointmentId,
      clientId: target.clientId,
      patientId: target.patientId,
      intervalAmount: disposition.intervalAmount!,
      intervalUnit: disposition.intervalUnit!,
      primaryProviderId: target.providerId ?? undefined,
      bookingNotes: disposition.bookingNotes ?? undefined,
      createdVia: 'end_visit',
    });
  }

  if (disposition.mode === 'labs_pending') {
    const labs = disposition.labsPendingTask;
    if (opts.branchIds.length === 0) {
      throw new Error('Could not determine practice branches for the task.');
    }
    const scheduleError = validateTaskScheduleOrder(labs?.startAt ?? null, labs?.dueAt ?? null);
    if (scheduleError) throw new Error(scheduleError);
    const task = await createTask({
      title:
        labs?.title?.trim() ||
        `${opts.labsTaskTitleFallback}${target.patientName ? ` — ${target.patientName}` : ''}`,
      body: LABS_PENDING_FORWARD_BOOKING_TASK_BODY,
      branchIds: opts.branchIds,
      assignedToEmployeeId: labs?.assignedToEmployeeId ?? null,
      startAt: labs?.startAt ?? null,
      dueAt: labs?.dueAt ?? null,
      links: [
        ...(target.clientId != null
          ? ([{ entityType: 'client', entityId: target.clientId }] as const)
          : []),
        { entityType: 'appointment', entityId: target.appointmentId },
        { entityType: 'patient', entityId: target.patientId },
      ],
    });
    taskId = Number(task.id);
    notifyTasksChanged();
  }

  const entryId = entry ? Number(entry.id) : null;

  await patchForwardBookingDisposition(target.appointmentId, disposition, {
    practiceId: opts.practiceId,
  });
  if (target.soapEncounterId) {
    await updateEncounter(target.soapEncounterId, {
      forwardBookingDisposition: disposition as unknown as Record<string, unknown>,
      ...(entryId != null ? { forwardBookingEntryId: entryId } : {}),
      ...(taskId != null ? { forwardBookingTaskId: taskId } : {}),
    });
  }

  return { disposition, entry, taskId };
}
