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
  quoLinePhone?: string | null;
  practice?: { id: number; name?: string } | null;
  isActive?: boolean;
  isDeleted?: boolean;
  taskForwarderEmployeeId?: number | null;
};

export type UpsertEmployeesResponse = { ok: boolean; upserted: number };

export type DeleteEmployeesResponse = { ok: boolean; deleted: number };

/**
 * Roles never travel with an employee save (RP-02). Screens send back the GET body, whose roleIds
 * include office roles, and saving them made every office role practice-wide. Roles change only
 * through `updateEmployeeRoles` (PUT /employees/:id/roles), which keeps office assignments.
 */
function withoutRoles(body: EmployeeDto | EmployeeDto[]): EmployeeDto | EmployeeDto[] {
  const strip = (dto: EmployeeDto): EmployeeDto => {
    const copy: EmployeeDto = { ...dto };
    delete copy.roleIds;
    delete copy.roleAssignments;
    return copy;
  };
  return Array.isArray(body) ? body.map(strip) : strip(body);
}

export async function upsertEmployees(
  body: EmployeeDto | EmployeeDto[]
): Promise<UpsertEmployeesResponse> {
  const { data } = await http.post<UpsertEmployeesResponse>(
    '/employees/upsert',
    withoutRoles(body)
  );
  return data;
}

/** POST /employees — save; server passes through withImageUrls. Never sends roles. */
export async function saveEmployees(body: EmployeeDto | EmployeeDto[]): Promise<unknown> {
  const { data } = await http.post<unknown>('/employees', withoutRoles(body));
  return data;
}

export async function deleteEmployees(ids: number[]): Promise<DeleteEmployeesResponse> {
  if (ids.length === 0) return { ok: true, deleted: 0 };
  const { data } = await http.delete<DeleteEmployeesResponse>('/employees', {
    params: { ids: ids.join(',') },
  });
  return data;
}

export type EmployeeSignatureResponse = { ok: boolean; employeeId: number; hasSignature: boolean };

/**
 * PUT /employees/:id/signature — a provider's signature for printed documents.
 * Practice managers and above only (staff.employee.manage); the server logs each change.
 */
export async function setEmployeeSignature(
  employeeId: number,
  practiceId: number,
  image: string
): Promise<EmployeeSignatureResponse> {
  const { data } = await http.put<EmployeeSignatureResponse>(`/employees/${employeeId}/signature`, {
    practiceId,
    image,
  });
  return data;
}

/** DELETE /employees/:id/signature — clear it (same rule and log). */
export async function clearEmployeeSignature(
  employeeId: number,
  practiceId: number
): Promise<EmployeeSignatureResponse> {
  const { data } = await http.delete<EmployeeSignatureResponse>(
    `/employees/${employeeId}/signature`,
    {
      params: { practiceId },
    }
  );
  return data;
}
