/** Main practice line from API payloads (`practice.phone1` or normalized `phone`). */
export function pickPracticeMainPhone(
  practice: { phone1?: string | null; phone?: string | null } | null | undefined
): string | null {
  const raw = (practice?.phone1 ?? practice?.phone)?.trim();
  return raw || null;
}
