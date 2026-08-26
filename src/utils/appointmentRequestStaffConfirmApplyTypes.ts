import { fetchAppointmentById, isAppointmentCancelledOnPracticeCalendar, patchAppointment } from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Appointment } from '../api/roomLoader';
import {
  requestDataPetRowSummaries,
  type AppointmentRequestPetRowSummary,
} from './appointmentRequestDetailDisplay';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { appointmentTypeRequiresPatient } from './appointmentTypeSettings';
import { patientsForAppointment } from './schedulerAddPet';
import { pickStr } from './schedulerVisitDisplay';
import { appointmentTypeForRoutingStatsKey } from './routingCalculateTimeType';

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

/** No patient linked on this calendar row yet (HOLD before Edit). */
function visitRowMissingLinkedPatient(appt: Appointment): boolean {
  return patientsForAppointment(appt).length === 0;
}

function resolvePetTargetTypeId(
  pet: AppointmentRequestPetRowSummary,
  appointmentTypes: readonly AppointmentType[],
): number | null {
  if (pet.appointmentTypeId != null && pet.appointmentTypeId > 0) {
    return pet.appointmentTypeId;
  }
  const label = pet.appointmentType?.trim();
  if (!label) return null;
  const matched = appointmentTypeForRoutingStatsKey(label, appointmentTypes);
  if (matched?.id != null && Number(matched.id) > 0) return Number(matched.id);
  return null;
}

/** HOLD → visit type only when the calendar row can satisfy type rules (e.g. patient linked). */
export function canApplyStaffConfirmVisitTypeUpgrade(
  appt: Appointment,
  targetType: AppointmentType | undefined,
): boolean {
  if (!targetType) return false;
  if (appointmentTypeRequiresPatient(targetType) && visitRowMissingLinkedPatient(appt)) {
    return false;
  }
  return true;
}

/** Block Confirm when request visit types need a patient that is not on the calendar row yet. */
export function staffConfirmVisitTypeUpgradeBlockedMessage(args: {
  requestData: Record<string, unknown>;
  appointments: readonly Appointment[];
  appointmentTypes: readonly AppointmentType[];
  catalog: AppointmentTypeCatalog;
}): string | null {
  const pets = requestDataPetRowSummaries(args.requestData);
  if (pets.length === 0 || args.appointments.length === 0) return null;

  const sortedAppts = [...args.appointments].sort(
    (a, b) => Number(a.id) - Number(b.id) || String(a.appointmentStart).localeCompare(String(b.appointmentStart)),
  );
  const usedIds = new Set<number>();

  for (const pet of pets) {
    const targetTypeId = resolvePetTargetTypeId(pet, args.appointmentTypes);
    if (targetTypeId == null || targetTypeId <= 0) continue;
    const typeRow = args.appointmentTypes.find((t) => t.id === targetTypeId);
    if (!appointmentTypeRequiresPatient(typeRow)) continue;

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

    if (visitRowMissingLinkedPatient(appt)) {
      const label = typeRow?.prettyName?.trim() || typeRow?.name?.trim() || 'This visit type';
      return `${label} requires a patient. Use Edit to link the client and pet before confirming.`;
    }
  }

  return null;
}

/** Block Confirm while any household row is still a 0-point hold type. */
export function staffConfirmHoldVisitBlockedMessage(args: {
  appointments: readonly Appointment[];
  catalog: AppointmentTypeCatalog;
}): string | null {
  for (const appt of args.appointments) {
    if (isAppointmentCancelledOnPracticeCalendar(appt)) continue;
    if (opsPointsForAppointment(appt, args.catalog) <= 0) {
      return 'This visit is still on hold. Use Edit to link the client and change each pet to a real visit type before confirming.';
    }
  }
  return null;
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
    const targetTypeId = resolvePetTargetTypeId(pet, args.appointmentTypes);
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
    if (!canApplyStaffConfirmVisitTypeUpgrade(appt, typeRow)) continue;

    try {
      const patched = await patchAppointment(
        apptId,
        {
          appointmentTypeId: targetTypeId,
          ...(typeRow?.name ? { appointmentTypeName: typeRow.name } : {}),
        },
        { practiceId: args.practiceId },
      );
      updated.push(patched);
    } catch {
      // Skip rows that fail validation (e.g. wellness without patient).
    }
  }

  return updated;
}
