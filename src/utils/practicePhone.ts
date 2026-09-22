/** Used when the logged-in staff member has no Quo line of their own. */
export const PRACTICE_MAIN_LINE_FALLBACK = '207-536-8387';

/** Main practice line from API payloads (`practice.phone1` or normalized `phone`). */
export function pickPracticeMainPhone(
  practice: { phone1?: string | null; phone?: string | null } | null | undefined
): string | null {
  const raw = (practice?.phone1 ?? practice?.phone)?.trim();
  return raw || null;
}
