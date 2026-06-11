const STORAGE_KEY = 'vayd_post_login_redirect';

/** Persist client-portal deep link (e.g. membership signup ?promo=) across login navigation. */
export function savePostLoginRedirect(pathname: string, search = '', hash = ''): void {
  const path = `${pathname}${search}${hash}`;
  if (!path.startsWith('/client-portal') || path === '/client-portal') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    /* ignore quota / private mode */
  }
}

export function peekPostLoginRedirect(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function consumePostLoginRedirect(): string | null {
  const path = peekPostLoginRedirect();
  if (!path) return null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return path;
}

type FromLocation = { pathname?: string; search?: string; hash?: string };

/** Build return path from react-router location passed via login state. */
export function clientPortalReturnPath(from: FromLocation | undefined | null): string | null {
  const pathname = from?.pathname ?? '';
  if (!pathname.startsWith('/client-portal') || pathname === '/client-portal') return null;
  return `${pathname}${from?.search ?? ''}${from?.hash ?? ''}`;
}

export function isMembershipSignupReturnPath(path: string): boolean {
  return path.includes('/membership-signup') || path.includes('/membership-payment');
}
