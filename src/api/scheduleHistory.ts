import { http } from './http';

/**
 * Past schedules (owner, Nov 13, 2026): which weekdays someone worked from which date. Goals on
 * the VSD report use the schedule in effect on each date; routing and booking use the current one.
 */
export type ScheduleVersion = {
  /** YYYY-MM-DD; fromStart = their schedule before any recorded change. */
  effectiveFrom: string;
  /** 0=Sunday .. 6=Saturday */
  workdays: number[];
  fromStart: boolean;
};

export async function fetchScheduleHistory(employeeId: number): Promise<ScheduleVersion[]> {
  const { data } = await http.get<ScheduleVersion[]>(`/employees/${employeeId}/schedule-history`);
  return Array.isArray(data) ? data : [];
}

export async function addPastSchedule(
  employeeId: number,
  effectiveFrom: string,
  workdays: number[]
): Promise<ScheduleVersion[]> {
  const { data } = await http.post<ScheduleVersion[]>(`/employees/${employeeId}/schedule-history`, {
    effectiveFrom,
    workdays,
  });
  return Array.isArray(data) ? data : [];
}

export async function removePastSchedule(
  employeeId: number,
  effectiveFrom: string
): Promise<ScheduleVersion[]> {
  const { data } = await http.delete<ScheduleVersion[]>(
    `/employees/${employeeId}/schedule-history/${effectiveFrom}`
  );
  return Array.isArray(data) ? data : [];
}
