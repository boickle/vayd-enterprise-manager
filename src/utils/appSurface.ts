import { isPublicClientLinkPath } from './publicClientLinkPaths';

/** Marketing vs staff surface so GTM can exclude /schedule and other employee tools. */
export function appSurfaceFromPath(pathname: string): 'public' | 'staff' {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (
    isPublicClientLinkPath(path) ||
    path.startsWith('/client-portal') ||
    path === '/share' ||
    path === '/login' ||
    path === '/request-reset' ||
    path === '/requestreset' ||
    path === '/reset-password' ||
    path === '/resetpass'
  ) {
    return 'public';
  }
  return 'staff';
}
