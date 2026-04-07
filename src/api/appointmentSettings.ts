// src/api/appointmentSettings.ts
import { http } from './http';

export type AppointmentType = {
  id: number;
  name: string;
  prettyName: string;
  showInApptRequestForm: boolean;
  newPatientAllowed: boolean;
  formListOrder?: number | null;
  isBoardingType: boolean;
  hasExtraInstructions: boolean;
  defaultDuration: number;
  defaultStartTime: string;
  isActive: boolean;
  isDeleted: boolean;
  pimsId: string;
  pimsType: string;
  /** When set by the API, scheduler uses this for event fill color */
  calendarColor?: string | null;
  colorHex?: string | null;
  color?: string | null;
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
  imageUrl?: string | null;
  /** OpenPhone user id for call attribution / CSR coaching when synced. */
  openPhoneUserId?: string | null;
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

/** Schedule override for a specific calendar date (used by routing instead of weekly schedule) */
export type ScheduleOverride = {
  id: number;
  employeeId: number;
  date: string; // YYYY-MM-DD
  workStartLocal?: string | null;
  workEndLocal?: string | null;
  startDepotLat?: number | null;
  startDepotLon?: number | null;
  endDepotLat?: number | null;
  endDepotLon?: number | null;
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
    formListOrder?: number | null;
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

/** Active, non-deleted employee_role row from GET /employees/roles */
export type EmployeeRole = {
  id: number;
  name: string;
  roleValue: string;
  pimsType?: string;
  description?: string | null;
};

/**
 * Active non-deleted employee roles, ordered by name then roleValue.
 * GET /employees/roles
 */
export async function fetchEmployeeRoles(): Promise<EmployeeRole[]> {
  const { data } = await http.get('/employees/roles');
  return Array.isArray(data) ? data : (data?.items ?? []);
}

/**
 * Employees with the given role (same Employee shape as GET /employees).
 * GET /employees/by-role/:roleId
 */
export async function fetchEmployeesByRole(roleId: number): Promise<Employee[]> {
  const { data } = await http.get(`/employees/by-role/${roleId}`);
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

// --- Schedule overrides (per-date overrides for routing) ---

/**
 * List schedule overrides for an employee in a date range.
 * GET /employees/:id/schedule-overrides?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function fetchScheduleOverrides(
  employeeId: number,
  params?: { startDate?: string; endDate?: string }
): Promise<ScheduleOverride[]> {
  const { data } = await http.get(`/employees/${employeeId}/schedule-overrides`, { params });
  return Array.isArray(data) ? data : [];
}

/**
 * Get schedule override for an employee on a specific date.
 * GET /employees/:id/schedule-overrides/by-date?date=YYYY-MM-DD
 * Returns 404 when no override exists.
 */
export async function fetchScheduleOverrideByDate(
  employeeId: number,
  date: string
): Promise<ScheduleOverride | null> {
  try {
    const { data } = await http.get(`/employees/${employeeId}/schedule-overrides/by-date`, {
      params: { date },
    });
    return data;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}

/**
 * Create a schedule override for a date.
 * POST /employees/:id/schedule-overrides
 */
export async function createScheduleOverride(
  employeeId: number,
  body: {
    date: string;
    workStartLocal?: string;
    workEndLocal?: string;
    startDepotLat?: number;
    startDepotLon?: number;
    endDepotLat?: number;
    endDepotLon?: number;
  }
): Promise<ScheduleOverride> {
  const { data } = await http.post(`/employees/${employeeId}/schedule-overrides`, body);
  return data;
}

/**
 * Update an existing schedule override.
 * PUT /employees/:id/schedule-overrides/:overrideId
 */
export async function updateScheduleOverride(
  employeeId: number,
  overrideId: number,
  body: {
    workStartLocal?: string;
    workEndLocal?: string;
    startDepotLat?: number;
    startDepotLon?: number;
    endDepotLat?: number;
    endDepotLon?: number;
  }
): Promise<ScheduleOverride> {
  const { data } = await http.put(
    `/employees/${employeeId}/schedule-overrides/${overrideId}`,
    body
  );
  return data;
}

/**
 * Delete a schedule override.
 * DELETE /employees/:id/schedule-overrides/:overrideId
 */
export async function deleteScheduleOverride(
  employeeId: number,
  overrideId: number
): Promise<void> {
  await http.delete(`/employees/${employeeId}/schedule-overrides/${overrideId}`);
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Upload or replace an employee's profile image.
 * POST /employees/:employeeId/image
 * Body: multipart/form-data with one file under field name "file"
 * Allowed: JPEG, JPG, PNG, GIF, WebP. Max 5MB.
 */
export async function uploadEmployeeImage(
  employeeId: number,
  file: File
): Promise<{ success: boolean; imageUrl: string; s3Key: string }> {
  const lower = file.type?.toLowerCase() ?? '';
  const allowed =
    ALLOWED_IMAGE_TYPES.some((t) => t === lower) || /\.(jpe?g|png|gif|webp)$/i.test(file.name);
  if (!allowed) {
    throw new Error('Allowed types: JPEG, JPG, PNG, GIF, WebP');
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Max file size is 5MB');
  }
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<{ success: boolean; imageUrl: string; s3Key: string }>(
    `/employees/${employeeId}/image`,
    form
  );
  return data;
}
