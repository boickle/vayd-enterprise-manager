// src/api/appointmentSettings.ts
import { http } from './http';

export type AppointmentType = {
  id: number;
  name: string;
  prettyName: string;
  showInApptRequestForm: boolean;
  newPatientAllowed: boolean;
  isBoardingType: boolean;
  hasExtraInstructions: boolean;
  defaultDuration: number;
  defaultStartTime: string;
  isActive: boolean;
  isDeleted: boolean;
  pimsId: string;
  pimsType: string;
  practice?: {
    id: number;
    name: string;
  };
};

export type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  designation?: string;
  isProvider?: boolean;
  appointmentTypes: AppointmentType[];
  weeklySchedules: EmployeeWeeklySchedule[];
  practice?: {
    id: number;
    name: string;
  };
};

export type EmployeeWeeklySchedule = {
  id?: number; // May not be present in API response
  dayOfWeek: number;
  isWorkday: boolean;
  workStartLocal?: string | null;
  workEndLocal?: string | null;
  startDepotLat?: number | null;
  startDepotLon?: number | null;
  endDepotLat?: number | null;
  endDepotLon?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  notes?: string | null;
  zones?: EmployeeWeeklyScheduleZone[];
};

export type EmployeeWeeklyScheduleZone = {
  zoneId: number;
  zone?: Zone;
  acceptingNewPatients: boolean;
};

export type Zone = {
  id: number;
  name: string;
};

/**
 * Update which appointment types an employee (doctor) can see/handle
 * PUT /employees/:id/appointment-types
 */
export async function updateEmployeeAppointmentTypes(
  employeeId: number,
  appointmentTypeIds: number[]
): Promise<Employee> {
  const { data } = await http.put(`/employees/${employeeId}/appointment-types`, {
    appointmentTypeIds,
  });
  return data;
}

/**
 * Update which zones an employee is available in and whether they accept new patients in each zone
 * PUT /employees/schedules/:scheduleId/zones
 */
export async function updateEmployeeScheduleZones(
  scheduleId: number,
  zones: Array<{ zoneId: number; acceptingNewPatients: boolean }>
): Promise<{ success: boolean }> {
  const { data } = await http.put(`/employees/schedules/${scheduleId}/zones`, {
    scheduleId,
    zones,
  });
  return data;
}

/**
 * Update weekly schedule (work hours, depot locations, workday status)
 * PUT /employees/schedules/:scheduleId
 */
export async function updateWeeklySchedule(
  scheduleId: number,
  updates: {
    isWorkday?: boolean;
    workStartLocal?: string;
    workEndLocal?: string;
    startDepotLat?: number;
    startDepotLon?: number;
    endDepotLat?: number;
    endDepotLon?: number;
  }
): Promise<{ success: boolean }> {
  const { data } = await http.put(`/employees/schedules/${scheduleId}`, updates);
  return data;
}

/**
 * Update appointment type settings (prettyName, showInApptRequestForm, newPatientAllowed)
 * PUT /appointment-types/:id
 */
export async function updateAppointmentType(
  appointmentTypeId: number,
  updates: {
    prettyName?: string;
    showInApptRequestForm?: boolean;
    newPatientAllowed?: boolean;
  }
): Promise<AppointmentType> {
  const { data } = await http.put(`/appointment-types/${appointmentTypeId}`, updates);
  return data;
}

/**
 * Get all appointment types
 * GET /appointment-types
 */
export async function fetchAllAppointmentTypes(practiceId?: number): Promise<AppointmentType[]> {
  const params: any = {};
  if (practiceId) {
    params.practiceId = practiceId;
  }
  const { data } = await http.get('/appointment-types', { params });
  return Array.isArray(data) ? data : (data?.items ?? data?.appointmentTypes ?? []);
}

/**
 * Get a single employee by ID
 * GET /employees/:id
 */
export async function fetchEmployee(employeeId: number): Promise<Employee> {
  const { data } = await http.get(`/employees/${employeeId}`);
  // Handle case where API returns an array instead of a single object
  if (Array.isArray(data)) {
    return data[0];
  }
  return data;
}

/**
 * Get all employees
 * GET /employees
 */
export async function fetchAllEmployees(): Promise<Employee[]> {
  const { data } = await http.get('/employees');
  return Array.isArray(data) ? data : (data?.items ?? []);
}

/**
 * Get all available zones
 * GET /zones
 */
export async function fetchAllZones(): Promise<Zone[]> {
  const { data } = await http.get('/zones');
  return Array.isArray(data) ? data : (data?.items ?? []);
}


