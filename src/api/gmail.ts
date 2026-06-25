import { http } from './http';

export type GmailMailboxStatus = {
  email: string;
  kind?: 'shared' | 'personal';
  displayLabel?: string;
  connected: boolean;
  grantedEmail?: string | null;
  connectedAt?: string | null;
  tokenExpiresAt?: string | null;
  mailboxMismatch?: boolean;
};

export type GmailMailboxesResponse = {
  mailboxes: GmailMailboxStatus[];
  defaultMailbox: string | null;
};

export type GmailOAuthStatus = {
  connected: boolean;
  grantedEmail?: string | null;
  connectedAt?: string | null;
  scopes?: string[];
  sharedMailbox?: string;
  mailboxMismatch?: boolean;
  tokenExpiresAt?: string | null;
  mailboxes?: GmailMailboxStatus[];
};

export type GmailLabelColor = {
  textColor: string;
  backgroundColor: string;
};

export type GmailLabelNode = {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: string | null;
  labelListVisibility?: string | null;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: GmailLabelColor | null;
  children: GmailLabelNode[];
};

export type GmailAddress = {
  name?: string | null;
  email: string;
};

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  snippet: string;
  from: GmailAddress;
  to: GmailAddress[];
  subject: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
  labelIds: string[];
  hasAttachments: boolean;
};

export type GmailMessagesResponse = {
  labelId: string;
  untaggedQueue: GmailMessageSummary[];
  threads: GmailMessageSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number | null;
};

function mailboxParams(mailbox: string) {
  return { mailbox };
}

function gmailErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { message?: string; code?: string } } }).response?.data;
    if (data?.code === 'GMAIL_NOT_CONNECTED') {
      return data.message ?? 'Connect Gmail for this account.';
    }
    if (data?.code === 'GMAIL_MAILBOX_MISMATCH') {
      return data.message ?? 'Connect using the correct Google account for this inbox.';
    }
    if (data?.code === 'GMAIL_ACCESS_DENIED') {
      return data.message ?? 'You do not have access to the practice inbox.';
    }
    if (data?.message) return String(data.message);
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export { gmailErrorMessage };

export async function fetchGmailAccess(): Promise<boolean> {
  const { data } = await http.get<{ allowed: boolean }>('/gmail/access');
  return data?.allowed === true;
}

export async function fetchGmailMailboxes(): Promise<GmailMailboxesResponse> {
  const { data } = await http.get<GmailMailboxesResponse>('/gmail/mailboxes');
  return data;
}

export async function fetchGmailOAuthStatus(): Promise<GmailOAuthStatus> {
  const { data } = await http.get<GmailOAuthStatus>('/gmail/oauth/status');
  return data;
}

export async function fetchGmailOAuthConnectUrl(
  mailbox: string,
  returnTo?: string,
): Promise<string> {
  const { data } = await http.get<{ url: string }>('/gmail/oauth/connect', {
    params: { mailbox, ...(returnTo ? { returnTo } : {}) },
  });
  if (!data?.url?.trim()) throw new Error('OAuth connect URL missing');
  return data.url;
}

export async function disconnectGmail(mailbox?: string): Promise<void> {
  await http.delete('/gmail/oauth/disconnect', {
    params: mailbox ? { mailbox } : undefined,
  });
}

export async function fetchGmailThread(
  mailbox: string,
  threadId: string,
): Promise<GmailThreadResponse> {
  const { data } = await http.get<GmailThreadResponse>(
    `/gmail/threads/${encodeURIComponent(threadId)}`,
    { params: mailboxParams(mailbox) },
  );
  return data;
}

export async function fetchGmailSendAs(mailbox: string): Promise<{ aliases: GmailSendAsAlias[] }> {
  const { data } = await http.get<{ aliases: GmailSendAsAlias[] }>('/gmail/send-as', {
    params: mailboxParams(mailbox),
  });
  return data;
}

export type GmailThreadMessage = {
  id: string;
  threadId: string;
  snippet: string;
  from: GmailAddress;
  to: GmailAddress[];
  subject: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
  labelIds: string[];
  hasAttachments: boolean;
  headers: {
    from: string;
    to: string;
    cc: string;
    subject: string;
    messageId: string;
    references: string;
    inReplyTo: string;
  };
  body: { html: string | null; text: string | null };
};

export type GmailThreadResponse = {
  id: string;
  messages: GmailThreadMessage[];
};

export type GmailSendAsAlias = {
  sendAsEmail: string;
  displayName: string | null;
  isDefault: boolean;
  isPrimary: boolean;
  treatAsAlias: boolean;
};

export async function sendGmailMessage(
  mailbox: string,
  body: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  },
) {
  const { data } = await http.post('/gmail/messages/send', body, {
    params: mailboxParams(mailbox),
  });
  return data;
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed || '(no subject)'}`;
}

export async function fetchGmailLabels(mailbox: string): Promise<GmailLabelNode[]> {
  const { data } = await http.get<{ labels: GmailLabelNode[] }>('/gmail/labels', {
    params: mailboxParams(mailbox),
  });
  return data.labels ?? [];
}

export async function fetchGmailMessages(
  mailbox: string,
  params: {
    labelId?: string;
    q?: string;
    pageToken?: string;
    maxResults?: number;
  },
): Promise<GmailMessagesResponse> {
  const { data } = await http.get<GmailMessagesResponse>('/gmail/messages', {
    params: { ...mailboxParams(mailbox), ...params },
  });
  return data;
}

export async function modifyGmailMessage(
  mailbox: string,
  messageId: string,
  body: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<{ id: string; labelIds: string[] }> {
  const { data } = await http.post<{ id: string; labelIds: string[] }>(
    `/gmail/messages/${encodeURIComponent(messageId)}/modify`,
    body,
    { params: mailboxParams(mailbox) },
  );
  return data;
}

async function mailboxAction(mailbox: string, messageId: string, action: string) {
  const { data } = await http.post<{ id: string; labelIds: string[] }>(
    `/gmail/messages/${encodeURIComponent(messageId)}/${action}`,
    undefined,
    { params: mailboxParams(mailbox) },
  );
  return data;
}

export async function archiveGmailMessage(mailbox: string, messageId: string) {
  return mailboxAction(mailbox, messageId, 'archive');
}

export async function trashGmailMessage(mailbox: string, messageId: string) {
  return mailboxAction(mailbox, messageId, 'trash');
}

export async function markGmailMessageRead(mailbox: string, messageId: string) {
  return mailboxAction(mailbox, messageId, 'read');
}

export async function markGmailMessageUnread(mailbox: string, messageId: string) {
  return mailboxAction(mailbox, messageId, 'unread');
}

export async function starGmailMessage(mailbox: string, messageId: string, starred: boolean) {
  const { data } = await http.post<{ id: string; labelIds: string[] }>(
    `/gmail/messages/${encodeURIComponent(messageId)}/star`,
    { starred },
    { params: mailboxParams(mailbox) },
  );
  return data;
}

export function flattenUserLabels(nodes: GmailLabelNode[]): GmailLabelNode[] {
  const out: GmailLabelNode[] = [];
  const walk = (list: GmailLabelNode[]) => {
    for (const n of list) {
      if (n.type === 'user' && !n.id.startsWith('path:')) out.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function formatGmailAddress(addr: GmailAddress): string {
  const name = addr.name?.trim();
  if (name) return `${name} <${addr.email}>`;
  return addr.email;
}

export function labelDisplayName(label: GmailLabelNode): string {
  if (label.type === 'system') {
    const map: Record<string, string> = {
      INBOX: 'Inbox',
      STARRED: 'Starred',
      SENT: 'Sent',
      DRAFT: 'Drafts',
      TRASH: 'Trash',
      SPAM: 'Spam',
      IMPORTANT: 'Important',
      UNREAD: 'Unread',
    };
    return map[label.id] ?? label.name;
  }
  const parts = label.name.split('/');
  return parts[parts.length - 1] ?? label.name;
}

export function mailboxDisplayLabel(mailbox: Pick<GmailMailboxStatus, 'email' | 'displayLabel' | 'kind'>): string {
  if (mailbox.displayLabel?.trim()) return mailbox.displayLabel.trim();
  return mailboxShortLabel(mailbox.email);
}

export function mailboxShortLabel(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
