const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e || null;
}

/** Pull candidate emails out of free text (e.g. a request notification body). */
export function extractEmailsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(EMAIL_RE)) {
    const e = normalizeEmail(match[0]);
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}
