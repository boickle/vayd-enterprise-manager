/** Client-facing magic-link pages — no staff login required (same as survey / room-loader). */
export function isPublicClientLinkPath(pathname: string): boolean {
  return (
    pathname.startsWith('/confirm/') ||
    pathname.startsWith('/survey/') ||
    pathname.startsWith('/public/room-loader') ||
    pathname === '/refer-a-friend' ||
    pathname.startsWith('/client-portal/request-appointment')
  );
}
