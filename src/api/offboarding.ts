import { http } from './http';

/** RP-03 Offboard (Settings → Staff, and Admin → Users "turn off login"). */

export type OffboardFutureVisit = {
  id: number;
  start: string;
  clientName: string | null;
  patientName: string | null;
};

export type OffboardPreview = {
  employee: {
    id: number;
    name: string;
    doctorName: string;
    isActive: boolean;
    isProvider: boolean;
  };
  /** Today in Eastern time (YYYY-MM-DD). */
  today: string;
  lastDay: string;
  offboarding: { id: number; lastDay: string; completedAt: string | null } | null;
  openTaskCount: number;
  futureVisits: OffboardFutureVisit[];
  primaryDoctorOf: { pets: number; households: number; forwardBookings: number };
  worksWith: Array<{ userId: number; name: string; email: string }>;
  hasActiveLogin: boolean;
  warnings: {
    draftSoaps: number;
    controlledStockItems: number;
    controlledLocationId: number | null;
    onlyHolderOfRoles: string[];
  };
};

export type OffboardRequest = {
  lastDay?: string | null;
  taskToEmployeeId: number;
  primaryDoctorToId?: number | null;
  worksWith?: Array<{ userId: number; doctorId: number | null }>;
  householdClientId?: number | null;
};

export type OffboardResult = {
  id: number;
  employeeId: number;
  lastDay: string;
  endsAt: string;
  completedAt: string | null;
  rebookTaskId: number | null;
  alreadyOffboarded: boolean;
};

export type DeactivatedStaffRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  designation: string | null;
  isProvider: boolean;
  /** False once deactivated or past their last day. */
  isActive: boolean;
  lastDay: string | null;
  /** Their last appointment so far: where their goals end when no last day is recorded. */
  lastVisit?: string | null;
};

export type DepartedDoctorRow = {
  id: number;
  pimsId: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  designation: string | null;
  lastDay: string | null;
};

export async function fetchOffboardPreview(
  employeeId: number,
  lastDay?: string | null
): Promise<OffboardPreview> {
  const { data } = await http.get<OffboardPreview>(`/employee-offboarding/${employeeId}/preview`, {
    params: lastDay ? { lastDay } : undefined,
  });
  return data;
}

export async function offboardEmployee(
  employeeId: number,
  body: OffboardRequest
): Promise<OffboardResult> {
  const { data } = await http.post<OffboardResult>(`/employee-offboarding/${employeeId}`, body);
  return data;
}

export async function cancelOffboarding(employeeId: number): Promise<void> {
  await http.post(`/employee-offboarding/${employeeId}/cancel`, {});
}

/**
 * Someone already deactivated: record or correct their last day. Their goals stop counting
 * after it. No handover runs (that already happened when they were deactivated).
 */
export async function recordLastDay(employeeId: number, lastDay: string): Promise<void> {
  await http.post(`/employee-offboarding/${employeeId}/last-day`, { lastDay });
}

export async function fetchDeactivatedStaff(): Promise<DeactivatedStaffRow[]> {
  const { data } = await http.get<DeactivatedStaffRow[]>('/employee-offboarding/deactivated');
  return Array.isArray(data) ? data : [];
}

/** Doctors who have left but still have visits booked; the Scheduler keeps their calendar openable. */
export async function fetchDepartedDoctorsWithVisits(): Promise<DepartedDoctorRow[]> {
  const { data } = await http.get<DepartedDoctorRow[]>('/employee-offboarding/scheduler-doctors');
  return Array.isArray(data) ? data : [];
}
