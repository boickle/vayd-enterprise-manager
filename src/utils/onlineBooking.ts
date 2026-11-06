import { DateTime } from 'luxon';
import { deriveVeterinarianClientZoneFlags } from '../api/employee';
import { goalDayOfWeekFromLuxonWeekday } from '../api/employeeGoals';

/** Veterinarian row from GET /public/appointments/veterinarians or GET /employees/veterinarians */
export type VeterinarianWithAppointmentTypes = {
  id?: number | string;
  employeeId?: number | string;
  pimsId?: number | string;
  appointmentTypes?: Array<{
    id: number;
    allowOnlineBooking?: boolean;
  }>;
  weeklySchedules?: Array<{
    dayOfWeek?: number;
    isWorkday?: boolean;
    zones?: Array<{ acceptingNewPatients?: boolean }> | null;
  }> | null;
};

export function resolveVeterinarianRecordId(vet: {
  id?: number | string;
  employeeId?: number | string;
  pimsId?: number | string;
}): string | null {
  const id = vet.id ?? vet.employeeId ?? vet.pimsId;
  return id != null ? String(id) : null;
}

function veterinarianLookupIds(vet: VeterinarianWithAppointmentTypes): string[] {
  const extra = vet as VeterinarianWithAppointmentTypes & { pimsUserId?: number | string };
  return [vet.id, vet.employeeId, vet.pimsId, extra.pimsUserId]
    .filter((value) => value != null && String(value).trim() !== '')
    .map((value) => String(value));
}

export function findVeterinarianById(
  veterinarians: VeterinarianWithAppointmentTypes[],
  doctorId: string | number | undefined,
): VeterinarianWithAppointmentTypes | null {
  if (doctorId == null) return null;
  const target = String(doctorId);
  return veterinarians.find((v) => veterinarianLookupIds(v).includes(target)) ?? null;
}

/** Goals API dayOfWeek: 0 = Sunday … 6 = Saturday. */
export function isDoctorAcceptingNewPatientsOnDayOfWeek(
  doctor: Pick<VeterinarianWithAppointmentTypes, 'weeklySchedules'> | null | undefined,
  dayOfWeek: number,
): boolean {
  const schedules = doctor?.weeklySchedules;
  if (!Array.isArray(schedules) || schedules.length === 0) return false;

  const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (!schedule || schedule.isWorkday === false) return false;

  const zones = schedule.zones;
  if (!Array.isArray(zones) || zones.length === 0) return false;

  return zones.some((z) => z.acceptingNewPatients === true);
}

export function isDoctorAcceptingNewPatientsOnSlotDate(
  doctor: Pick<VeterinarianWithAppointmentTypes, 'weeklySchedules'> | null | undefined,
  slotIso: string,
): boolean {
  const dt = DateTime.fromISO(slotIso);
  if (!dt.isValid) return false;
  const dayOfWeek = goalDayOfWeekFromLuxonWeekday(dt.weekday);
  return isDoctorAcceptingNewPatientsOnDayOfWeek(doctor, dayOfWeek);
}

export function isVeterinarianAcceptingNewPatientsInClientZone(
  doctor: Pick<VeterinarianWithAppointmentTypes, 'weeklySchedules'> | null | undefined,
): boolean {
  if (!doctor) return false;
  return deriveVeterinarianClientZoneFlags(doctor).acceptingNewPatients;
}

export function canBookOnline(
  doctor: VeterinarianWithAppointmentTypes | null | undefined,
  appointmentTypeId: number | null | undefined,
): boolean {
  if (doctor == null || appointmentTypeId == null || !Number.isFinite(appointmentTypeId)) {
    return false;
  }
  return (
    doctor.appointmentTypes?.some(
      (t) => t.id === appointmentTypeId && t.allowOnlineBooking === true,
    ) ?? false
  );
}

export function canBookOnlineForVisitTypes(
  doctor: VeterinarianWithAppointmentTypes | null | undefined,
  appointmentTypeIds: readonly number[],
): boolean {
  if (appointmentTypeIds.length === 0) return false;
  return appointmentTypeIds.every((typeId) => canBookOnline(doctor, typeId));
}

export function canBookOnlineForNewPatientRequest(
  doctor: VeterinarianWithAppointmentTypes | null | undefined,
  appointmentTypeId: number | null | undefined,
): boolean {
  return (
    canBookOnline(doctor, appointmentTypeId) &&
    isVeterinarianAcceptingNewPatientsInClientZone(doctor)
  );
}

export function canBookOnlineForNewPatientRequestForVisitTypes(
  doctor: VeterinarianWithAppointmentTypes | null | undefined,
  appointmentTypeIds: readonly number[],
): boolean {
  if (appointmentTypeIds.length === 0) return false;
  return appointmentTypeIds.every((typeId) =>
    canBookOnlineForNewPatientRequest(doctor, typeId),
  );
}

export function anyDoctorCanBookOnline(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeId: number | null | undefined,
): boolean {
  if (appointmentTypeId == null || !Number.isFinite(appointmentTypeId)) return false;
  return doctors.some((d) => canBookOnline(d, appointmentTypeId));
}

export function anyDoctorCanBookOnlineForVisitTypes(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeIds: readonly number[],
): boolean {
  if (appointmentTypeIds.length === 0) return false;
  return doctors.some((d) => canBookOnlineForVisitTypes(d, appointmentTypeIds));
}

export function anyDoctorCanBookOnlineForNewPatientRequest(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeId: number | null | undefined,
): boolean {
  if (appointmentTypeId == null || !Number.isFinite(appointmentTypeId)) return false;
  return doctors.some((d) => canBookOnlineForNewPatientRequest(d, appointmentTypeId));
}

export function anyDoctorCanBookOnlineForNewPatientRequestForVisitTypes(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeIds: readonly number[],
): boolean {
  if (appointmentTypeIds.length === 0) return false;
  return doctors.some((d) =>
    canBookOnlineForNewPatientRequestForVisitTypes(d, appointmentTypeIds),
  );
}

export function isOnlineBookingUnavailableError(
  status: number | undefined,
  message: string | string[] | undefined,
): boolean {
  if (status !== 403) return false;
  const m = (Array.isArray(message) ? message.join(' ') : (message ?? '')).toLowerCase();
  return m.includes('online booking') || m.includes('not available');
}

/**
 * Overlapping month browses for the same doctor abort the older search server-side.
 * Treat that as a soft cancel (a newer request is in flight), not a user-facing failure.
 */
export function isSupersededAvailabilityError(
  status: number | undefined,
  message: string | string[] | undefined,
): boolean {
  if (status !== 400 && status !== 409) return false;
  const m = (Array.isArray(message) ? message.join(' ') : (message ?? '')).toLowerCase();
  return (
    m.includes('superseded') ||
    m.includes('booking is in progress') ||
    m.includes('availability search was cancelled')
  );
}

export const ONLINE_BOOKING_UNAVAILABLE_MESSAGE =
  "Online booking isn't available for this doctor and appointment type. Please enter your preferred times below and our team will reach out to schedule with you.";

export const ONLINE_BOOKING_OTHER_SPECIES_MESSAGE =
  "Online booking isn't available when a pet species is listed as Other. Please enter your preferred times below and our team will reach out to schedule with you.";

/** Self-scheduling only when every new pet on the form is Dog or Cat (not Other). */
export function petsSpeciesAllowOnlineScheduling(
  pets: ReadonlyArray<{ speciesChoice?: string | null }>,
): boolean {
  return !pets.some((p) => p.speciesChoice === 'Other');
}

export const SLOT_NO_LONGER_AVAILABLE_MESSAGE =
  'The selected time is no longer available. Please choose another time.';

export function extractApiResponseMessage(message: string | string[] | undefined): string {
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' ? message.trim() : '';
}

export function isSlotNoLongerAvailableError(
  status: number | undefined,
  message: string | string[] | undefined,
): boolean {
  if (status !== 400) return false;
  const m = extractApiResponseMessage(message).toLowerCase();
  return m.includes('no longer available') || m.includes('selected time');
}

export type AppointmentFormSubmitSuccessKind =
  | 'online_confirmed'
  /** Booked for a new pet with handling needs; held until the team reviews records. */
  | 'online_held_pending_handling'
  | 'request_received'
  /** D2: the picked time was taken at submit; nothing was booked and the team will call. */
  | 'slot_taken'
  /** Some pets were booked; the team will call about the rest. */
  | 'online_partial';

/** Classify public form POST success message from the API. */
export function appointmentFormSubmitSuccessKindFromMessage(
  message: string | undefined,
): AppointmentFormSubmitSuccessKind {
  const m = (message ?? '').toLowerCase();
  if (m.includes('held your appointment') || m.includes('review your pet')) {
    return 'online_held_pending_handling';
  }
  if (m.includes('booked successfully') || m.includes('appointment is confirmed')) {
    return 'online_confirmed';
  }
  return 'request_received';
}

/**
 * Classify the public form POST response. Prefers the API's `bookingOutcome`; older APIs only
 * send a message.
 */
export function appointmentFormSubmitSuccessKindFromResponse(
  response: { message?: string | string[]; bookingOutcome?: string } | null | undefined
): AppointmentFormSubmitSuccessKind {
  // A visit held for handling review is booked, but the client sees the "held" screen.
  if (
    response?.bookingOutcome !== 'slot_taken' &&
    appointmentFormSubmitSuccessKindFromMessage(extractApiResponseMessage(response?.message)) ===
      'online_held_pending_handling'
  ) {
    return 'online_held_pending_handling';
  }
  switch (response?.bookingOutcome) {
    case 'slot_taken':
      return 'slot_taken';
    case 'partial':
      return 'online_partial';
    case 'booked':
      return 'online_confirmed';
    case 'not_booked':
    case 'request':
      return 'request_received';
    default:
      return appointmentFormSubmitSuccessKindFromMessage(
        extractApiResponseMessage(response?.message)
      );
  }
}
