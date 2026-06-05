import { http } from './http';

/** Matches backend EmployeeDto; extra keys allowed for weekly defaults / roles. */
export type EmployeeDto = Record<string, unknown> & {
  id?: number;
  pimsId?: string | number | null;
  pimsUserId?: string | null;
  pimsType?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  email?: string | null;
  title?: string | null;
  designation?: string | null;
  licenseNumber?: string | null;
  isProvider?: boolean;
  roleIds?: number[];
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  county?: string | null;
  country?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  practice?: { id: number; name?: string } | null;
  isActive?: boolean;
  isDeleted?: boolean;
};

export type UpsertEmployeesResponse = { ok: boolean; upserted: number };

export type DeleteEmployeesResponse = { ok: boolean; deleted: number };

export async function upsertEmployees(
  body: EmployeeDto | EmployeeDto[]
): Promise<UpsertEmployeesResponse> {
  const { data } = await http.post<UpsertEmployeesResponse>('/employees/upsert', body);
  return data;
}

/** POST /employees — save; server passes through withImageUrls. */
export async function saveEmployees(body: EmployeeDto | EmployeeDto[]): Promise<unknown> {
  const { data } = await http.post<unknown>('/employees', body);
  return data;
}

export async function deleteEmployees(ids: number[]): Promise<DeleteEmployeesResponse> {
  if (ids.length === 0) return { ok: true, deleted: 0 };
  const { data } = await http.delete<DeleteEmployeesResponse>('/employees', {
    params: { ids: ids.join(',') },
  });
  return data;
}
