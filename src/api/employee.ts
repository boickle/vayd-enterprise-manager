import { http } from './http';

export type Provider = {
  id: string | number;
  name: string;
  email: string;
  pimsId?: string | number; // PIMS ID for API calls
  dailyRevenueGoal?: number | null;
  bonusRevenueGoal?: number | null;
  dailyPointGoal?: number | null;
  weeklyPointGoal?: number | null;
};

function buildProviderName(r: any): string {
  const parts: string[] = [];
  if (r.firstName) parts.push(r.firstName);
  if (r.middleInitial || r.middleName) {
    const middle = r.middleInitial || (r.middleName ? r.middleName.charAt(0).toUpperCase() : '');
    if (middle) parts.push(middle);
  }
  if (r.lastName) parts.push(r.lastName);
  
  if (parts.length > 0) {
    return parts.join(' ').trim();
  }
  
  return r.name || `Provider ${r.id ?? ''}`;
}

export async function fetchPrimaryProviders(): Promise<Provider[]> {
  const { data } = await http.get('/employees/providers');
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

  return rows.map((r) => ({
    id: r.id ?? r.pimsId ?? r.employeeId,
    pimsId: r.pimsId ?? r.employee?.pimsId ?? r.id ?? r.employeeId, // Preserve pimsId for API calls
    email: r?.email,
    name: buildProviderName(r),
    dailyRevenueGoal: r?.dailyRevenueGoal ?? null,
    bonusRevenueGoal: r?.bonusRevenueGoal ?? null,
    dailyPointGoal: r?.dailyPointGoal ?? null,
    weeklyPointGoal: r?.weeklyPointGoal ?? null,
  }));
}

export type Employee = {
  id: string | number;
  name: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  middleInitial?: string;
};

function buildEmployeeName(r: any): string {
  const parts: string[] = [];
  if (r.firstName) parts.push(r.firstName);
  if (r.middleInitial || r.middleName) {
    const middle = r.middleInitial || (r.middleName ? r.middleName.charAt(0).toUpperCase() : '');
    if (middle) parts.push(middle);
  }
  if (r.lastName) parts.push(r.lastName);
  
  if (parts.length > 0) {
    return parts.join(' ').trim();
  }
  
  return r.name || `Employee ${r.id ?? ''}`;
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  // Try /employees/providers first (known working endpoint), then fallback to /employees/search
  try {
    const { data } = await http.get('/employees/providers');
    const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

    return rows.map((r) => ({
      id: r.id ?? r.pimsId ?? r.employeeId,
      email: r?.email,
      name: buildEmployeeName(r),
      firstName: r?.firstName ?? r?.employee?.firstName,
      lastName: r?.lastName ?? r?.employee?.lastName,
      middleInitial: r?.middleInitial ?? r?.employee?.middleInitial,
    }));
  } catch (err) {
    // Fallback to /employees/search with empty query to get all
    try {
      const { data } = await http.get('/employees/search', { params: { q: '' } });
      const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

      return rows.map((r) => ({
        id: r.id ?? r.employeeId,
        email: r?.email,
        name: buildEmployeeName(r),
        firstName: r?.firstName ?? r?.employee?.firstName,
        lastName: r?.lastName ?? r?.employee?.lastName,
        middleInitial: r?.middleInitial ?? r?.employee?.middleInitial,
      }));
    } catch (err2) {
      // Last fallback: try /employees directly
      try {
        const { data } = await http.get('/employees');
        const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

        return rows.map((r) => ({
          id: r.id ?? r.employeeId,
          email: r?.email,
          name: buildEmployeeName(r),
          firstName: r?.firstName ?? r?.employee?.firstName,
          lastName: r?.lastName ?? r?.employee?.lastName,
          middleInitial: r?.middleInitial ?? r?.employee?.middleInitial,
        }));
      } catch (err3) {
        console.error('Failed to fetch employees from all endpoints', { err, err2, err3 });
        throw err3;
      }
    }
  }
}

export type WeeklySchedule = {
  dayOfWeek: number; // 0-6 (Sunday-Saturday) or 1-7 (Monday-Sunday)
  isWorkday: boolean;
  workStartLocal: string; // "HH:mm"
  workEndLocal: string; // "HH:mm"
};

export async function fetchEmployeeWeeklySchedules(employeeId: string | number): Promise<WeeklySchedule[]> {
  const { data } = await http.get(`/employees/${employeeId}/weekly-schedules`);
  return Array.isArray(data) ? data : [];
}

export async function updateEmployeeWeeklySchedules(
  employeeId: string | number,
  schedules: WeeklySchedule[]
): Promise<WeeklySchedule[]> {
  const { data } = await http.put(`/employees/${employeeId}/weekly-schedules`, schedules);
  return Array.isArray(data) ? data : [];
}

export type Location = {
  lat?: number;
  lon?: number;
  address?: string;
};

export type EmployeeDayLocation = {
  dayOfWeek: number; // 0-6 (Sunday-Saturday) per API
  validFrom: string | null; // YYYY-MM-DD or null for default
  startLocation?: Location;
  endLocation?: Location;
};

export async function fetchEmployeeLocations(employeeId: string | number): Promise<EmployeeDayLocation[]> {
  const { data } = await http.get(`/employees/${employeeId}/locations`);
  return Array.isArray(data) ? data : [];
}

export type UpdateEmployeeLocationRequest = {
  dayOfWeek: number; // 0-6 (Sunday-Saturday) per API
  startDepotLat?: number;
  startDepotLon?: number;
  endDepotLat?: number;
  endDepotLon?: number;
  validFrom?: string | null; // YYYY-MM-DD or null for default
};

export async function updateEmployeeLocation(
  employeeId: string | number,
  location: UpdateEmployeeLocationRequest
): Promise<EmployeeDayLocation> {
  const { data } = await http.patch(`/employees/${employeeId}/locations`, location);
  return data;
}
