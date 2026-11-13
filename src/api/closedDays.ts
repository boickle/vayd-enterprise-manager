// Settings → Scheduling → Manage Closed Days: staff days off a closed day creates.
// The closed-day list itself is the practice setting scheduling.closedDates (practiceSettings.ts).
import { http } from './http';

export type ClosedDayStaffCount = { date: string; staffOff: number };

export type ClosedDayStaffOffResult = {
  date: string;
  /** Staff given the day off by this closed day. */
  markedOff: number;
  /** Staff who already had that day off. */
  alreadyOff: number;
  /** Staff left working because they already have custom hours that date. */
  skipped: Array<{
    employeeId: number;
    name: string;
    workStartLocal: string | null;
    workEndLocal: string | null;
  }>;
};

/** GET /employees/closed-days — staff days off created by closed days, by date. */
export async function listClosedDayStaffCounts(from?: string): Promise<ClosedDayStaffCount[]> {
  const { data } = await http.get('/employees/closed-days', { params: from ? { from } : {} });
  return Array.isArray(data) ? data : [];
}

/** POST /employees/closed-days/:date/staff-off — give every active staff member the day off. */
export async function closeStaffSchedules(date: string): Promise<ClosedDayStaffOffResult> {
  const { data } = await http.post(`/employees/closed-days/${date}/staff-off`);
  return data;
}

/** DELETE /employees/closed-days/:date/staff-off — remove only the days off the closed day added. */
export async function reopenStaffSchedules(
  date: string
): Promise<{ date: string; reopened: number }> {
  const { data } = await http.delete(`/employees/closed-days/${date}/staff-off`);
  return data;
}
