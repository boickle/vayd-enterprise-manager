import type { GmailMailboxStatus, GmailSendAsAlias } from '../api/gmail';

/**
 * Visit recaps go out from the shared field inbox, not the general practice inbox —
 * replies belong with the doctors who did the visit.
 */
export const VISIT_RECAP_MAILBOX = 'field@vetatyourdoor.com';

/** Fallback so a recap can still be sent if the field inbox isn't connected. */
const FALLBACK_MAILBOX = 'info@vetatyourdoor.com';

function normalize(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** The bare address out of either `a@b.com` or `Name <a@b.com>`. */
function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return normalize(match ? match[1] : value);
}

/** The shared mailbox to send the recap through, preferring the field inbox. */
export function resolveRecapMailbox(mailboxes: GmailMailboxStatus[]): string | null {
  const connected = mailboxes.filter((m) => m.connected);
  const preferred = [VISIT_RECAP_MAILBOX, FALLBACK_MAILBOX];
  for (const wanted of preferred) {
    const hit = connected.find((m) => normalize(m.email) === wanted);
    if (hit) return hit.email;
  }
  return connected[0]?.email ?? null;
}

/** `Name <a@b.com>` or bare address, for the From field / send-as select. */
export function formatSendAsLabel(alias: GmailSendAsAlias): string {
  const email = alias.sendAsEmail.trim();
  return alias.displayName?.trim() ? `${alias.displayName.trim()} <${email}>` : email;
}

/**
 * The address the recap should appear to come from: the visit provider's work
 * alias when the shared mailbox genuinely has it configured, otherwise the shared
 * mailbox itself.
 *
 * The provider's address here comes from `employees.email`, which is a single
 * field that may well hold a private address. Requiring a match against the
 * mailbox's real send-as list means a private address can never be used as the
 * From — a missing alias degrades to the shared inbox instead of leaking it.
 */
export function resolveRecapFromAddress(
  aliases: GmailSendAsAlias[],
  mailbox: string,
  providerEmail: string | null | undefined
): string {
  const wanted = normalize(providerEmail);
  if (wanted) {
    const alias = aliases.find((a) => normalize(a.sendAsEmail) === wanted);
    if (alias) return formatSendAsLabel(alias);
  }
  const self = aliases.find((a) => normalize(a.sendAsEmail) === normalize(mailbox));
  if (self) return formatSendAsLabel(self);
  return mailbox;
}

/** True when the recap will go out as the shared inbox rather than the provider. */
export function isFallbackSender(fromAddress: string, mailbox: string): boolean {
  return bareAddress(fromAddress) === normalize(mailbox);
}

/** Bare email of a From label (`Name <a@b.com>` or `a@b.com`). */
export function bareSendAsAddress(value: string): string {
  return bareAddress(value);
}

/**
 * Split a To field into unique addresses. Commas and semicolons separate
 * recipients, but not when they sit inside quotes or `<angle brackets>` so
 * "Cheeseman, BVM&S <kate@…>" stays one address.
 */
export function parseRecapRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of splitRecipientList(raw)) {
    const email = extractRecipientEmail(part);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function splitRecipientList(raw: string): string[] {
  if (!raw.trim()) return [];
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let inAngles = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (ch === '<' && !inQuotes) {
      inAngles = true;
      cur += ch;
      continue;
    }
    if (ch === '>' && !inQuotes) {
      inAngles = false;
      cur += ch;
      continue;
    }
    if ((ch === ',' || ch === ';' || ch === '\n') && !inQuotes && !inAngles) {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const trimmed = cur.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

function extractRecipientEmail(part: string): string | null {
  const angled = part.match(/<([^>]+)>/);
  const email = (angled ? angled[1] : part).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Closing the Gmail signature sits under. The model often skips it, so send always adds it. */
export const RECAP_FAREWELL = 'Take care,';

export function recapHasFarewell(text: string): boolean {
  const tail = (text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /(?:take care|warmly|best regards|best wishes|sincerely|with care|all the best)\s*,?$/i.test(
    tail
  );
}

/** Append "Take care," when the letter has no closing of its own. */
export function ensureRecapFarewell(parts: {
  html: string;
  text: string;
}): { html: string; text: string } {
  if (recapHasFarewell(parts.text) || recapHasFarewell(parts.html)) return parts;
  return {
    text: `${parts.text.replace(/\s+$/, '')}\n\n${RECAP_FAREWELL}`,
    html: `${parts.html.replace(/(<br\s*\/?>|\s)+$/gi, '')}<br><br>${RECAP_FAREWELL}`,
  };
}

const FAREWELL_RE = /(?:take care|warmly|best regards|best wishes|sincerely|with care|all the best)\s*,?/gi;

/**
 * Puts the "order from our store" block above the recap's closing ("Take care,"), so it reads
 * as part of the doctor's letter and the signature stays last. With no closing found it goes last.
 */
export function insertBeforeFarewell(
  closed: { html: string; text: string },
  block: { html: string; text: string } | null
): { html: string; text: string } {
  if (!block) return closed;
  const lines = closed.text.replace(/\s+$/, '').split('\n');
  const lastIdx = lines.length - 1;
  const text =
    lastIdx >= 0 && recapHasFarewell(lines[lastIdx])
      ? [...lines.slice(0, lastIdx), '', block.text, '', lines[lastIdx]].join('\n').replace(/\n{3,}/g, '\n\n')
      : `${closed.text.replace(/\s+$/, '')}\n\n${block.text}`;

  let at = -1;
  for (const m of closed.html.matchAll(FAREWELL_RE)) at = m.index ?? at;
  let html: string;
  if (at < 0 || !recapHasFarewell(closed.html)) {
    html = `${closed.html}${block.html}`;
  } else {
    // Start of the element holding the closing, when it sits in its own <p>/<div>.
    const before = closed.html.slice(0, at);
    const open = Math.max(before.lastIndexOf('<p'), before.lastIndexOf('<div'));
    const close = Math.max(before.lastIndexOf('</p>'), before.lastIndexOf('</div>'), before.lastIndexOf('<br'));
    const cut = open > close ? open : at;
    html = `${closed.html.slice(0, cut)}${block.html}${closed.html.slice(cut)}`;
  }
  return { html, text };
}
