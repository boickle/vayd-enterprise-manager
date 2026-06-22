/** Strip trailing/leading punctuation from a single name token. */
export function stripNameToken(raw: string): string {
  return raw.replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
}

/**
 * Client first name for SMS greetings.
 * Prefers explicit `firstName`; parses PIMS-style "Last, First" display labels.
 */
export function clientFirstNameForSms(opts: {
  firstName?: string | null;
  displayLabel?: string | null;
}): string {
  const fn = opts.firstName?.trim();
  if (fn) {
    const token = stripNameToken(fn.split(/\s+/).filter(Boolean)[0] ?? fn);
    if (token) return token;
  }

  const label = opts.displayLabel?.trim();
  if (!label) return 'there';

  if (label.includes(',')) {
    const afterComma = label.split(',').slice(1).join(',').trim();
    const first = stripNameToken(afterComma.split(/\s+/).filter(Boolean)[0] ?? '');
    if (first) return first;
  }

  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return stripNameToken(parts[0]!);
  }
  if (parts.length === 1) {
    return stripNameToken(parts[0]!);
  }

  return 'there';
}
