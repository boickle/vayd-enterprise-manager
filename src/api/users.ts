// src/api/users.ts
import { http } from './http';

// Issue a password reset link to the given email (PA-04: the one public reset-request route).
export async function requestPasswordReset(email: string) {
  return http.post('/auth/request-reset', { email });
}

// Complete a password reset with the emailed link's token or a 6-digit code.
// PA-02: a code is only accepted with the login's email, so send it whenever it is known.
export async function completePasswordReset(token: string, newPassword: string, email?: string) {
  return http.post('/users/reset-password/complete', email ? { email, token, newPassword } : { token, newPassword });
}

// Admin-only create user (your controller protects this with AuthGuard)
export async function createUser(email: string, password?: string) {
  return http.post('/users/create', { email, password });
}

export async function createEmployeeUser(
  email: string,
  doctorId?: number,
  password?: string,
) {
  const body: { email: string; password?: string; doctorId?: number } = { email };
  if (doctorId != null) body.doctorId = doctorId;
  if (password) body.password = password;
  return http.post('/users/create-employee', body);
}

// ✅ New: Client self-serve create user
// This endpoint will only succeed if the email is in the clients table
export async function createClientUser(email: string, password?: string) {
  return http.post('/users/create-client', { email, password });
}

// Optional helpers
export async function getCurrentUser() {
  return http.get('/users');
}

export async function patchUserUiPrefs(body: {
  clientLayout?: Record<string, unknown>;
  patientLayout?: Record<string, unknown>;
}) {
  const { data } = await http.patch('/users/ui-prefs', body);
  return data as {
    clientLayout?: Record<string, unknown>;
    patientLayout?: Record<string, unknown>;
  };
}

// Update communication preferences
export async function updateCommunicationPreferences(
  allowEmail?: boolean,
  allowText?: boolean,
  extras?: { preferPhone?: boolean; doNotSendReminders?: boolean }
) {
  const body: {
    allowEmail?: boolean;
    allowText?: boolean;
    preferPhone?: boolean;
    doNotSendReminders?: boolean;
  } = {};
  if (allowEmail !== undefined) body.allowEmail = allowEmail;
  if (allowText !== undefined) body.allowText = allowText;
  if (extras?.preferPhone !== undefined) body.preferPhone = extras.preferPhone;
  if (extras?.doNotSendReminders !== undefined) body.doNotSendReminders = extras.doNotSendReminders;
  return http.post('/users/communication-preferences', body);
}

export async function sendClientPortalAccess(
  clientId: number
): Promise<{ ok: boolean; invited: boolean }> {
  const { data } = await http.post('/users/send-client-portal-access', { clientId });
  return data;
}

/** Scout login roles managed in Admin → Users. */
export type ScoutUserRole =
  | 'superadmin'
  | 'admin'
  | 'employee'
  | 'provider'
  | 'generic'
  | 'client';

export type AdminManagedUser = {
  id: number;
  email: string | null;
  role: ScoutUserRole | string;
  employeeId: number | null;
  doctorId: number | null;
  employeeName: string | null;
  doctorName: string | null;
  /** The doctor's default person (room loader emails, mail-order approval tasks). */
  isDoctorDefault?: boolean;
  clientId?: number | null;
  clientName?: string | null;
  isActive: boolean;
  requiresPasswordReset: boolean;
  created: string | null;
  updated: string | null;
};

export type UpdateAdminUserPayload = {
  email?: string;
  role?: ScoutUserRole | string;
  employeeId?: number | null;
  doctorId?: number | null;
  isActive?: boolean;
};

export type ListAdminUsersParams = {
  q?: string;
  role?: string;
  isActive?: boolean;
  employeeId?: number;
};

export async function fetchAdminUsers(
  params: ListAdminUsersParams = {},
): Promise<AdminManagedUser[]> {
  const { data } = await http.get('/admin/users', {
    params: {
      q: params.q || undefined,
      role: params.role || undefined,
      employeeId: params.employeeId,
      isActive:
        params.isActive === undefined ? undefined : params.isActive ? 'true' : 'false',
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchAdminUser(userId: number): Promise<AdminManagedUser> {
  const { data } = await http.get(`/admin/users/${userId}`);
  return data;
}

export async function updateAdminUser(
  userId: number,
  payload: UpdateAdminUserPayload,
): Promise<AdminManagedUser> {
  const { data } = await http.patch(`/admin/users/${userId}`, payload);
  return data;
}

export async function adminSendPasswordReset(
  userId: number,
): Promise<{ status: string }> {
  const { data } = await http.post(`/admin/users/${userId}/reset-password`);
  return data;
}

/** An employee's login and who they work with (Settings → Staff → Profile). */
export type StaffLogin = {
  userId: number;
  email: string | null;
  isActive: boolean;
  doctorId: number | null;
  doctorName: string | null;
  isDoctorDefault: boolean;
};

export async function getStaffLogin(practiceId: number, employeeId: number) {
  const { data } = await http.get<StaffLogin | null>(
    `/practice/${practiceId}/staff-logins/${employeeId}`
  );
  return data ?? null;
}

/** Practice manager and above. Marking someone the default clears it from the doctor's others. */
export async function setStaffWorksWith(
  practiceId: number,
  employeeId: number,
  body: { doctorId: number | null; isDoctorDefault: boolean }
) {
  const { data } = await http.put<StaffLogin | null>(
    `/practice/${practiceId}/staff-logins/${employeeId}/works-with`,
    body
  );
  return data ?? null;
}

/** Practice manager and above. Uses the employee's email and emails them a temporary password. */
export async function createStaffLogin(practiceId: number, employeeId: number) {
  const { data } = await http.post<{ message: string; login: StaffLogin | null }>(
    `/practice/${practiceId}/staff-logins/${employeeId}`
  );
  return data;
}
