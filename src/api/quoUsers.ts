/** COM-CALL: the practice's Quo users, for the staff profile's "Quo user" field. */
import { http } from './http';

export type QuoUser = { id: string; name: string; email: string | null };

export type QuoUsersResponse = {
  /** The practice uses Quo: every active staff profile needs a Quo user or "Doesn't use Quo". */
  quoEnabled: boolean;
  users: QuoUser[];
  /** Quo couldn't be reached; the list is empty but the choice is still required. */
  error?: string;
};

export type UnlinkedQuoCaller = {
  quoUserId: string;
  name: string | null;
  email: string | null;
  /** Answered calls nobody has filed or dismissed. */
  waitingCalls: number;
  lastCallAt: string | null;
  /** False when this Quo user is no longer in the Quo workspace; null when Quo couldn't be asked. */
  inQuo?: boolean | null;
  /** A staff member (usually deactivated) still carrying this Quo user, e.g. "Winni Zhang (deactivated)". */
  formerStaffName?: string | null;
};

/** Who the notice names: the Quo name, else the staff record, else a plain description. */
export function unlinkedCallerLabel(u: UnlinkedQuoCaller): string {
  if (u.name) return u.email && u.email !== u.name ? `${u.name} (${u.email})` : u.name;
  if (u.formerStaffName) return u.formerStaffName;
  if (u.email) return u.email;
  return u.inQuo === false
    ? `a Quo user no longer in your Quo workspace (${u.quoUserId})`
    : `Quo user ${u.quoUserId}`;
}

/** Dismisses every waiting call from a Quo user no active staff member is linked to. */
export async function dismissUnlinkedQuoCalls(quoUserId: string): Promise<number> {
  const { data } = await http.post<{ dismissed?: number }>(
    `/employees/quo-users/unlinked/${encodeURIComponent(quoUserId)}/dismiss-calls`
  );
  return Number(data?.dismissed) || 0;
}

/** Active staff whose Scout login is turned off (Admin → Users) but who were never offboarded. */
export async function fetchActiveStaffWithLoginOff(): Promise<number[]> {
  const { data } = await http.get<{ employeeIds?: number[] }>('/employees/login-off');
  return Array.isArray(data?.employeeIds) ? data.employeeIds.map(Number) : [];
}

/** The value the profile sends for "Doesn't use Quo". */
export const QUO_NONE = 'none';

export async function fetchQuoUsers(): Promise<QuoUsersResponse> {
  const { data } = await http.get<QuoUsersResponse>('/employees/quo-users');
  return {
    quoEnabled: data?.quoEnabled === true,
    users: Array.isArray(data?.users) ? data.users : [],
    ...(data?.error ? { error: data.error } : {}),
  };
}

/** Quo users who took or made calls lately but aren't linked to any active staff member. */
export async function fetchUnlinkedQuoCallers(): Promise<UnlinkedQuoCaller[]> {
  const { data } = await http.get<{ unlinked?: UnlinkedQuoCaller[] }>(
    '/employees/quo-users/unlinked'
  );
  return Array.isArray(data?.unlinked) ? data.unlinked : [];
}

/** The Quo user whose email matches this person's, offered as a suggestion only. */
export function quoUserMatchingEmail(
  users: QuoUser[],
  email: string | null | undefined
): QuoUser | undefined {
  const key = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  return users.find(
    (u) =>
      String(u.email ?? '')
        .trim()
        .toLowerCase() === key
  );
}
