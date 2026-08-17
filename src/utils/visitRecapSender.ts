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
    if (alias) {
      return alias.displayName?.trim()
        ? `${alias.displayName.trim()} <${alias.sendAsEmail}>`
        : alias.sendAsEmail;
    }
  }
  const self = aliases.find((a) => normalize(a.sendAsEmail) === normalize(mailbox));
  if (self) {
    return self.displayName?.trim()
      ? `${self.displayName.trim()} <${self.sendAsEmail}>`
      : self.sendAsEmail;
  }
  return mailbox;
}

/** True when the recap will go out as the shared inbox rather than the provider. */
export function isFallbackSender(fromAddress: string, mailbox: string): boolean {
  return bareAddress(fromAddress) === normalize(mailbox);
}
