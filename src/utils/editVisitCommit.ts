import { patchAppointment, putAppointmentAlternateAddress } from '../api/appointments';
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
  alternateAddressText: string;
  initialAlternateAddressText: string;
};

export type CommitEditVisitInput = {
  appointmentId: number;
  practiceId: number;
  appointmentStart: string;
  appointmentEnd: string;
  form: EditVisitFormSnapshot;
  /** When set (type preview on calendar), overrides `form.appointmentTypeId`. */
  previewAppointmentTypeId?: number | null;
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

  const trimmedAlt = input.form.alternateAddressText.trim();
  if (trimmedAlt.length > 4000) {
    throw new Error('Alternate address must be 4000 characters or fewer.');
  }

  const alternateDirty = input.form.initialAlternateAddressText !== trimmedAlt;

  const updated = await patchAppointment(
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
    },
    { practiceId: input.practiceId }
  );

  if (alternateDirty) {
    await putAppointmentAlternateAddress(input.appointmentId, {
      addressText: trimmedAlt === '' ? null : trimmedAlt,
    });
  }

  return updated;
}
