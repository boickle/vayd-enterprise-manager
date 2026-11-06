import { GMAIL_ALL_MAIL_SEARCH_SCOPE } from '../components/gmail/gmailSearch';

/**
 * `records@vetatyourdoor.com` is an alias of `info@`, not a delegated mailbox,
 * so there is nothing separate to search. Mail to records@ lands in info@ and a
 * Gmail filter tags it `Records` — that label is the closest thing we have to a
 * dedicated inbox.
 */
export const RECORDS_GMAIL_LABEL = 'Records';

function quoteGmailTerm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed)) return `"${trimmed.replace(/"/g, '')}"`;
  return trimmed;
}

/** Surname only — "Olivia Major" and "O. Major" should both hit. */
export function clientSurname(clientName: string | null | undefined): string {
  const parts = (clientName ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Records arrive addressed to us, not from a known address, so the only reliable
 * hooks are the pet's name and the owner's surname. Either one matching is worth
 * showing the CL — requiring both misses records filed under just the pet.
 */
export function buildRecordsEmailSearchQuery(opts: {
  patientName?: string | null;
  clientName?: string | null;
  hospitalName?: string | null;
}): string {
  const terms: string[] = [];
  const patient = quoteGmailTerm(opts.patientName ?? '');
  const surname = quoteGmailTerm(clientSurname(opts.clientName));
  const hospital = quoteGmailTerm(opts.hospitalName ?? '');

  for (const term of [patient, surname, hospital]) {
    if (term && !terms.includes(term)) terms.push(term);
  }
  if (!terms.length) return '';

  // Gmail ORs a {…} group; widen past the Records label since outside practices
  // often reply to a person rather than to records@.
  const anyTerm = terms.length === 1 ? terms[0] : `{${terms.join(' ')}}`;
  return `${anyTerm} ${GMAIL_ALL_MAIL_SEARCH_SCOPE}`.trim();
}
