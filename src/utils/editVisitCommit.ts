import { patchAppointment } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import {
  appendEditedByStaffNote,
  type AppointmentChangeActor,
  type EditVisitChangeKind,
} from './appointmentChangeAuditNote';

export type EditVisitFormSnapshot = {
  appointmentTypeId: number;
  primaryProviderId: number;
  additionalEmployeeIds: number[];
  description: string;
  instructions: string;
  statusName: string;
  confirmStatusName: string;
  isComplete: boolean;
  allDay: boolean;
};

export type CommitEditVisitInput = {
  appointmentId: number;
  practiceId: number;
  appointmentStart: string;
  appointmentEnd: string;
  form: EditVisitFormSnapshot;
  /** When set (type preview on calendar), overrides `form.appointmentTypeId`. */
  previewAppointmentTypeId?: number | null;
  /** Append edit audit line(s) to staff notes before save. */
  editedByAudit?: {
    actor: AppointmentChangeActor;
    practiceTz: string;
    changes: EditVisitChangeKind[];
  };
};

export async function commitEditVisit(input: CommitEditVisitInput): Promise<Appointment> {
  const typeId =
    input.previewAppointmentTypeId != null &&
    Number.isFinite(Number(input.previewAppointmentTypeId))
      ? Number(input.previewAppointmentTypeId)
      : input.form.appointmentTypeId;

  if (!Number.isFinite(typeId) || typeId <= 0) {
    throw new Error('Choose a valid appointment type.');
  }
  if (!Number.isFinite(input.form.primaryProviderId) || input.form.primaryProviderId <= 0) {
    throw new Error('Choose a primary provider.');
  }

  const description = input.form.description.trim();
  let instructions = input.form.instructions.trim();
  if (input.editedByAudit?.changes.length) {
    instructions = appendEditedByStaffNote(
      instructions,
      input.editedByAudit.actor,
      input.editedByAudit.practiceTz,
      input.editedByAudit.changes
    ).trim();
  }

  return patchAppointment(
    input.appointmentId,
    {
      appointmentTypeId: typeId,
      primaryProviderId: input.form.primaryProviderId,
      additionalEmployeeIds: input.form.additionalEmployeeIds,
      description: description || null,
      instructions: instructions || null,
      statusName: input.form.statusName.trim() || null,
      confirmStatusName: input.form.confirmStatusName.trim() || null,
      isComplete: input.form.isComplete,
      allDay: input.form.allDay,
      appointmentStart: input.appointmentStart,
      appointmentEnd: input.appointmentEnd,
      /** PATCH on existing visit — not manual booking; skip role type permission gate. */
      bookedViaRouting: true,
    },
    { practiceId: input.practiceId }
  );
}
