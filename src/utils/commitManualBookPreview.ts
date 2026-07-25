import {
  createAppointment,
  putAppointmentAlternateAddress,
} from '../api/appointments';
import type { Provider } from '../api/employee';
import { appendBookedStaffNote } from '../utils/bookedAppointmentDescription';
import { resolveAppointmentChangeActorFromAuth } from '../utils/appointmentChangeAuditNote';
import type { ManualBookPreviewDraft } from './routingCalendarPreviewStorage';
import type { AppointmentType } from '../api/appointmentSettings';
import { appointmentFormFlags } from './appointmentTypeSettings';
import type { Appointment } from '../api/roomLoader';
import { patientHasOverlappingActiveVisit } from './patientOverlappingVisit';

/** Process-wide lock — survives React remounts / double Book clicks on the same draft. */
const inFlightManualBookKeys = new Set<string>();

function manualBookLockKey(draft: ManualBookPreviewDraft): string {
  return [
    draft.practiceId,
    draft.primaryProviderId,
    draft.patientId?.trim() || 'no-patient',
    draft.appointmentStartIso,
    draft.appointmentEndIso,
    draft.appointmentTypeId,
  ].join('|');
}

export async function commitManualBookPreviewDraft(
  draft: ManualBookPreviewDraft,
  ctx: {
    providers: readonly Provider[];
    practiceTz: string;
    token?: string | null;
    userEmail?: string | null;
    doctorId?: string | null;
    appointmentTypes?: readonly AppointmentType[];
    /** When provided, refuse to create a second active overlapping visit for the same pet. */
    existingAppointments?: readonly Appointment[];
  },
): Promise<number> {
  const trimmedAlt = draft.alternateAddressText?.trim() ?? '';
  if (trimmedAlt.length > 4000) {
    throw new Error('Alternate address must be 4000 characters or fewer.');
  }

  const selectedType = ctx.appointmentTypes?.find((t) => t.id === draft.appointmentTypeId);
  if (appointmentFormFlags(selectedType).requirePatient && !draft.patientId?.trim()) {
    throw new Error('Select a patient — this appointment type requires one.');
  }

  // Co-visit add-pet only: block true duplicates. Manual override may intentionally
  // book while the pet has another overlapping visit on a different provider.
  if (
    draft.coVisitAddPet &&
    draft.patientId?.trim() &&
    ctx.existingAppointments &&
    patientHasOverlappingActiveVisit({
      appointments: ctx.existingAppointments,
      patientId: draft.patientId.trim(),
      startIso: draft.appointmentStartIso,
      endIso: draft.appointmentEndIso,
    })
  ) {
    throw new Error('This pet already has an appointment overlapping that time.');
  }

  const lockKey = manualBookLockKey(draft);
  if (inFlightManualBookKeys.has(lockKey)) {
    throw new Error('This appointment is already being saved. Wait a moment and refresh if needed.');
  }
  inFlightManualBookKeys.add(lockKey);

  try {
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
      ...(draft.coVisitAddPet ? { bookedViaRouting: true } : {}),
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
  } finally {
    inFlightManualBookKeys.delete(lockKey);
  }
}
