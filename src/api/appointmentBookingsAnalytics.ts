import { http } from './http';

/** Single booked visit row (nested under each day). One row = one booked visit; requires clientId + patientId on the server. */
export type AppointmentBookingDetail = {
  appointmentStart?: string;
  appointmentTypeName?: string;
  appointmentTypePrettyName?: string;
  primaryProviderId?: number | null;
  primaryProviderName?: string | null;
  /** True when this is the first qualifying visit for this pet at this practice (per patientId + practiceId). */
  newPatient?: boolean;
};

/** Daily counts for appointments booked (attributed to the employee who booked). */
export type AppointmentBookingsDayRow = {
  date: string;
  totalBooked: number;
  existingPatientBooked: number;
  newPatientBooked: number;
  bookings?: AppointmentBookingDetail[];
};

export type AppointmentBookingsAnalyticsUser = {
  userEmail: string;
  employeeName?: string;
  bookingsByDay: AppointmentBookingsDayRow[];
  totalBooked?: number;
  totalExistingPatientBooked?: number;
  totalNewPatientBooked?: number;
};

export type AppointmentBookingsAnalyticsResponse = {
  startDate: string;
  endDate: string;
  users: AppointmentBookingsAnalyticsUser[];
};

/**
 * Per-user appointment booking counts by day (new vs existing patient / pet).
 * Backend: GET /analytics/appointment-bookings?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Shape mirrors /analytics/routing-usage so the UI can aggregate by practice or filter by employee.
 */
export async function fetchAppointmentBookingsAnalytics(params: {
  startDate: string;
  endDate: string;
}): Promise<AppointmentBookingsAnalyticsResponse> {
  const { data } = await http.get<AppointmentBookingsAnalyticsResponse>(
    '/analytics/appointment-bookings',
    {
      params: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
    }
  );
  return data;
}
