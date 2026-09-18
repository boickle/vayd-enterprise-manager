import type { GmailMailboxStatus } from '../api/gmail';

const INFO = 'info@vetatyourdoor.com';
const FIELD = 'field@vetatyourdoor.com';

export const NO_SHARED_GMAIL_MESSAGE =
  'No shared practice inbox is available. You need access to Info or Field to email clients from Scout.';

function normalizeMailboxEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** info@ / field@ — not a staff personal mailbox. */
export function isSharedPracticeMailbox(mailbox: Pick<GmailMailboxStatus, 'email' | 'kind' | 'authMode'>): boolean {
  if (mailbox.kind === 'personal') return false;
  if (mailbox.kind === 'shared' || mailbox.authMode === 'service_account') return true;
  const email = normalizeMailboxEmail(mailbox.email);
  return email === INFO || email === FIELD;
}

export function sharedConnectedMailboxes(
  mailboxes: GmailMailboxStatus[] | undefined,
): GmailMailboxStatus[] {
  return (mailboxes ?? []).filter((mb) => mb.connected && isSharedPracticeMailbox(mb));
}

/** Info first when the user can send from both. */
export function defaultSharedMailbox(
  mailboxes: GmailMailboxStatus[] | undefined,
): GmailMailboxStatus | null {
  const shared = sharedConnectedMailboxes(mailboxes);
  return (
    shared.find((m) => normalizeMailboxEmail(m.email) === INFO) ??
    shared.find((m) => normalizeMailboxEmail(m.email) === FIELD) ??
    shared[0] ??
    null
  );
}
