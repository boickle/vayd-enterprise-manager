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
};

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
