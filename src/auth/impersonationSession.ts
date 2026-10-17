/**
 * Superadmin "view as" session. The superadmin's own sign-in is set aside in
 * localStorage and put back when the session stops or expires. Kept free of
 * `http` imports so the token refresh code can use it.
 */

const SESSION_KEY = 'vayd_impersonation';
const SIGN_IN_KEYS = [
  'accessToken',
  'refreshToken',
  'vayd_token',
  'vayd_email',
  'vayd_clientId',
  'vayd_clientInfo',
] as const;

export type ImpersonationTarget = {
  userId: number;
  email: string;
  role: string;
  name: string;
  clientId: number | null;
};

export type ImpersonationSession = {
  target: ImpersonationTarget;
  expiresAt: string;
  returnTo: string;
  saved: Partial<Record<(typeof SIGN_IN_KEYS)[number], string | null>>;
};

export function readImpersonation(): ImpersonationSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ImpersonationSession) : null;
  } catch {
    return null;
  }
}

/** Swaps the stored sign-in for the impersonation token and returns where to go. */
export function beginImpersonation(input: {
  accessToken: string;
  expiresAt: string;
  target: ImpersonationTarget;
  returnTo: string;
}): string {
  const saved: ImpersonationSession['saved'] = {};
  for (const key of SIGN_IN_KEYS) saved[key] = localStorage.getItem(key);
  const session: ImpersonationSession = {
    target: input.target,
    expiresAt: input.expiresAt,
    returnTo: input.returnTo,
    saved,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  for (const key of SIGN_IN_KEYS) localStorage.removeItem(key);
  localStorage.setItem('accessToken', input.accessToken);
  localStorage.setItem('vayd_email', input.target.email);
  if (input.target.clientId != null) {
    localStorage.setItem('vayd_clientId', String(input.target.clientId));
  }
  return input.target.role === 'client' ? '/client-portal' : '/schedule';
}

/** Puts the superadmin's own sign-in back. Returns the page they started from. */
export function endImpersonation(): string {
  const session = readImpersonation();
  localStorage.removeItem(SESSION_KEY);
  if (!session) return '/schedule';
  for (const key of SIGN_IN_KEYS) {
    const value = session.saved[key];
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  return session.returnTo || '/schedule';
}

/** Ends the session and reloads as the superadmin. */
export function leaveImpersonation(): void {
  window.location.assign(endImpersonation());
}
