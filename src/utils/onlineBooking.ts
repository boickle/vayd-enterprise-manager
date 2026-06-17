/** Veterinarian row from GET /public/appointments/veterinarians or GET /employees/veterinarians */
export type VeterinarianWithAppointmentTypes = {
  id?: number | string;
  appointmentTypes?: Array<{
    id: number;
    allowOnlineBooking?: boolean;
  }>;
};

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

export function anyDoctorCanBookOnline(
  doctors: VeterinarianWithAppointmentTypes[],
  appointmentTypeId: number | null | undefined,
): boolean {
  if (appointmentTypeId == null || !Number.isFinite(appointmentTypeId)) return false;
  return doctors.some((d) => canBookOnline(d, appointmentTypeId));
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
