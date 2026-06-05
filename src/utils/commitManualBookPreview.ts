import {
  createAppointment,
  putAppointmentAlternateAddress,
} from '../api/appointments';
import type { Provider } from '../api/employee';
import { appendBookedStaffNote } from '../utils/bookedAppointmentDescription';
import { resolveAppointmentChangeActorFromAuth } from '../utils/appointmentChangeAuditNote';
import type { ManualBookPreviewDraft } from './routingCalendarPreviewStorage';

export async function commitManualBookPreviewDraft(
  draft: ManualBookPreviewDraft,
  ctx: {
    providers: readonly Provider[];
    practiceTz: string;
    token?: string | null;
    userEmail?: string | null;
    doctorId?: string | null;
  },
): Promise<number> {
  const trimmedAlt = draft.alternateAddressText?.trim() ?? '';
  if (trimmedAlt.length > 4000) {
    throw new Error('Alternate address must be 4000 characters or fewer.');
  }

  const bookActor = resolveAppointmentChangeActorFromAuth({
    token: ctx.token,
    userEmail: ctx.userEmail,
    doctorId: ctx.doctorId,
    providers: ctx.providers,
  });

  const instructions = appendBookedStaffNote(
    draft.instructions?.trim() || null,
    bookActor,
    ctx.practiceTz,
  ).trim();

  const created = await createAppointment({
    practiceId: draft.practiceId,
    primaryProviderId: draft.primaryProviderId,
    ...(draft.additionalEmployeeIds?.length
      ? { additionalEmployeeIds: draft.additionalEmployeeIds }
      : {}),
    ...(draft.clientId ? { clientId: Number(draft.clientId) } : {}),
    ...(draft.patientId ? { patientId: Number(draft.patientId) } : {}),
    ...(trimmedAlt ? { alternateAddressText: trimmedAlt } : {}),
    appointmentTypeId: draft.appointmentTypeId,
    appointmentStart: draft.appointmentStartIso,
    appointmentEnd: draft.appointmentEndIso,
    description: draft.description?.trim() || undefined,
    instructions: instructions || undefined,
  });

  const idRaw = created?.id;
  if (idRaw == null || !Number.isFinite(Number(idRaw))) {
    throw new Error('Appointment was created but no id was returned.');
  }
  const apptId = Number(idRaw);

  if (trimmedAlt) {
    await putAppointmentAlternateAddress(apptId, { addressText: trimmedAlt });
  }

  return apptId;
}
