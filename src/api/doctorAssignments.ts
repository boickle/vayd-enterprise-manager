import { http } from './http';

export type DoctorAssignmentPerson = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email?: string | null;
};

export type StaffDoctorAssignments = {
  userId: number;
  email: string | null;
  role: string;
  employeeId: number | null;
  employeeName: string | null;
  doctorIds: number[];
  doctors: DoctorAssignmentPerson[];
};

export type DoctorAssignmentItem = {
  id: number;
  userId: number;
  doctorId: number;
  sortOrder: number;
  user: DoctorAssignmentPerson & { employeeId: number | null };
  doctor: DoctorAssignmentPerson;
};

export type SetUserDoctorAssignmentsRequest = {
  doctorIds: number[];
};

export async function fetchStaffDoctorAssignments(): Promise<StaffDoctorAssignments[]> {
  const { data } = await http.get<StaffDoctorAssignments[]>('/users/doctor-assignments/staff');
  return data ?? [];
}

export async function fetchDoctorAssignmentDoctors(): Promise<DoctorAssignmentPerson[]> {
  const { data } = await http.get<DoctorAssignmentPerson[]>('/users/doctor-assignments/doctors');
  return data ?? [];
}

export async function fetchUserDoctorAssignments(userId: number): Promise<DoctorAssignmentItem[]> {
  const { data } = await http.get<DoctorAssignmentItem[]>(
    `/users/doctor-assignments/by-user/${userId}`
  );
  return data ?? [];
}

export async function saveUserDoctorAssignments(
  userId: number,
  body: SetUserDoctorAssignmentsRequest
): Promise<DoctorAssignmentItem[]> {
  const { data } = await http.put<DoctorAssignmentItem[]>(
    `/users/doctor-assignments/by-user/${userId}`,
    body
  );
  return data ?? [];
}
