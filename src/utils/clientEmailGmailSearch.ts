import { GMAIL_ALL_MAIL_SEARCH_SCOPE } from '../components/gmail/gmailSearch';

const DEFAULT_RECEPTION_EMAIL = (import.meta.env.VITE_DEFAULT_RECEPTION_EMAIL || '')
  .trim()
  .toLowerCase();

export const CLIENT_EMAIL_THREADS_PER_ADDRESS = 3;

function quoteGmailTerm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed)) return `"${trimmed.replace(/"/g, '')}"`;
  return trimmed;
}

/** Gmail query for all correspondence with a client address. */
export function buildGmailClientCorrespondenceQuery(clientEmail: string): string {
  const term = quoteGmailTerm(clientEmail);
  return `{from:${term} to:${term}} ${GMAIL_ALL_MAIL_SEARCH_SCOPE}`.trim();
}

export function isEffectiveClientEmail(email: string | null | undefined): boolean {
  if (email == null || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes('@')) return false;
  if (DEFAULT_RECEPTION_EMAIL && trimmed.toLowerCase() === DEFAULT_RECEPTION_EMAIL) return false;
  return true;
}

/** Unique, normalized client emails from GET /clients/:id payload. */
export function clientEmailsFromStaffPayload(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of ['email', 'secondEmail']) {
    const value = record[key];
    if (typeof value !== 'string' || !isEffectiveClientEmail(value)) continue;
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}
