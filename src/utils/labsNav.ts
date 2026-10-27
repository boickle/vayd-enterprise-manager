/** Labs = lab work in flight and coming back: IDEXX send-outs and in-house runs. */

export const LABS_HOME = '/schedule/idexx-results';
export const LABS_IN_HOUSE = '/schedule/in-house-labs';

export function isLabsNavPath(pathname: string): boolean {
  return [LABS_HOME, LABS_IN_HOUSE].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}
