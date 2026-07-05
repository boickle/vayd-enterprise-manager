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

export type GmailAttachmentSummary = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size?: number;
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
  threadMessageCount?: number;
  participants?: string;
  attachments?: GmailAttachmentSummary[];
  /** When set, a message in this thread is scheduled to send at this time. */
  scheduledSendAt?: string | null;
};

export type GmailMessagesResponse = {
  labelId: string;
  untaggedQueue: GmailMessageSummary[];
  threads: GmailMessageSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number | null;
  inboxUnreadCount?: number;
};

export const GMAIL_MESSAGES_PAGE_SIZE = 50;

/** While the inbox is open, refetch from Gmail API on this interval (fallback if WebSocket/push lag). */
export const GMAIL_INBOX_POLL_MS = 30_000;

function messageTimestamp(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function threadKey(msg: GmailMessageSummary): string {
  return msg.threadId?.trim() || msg.id;
}

function attachmentDisplayKey(att: GmailAttachmentSummary): string {
  const name = att.filename.trim().toLowerCase();
  const mime = att.mimeType.trim().toLowerCase();
  const size = att.size != null ? String(att.size) : '';
  return `${name}|${mime}|${size}`;
}

function dedupeAttachmentsNewestFirst(
  attachments: GmailAttachmentSummary[],
): GmailAttachmentSummary[] {
  const out: GmailAttachmentSummary[] = [];
  const seen = new Set<string>();
  for (const att of attachments) {
    const key = attachmentDisplayKey(att);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(att);
  }
  return out;
}

/** Newest message first; within a message, later MIME parts are treated as more recent. */
function collectThreadAttachmentsNewestFirst(
  messages: GmailMessageSummary[],
): GmailAttachmentSummary[] {
  const ranked: Array<{
    att: GmailAttachmentSummary;
    messageTs: number;
    withinMessageRank: number;
  }> = [];

  for (const m of messages) {
    const messageTs = messageTimestamp(m.date);
    const msgAttachments = m.attachments ?? [];
    for (let i = 0; i < msgAttachments.length; i++) {
      ranked.push({
        att: msgAttachments[i]!,
        messageTs,
        withinMessageRank: msgAttachments.length - 1 - i,
      });
    }
  }

  ranked.sort((a, b) => {
    const tsDiff = b.messageTs - a.messageTs;
    if (tsDiff !== 0) return tsDiff;
    return b.withinMessageRank - a.withinMessageRank;
  });

  return dedupeAttachmentsNewestFirst(ranked.map((entry) => entry.att));
}

/** Collapse individual messages into one row per thread (newest message wins). */
export function groupGmailMessagesByThread(
  messages: GmailMessageSummary[],
): GmailMessageSummary[] {
  const byThread = new Map<string, GmailMessageSummary[]>();
  for (const msg of messages) {
    const key = threadKey(msg);
    const list = byThread.get(key) ?? [];
    list.push(msg);
    byThread.set(key, list);
  }

  const grouped: GmailMessageSummary[] = [];
  for (const msgs of byThread.values()) {
    const sorted = [...msgs].sort(
      (a, b) => messageTimestamp(b.date) - messageTimestamp(a.date),
    );
    const latest = sorted[0]!;
    const labelIds = new Set<string>();
    let maxCount = 1;
    const participantParts: string[] = [];
    let scheduledSendAt: string | null | undefined;
    for (const m of sorted) {
      for (const id of m.labelIds) labelIds.add(id);
      maxCount = Math.max(maxCount, m.threadMessageCount ?? 1);
      if (m.participants?.trim()) participantParts.push(m.participants.trim());
      if (m.scheduledSendAt) {
        if (
          !scheduledSendAt ||
          new Date(m.scheduledSendAt).getTime() < new Date(scheduledSendAt).getTime()
        ) {
          scheduledSendAt = m.scheduledSendAt;
        }
      }
    }
    const attachments = collectThreadAttachmentsNewestFirst(sorted);
    grouped.push({
      ...latest,
      threadId: threadKey(latest),
      labelIds: [...labelIds],
      isUnread: sorted.some((m) => m.isUnread),
      isStarred: sorted.some((m) => m.isStarred),
      hasAttachments: attachments.length > 0 || sorted.some((m) => m.hasAttachments),
      attachments,
      threadMessageCount: Math.max(maxCount, sorted.length),
      participants: mergeParticipantLists(participantParts) ?? latest.participants,
      scheduledSendAt: scheduledSendAt ?? latest.scheduledSendAt ?? null,
    });
  }

  grouped.sort((a, b) => messageTimestamp(b.date) - messageTimestamp(a.date));
  return grouped;
}

function mergeParticipantLists(parts: string[]): string | undefined {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const name of part.split(',').map((s) => s.trim()).filter(Boolean)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names.length > 0 ? names.join(', ') : undefined;
}

/** Merge API sections into one thread-grouped list sorted newest-first. */
export function mergeGmailMessagesByDate(
  ...lists: GmailMessageSummary[][]
): GmailMessageSummary[] {
  return groupGmailMessagesByThread(lists.flat());
}

function mailboxParams(mailbox: string, threadId?: string) {
  return threadId?.trim() ? { mailbox, threadId: threadId.trim() } : { mailbox };
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
  attachments?: GmailAttachmentSummary[];
  scheduledSendAt?: string | null;
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

export function patchInboxUnreadCount(
  labels: GmailLabelNode[],
  count: number | undefined,
): GmailLabelNode[] {
  if (count == null || count <= 0) return labels;
  return labels.map((label) =>
    label.id === 'INBOX'
      ? { ...label, threadsUnread: count, messagesUnread: count }
      : label,
  );
}

export async function fetchGmailLabels(
  mailbox: string,
): Promise<{ labels: GmailLabelNode[]; inboxUnreadCount?: number }> {
  const { data } = await http.get<{ labels: GmailLabelNode[]; inboxUnreadCount?: number }>(
    '/gmail/labels',
    {
      params: mailboxParams(mailbox),
    },
  );
  return { labels: data.labels ?? [], inboxUnreadCount: data.inboxUnreadCount };
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
  threadId?: string,
): Promise<{ id: string; labelIds: string[] }> {
  const { data } = await http.post<{ id: string; labelIds: string[] }>(
    `/gmail/messages/${encodeURIComponent(messageId)}/modify`,
    body,
    { params: mailboxParams(mailbox, threadId) },
  );
  return data;
}

async function mailboxAction(
  mailbox: string,
  messageId: string,
  action: string,
  threadId?: string,
) {
  const { data } = await http.post<{ id: string; labelIds: string[] }>(
    `/gmail/messages/${encodeURIComponent(messageId)}/${action}`,
    undefined,
    { params: mailboxParams(mailbox, threadId) },
  );
  return data;
}

export async function archiveGmailMessage(
  mailbox: string,
  messageId: string,
  threadId?: string,
) {
  return mailboxAction(mailbox, messageId, 'archive', threadId);
}

export async function trashGmailMessage(
  mailbox: string,
  messageId: string,
  threadId?: string,
) {
  return mailboxAction(mailbox, messageId, 'trash', threadId);
}

export async function markGmailMessageRead(
  mailbox: string,
  messageId: string,
  threadId?: string,
) {
  return mailboxAction(mailbox, messageId, 'read', threadId);
}

export async function markGmailMessageUnread(
  mailbox: string,
  messageId: string,
  threadId?: string,
) {
  return mailboxAction(mailbox, messageId, 'unread', threadId);
}

export async function starGmailMessage(
  mailbox: string,
  messageId: string,
  starred: boolean,
  threadId?: string,
) {
  const { data } = await http.post<{ id: string; labelIds: string[] }>(
    `/gmail/messages/${encodeURIComponent(messageId)}/star`,
    { starred },
    { params: mailboxParams(mailbox, threadId) },
  );
  return data;
}

export async function openGmailAttachment(
  mailbox: string,
  attachment: Pick<GmailAttachmentSummary, 'messageId' | 'attachmentId' | 'filename' | 'mimeType'>,
): Promise<void> {
  const { data } = await http.get<Blob>(
    `/gmail/messages/${encodeURIComponent(attachment.messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,
    {
      params: mailboxParams(mailbox),
      responseType: 'blob',
    },
  );
  const blob = data instanceof Blob ? data : new Blob([data], { type: attachment.mimeType });
  const url = URL.createObjectURL(blob);
  const previewable =
    attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf';
  if (previewable) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.filename;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function truncateAttachmentFilename(filename: string, max = 16): string {
  const trimmed = filename.trim();
  if (trimmed.length <= max) return trimmed;
  const dot = trimmed.lastIndexOf('.');
  if (dot > 0 && dot < trimmed.length - 1) {
    const ext = trimmed.slice(dot);
    const baseMax = Math.max(4, max - ext.length - 1);
    return `${trimmed.slice(0, baseMax)}…${ext}`;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Gmail snippets often contain HTML entities (`&#39;`, `&amp;`, etc.). */
export function decodeGmailSnippet(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (typeof document === 'undefined') {
    return trimmed
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }
  const el = document.createElement('textarea');
  el.innerHTML = trimmed;
  return el.value;
}

export function hasScheduledSend(
  msg: Pick<GmailMessageSummary, 'scheduledSendAt' | 'labelIds'>,
): boolean {
  return Boolean(msg.scheduledSendAt) || msg.labelIds.includes('SCHEDULED');
}

export function formatScheduledSendTooltip(iso: string | null | undefined): string {
  if (!iso) return 'Scheduled send';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Scheduled send';
  return `Scheduled for ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export const GMAIL_CATEGORIES_GROUP_ID = 'group:categories';
export const GMAIL_MORE_GROUP_ID = 'group:more';
export const GMAIL_SNOOZED_ID = 'virtual:snoozed';
export const GMAIL_SCHEDULED_ID = 'virtual:scheduled';
export const GMAIL_ALL_MAIL_ID = 'virtual:all-mail';

const GMAIL_CATEGORY_LABEL_PREFIX = 'CATEGORY_';

const VIRTUAL_MAILBOX_QUERIES: Record<string, string> = {
  [GMAIL_SNOOZED_ID]: 'in:snoozed',
  [GMAIL_SCHEDULED_ID]: 'in:scheduled',
  [GMAIL_ALL_MAIL_ID]: 'in:anywhere -in:spam -in:trash',
};

const PRIMARY_NAV_ORDER = [
  'INBOX',
  'STARRED',
  GMAIL_SNOOZED_ID,
  'SENT',
  'DRAFT',
] as const;

const MORE_NAV_ORDER = [
  'IMPORTANT',
  GMAIL_SCHEDULED_ID,
  GMAIL_ALL_MAIL_ID,
  'SPAM',
  'TRASH',
] as const;

function categoryDisplayName(id: string): string {
  const map: Record<string, string> = {
    CATEGORY_FORUMS: 'Forums',
    CATEGORY_UPDATES: 'Updates',
    CATEGORY_PERSONAL: 'Personal',
    CATEGORY_PROMOTIONS: 'Promotions',
    CATEGORY_SOCIAL: 'Social',
    CATEGORY_PURCHASES: 'Purchases',
  };
  if (map[id]) return map[id];
  const raw = id.replace(/^CATEGORY_/, '');
  return raw
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

const SIDEBAR_SYSTEM_LABEL_IDS = new Set([
  'INBOX',
  'STARRED',
  'SENT',
  'DRAFT',
  'TRASH',
  'SPAM',
  'IMPORTANT',
]);

/** Internal Gmail system labels that should not appear in the sidebar. */
const HIDDEN_SIDEBAR_LABEL_IDS = new Set(['UNREAD', 'CHAT']);

function normalizeSidebarLabel(label: GmailLabelNode): GmailLabelNode {
  if (label.id === 'YELLOW_STAR') {
    return { ...label, id: 'STARRED', name: 'STARRED' };
  }
  return label;
}

function isSidebarSystemLabel(id: string): boolean {
  return SIDEBAR_SYSTEM_LABEL_IDS.has(id) || id.startsWith(GMAIL_CATEGORY_LABEL_PREFIX);
}

function filterSidebarLabelTree(labels: GmailLabelNode[]): GmailLabelNode[] {
  const out: GmailLabelNode[] = [];
  for (const label of labels) {
    const normalized = normalizeSidebarLabel(label);
    if (HIDDEN_SIDEBAR_LABEL_IDS.has(normalized.id)) continue;
    if (normalized.type === 'system' && !isSidebarSystemLabel(normalized.id)) continue;
    out.push({
      ...normalized,
      children: normalized.children.length ? filterSidebarLabelTree(normalized.children) : [],
    });
  }
  return out;
}

export type GmailSidebarLabels = {
  navigation: GmailLabelNode[];
  userLabels: GmailLabelNode[];
};

function virtualMailboxLabel(id: string): GmailLabelNode {
  const names: Record<string, string> = {
    [GMAIL_SNOOZED_ID]: 'Snoozed',
    [GMAIL_SCHEDULED_ID]: 'Scheduled',
    [GMAIL_ALL_MAIL_ID]: 'All Mail',
  };
  return { id, name: names[id] ?? id, type: 'system', children: [] };
}

function systemLabelOrPlaceholder(
  id: string,
  systemById: Map<string, GmailLabelNode>,
): GmailLabelNode {
  if (isVirtualMailboxLabel(id)) return virtualMailboxLabel(id);
  return (
    systemById.get(id) ?? {
      id,
      name: id,
      type: 'system',
      children: [],
    }
  );
}

/** Filter internal labels and return Gmail-style sidebar navigation + user labels. */
export function prepareSidebarLabels(labels: GmailLabelNode[]): GmailSidebarLabels {
  const filtered = filterSidebarLabelTree(labels);
  const systemById = new Map<string, GmailLabelNode>();
  const userLabels: GmailLabelNode[] = [];
  const categories: GmailLabelNode[] = [];

  for (const label of filtered) {
    if (label.id.startsWith(GMAIL_CATEGORY_LABEL_PREFIX)) {
      categories.push(label);
    } else if (label.type === 'user') {
      userLabels.push(label);
    } else if (SIDEBAR_SYSTEM_LABEL_IDS.has(label.id) && !systemById.has(label.id)) {
      systemById.set(label.id, label);
    }
  }

  const navigation: GmailLabelNode[] = PRIMARY_NAV_ORDER.map((id) =>
    systemLabelOrPlaceholder(id, systemById),
  );

  const moreChildren = MORE_NAV_ORDER.map((id) => systemLabelOrPlaceholder(id, systemById));
  navigation.push({
    id: GMAIL_MORE_GROUP_ID,
    name: 'More',
    type: 'system',
    children: moreChildren,
  });

  if (categories.length > 0) {
    navigation.push({
      id: GMAIL_CATEGORIES_GROUP_ID,
      name: 'Categories',
      type: 'system',
      children: categories,
    });
  }

  return { navigation, userLabels };
}

export function isVirtualMailboxLabel(labelId: string): boolean {
  return labelId.startsWith('virtual:');
}

export function isMoreNavLabel(labelId: string): boolean {
  return (MORE_NAV_ORDER as readonly string[]).includes(labelId);
}

/** Resolve list params for a sidebar selection (supports virtual folders via Gmail search). */
export function resolveGmailMessageListParams(
  selectedLabelId: string,
  extraQuery: string,
  scopedLabelId: string,
): { labelId?: string; q?: string } {
  const virtualBase = VIRTUAL_MAILBOX_QUERIES[selectedLabelId];
  const trimmed = extraQuery.trim();
  if (virtualBase) {
    return { q: trimmed ? `${virtualBase} ${trimmed}` : virtualBase };
  }
  return {
    labelId: scopedLabelId,
    q: trimmed || undefined,
  };
}

/** Sidebar count badge — drafts/spam totals, inbox unread, etc. */
export function labelSidebarCount(label: GmailLabelNode): number | null {
  if (label.id === 'DRAFT') {
    const total = label.messagesTotal ?? label.threadsTotal;
    return total != null && total > 0 ? total : null;
  }
  if (label.id === 'INBOX') {
    const unread = label.threadsUnread ?? label.messagesUnread ?? 0;
    return unread > 0 ? unread : null;
  }
  if (label.id === 'SPAM') {
    const unread = label.threadsUnread ?? label.messagesUnread ?? 0;
    return unread > 0 ? unread : null;
  }
  const unread = label.messagesUnread ?? label.threadsUnread ?? 0;
  return unread > 0 ? unread : null;
}

export function getMessageUserLabels(
  labelIds: string[],
  labelById: Map<string, GmailLabelNode>,
): GmailLabelNode[] {
  return labelIds
    .map((id) => labelById.get(id))
    .filter((label): label is GmailLabelNode => label?.type === 'user');
}

const REMOVABLE_HEADER_SYSTEM_LABEL_IDS = new Set(['INBOX']);

/** User labels and removable system labels (e.g. Inbox) shown under the message subject. */
export function getMessageRemovableHeaderLabels(
  labelIds: string[],
  labelById: Map<string, GmailLabelNode>,
): GmailLabelNode[] {
  return labelIds
    .map((id) => labelById.get(id))
    .filter((label): label is GmailLabelNode => {
      if (!label) return false;
      if (label.type === 'user') return true;
      return REMOVABLE_HEADER_SYSTEM_LABEL_IDS.has(label.id);
    });
}

export function labelChipStyle(label: GmailLabelNode): {
  backgroundColor: string;
  color: string;
} {
  if (label.color?.backgroundColor) {
    return {
      backgroundColor: label.color.backgroundColor,
      color: label.color.textColor || '#ffffff',
    };
  }
  return { backgroundColor: '#e2e8f0', color: '#334155' };
}

/** Nest top-level Gmail category system labels under a collapsible "Categories" group. */
export function nestCategoryLabels(labels: GmailLabelNode[]): GmailLabelNode[] {
  let firstCategoryIdx = -1;
  const categories: GmailLabelNode[] = [];
  const rest: GmailLabelNode[] = [];

  for (const label of labels) {
    if (label.id.startsWith(GMAIL_CATEGORY_LABEL_PREFIX)) {
      if (firstCategoryIdx === -1) firstCategoryIdx = rest.length;
      categories.push(label);
    } else {
      rest.push(label);
    }
  }

  if (categories.length === 0) return labels;

  const categoriesGroup: GmailLabelNode = {
    id: GMAIL_CATEGORIES_GROUP_ID,
    name: 'Categories',
    type: 'system',
    children: categories,
  };

  const at = firstCategoryIdx === -1 ? rest.length : firstCategoryIdx;
  return [...rest.slice(0, at), categoriesGroup, ...rest.slice(at)];
}

export function isGmailLabelGroup(label: Pick<GmailLabelNode, 'id'>): boolean {
  return label.id.startsWith('group:');
}

export function flattenUserLabels(nodes: GmailLabelNode[]): GmailLabelNode[] {
  const out: GmailLabelNode[] = [];
  const walk = (list: GmailLabelNode[]) => {
    for (const n of list) {
      if (n.type === 'user' && !n.id.startsWith('path:') && !isGmailLabelGroup(n)) out.push(n);
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
  if (isGmailLabelGroup(label)) return label.name;
  if (label.type === 'system') {
    const map: Record<string, string> = {
      INBOX: 'Inbox',
      STARRED: 'Starred',
      [GMAIL_SNOOZED_ID]: 'Snoozed',
      SENT: 'Sent',
      DRAFT: 'Drafts',
      [GMAIL_SCHEDULED_ID]: 'Scheduled',
      [GMAIL_ALL_MAIL_ID]: 'All Mail',
      TRASH: 'Trash',
      SPAM: 'Spam',
      IMPORTANT: 'Important',
      UNREAD: 'Unread',
    };
    if (map[label.id]) return map[label.id];
    if (label.id.startsWith(GMAIL_CATEGORY_LABEL_PREFIX)) return categoryDisplayName(label.id);
    return label.name;
  }
  const parts = label.name.split('/');
  return parts[parts.length - 1] ?? label.name;
}

export function mailboxLocalAtPrefix(email: string): string {
  const local = email.split('@')[0] ?? email;
  return `${local}@`;
}

export function mailboxDisplayLabel(mailbox: Pick<GmailMailboxStatus, 'email' | 'displayLabel' | 'kind'>): string {
  if (mailbox.kind === 'personal') return mailboxLocalAtPrefix(mailbox.email);
  if (mailbox.displayLabel?.trim()) return mailbox.displayLabel.trim();
  return mailboxShortLabel(mailbox.email);
}

export function mailboxShortLabel(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
