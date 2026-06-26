import { patchAppointment } from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Appointment } from '../api/roomLoader';
import {
  requestDataPetRowSummaries,
  type AppointmentRequestPetRowSummary,
} from './appointmentRequestDetailDisplay';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { patientsForAppointment } from './schedulerAddPet';
import { pickStr } from './schedulerVisitDisplay';

function appointmentTypeIdFromAppt(appt: Appointment): number | null {
  const fromObj = appt.appointmentType?.id;
  if (fromObj != null && Number.isFinite(Number(fromObj)) && Number(fromObj) > 0) {
    return Number(fromObj);
  }
  const raw = (appt as { appointmentTypeId?: number }).appointmentTypeId;
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) return Number(raw);
  return null;
}

function petNameInAppointmentText(appt: Appointment, petName: string): boolean {
  const name = petName.trim().toLowerCase();
  if (!name) return false;
  const hay = [appt.description, appt.instructions]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!hay) return false;
  if (hay.includes(`${name}:`)) return true;
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay);
}

function appointmentMatchesPet(
  appt: Appointment,
  pet: AppointmentRequestPetRowSummary,
): boolean {
  const petName = pet.name.trim().toLowerCase();
  if (!petName) return false;

  for (const patient of patientsForAppointment(appt)) {
    const patientName = pickStr(patient.name)?.trim().toLowerCase();
    if (patientName && patientName === petName) return true;
    if (pet.patientId && String(patient.id) === String(pet.patientId)) return true;
    if (pet.patientPimsId && pickStr(patient.pimsId) === pet.patientPimsId) return true;
  }

  return petNameInAppointmentText(appt, pet.name);
}

function matchPetToAppointment(
  pet: AppointmentRequestPetRowSummary,
  appointments: readonly Appointment[],
  usedIds: ReadonlySet<number>,
): Appointment | undefined {
  for (const appt of appointments) {
    const id = Number(appt.id);
    if (!Number.isFinite(id) || usedIds.has(id)) continue;
    if (appointmentMatchesPet(appt, pet)) return appt;
  }
  return undefined;
}

/** Pet name from the online request when it matches this calendar hold row. */
export function appointmentRequestPetNameForVisit(
  appt: Appointment,
  requestData: Record<string, unknown> | null | undefined,
): string | null {
  if (!requestData) return null;
  for (const pet of requestDataPetRowSummaries(requestData)) {
    if (appointmentMatchesPet(appt, pet)) return pet.name;
  }
  return null;
}

export function staffConfirmHouseholdEditChoiceLabels(
  appointments: readonly Appointment[],
  requestData: Record<string, unknown> | null | undefined,
  fallbackLabel: (appt: Appointment) => string,
): { appointmentId: number; label: string }[] {
  return appointments
    .map((visitAppt) => {
      const appointmentId = Number(visitAppt.id);
      const label =
        appointmentRequestPetNameForVisit(visitAppt, requestData) ??
        fallbackLabel(visitAppt);
      return { appointmentId, label };
    })
    .filter((row) => Number.isFinite(row.appointmentId) && row.appointmentId > 0);
}

/**
 * Replace generic "Hold for Client" calendar rows with the visit types from the
 * online request (wellness, euthanasia, etc.) before staff confirms.
 */
export async function applyAppointmentRequestTypesToStaffConfirmVisits(args: {
  requestData: Record<string, unknown>;
  appointments: readonly Appointment[];
  catalog: AppointmentTypeCatalog;
  appointmentTypes: readonly AppointmentType[];
  practiceId: number;
}): Promise<Appointment[]> {
  const pets = requestDataPetRowSummaries(args.requestData);
  if (pets.length === 0 || args.appointments.length === 0) return [];

  const sortedAppts = [...args.appointments].sort(
    (a, b) => Number(a.id) - Number(b.id) || String(a.appointmentStart).localeCompare(String(b.appointmentStart)),
  );
  const usedIds = new Set<number>();
  const updated: Appointment[] = [];

  for (const pet of pets) {
    const targetTypeId = pet.appointmentTypeId;
    if (targetTypeId == null || targetTypeId <= 0) continue;

    let appt = matchPetToAppointment(pet, sortedAppts, usedIds);
    if (!appt) {
      appt = sortedAppts.find((row) => {
        const id = Number(row.id);
        return Number.isFinite(id) && !usedIds.has(id);
      });
    }
    if (!appt) continue;

    const apptId = Number(appt.id);
    if (!Number.isFinite(apptId)) continue;
    usedIds.add(apptId);

    const points = opsPointsForAppointment(appt, args.catalog);
    if (points > 0) continue;

    const currentTypeId = appointmentTypeIdFromAppt(appt);
    if (currentTypeId === targetTypeId) continue;

    const typeRow = args.appointmentTypes.find((t) => t.id === targetTypeId);
    const patched = await patchAppointment(
      apptId,
      {
        appointmentTypeId: targetTypeId,
        ...(typeRow?.name ? { appointmentTypeName: typeRow.name } : {}),
      },
      { practiceId: args.practiceId },
    );
    updated.push(patched);
  }

  return updated;
}
