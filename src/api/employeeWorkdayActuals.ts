import { http } from './http';

export type WorkdayActualTimeSource = 'button' | 'manual';

export type EmployeeWorkdayActual = {
  id: number | null;
  employeeId: number;
  date: string;
  workdayStartActual: string | null;
  workdayEndActual: string | null;
  workdayStartSource: WorkdayActualTimeSource | null;
  workdayEndSource: WorkdayActualTimeSource | null;
  startedByEmployeeId: number | null;
  endedByEmployeeId: number | null;
  notes: string | null;
};

export type SetWorkdayActualTimeBody = {
  at?: string;
  clear?: boolean;
};

export type UpsertWorkdayActualBody = {
  date: string;
  workdayStartActual?: string | null;
  workdayEndActual?: string | null;
  notes?: string;
};

/** GET /employees/:id/workday-actuals/by-date?date=YYYY-MM-DD */
export async function fetchEmployeeWorkdayActualByDate(
  employeeId: number | string,
  date: string
): Promise<EmployeeWorkdayActual> {
  const { data } = await http.get<EmployeeWorkdayActual>(
    `/employees/${encodeURIComponent(String(employeeId))}/workday-actuals/by-date`,
    { params: { date } }
  );
  return data;
}

/** GET /employees/:id/workday-actuals?startDate=&endDate= */
export async function fetchEmployeeWorkdayActualsRange(
  employeeId: number | string,
  startDate: string,
  endDate: string
): Promise<EmployeeWorkdayActual[]> {
  const { data } = await http.get<EmployeeWorkdayActual[]>(
    `/employees/${encodeURIComponent(String(employeeId))}/workday-actuals`,
    { params: { startDate, endDate } }
  );
  return Array.isArray(data) ? data : [];
}

/** PUT /employees/:id/workday-actuals — manual create/update (upsert). */
export async function upsertEmployeeWorkdayActual(
  employeeId: number | string,
  body: UpsertWorkdayActualBody
): Promise<EmployeeWorkdayActual> {
  const { data } = await http.put<EmployeeWorkdayActual>(
    `/employees/${encodeURIComponent(String(employeeId))}/workday-actuals`,
    body
  );
  return data;
}
