// src/api/holds.ts
import { http } from './http';
import {
  fetchEmployeeRoles,
  fetchEmployeesByRole,
  type Employee,
  type EmployeeRole,
} from './appointmentSettings';

export type HoldOwnerBucket = 'owned' | 'non_cl_unassigned' | 'unassigned';

export type HoldSource =
  | 'appointment_request'
  | 'care_outreach'
  | 'schedule_loader'
  | 'waitlist'
  | 'end_visit'
  | 'texted_offer'
  | 'manual';

/** Owner filter for GET /holds. Defaults to me + unassigned. */
export type HoldOwnerFilter =
  | 'me_unassigned'
  | 'me'
  | 'unassigned'
  | 'all'
  | number;

export type HoldEmployeeRef = {
  id: number;
  firstName: string | null;
  lastName: string | null;
};

export type HoldClientRef = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  phone1: string | null;
  email: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
};

export type HoldListItem = {
  id: number;
  appointmentStart: string | null;
  appointmentEnd: string | null;
  allDay: boolean;
  holdPlacedAtIso: string | null;
  appointmentType: {
    id: number | null;
    name: string | null;
    prettyName: string | null;
  } | null;
  client: HoldClientRef | null;
  patient: { id: number; name: string | null } | null;
  primaryProvider: HoldEmployeeRef | null;
  createdByEmployee: HoldEmployeeRef | null;
  holdOwner: HoldEmployeeRef | null;
  holdOwnerAssignedAt: string | null;
  ownerBucket: HoldOwnerBucket;
  effectiveOwnerEmployeeId: number | null;
  ownerIsCurrentUser: boolean;
  source: HoldSource;
  description: string | null;
  instructions: string | null;
  pimsId: string | null;
  appointmentRequestSubmissionId: number | null;
  forwardBooking: {
    id: number;
    createdVia: string | null;
    targetDueDate: string | null;
    bookingNotes: string | null;
    note: string | null;
  } | null;
};

export type HoldListResponse = {
  currentUserEmployeeId: number | null;
  holds: HoldListItem[];
};

/** GET /holds?practiceId=&owner= — unified Holds board. */
export async function fetchHolds(
  practiceId: number,
  owner: HoldOwnerFilter = 'me_unassigned'
): Promise<HoldListResponse> {
  const { data } = await http.get('/holds', {
    params: { practiceId, owner: String(owner) },
  });
  return {
    currentUserEmployeeId: data?.currentUserEmployeeId ?? null,
    holds: Array.isArray(data?.holds) ? data.holds : [],
  };
}

/** PATCH /holds/:appointmentId/owner — assign to a CL, or null to unassign. */
export async function assignHoldOwner(
  appointmentId: number,
  ownerEmployeeId: number | null
): Promise<HoldListItem> {
  const { data } = await http.patch(`/holds/${appointmentId}/owner`, {
    ownerEmployeeId,
  });
  return data;
}

export type ClientLiaisonOption = {
  id: number;
  firstName: string | null;
  lastName: string | null;
};

export const CLIENT_LIAISON_ROLE_SLUGS = ['client_liaison', 'lead_client_liaison'];

/** Everyone holding a Client Liaison or Lead Client Liaison role, once each. */
export async function fetchClientLiaisonEmployees(): Promise<Employee[]> {
  const roles: EmployeeRole[] = await fetchEmployeeRoles();
  const ids = roles
    .filter((r) => r.slug != null && CLIENT_LIAISON_ROLE_SLUGS.includes(r.slug))
    .map((r) => r.id);
  const lists = await Promise.all(ids.map((id) => fetchEmployeesByRole(id)));
  const byId = new Map<number, Employee>();
  for (const emp of lists.flat()) byId.set(emp.id, emp);
  return [...byId.values()];
}

/** Client Liaisons for the "Assign to…" dropdown. */
export async function fetchClientLiaisons(): Promise<ClientLiaisonOption[]> {
  const emps = await fetchClientLiaisonEmployees();
  return emps
    .map((e) => ({
      id: e.id,
      firstName: e.firstName ?? null,
      lastName: e.lastName ?? null,
    }))
    .sort((a, b) => {
      const la = `${a.lastName ?? ''} ${a.firstName ?? ''}`.trim().toLowerCase();
      const lb = `${b.lastName ?? ''} ${b.firstName ?? ''}`.trim().toLowerCase();
      return la.localeCompare(lb);
    });
}

export const HOLD_SOURCE_LABELS: Record<HoldSource, string> = {
  appointment_request: 'Appt request',
  care_outreach: 'Care outreach',
  schedule_loader: 'Schedule loader',
  waitlist: 'Waitlist',
  end_visit: 'Forward booking',
  texted_offer: 'Texted offer',
  manual: 'Manual',
};
