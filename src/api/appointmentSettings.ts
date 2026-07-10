// src/api/appointmentSettings.ts
import { http } from './http';
import { normalizeAppointmentTypeFromApi } from '../utils/appointmentTypeSettings';

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
  /** When the type was archived (ISO instant), if the API provides it. */
  archivedOn?: string | null;
  modified?: string | null;
  updated?: string | null;
  pimsId: string;
  pimsType: string;
  /** When set by the API, scheduler uses this for event fill color */
  calendarColor?: string | null;
  colorHex?: string | null;
  /** Fill color: hex (e.g. #00CC66) or CSS named color (e.g. pink) from API */
  color?: string | null;
  /** Text on colored chips: hex or named (e.g. black, #FFFFFF) from API */
  textColor?: string | null;
  /** Minutes before scheduled time the client may arrive; 0 = fixed time; null = legacy default */
  windowBeforeMinutes?: number | null;
  /** Minutes after scheduled time the client may arrive; null = legacy default */
  windowAfterMinutes?: number | null;
  /** User may set allDay on appointments of this type */
  allowAllDay?: boolean;
  /** User may link a client on create/update */
  allowClient?: boolean;
  /** User may set alternate visit address */
  allowAlternateAddress?: boolean;
  /** Visit must have a client home address or an alternate address (when allowed). */
  addressRequired?: boolean;
  /** Visit must have a patient linked to be saved. */
  requiresPatient?: boolean;
  /** Omitted from drive routing / doctor-day routable stops (server-side) */
  excludeFromRouting?: boolean;
  /** Excluded from appointment reminders and visit-based analytics (server-side) */
  excludeFromReminders?: boolean;
  /** Placeholder HOLD type — shown on the Holds board and classified as on hold (server-side) */
  isHold?: boolean;
  /** Use legacy routing rules for this type (server-side) */
  usesLegacyRouting?: boolean;
  /** Ops analytics doctor-day points; null = legacy name-based rules on server */
  points?: number | null;
  /** Frontend only: show scheduling-override UI for this type (not enforced on appointment APIs) */
  allowSchedulingOverride?: boolean;
  /** Employee assignment: allow clients to book this type online via the appointment request form */
  allowOnlineBooking?: boolean;
  practice?: {
    id: number;
    name: string;
  };
};

export type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  middleInitial?: string | null;
  email: string;
  title?: string;
  designation?: string;
  isProvider?: boolean;
  pimsId?: string | number | null;
  isActive?: boolean;
  isDeleted?: boolean;
  imageUrl?: string | null;
  /** VAYD-managed profile copy (not synced from PIMS). Max 2000 chars. */
  bio?: string | null;
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
  /** Doctor is winding down in this zone but still assigned. */
  transitioningOutOfZone?: boolean;
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

/** Normalize HH:mm or HH:mm:ss to HH:mm for comparisons. */
export function normalizeScheduleOverrideLocalTime(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}:\d{2})/);
  return m ? m[1] : s;
}

/** Day off: no shift times, or identical start/end (e.g. cleared routing for that date). */
export function scheduleOverrideIsOff(
  o: Pick<ScheduleOverride, 'workStartLocal' | 'workEndLocal'>
): boolean {
  const start = normalizeScheduleOverrideLocalTime(o.workStartLocal);
  const end = normalizeScheduleOverrideLocalTime(o.workEndLocal);
  if (!start && !end) return true;
  return Boolean(start && end && start === end);
}

export function buildScheduleOverridePayload(form: {
  workStartLocal?: string | null;
  workEndLocal?: string | null;
  startDepotLat?: number | null;
  startDepotLon?: number | null;
  endDepotLat?: number | null;
  endDepotLon?: number | null;
}): {
  workStartLocal?: string | null;
  workEndLocal?: string | null;
  startDepotLat?: number | null;
  startDepotLon?: number | null;
  endDepotLat?: number | null;
  endDepotLon?: number | null;
} {
  if (scheduleOverrideIsOff(form)) {
    return {
      workStartLocal: null,
      workEndLocal: null,
      startDepotLat: null,
      startDepotLon: null,
      endDepotLat: null,
      endDepotLon: null,
    };
  }
  return {
    workStartLocal: form.workStartLocal || null,
    workEndLocal: form.workEndLocal || null,
    startDepotLat: form.startDepotLat ?? null,
    startDepotLon: form.startDepotLon ?? null,
    endDepotLat: form.endDepotLat ?? null,
    endDepotLon: form.endDepotLon ?? null,
  };
}

/** Day off for routing — same payload shape as Settings → Mark as day off → Save. */
export function buildScheduleOverrideDayOffPayload(): ReturnType<typeof buildScheduleOverridePayload> {
  return buildScheduleOverridePayload({ workStartLocal: '', workEndLocal: '' });
}

export function formatScheduleOverrideApiError(err: unknown): string {
  const ax = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m;
  if (ax?.message) return ax.message;
  return 'Request failed';
}

export type Zone = {
  id: number;
  name: string;
};

export type EmployeeAppointmentTypeAssignment = {
  appointmentTypeId: number;
  allowOnlineBooking?: boolean;
};

/**
 * Update which appointment types an employee (doctor) can see/handle
 * PUT /employees/:id/appointment-types
 */
export async function updateEmployeeAppointmentTypes(
  employeeId: number,
  appointmentTypes: EmployeeAppointmentTypeAssignment[]
): Promise<Employee> {
  const { data } = await http.put(`/employees/${employeeId}/appointment-types`, {
    appointmentTypes,
  });
  return data;
}

/**
 * Update which zones an employee is available in and whether they accept new patients in each zone
 * PUT /employees/schedules/:scheduleId/zones
 */
export async function updateEmployeeScheduleZones(
  scheduleId: number,
  zones: Array<{
    zoneId: number;
    acceptingNewPatients: boolean;
    transitioningOutOfZone?: boolean;
  }>
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

export type AppointmentTypeUpdate = {
  name?: string;
  prettyName?: string;
  color?: string | null;
  textColor?: string | null;
  windowBeforeMinutes?: number | null;
  windowAfterMinutes?: number | null;
  showInApptRequestForm?: boolean;
  newPatientAllowed?: boolean;
  formListOrder?: number | null;
  allowAllDay?: boolean;
  allowClient?: boolean;
  allowAlternateAddress?: boolean;
  addressRequired?: boolean;
  requiresPatient?: boolean;
  excludeFromRouting?: boolean;
  excludeFromReminders?: boolean;
  isHold?: boolean;
  usesLegacyRouting?: boolean;
  points?: number | null;
  allowSchedulingOverride?: boolean;
  /** Default booked service length in minutes (routing, manual book, etc.). */
  defaultDuration?: number;
  /** Archive (true) or restore (false) — hide from new booking pickers when archived. */
  isDeleted?: boolean;
};

export type FetchAppointmentTypesOptions = {
  /** When true (default), only active non-archived types. When false, includes archived. */
  activeOnly?: boolean;
};

/**
 * Get one appointment type (includes window + color fields).
 * GET /appointment-types/:id
 */
export async function fetchAppointmentType(appointmentTypeId: number): Promise<AppointmentType> {
  const { data } = await http.get(`/appointment-types/${appointmentTypeId}`);
  return normalizeAppointmentTypeFromApi(data);
}

export type AppointmentTypeCreate = AppointmentTypeUpdate & {
  name: string;
  practiceId: number;
};

/**
 * Create a new appointment type.
 * POST /appointment-types
 */
export async function createAppointmentType(body: AppointmentTypeCreate): Promise<AppointmentType> {
  const { data } = await http.post('/appointment-types', body);
  return normalizeAppointmentTypeFromApi(data);
}

/**
 * Partial update appointment type settings.
 * PUT /appointment-types/:id
 */
export async function updateAppointmentType(
  appointmentTypeId: number,
  updates: AppointmentTypeUpdate
): Promise<AppointmentType> {
  const { data } = await http.put(`/appointment-types/${appointmentTypeId}`, updates);
  return normalizeAppointmentTypeFromApi(data);
}

/**
 * List appointment types for a practice.
 * GET /appointment-types?practiceId=&activeOnly=
 * Default activeOnly=true when omitted (booking pickers). Use activeOnly=false for settings archived list.
 */
export async function fetchAllAppointmentTypes(
  practiceId?: number,
  options?: FetchAppointmentTypesOptions
): Promise<AppointmentType[]> {
  const params: Record<string, string | number> = {};
  if (practiceId != null && Number.isFinite(practiceId)) {
    params.practiceId = practiceId;
  }
  // Query booleans as strings — some servers treat the literal "false" as truthy.
  params.activeOnly = options?.activeOnly === false ? 'false' : 'true';
  const { data } = await http.get('/appointment-types', { params });
  const rows: AppointmentType[] = Array.isArray(data)
    ? data
    : (data?.items ?? data?.appointmentTypes ?? []);
  return rows.map((row) => normalizeAppointmentTypeFromApi(row));
}

/** Archive or restore an appointment type (partial PUT). */
export async function setAppointmentTypeArchived(
  appointmentTypeId: number,
  archived: boolean
): Promise<AppointmentType> {
  return updateAppointmentType(appointmentTypeId, { isDeleted: archived });
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

/** GET /employees/roles/:roleId/appointment-types — manual booking types for a role */
export type RoleManualBookingAppointmentType = {
  appointmentTypeId: number;
  appointmentTypeName?: string | null;
  appointmentTypePrettyName?: string | null;
  practiceId?: number | null;
};

export async function fetchRoleManualBookingAppointmentTypes(
  roleId: number
): Promise<RoleManualBookingAppointmentType[]> {
  const { data } = await http.get(`/employees/roles/${roleId}/appointment-types`);
  return Array.isArray(data) ? data : [];
}

/** PUT /employees/roles/:roleId/appointment-types — replace role manual booking types */
export async function updateRoleManualBookingAppointmentTypes(
  roleId: number,
  appointmentTypeIds: number[]
): Promise<RoleManualBookingAppointmentType[]> {
  const { data } = await http.put(`/employees/roles/${roleId}/appointment-types`, {
    appointmentTypeIds,
  });
  return Array.isArray(data) ? data : [];
}

/** GET /employees/manual-bookable-appointment-types — types current user may book manually */
export type ManualBookableAppointmentTypesResponse = {
  appointmentTypeIds: number[];
};

export async function fetchManualBookableAppointmentTypes(
  practiceId: number
): Promise<ManualBookableAppointmentTypesResponse> {
  const { data } = await http.get<ManualBookableAppointmentTypesResponse>(
    '/employees/manual-bookable-appointment-types',
    { params: { practiceId } }
  );
  const ids = data?.appointmentTypeIds;
  return {
    appointmentTypeIds: Array.isArray(ids)
      ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : [],
  };
}

/** PUT /employees/:id/roles — replace employee role assignments */
export type UpdateEmployeeRolesRequest = {
  roleIds?: number[];
  roleAssignments?: Array<{ roleId: number; branchId?: number | null }>;
};

export async function updateEmployeeRoles(
  employeeId: number,
  body: UpdateEmployeeRolesRequest
): Promise<Employee> {
  const { data } = await http.put(`/employees/${employeeId}/roles`, body);
  if (Array.isArray(data)) return data[0];
  return data;
}

export const EMPLOYEE_BIO_MAX_LENGTH = 2000;

/** PUT /employees/:id/bio — VAYD-managed profile copy (admin only). */
export async function updateEmployeeBio(
  employeeId: number,
  bio: string | null,
): Promise<Employee> {
  const { data } = await http.put(`/employees/${employeeId}/bio`, { bio });
  if (Array.isArray(data)) return data[0];
  return data;
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
    workStartLocal?: string | null;
    workEndLocal?: string | null;
    startDepotLat?: number | null;
    startDepotLon?: number | null;
    endDepotLat?: number | null;
    endDepotLon?: number | null;
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
    workStartLocal?: string | null;
    workEndLocal?: string | null;
    startDepotLat?: number | null;
    startDepotLon?: number | null;
    endDepotLat?: number | null;
    endDepotLon?: number | null;
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
