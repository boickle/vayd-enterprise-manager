const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-11-13" (a calendar date, no time) → "Nov 13, 2026". Read from the parts, so no time zone
 * can move it a day. Anything else comes back unchanged.
 */
export function formatYmd(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  if (!m) return String(ymd ?? '');
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return String(ymd);
  return `${month} ${Number(m[3])}, ${m[1]}`;
}
