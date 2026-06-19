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

export function findVeterinarianById(
  veterinarians: VeterinarianWithAppointmentTypes[],
  doctorId: string | number | undefined,
): VeterinarianWithAppointmentTypes | null {
  if (doctorId == null) return null;
  const target = String(doctorId);
  return (
    veterinarians.find((v) => {
      const id = resolveVeterinarianRecordId(v);
      return id != null && id === target;
    }) ?? null
  );
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

export function canBookOnlineForNewPatientRequest(
  doctor: VeterinarianWithAppointmentTypes | null | undefined,
  appointmentTypeId: number | null | undefined,
): boolean {
  return (
    canBookOnline(doctor, appointmentTypeId) &&
    isVeterinarianAcceptingNewPatientsInClientZone(doctor)
  );
}

export function anyDoctorCanBookOnline(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeId: number | null | undefined,
): boolean {
  if (appointmentTypeId == null || !Number.isFinite(appointmentTypeId)) return false;
  return doctors.some((d) => canBookOnline(d, appointmentTypeId));
}

export function anyDoctorCanBookOnlineForNewPatientRequest(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeId: number | null | undefined,
): boolean {
  if (appointmentTypeId == null || !Number.isFinite(appointmentTypeId)) return false;
  return doctors.some((d) => canBookOnlineForNewPatientRequest(d, appointmentTypeId));
}

export function isOnlineBookingUnavailableError(
  status: number | undefined,
  message: string | string[] | undefined,
): boolean {
  if (status !== 403) return false;
  const m = (Array.isArray(message) ? message.join(' ') : (message ?? '')).toLowerCase();
  return m.includes('online booking') || m.includes('not available');
}

export const ONLINE_BOOKING_UNAVAILABLE_MESSAGE =
  'Online booking is not available for this doctor and appointment type. Please enter your preferred times and a Client Liaison will contact you.';

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

export type AppointmentFormSubmitSuccessKind = 'online_confirmed' | 'request_received';

/** Classify public form POST success message from the API. */
export function appointmentFormSubmitSuccessKindFromMessage(
  message: string | undefined,
): AppointmentFormSubmitSuccessKind {
  const m = (message ?? '').toLowerCase();
  if (m.includes('booked successfully') || m.includes('appointment is confirmed')) {
    return 'online_confirmed';
  }
  return 'request_received';
}
