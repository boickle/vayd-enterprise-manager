// src/api/holds.ts
import { http } from './http';
import {
  fetchEmployeeRoles,
  fetchEmployeesByRole,
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

function truthyApiFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function normalizeEmployeeRef(raw: unknown): HoldEmployeeRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const first = o.firstName ?? o.first_name;
  const last = o.lastName ?? o.last_name;
  return {
    id,
    firstName: typeof first === 'string' ? first : first == null ? null : String(first),
    lastName: typeof last === 'string' ? last : last == null ? null : String(last),
  };
}

function normalizeOptionalId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Normalize a holds-board row. When the API omits or mis-sets `ownerIsCurrentUser`
 * (common on `owner=all` payloads), derive it from holdOwner / effectiveOwner vs
 * the response's currentUserEmployeeId so Mine / Me+unassigned stay accurate.
 */
export function normalizeHoldListItem(
  raw: unknown,
  currentUserEmployeeId: number | null
): HoldListItem {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const holdOwner = normalizeEmployeeRef(o.holdOwner ?? o.hold_owner);
  const createdByEmployee = normalizeEmployeeRef(
    o.createdByEmployee ?? o.created_by_employee
  );
  const primaryProvider = normalizeEmployeeRef(
    o.primaryProvider ?? o.primary_provider
  );
  let effectiveOwnerEmployeeId = normalizeOptionalId(
    o.effectiveOwnerEmployeeId ?? o.effective_owner_employee_id
  );
  if (effectiveOwnerEmployeeId == null && holdOwner) {
    effectiveOwnerEmployeeId = holdOwner.id;
  }

  let ownerIsCurrentUser = truthyApiFlag(
    o.ownerIsCurrentUser ?? o.owner_is_current_user
  );
  if (!ownerIsCurrentUser && currentUserEmployeeId != null) {
    ownerIsCurrentUser =
      holdOwner?.id === currentUserEmployeeId ||
      effectiveOwnerEmployeeId === currentUserEmployeeId;
  }

  const ownerBucketRaw = String(
    o.ownerBucket ?? o.owner_bucket ?? 'unassigned'
  ).trim();
  const ownerBucket: HoldOwnerBucket =
    ownerBucketRaw === 'owned' ||
    ownerBucketRaw === 'non_cl_unassigned' ||
    ownerBucketRaw === 'unassigned'
      ? ownerBucketRaw
      : 'unassigned';

  const clientRaw = o.client;
  let client: HoldClientRef | null = null;
  if (clientRaw && typeof clientRaw === 'object') {
    const c = clientRaw as Record<string, unknown>;
    const cid = normalizeOptionalId(c.id);
    if (cid != null) {
      const str = (v: unknown) =>
        typeof v === 'string' ? v : v == null ? null : String(v);
      client = {
        id: cid,
        firstName: str(c.firstName ?? c.first_name),
        lastName: str(c.lastName ?? c.last_name),
        phone1: str(c.phone1 ?? c.phone_1),
        email: str(c.email),
        address1: str(c.address1 ?? c.address_1),
        city: str(c.city),
        state: str(c.state),
        zipcode: str(c.zipcode ?? c.zip),
      };
    }
  }

  const patientRaw = o.patient;
  let patient: HoldListItem['patient'] = null;
  if (patientRaw && typeof patientRaw === 'object') {
    const p = patientRaw as Record<string, unknown>;
    const pid = normalizeOptionalId(p.id);
    if (pid != null) {
      patient = {
        id: pid,
        name: typeof p.name === 'string' ? p.name : p.name == null ? null : String(p.name),
      };
    }
  }

  const typeRaw = o.appointmentType ?? o.appointment_type;
  let appointmentType: HoldListItem['appointmentType'] = null;
  if (typeRaw && typeof typeRaw === 'object') {
    const t = typeRaw as Record<string, unknown>;
    appointmentType = {
      id: normalizeOptionalId(t.id),
      name: typeof t.name === 'string' ? t.name : null,
      prettyName: typeof (t.prettyName ?? t.pretty_name) === 'string'
        ? String(t.prettyName ?? t.pretty_name)
        : null,
    };
  }

  const fbRaw = o.forwardBooking ?? o.forward_booking;
  let forwardBooking: HoldListItem['forwardBooking'] = null;
  if (fbRaw && typeof fbRaw === 'object') {
    const f = fbRaw as Record<string, unknown>;
    const fid = normalizeOptionalId(f.id);
    if (fid != null) {
      forwardBooking = {
        id: fid,
        createdVia:
          typeof (f.createdVia ?? f.created_via) === 'string'
            ? String(f.createdVia ?? f.created_via)
            : null,
        targetDueDate:
          typeof (f.targetDueDate ?? f.target_due_date) === 'string'
            ? String(f.targetDueDate ?? f.target_due_date)
            : null,
        bookingNotes:
          typeof (f.bookingNotes ?? f.booking_notes) === 'string'
            ? String(f.bookingNotes ?? f.booking_notes)
            : null,
        note: typeof f.note === 'string' ? f.note : null,
      };
    }
  }

  const sourceRaw = String(o.source ?? 'manual').trim();
  const source = (
    [
      'appointment_request',
      'care_outreach',
      'schedule_loader',
      'waitlist',
      'end_visit',
      'texted_offer',
      'manual',
    ] as HoldSource[]
  ).includes(sourceRaw as HoldSource)
    ? (sourceRaw as HoldSource)
    : 'manual';

  const id = normalizeOptionalId(o.id) ?? 0;
  const strOrNull = (v: unknown) =>
    typeof v === 'string' ? v : v == null ? null : String(v);

  return {
    id,
    appointmentStart: strOrNull(o.appointmentStart ?? o.appointment_start),
    appointmentEnd: strOrNull(o.appointmentEnd ?? o.appointment_end),
    allDay: truthyApiFlag(o.allDay ?? o.all_day),
    holdPlacedAtIso: strOrNull(o.holdPlacedAtIso ?? o.hold_placed_at_iso),
    appointmentType,
    client,
    patient,
    primaryProvider,
    createdByEmployee,
    holdOwner,
    holdOwnerAssignedAt: strOrNull(
      o.holdOwnerAssignedAt ?? o.hold_owner_assigned_at
    ),
    ownerBucket,
    effectiveOwnerEmployeeId,
    ownerIsCurrentUser,
    source,
    description: strOrNull(o.description),
    instructions: strOrNull(o.instructions),
    pimsId: strOrNull(o.pimsId ?? o.pims_id),
    appointmentRequestSubmissionId: normalizeOptionalId(
      o.appointmentRequestSubmissionId ?? o.appointment_request_submission_id
    ),
    forwardBooking,
  };
}

/** Reconcile Mine flags using a trusted staff employee id (JWT/auth), not only the holds payload. */
export function reconcileHoldOwnerIsCurrentUser(
  holds: HoldListItem[],
  currentUserEmployeeId: number | null
): HoldListItem[] {
  if (currentUserEmployeeId == null) return holds;
  return holds.map((hold) => {
    if (hold.ownerIsCurrentUser) return hold;
    const isMine =
      hold.holdOwner?.id === currentUserEmployeeId ||
      hold.effectiveOwnerEmployeeId === currentUserEmployeeId;
    return isMine ? { ...hold, ownerIsCurrentUser: true } : hold;
  });
}

/** GET /holds?practiceId=&owner= — unified Holds board. */
export async function fetchHolds(
  practiceId: number,
  owner: HoldOwnerFilter = 'me_unassigned'
): Promise<HoldListResponse> {
  const { data } = await http.get('/holds', {
    params: { practiceId, owner: String(owner) },
  });
  const currentUserEmployeeId = normalizeOptionalId(
    data?.currentUserEmployeeId ?? data?.current_user_employee_id
  );
  const rawHolds = Array.isArray(data?.holds) ? data.holds : [];
  return {
    currentUserEmployeeId,
    holds: rawHolds.map((row: unknown) =>
      normalizeHoldListItem(row, currentUserEmployeeId)
    ),
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
  return normalizeHoldListItem(data, ownerEmployeeId);
}

export type ClientLiaisonOption = {
  id: number;
  firstName: string | null;
  lastName: string | null;
};

/** Match the EVet "Receptionist" (Client Liaison) role by name, roleValue, then fuzzy. */
function findReceptionistRoleId(roles: EmployeeRole[]): number | null {
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const byName = roles.find((r) => norm(r.name) === 'receptionist');
  if (byName) return byName.id;
  const byValue = roles.find((r) => norm(r.roleValue) === 'receptionist');
  if (byValue) return byValue.id;
  const fuzzy = roles.find((r) => norm(r.name).includes('receptionist'));
  return fuzzy?.id ?? null;
}

/** Client Liaisons (Receptionists) for the "Assign to…" dropdown. */
export async function fetchClientLiaisons(): Promise<ClientLiaisonOption[]> {
  const roles = await fetchEmployeeRoles();
  const roleId = findReceptionistRoleId(roles);
  if (roleId == null) return [];
  const emps = await fetchEmployeesByRole(roleId);
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
