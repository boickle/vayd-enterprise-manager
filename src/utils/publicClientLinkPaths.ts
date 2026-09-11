/** Client-facing magic-link pages — no staff login required (same as survey / room-loader). */
export function isPublicClientLinkPath(pathname: string): boolean {
  return (
    pathname.startsWith('/confirm/') ||
    pathname.startsWith('/survey/') ||
    pathname.startsWith('/consent/') ||
    pathname.startsWith('/records/') ||
    pathname.startsWith('/public/room-loader') ||
    pathname === '/share' ||
    pathname === '/refer-a-friend' ||
    pathname.startsWith('/client-portal/request-appointment') ||
    pathname === '/store' ||
    pathname.startsWith('/store/')
  );
}
