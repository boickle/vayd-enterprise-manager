import { patchAppointment } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';

export type EditVisitFormSnapshot = {
  appointmentTypeId: number;
  primaryProviderId: number;
  additionalEmployeeIds: number[];
  description: string;
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
  /** Routing-driven type change — bypass manual booking permission check. */
  bookedViaRouting?: boolean;
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

  return patchAppointment(
    input.appointmentId,
    {
      appointmentTypeId: typeId,
      primaryProviderId: input.form.primaryProviderId,
      additionalEmployeeIds: input.form.additionalEmployeeIds,
      description: input.form.description.trim() || null,
      statusName: input.form.statusName.trim() || null,
      confirmStatusName: input.form.confirmStatusName.trim() || null,
      isComplete: input.form.isComplete,
      allDay: input.form.allDay,
      appointmentStart: input.appointmentStart,
      appointmentEnd: input.appointmentEnd,
      ...(input.bookedViaRouting ? { bookedViaRouting: true } : {}),
    },
    { practiceId: input.practiceId }
  );
}
