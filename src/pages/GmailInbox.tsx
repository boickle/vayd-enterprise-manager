import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Mail, Menu, PenSquare, Plus, RefreshCw, Star, X } from 'lucide-react';
import GmailAttachmentIcon from '../components/gmail/GmailAttachmentIcon';
import GmailBulkToolbar, { type GmailLabelApplyUpdate } from '../components/gmail/GmailBulkToolbar';
import GmailComposePanel from '../components/gmail/GmailComposePanel';
import GmailMessageView from '../components/gmail/GmailMessageView';
import GmailSearchBar from '../components/gmail/GmailSearchBar';
import {
  buildGmailSearchQuery,
  EMPTY_GMAIL_SEARCH_FILTER,
  searchLabelIdForScope,
  type GmailSearchFilterFields,
} from '../components/gmail/gmailSearch';
import type { ComposeContext, GmailComposeDraftSavedInfo } from '../components/gmail/gmailCompose';
import { discardAllThreadDrafts } from '../components/gmail/gmailCompose';
import '../components/gmail/GmailComposeModal.css';
import GmailLabelTree from '../components/gmail/GmailLabelTree';
import GmailScheduledSendIcon from '../components/gmail/GmailScheduledSendIcon';
import {
  disconnectGmail,
  fetchGmailLabels,
  fetchGmailMailboxes,
  fetchGmailMessages,
  fetchGmailOAuthConnectUrl,
  fetchGmailThread,
  flattenUserLabels,
  GMAIL_MESSAGES_PAGE_SIZE,
  GMAIL_INBOX_POLL_MS,
  getMessageUserLabels,
  GMAIL_CATEGORIES_GROUP_ID,
  labelChipStyle,
  mergeGmailMessagesByDate,
  patchInboxUnreadCount,
  prepareSidebarLabels,
  collectExpandableLabelIds,
  resolveGmailMessageListParams,
  isMoreNavLabel,
  GMAIL_MORE_GROUP_ID,
  gmailErrorMessage,
  labelDisplayName,
  mailboxShortLabel,
  mailboxDisplayLabel,
  markGmailMessageRead,
  modifyGmailMessage,
  openGmailAttachment,
  starGmailMessage,
  threadLabelIds,
  truncateAttachmentFilename,
  decodeGmailSnippet,
  findThreadDraftMessage,
  hasScheduledSend,
  latestNonDraftThreadMessage,
  messageHasDraft,
  messageListParticipants,
  type GmailAttachmentSummary,
  type GmailLabelNode,
  type GmailMailboxStatus,
  type GmailMessageSummary,
  type GmailThreadMessage,
} from '../api/gmail';
import './GmailInbox.css';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import GmailAppointmentRequestPanel from '../components/gmail/GmailAppointmentRequestPanel';
import {
  useAppointmentRequestThreadIndex,
} from '../hooks/useAppointmentRequestThreadIndex';
import { extractEmailsFromText } from '../utils/gmailEmailExtract';
import { isAppointmentRequestNotificationSubject, requestDataEmail } from '../utils/appointmentRequestDisplay';
import {
  apptRequestGmailNotBookedLabelPendingDismissal,
  apptRequestGmailOnHoldSyncSignature,
  applyApptRequestGmailOnHoldLabel,
  isAppointmentRequestMailbox,
  isApptRequestOnHoldLabelId,
  outcomeLabelPatch,
  resolveApptRequestGmailOutcome,
  resolveApptRequestLabelIds,
  syncManagedApptRequestGmailLabels,
  threadHasOutcomeLabel,
} from '../utils/gmailAppointmentRequestLabels';
import { appointmentRequestSubmissionGmailOnHold } from '../utils/appointmentRequestOnHold';
import { beginAppointmentRequestNotBookedFlow } from '../utils/appointmentRequestNotBookedFlow';
import { beginAppointmentRequestOnHoldReleaseFlow } from '../utils/appointmentRequestOnHoldReleaseFlow';
import { buildGmailInboxReturnPath } from '../utils/routingAppointmentRequestIntent';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import {
  patchAppointmentRequestSubmission,
  fetchAppointmentRequestSubmission,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import { useAuth } from '../auth/useAuth';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { subscribeGmailInbox } from '../utils/gmailRealtime';
import {
  clearAppointmentRequestReturnSession,
  readAppointmentRequestReturnSession,
} from '../utils/appointmentRequestReturnSession';
import {
  clearAppointmentRequestStaffConfirmReturnSession,
  readAppointmentRequestStaffConfirmReturnSession,
} from '../utils/appointmentRequestStaffConfirmSession';
import {
  clearNotBookedRemoveReturnSession,
  readNotBookedRemoveReturnSession,
} from '../utils/appointmentRequestNotBookedRemoveSession';

function formatMessageDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sameLabelIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

const INBOX_ATTACHMENT_PREVIEW_LIMIT = 3;

const MAILBOX_DOMAIN = 'vetatyourdoor.com';
const CUSTOM_MAILBOXES_STORAGE_KEY = 'gmailInbox.customMailboxes';

function loadCustomMailboxes(): string[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_MAILBOXES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function saveCustomMailboxes(emails: string[]): void {
  try {
    window.localStorage.setItem(CUSTOM_MAILBOXES_STORAGE_KEY, JSON.stringify(emails));
  } catch {
    /* ignore storage errors (private browsing, quota, etc.) */
  }
}

/** Normalize free-typed mailbox input into a full `@vetatyourdoor.com` address, or an error message. */
function normalizeMailboxInput(raw: string): { email: string } | { error: string } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { error: 'Enter an email address.' };

  const [localPart, domain, ...rest] = trimmed.split('@');
  if (rest.length > 0 || !localPart) {
    return { error: 'Enter a valid email address.' };
  }
  if (domain && domain !== MAILBOX_DOMAIN) {
    return { error: `Only @${MAILBOX_DOMAIN} addresses are supported.` };
  }
  if (!/^[a-z0-9._+-]+$/.test(localPart)) {
    return { error: 'Enter a valid email address.' };
  }
  return { email: `${localPart}@${MAILBOX_DOMAIN}` };
}

function threadMessageToSummary(msg: GmailThreadMessage): GmailMessageSummary {
  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet,
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    date: msg.date,
    isUnread: msg.isUnread,
    isStarred: msg.isStarred,
    labelIds: msg.labelIds,
    hasAttachments: msg.hasAttachments,
    attachments: msg.attachments,
    scheduledSendAt: msg.scheduledSendAt,
  };
}

function MessageListSection({
  messages,
  selectedId,
  checkedIds,
  labelById,
  onSelect,
  onToggleCheck,
  onToggleStar,
  onOpenAttachment,
}: {
  messages: GmailMessageSummary[];
  selectedId: string | null;
  checkedIds: Set<string>;
  labelById: Map<string, GmailLabelNode>;
  onSelect: (msg: GmailMessageSummary) => void;
  onToggleCheck: (msg: GmailMessageSummary) => void;
  onToggleStar: (msg: GmailMessageSummary) => void;
  onOpenAttachment: (attachment: GmailAttachmentSummary) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <ul className="gmail-msg-list">
      {messages.map((msg) => {
        const userLabels = getMessageUserLabels(msg.labelIds, labelById);
        return (
          <li
            key={msg.threadId}
            className={[
              'gmail-msg-item',
              msg.isUnread ? 'gmail-msg-item--unread' : '',
              selectedId === msg.id || selectedId === msg.threadId
                ? 'gmail-msg-item--selected'
                : '',
              checkedIds.has(msg.id) ? 'gmail-msg-item--checked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <input
              type="checkbox"
              className="gmail-msg-item__check"
              checked={checkedIds.has(msg.id)}
              aria-label={`Select message from ${msg.from.name?.trim() || msg.from.email}`}
              onChange={() => onToggleCheck(msg)}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className={`gmail-msg-item__star${msg.isStarred ? ' gmail-msg-item__star--on' : ''}`}
              aria-label={msg.isStarred ? 'Unstar message' : 'Star message'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(msg);
              }}
            >
              <Star size={18} strokeWidth={1.5} aria-hidden />
            </button>
            <div
              role="button"
              tabIndex={0}
              className="gmail-msg-item__btn"
              onClick={() => onSelect(msg)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(msg);
                }
              }}
            >
              <div className="gmail-msg-item__main">
                <span className="gmail-msg-item__from">
                  <span className="gmail-msg-item__participants">
                    {messageListParticipants(msg)}
                  </span>
                  {messageHasDraft(msg) ? (
                    <span className="gmail-msg-item__draft-label">Draft</span>
                  ) : null}
                  {(msg.threadMessageCount ?? 1) > 1 ? (
                    <span className="gmail-msg-item__thread-count">{msg.threadMessageCount}</span>
                  ) : null}
                </span>
                <div className="gmail-msg-item__content">
                  <div className="gmail-msg-item__headline">
                    {userLabels.length > 0 ? (
                      <span className="gmail-msg-item__labels">
                        {userLabels.map((label) => (
                          <span
                            key={label.id}
                            className="gmail-msg-item__label"
                            style={labelChipStyle(label)}
                            title={label.name}
                          >
                            {labelDisplayName(label)}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="gmail-msg-item__subject-line">
                      <span className="gmail-msg-item__subject">
                        {msg.subject || '(no subject)'}
                      </span>
                      {msg.snippet?.trim() ? (
                        <>
                          <span className="gmail-msg-item__subject-sep"> — </span>
                          <span className="gmail-msg-item__snippet">
                            {decodeGmailSnippet(msg.snippet)}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {msg.attachments && msg.attachments.length > 0 ? (
                    <div className="gmail-msg-item__attachments">
                      {msg.attachments
                        .slice(0, INBOX_ATTACHMENT_PREVIEW_LIMIT)
                        .map((attachment) => (
                          <button
                            key={`${attachment.messageId}:${attachment.attachmentId}`}
                            type="button"
                            className="gmail-msg-item__attachment"
                            title={attachment.filename}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenAttachment(attachment);
                            }}
                          >
                            <GmailAttachmentIcon
                              mimeType={attachment.mimeType}
                              filename={attachment.filename}
                            />
                            {truncateAttachmentFilename(attachment.filename, 20)}
                          </button>
                        ))}
                      {msg.attachments.length > INBOX_ATTACHMENT_PREVIEW_LIMIT ? (
                        <span
                          className="gmail-msg-item__attachment-more"
                          title={`${msg.attachments.length - INBOX_ATTACHMENT_PREVIEW_LIMIT} more attachments`}
                        >
                          +{msg.attachments.length - INBOX_ATTACHMENT_PREVIEW_LIMIT}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span className="gmail-msg-item__date">
                  {hasScheduledSend(msg) ? (
                    <GmailScheduledSendIcon scheduledSendAt={msg.scheduledSendAt} />
                  ) : null}
                  {formatMessageDate(msg.date)}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function GmailInbox() {
  const { allowed: canAccessGmailInbox, loading: gmailAccessLoading } = useGmailInboxAccess();
  const { token } = useAuth() as { token?: string | null };
  const navigate = useNavigate();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [searchParams, setSearchParams] = useSearchParams();
  const [mailboxes, setMailboxes] = useState<GmailMailboxStatus[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<string | null>(null);
  const [navigationLabels, setNavigationLabels] = useState<GmailLabelNode[]>([]);
  const [sidebarUserLabels, setSidebarUserLabels] = useState<GmailLabelNode[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState('INBOX');
  const [expandedLabels, setExpandedLabels] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [resultSizeEstimate, setResultSizeEstimate] = useState<number | null>(null);
  const pageTokensRef = useRef<(string | null)[]>([null]);
  const pageIndexRef = useRef(0);
  pageTokensRef.current = pageTokens;
  pageIndexRef.current = pageIndex;
  const [selectedMessage, setSelectedMessage] = useState<GmailMessageSummary | null>(null);
  const selectedMessageRef = useRef(selectedMessage);
  selectedMessageRef.current = selectedMessage;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<GmailThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeContext, setComposeContext] = useState<ComposeContext>({ mode: 'new' });
  const [smsPromptSubmissionId, setSmsPromptSubmissionId] = useState<number | null>(null);
  const [notBookedPromptSubmissionId, setNotBookedPromptSubmissionId] = useState<number | null>(null);
  const pendingNotBookedOpenRef = useRef<number | null>(null);
  const pendingBookReturnIdRef = useRef<number | null>(null);
  const apptRequestGmailLabelSyncRef = useRef<string | null>(null);
  const notBookedLabelFlowRef = useRef<Set<string>>(new Set());
  const onHoldLabelFlowRef = useRef<Set<string>>(new Set());
  const managedLabelsSyncedThreadsRef = useRef<Set<string>>(new Set());
  const [mailSearchInput, setMailSearchInput] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [searchFilterDraft, setSearchFilterDraft] = useState<GmailSearchFilterFields>(() => ({
    ...EMPTY_GMAIL_SEARCH_FILTER,
  }));
  const [appliedSearchFilter, setAppliedSearchFilter] = useState<GmailSearchFilterFields>(() => ({
    ...EMPTY_GMAIL_SEARCH_FILTER,
  }));
  const [searchFilterOpen, setSearchFilterOpen] = useState(false);
  const [checkedMessageIds, setCheckedMessageIds] = useState<Set<string>>(() => new Set());
  const [mailboxUnreadCounts, setMailboxUnreadCounts] = useState<Record<string, number>>({});
  const [customMailboxes, setCustomMailboxes] = useState<string[]>(() => loadCustomMailboxes());
  const [showAddMailbox, setShowAddMailbox] = useState(false);
  const [newMailboxValue, setNewMailboxValue] = useState('');
  const [addMailboxError, setAddMailboxError] = useState<string | null>(null);
  const [labelsDrawerOpen, setLabelsDrawerOpen] = useState(false);
  const addMailboxInputRef = useRef<HTMLInputElement | null>(null);
  const deepLinkHandledRef = useRef<string | null>(null);
  /** Thread id from ?thread= while the deep link is resolving. */
  const pendingThreadDeepLinkRef = useRef<string | null>(null);
  /** Thread id to keep open until the user explicitly leaves (e.g. return from Book flow). */
  const protectedThreadIdRef = useRef<string | null>(null);

  const deepLinkThreadId = searchParams.get('thread')?.trim() ?? null;

  const shouldProtectThreadSelection = () =>
    Boolean(pendingThreadDeepLinkRef.current || protectedThreadIdRef.current);

  const clearProtectedThreadSelection = () => {
    protectedThreadIdRef.current = null;
    pendingThreadDeepLinkRef.current = null;
  };

  useEffect(() => {
    if (deepLinkThreadId) pendingThreadDeepLinkRef.current = deepLinkThreadId;
  }, [deepLinkThreadId]);

  const mailSearch = useMemo(
    () => buildGmailSearchQuery(appliedSearchFilter, debouncedSearchText),
    [appliedSearchFilter, debouncedSearchText]
  );

  const searchLabelId = useMemo(
    () => searchLabelIdForScope(appliedSearchFilter.scope, selectedLabelId),
    [appliedSearchFilter.scope, selectedLabelId]
  );

  const messageListParams = useMemo(
    () => resolveGmailMessageListParams(selectedLabelId, mailSearch, searchLabelId),
    [selectedLabelId, mailSearch, searchLabelId]
  );

  const activeMailbox = useMemo(() => {
    if (selectedMailbox) return selectedMailbox;
    const fromUrl = searchParams.get('mailbox')?.trim().toLowerCase();
    if (fromUrl) return fromUrl;
    return customMailboxes[0] ?? null;
  }, [selectedMailbox, searchParams, customMailboxes]);

  const activeMailboxStatus = useMemo(
    () => mailboxes.find((m) => m.email === activeMailbox) ?? null,
    [mailboxes, activeMailbox]
  );

  /** Tabs are entirely staff-added addresses; pull connection status from the API when known. */
  const displayMailboxes = useMemo<GmailMailboxStatus[]>(() => {
    const byEmail = new Map(mailboxes.map((m) => [m.email, m]));
    return customMailboxes.map(
      (email): GmailMailboxStatus =>
        byEmail.get(email) ?? { email, kind: 'personal', connected: false }
    );
  }, [mailboxes, customMailboxes]);

  const connected = activeMailboxStatus?.connected === true;
  const isServiceAccountMailbox = activeMailboxStatus?.authMode === 'service_account';
  const oauthConnectedParam = searchParams.get('connected') === '1';
  const oauthErrorParam = searchParams.get('error');
  const oauthMailboxParam = searchParams.get('mailbox')?.trim().toLowerCase() ?? null;

  const userLabels = useMemo(() => flattenUserLabels(sidebarUserLabels), [sidebarUserLabels]);
  const labelById = useMemo(() => {
    const map = new Map<string, GmailLabelNode>();
    const walk = (nodes: GmailLabelNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children.length) walk(n.children);
      }
    };
    walk(navigationLabels);
    walk(sidebarUserLabels);
    return map;
  }, [navigationLabels, sidebarUserLabels]);

  const isApptRequestMailbox = isAppointmentRequestMailbox(activeMailbox);
  const apptRequestIndex = useAppointmentRequestThreadIndex(
    isApptRequestMailbox && connected && canAccessGmailInbox
  );
  const resolveApptSubmission = apptRequestIndex.resolve;
  // The request notification is sent info@ → info@, so the requester's real email
  // only appears in the body — scrape it so we can match the submission.
  const threadBodyEmails = useMemo(() => {
    if (!isApptRequestMailbox) return [] as string[];
    const parts: string[] = [];
    for (const m of threadMessages) {
      if (m.body?.text) parts.push(m.body.text);
      else if (m.body?.html) parts.push(m.body.html);
      if (m.snippet) parts.push(m.snippet);
    }
    return extractEmailsFromText(parts.join('\n'));
  }, [isApptRequestMailbox, threadMessages]);
  const linkedApptSubmission = useMemo(
    () => (isApptRequestMailbox ? resolveApptSubmission(selectedMessage, threadBodyEmails) : null),
    [isApptRequestMailbox, resolveApptSubmission, selectedMessage, threadBodyEmails]
  );

  /** Lazily link the open thread's submission — one gmail-link call, not bulk backfill. */
  useEffect(() => {
    if (!linkedApptSubmission?.id) return;
    if (linkedApptSubmission.gmailThreadId?.trim()) return;
    apptRequestIndex.ensureGmailLink(linkedApptSubmission.id);
  }, [
    linkedApptSubmission?.id,
    linkedApptSubmission?.gmailThreadId,
    apptRequestIndex.ensureGmailLink,
  ]);

  /** Resolve + persist gmailThreadId when a liaison notification is open but not indexed yet. */
  useEffect(() => {
    if (!isApptRequestMailbox || !selectedMessage || !apptRequestIndex.ready) return;
    apptRequestIndex.proactivelyLinkNotification(selectedMessage, threadBodyEmails);
  }, [
    isApptRequestMailbox,
    selectedMessage,
    threadBodyEmails,
    apptRequestIndex.ready,
    apptRequestIndex.proactivelyLinkNotification,
  ]);

  /** After Book → return from routing, refresh submission, apply labels, and prompt SMS. */
  useEffect(() => {
    if (!isApptRequestMailbox || !selectedMessage?.threadId) return;
    const pending = readAppointmentRequestReturnSession();
    if (!pending) return;

    clearAppointmentRequestReturnSession();
    pendingBookReturnIdRef.current = pending.appointmentRequestSubmissionId;

    const warn = sessionStorage.getItem('vayd:appointment-request-return-toast');
    if (warn) {
      setBanner(warn);
      sessionStorage.removeItem('vayd:appointment-request-return-toast');
    }

    apptRequestIndex.refresh();
    void fetchAppointmentRequestSubmission(pending.appointmentRequestSubmissionId)
      .then((item) => apptRequestIndex.applyLocalUpdate({ ...item, kind: 'submission' }))
      .catch(() => {
        /* refresh will catch up */
      });
  }, [
    isApptRequestMailbox,
    selectedMessage?.threadId,
    apptRequestIndex.refresh,
    apptRequestIndex.applyLocalUpdate,
  ]);

  /** After removing a linked visit for not booked → reopen reason modal on this thread. */
  useEffect(() => {
    if (!isApptRequestMailbox || !selectedMessage?.threadId) return;
    const pending = readNotBookedRemoveReturnSession();
    if (!pending) return;

    clearNotBookedRemoveReturnSession();
    pendingNotBookedOpenRef.current = pending.submissionId;
    apptRequestIndex.refresh();
    void fetchAppointmentRequestSubmission(pending.submissionId)
      .then((item) => apptRequestIndex.applyLocalUpdate({ ...item, kind: 'submission' }))
      .catch(() => {
        /* refresh will catch up */
      });
  }, [
    isApptRequestMailbox,
    selectedMessage?.threadId,
    apptRequestIndex.refresh,
    apptRequestIndex.applyLocalUpdate,
  ]);

  useEffect(() => {
    const targetId = pendingBookReturnIdRef.current;
    if (targetId == null) return;
    if (!linkedApptSubmission || linkedApptSubmission.id !== targetId) return;
    pendingBookReturnIdRef.current = null;
    setSmsPromptSubmissionId(targetId);
  }, [linkedApptSubmission]);

  useEffect(() => {
    const targetId = pendingNotBookedOpenRef.current;
    if (targetId == null) return;
    if (!linkedApptSubmission || linkedApptSubmission.id !== targetId) return;
    pendingNotBookedOpenRef.current = null;
    setNotBookedPromptSubmissionId(targetId);
  }, [linkedApptSubmission]);

  const guardApptRequestArchive = useCallback(
    (targets: GmailMessageSummary[]): string | null => {
      if (!isApptRequestMailbox) return null;
      const ids = resolveApptRequestLabelIds(userLabels);
      for (const target of targets) {
        if (!resolveApptSubmission(target)) continue;
        if (!threadHasOutcomeLabel(target.labelIds, ids)) {
          return 'Mark this appointment request as BOOKED or NOT BOOKED before archiving.';
        }
      }
      return null;
    },
    [isApptRequestMailbox, userLabels, resolveApptSubmission]
  );

  const clearOAuthParams = useCallback(() => {
    if (!oauthConnectedParam && !oauthErrorParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('connected');
    next.delete('error');
    setSearchParams(next, { replace: true });
  }, [oauthConnectedParam, oauthErrorParam, searchParams, setSearchParams]);

  useEffect(() => {
    if (oauthConnectedParam) {
      const who = oauthMailboxParam ? ` (${oauthMailboxParam})` : '';
      setBanner(`Gmail connected successfully${who}.`);
      if (oauthMailboxParam) setSelectedMailbox(oauthMailboxParam);
      clearOAuthParams();
    } else if (oauthErrorParam) {
      setBanner(`Gmail connection failed: ${oauthErrorParam}`);
      clearOAuthParams();
    }
  }, [oauthConnectedParam, oauthErrorParam, oauthMailboxParam, clearOAuthParams]);

  useEffect(() => {
    if (!connected || !activeMailbox || !deepLinkThreadId || !canAccessGmailInbox) return;
    const key = `${activeMailbox}:${deepLinkThreadId}`;
    if (deepLinkHandledRef.current === key) return;

    let cancelled = false;
    (async () => {
      try {
        const thread = await fetchGmailThread(activeMailbox, deepLinkThreadId);
        if (cancelled || thread.messages.length === 0) return;
        const latest = thread.messages[thread.messages.length - 1];
        deepLinkHandledRef.current = key;
        pendingThreadDeepLinkRef.current = null;
        protectedThreadIdRef.current = deepLinkThreadId;
        setSelectedLabelId('INBOX');
        setComposeOpen(false);
        if (activeMailbox) setSelectedMailbox(activeMailbox);
        setSelectedMessage(threadMessageToSummary(latest));
        setThreadMessages(thread.messages);
        const next = new URLSearchParams(searchParams);
        if (activeMailbox) next.set('mailbox', activeMailbox);
        next.set('thread', deepLinkThreadId);
        setSearchParams(next, { replace: true });
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connected,
    activeMailbox,
    deepLinkThreadId,
    canAccessGmailInbox,
    searchParams,
    setSearchParams,
  ]);

  const handleSelectLabel = useCallback((labelId: string) => {
    clearProtectedThreadSelection();
    setSelectedMessage(null);
    setSelectedLabelId(labelId);
    setLabelsDrawerOpen(false);
    if (isMoreNavLabel(labelId)) {
      setExpandedLabels((prev) => {
        const next = new Set(prev);
        next.add(GMAIL_MORE_GROUP_ID);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!labelsDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLabelsDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [labelsDrawerOpen]);

  const loadMailboxes = useCallback(async () => {
    const res = await fetchGmailMailboxes();
    setMailboxes(res.mailboxes);

    const sharedEmails = (res.mailboxes ?? [])
      .filter((m) => m.kind === 'shared' || m.authMode === 'service_account')
      .map((m) => m.email.toLowerCase());
    if (sharedEmails.length > 0) {
      setCustomMailboxes((prev) => {
        let changed = false;
        const next = [...prev];
        for (const email of sharedEmails) {
          if (!next.includes(email)) {
            next.push(email);
            changed = true;
          }
        }
        if (!changed) return prev;
        saveCustomMailboxes(next);
        return next;
      });
    }

    if (!selectedMailbox && !searchParams.get('mailbox')) {
      const defaultMb =
        res.defaultMailbox ??
        sharedEmails[0] ??
        customMailboxes[0] ??
        null;
      setSelectedMailbox(defaultMb);
    }
    return res;
  }, [selectedMailbox, searchParams, customMailboxes]);

  const loadLabels = useCallback(async () => {
    if (!activeMailbox) return;
    const { labels, inboxUnreadCount } = await fetchGmailLabels(activeMailbox);
    const { navigation, userLabels: userLabelTree } = prepareSidebarLabels(labels);
    setNavigationLabels(patchInboxUnreadCount(navigation, inboxUnreadCount));
    setSidebarUserLabels(userLabelTree);
    setExpandedLabels((prev) => {
      const next = new Set(prev);
      for (const id of collectExpandableLabelIds(userLabelTree)) {
        next.add(id);
      }
      if (navigation.some((n) => n.id === GMAIL_CATEGORIES_GROUP_ID)) {
        next.add(GMAIL_CATEGORIES_GROUP_ID);
      }
      return next;
    });
  }, [activeMailbox]);

  const connectedMailboxKey = displayMailboxes
    .filter((m) => m.connected)
    .map((m) => m.email)
    .join(',');

  useEffect(() => {
    const emails = connectedMailboxKey.split(',').filter(Boolean);
    if (emails.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        emails.map(async (email) => {
          try {
            const { inboxUnreadCount } = await fetchGmailLabels(email);
            return [email, inboxUnreadCount ?? 0] as const;
          } catch {
            return [email, 0] as const;
          }
        })
      );
      if (cancelled) return;
      setMailboxUnreadCounts((prev) => {
        const next = { ...prev };
        for (const [email, count] of entries) next[email] = count;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [connectedMailboxKey]);

  const loadPage = useCallback(
    async (page: number) => {
      if (!activeMailbox) return;
      const pageToken = pageTokensRef.current[page] ?? undefined;
      const res = await fetchGmailMessages(activeMailbox, {
        ...messageListParams,
        pageToken,
        maxResults: GMAIL_MESSAGES_PAGE_SIZE,
      });
      const incoming = mergeGmailMessagesByDate(res.threads ?? [], res.untaggedQueue ?? []);
      setMessages(incoming);
      if (typeof res.inboxUnreadCount === 'number') {
        setNavigationLabels((prev) => patchInboxUnreadCount(prev, res.inboxUnreadCount));
      }
      setHasNextPage(!!res.nextPageToken);
      setResultSizeEstimate(res.resultSizeEstimate ?? null);

      if (res.nextPageToken && pageTokensRef.current.length === page + 1) {
        const nextTokens = [...pageTokensRef.current, res.nextPageToken];
        pageTokensRef.current = nextTokens;
        setPageTokens(nextTokens);
      }

      setCheckedMessageIds(new Set());
      return res;
    },
    [activeMailbox, messageListParams]
  );

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await loadMailboxes();
      if (!activeMailbox || !activeMailboxStatus?.connected) {
        setNavigationLabels([]);
        setSidebarUserLabels([]);
        setMessages([]);
        setSelectedMessage(null);
        return;
      }
      await Promise.all([loadLabels(), loadPage(pageIndexRef.current)]);
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [loadMailboxes, activeMailbox, activeMailboxStatus?.connected, loadLabels, loadPage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadMailboxes();
        if (cancelled) return;
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMailboxes]);

  useEffect(() => {
    if (!activeMailbox || !activeMailboxStatus?.connected) {
      setNavigationLabels([]);
      setSidebarUserLabels([]);
      setMessages([]);
      if (!shouldProtectThreadSelection()) setSelectedMessage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      setSelectedLabelId('INBOX');
      setMailSearchInput('');
      setDebouncedSearchText('');
      setAppliedSearchFilter({ ...EMPTY_GMAIL_SEARCH_FILTER });
      setSearchFilterDraft({ ...EMPTY_GMAIL_SEARCH_FILTER });
      setSearchFilterOpen(false);
      try {
        await loadLabels();
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMailbox, activeMailboxStatus?.connected, loadLabels]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchText(mailSearchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [mailSearchInput]);

  useEffect(() => {
    if (showAddMailbox) addMailboxInputRef.current?.focus();
  }, [showAddMailbox]);

  const listFilterRef = useRef({
    activeMailbox: activeMailbox ?? null,
    messageListParams,
  });

  useEffect(() => {
    if (!connected || !activeMailbox) return;

    const prev = listFilterRef.current;
    const filtersChanged =
      prev.activeMailbox !== activeMailbox ||
      prev.messageListParams.labelId !== messageListParams.labelId ||
      prev.messageListParams.q !== messageListParams.q;

    if (filtersChanged) {
      listFilterRef.current = { activeMailbox, messageListParams };
      pageTokensRef.current = [null];
      setPageTokens([null]);
      setHasNextPage(false);
      setResultSizeEstimate(null);
      if (!shouldProtectThreadSelection()) setSelectedMessage(null);
      if (pageIndex !== 0) {
        setPageIndex(0);
        return;
      }
    }

    let cancelled = false;
    (async () => {
      setError(null);
      try {
        await loadPage(pageIndex);
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, activeMailbox, messageListParams, pageIndex, loadPage]);

  useEffect(() => {
    setSelectedMessage((prev) => {
      if (!prev) return null;
      const match = messages.find((m) => m.id === prev.id || m.threadId === prev.threadId);
      // Keep deep-linked / off-page threads open until the list catches up.
      return match ?? prev;
    });
  }, [messages]);

  useEffect(() => {
    if (!connected || !activeMailbox || !canAccessGmailInbox) return;

    const practiceId = resolvePracticeIdFromToken(token ?? localStorage.getItem('accessToken'));

    const refreshFromGmail = () => {
      void loadPage(pageIndexRef.current).catch(() => {
        /* non-blocking */
      });
      void loadLabels().catch(() => {
        /* non-blocking */
      });
    };

    const unsubscribe = subscribeGmailInbox({
      practiceId,
      mailboxEmail: activeMailbox,
      onInboxChange: refreshFromGmail,
    });

    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      refreshFromGmail();
    };

    const intervalId = window.setInterval(poll, GMAIL_INBOX_POLL_MS);
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      unsubscribe();
    };
  }, [connected, activeMailbox, canAccessGmailInbox, token, loadPage, loadLabels]);

  const handleConnect = async (mailbox: string) => {
    const status = mailboxes.find((m) => m.email === mailbox);
    if (status?.authMode === 'service_account') {
      setBanner(`${mailbox} is already available via service account — no password connect needed.`);
      return;
    }
    try {
      const url = await fetchGmailOAuthConnectUrl(mailbox, '/schedule/email');
      window.location.assign(url);
    } catch (e) {
      setError(gmailErrorMessage(e));
    }
  };

  const handleDisconnect = async (mailbox: string) => {
    const status = mailboxes.find((m) => m.email === mailbox);
    if (status?.authMode === 'service_account') {
      setError(`${mailbox} uses service-account access and cannot be disconnected.`);
      return;
    }
    try {
      await disconnectGmail(mailbox);
      await loadMailboxes();
      setNavigationLabels([]);
      setSidebarUserLabels([]);
      setMessages([]);
      setSelectedMessage(null);
    } catch (e) {
      setError(gmailErrorMessage(e));
    }
  };

  const handleAddMailbox = () => {
    const result = normalizeMailboxInput(newMailboxValue);
    if ('error' in result) {
      setAddMailboxError(result.error);
      return;
    }
    const { email } = result;
    setCustomMailboxes((prev) => {
      if (prev.includes(email)) return prev;
      const next = [...prev, email];
      saveCustomMailboxes(next);
      return next;
    });
    setNewMailboxValue('');
    setAddMailboxError(null);
    setShowAddMailbox(false);
    selectMailbox(email);
    const alreadySa = mailboxes.some(
      (m) => m.email === email && m.authMode === 'service_account' && m.connected
    );
    if (!alreadySa) {
      void handleConnect(email);
    }
  };

  const handleRemoveCustomMailbox = async (email: string) => {
    const status = mailboxes.find((m) => m.email === email);
    if (status?.connected && status.authMode !== 'service_account') {
      try {
        await handleDisconnect(email);
      } catch {
        /* handleDisconnect already surfaces the error */
      }
    }
    const remaining = customMailboxes.filter((e) => e !== email);
    setCustomMailboxes(remaining);
    saveCustomMailboxes(remaining);
    if (activeMailbox === email) {
      setSelectedMailbox(remaining[0] ?? null);
      const next = new URLSearchParams(searchParams);
      next.delete('mailbox');
      setSearchParams(next, { replace: true });
    }
  };

  const selectMailbox = (email: string) => {
    clearProtectedThreadSelection();
    setLabelsDrawerOpen(false);
    setSelectedMailbox(email);
    setMailSearchInput('');
    setDebouncedSearchText('');
    setAppliedSearchFilter({ ...EMPTY_GMAIL_SEARCH_FILTER });
    setSearchFilterDraft({ ...EMPTY_GMAIL_SEARCH_FILTER });
    setSearchFilterOpen(false);
    const next = new URLSearchParams(searchParams);
    next.set('mailbox', email);
    setSearchParams(next, { replace: true });
  };

  const applyLocalMessageUpdate = (id: string, patch: Partial<GmailMessageSummary>) => {
    let threadIdForSync: string | undefined;
    let threadWasUnread = false;
    setMessages((prev) => {
      const target = prev.find((m) => m.id === id);
      threadIdForSync = target?.threadId;
      if (target) {
        threadWasUnread = prev.some((m) => m.threadId === target.threadId && m.isUnread);
      }
      return prev.map((m) => {
        if (m.id === id) return { ...m, ...patch };
        if (threadIdForSync && m.threadId === threadIdForSync && patch.isUnread === false) {
          return { ...m, isUnread: false };
        }
        return m;
      });
    });
    if (typeof patch.isUnread === 'boolean') {
      if (patch.isUnread === false && threadWasUnread) {
        setNavigationLabels((prev) =>
          prev.map((label) => {
            if (label.id !== 'INBOX') return label;
            const base = label.threadsUnread ?? label.messagesUnread ?? 0;
            const next = Math.max(0, base - 1);
            return { ...label, threadsUnread: next, messagesUnread: next };
          })
        );
      } else if (patch.isUnread === true && !threadWasUnread) {
        setNavigationLabels((prev) =>
          prev.map((label) => {
            if (label.id !== 'INBOX') return label;
            const base = label.threadsUnread ?? label.messagesUnread ?? 0;
            return { ...label, threadsUnread: base + 1, messagesUnread: base + 1 };
          })
        );
      }
    }
    setSelectedMessage((prev) => {
      if (!prev) return null;
      if (prev.id === id || (threadIdForSync && prev.threadId === threadIdForSync)) {
        return { ...prev, ...patch };
      }
      return prev;
    });
  };

  const removeMessageFromLists = (id: string) => {
    setMessages((prev) => {
      const threadId = prev.find((m) => m.id === id)?.threadId;
      setSelectedMessage((selected) =>
        selected && (selected.id === id || (threadId && selected.threadId === threadId))
          ? null
          : selected
      );
      return prev.filter((m) => m.id !== id && (!threadId || m.threadId !== threadId));
    });
  };

  const openCompose = (context: ComposeContext) => {
    if (context.threadId?.trim()) {
      discardedDraftThreadsRef.current.delete(context.threadId.trim());
    }
    const preferredTo =
      linkedApptSubmission != null
        ? requestDataEmail(linkedApptSubmission.requestData ?? {}) ?? undefined
        : undefined;
    setComposeContext({
      ...context,
      preferredTo: context.preferredTo ?? preferredTo,
    });
    setComposeOpen(true);
  };

  const latestThreadMessage = useMemo(() => {
    if (threadMessages.length === 0) return null;
    return threadMessages[threadMessages.length - 1];
  }, [threadMessages]);

  useEffect(() => {
    if (!selectedMessage || !activeMailbox || !connected) {
      setThreadMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setThreadLoading(true);
      try {
        const thread = await fetchGmailThread(activeMailbox, selectedMessage.threadId);
        if (!cancelled) setThreadMessages(thread.messages);
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMessage?.id, selectedMessage?.threadId, activeMailbox, connected]);

  /** Replace stale list/search label chips with live labels from the opened thread. */
  useEffect(() => {
    if (!selectedMessage?.threadId || threadMessages.length === 0) return;
    const merged = threadLabelIds(threadMessages);
    const threadId = selectedMessage.threadId;
    setSelectedMessage((prev) => {
      if (!prev || prev.threadId !== threadId) return prev;
      if (sameLabelIds(prev.labelIds, merged)) return prev;
      return { ...prev, labelIds: merged };
    });
    setMessages((prev) =>
      prev.map((m) => {
        if (m.threadId !== threadId) return m;
        if (sameLabelIds(m.labelIds, merged)) return m;
        return { ...m, labelIds: merged };
      }),
    );
  }, [threadMessages, selectedMessage?.threadId]);

  useEffect(() => {
    if (threadLoading || !selectedMessage?.threadId || threadMessages.length === 0) return;
    const threadId = selectedMessage.threadId;
    const draft = findThreadDraftMessage(threadMessages);
    if (!draft) {
      discardedDraftThreadsRef.current.delete(threadId);
      return;
    }
    if (discardedDraftThreadsRef.current.has(threadId)) return;
    if (draftAutoOpenedThreadRef.current === threadId) return;
    const replyTo = latestNonDraftThreadMessage(threadMessages);
    draftAutoOpenedThreadRef.current = threadId;
    if (!replyTo) {
      openCompose({
        mode: 'new',
        threadId,
        threadInInbox: selectedMessage.labelIds.includes('INBOX'),
      });
      return;
    }
    openCompose({
      mode: 'reply',
      threadId,
      replyTo,
      threadInInbox: selectedMessage.labelIds.includes('INBOX'),
    });
  }, [threadLoading, selectedMessage?.threadId, selectedMessage?.labelIds, threadMessages]);

  const handleSelectMessage = async (msg: GmailMessageSummary) => {
    clearProtectedThreadSelection();
    draftAutoOpenedThreadRef.current = null;
    setComposeOpen(false);
    setSelectedMessage(msg);
    protectedThreadIdRef.current = msg.threadId;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => {
        document.querySelector('.gmail-message-view__scroll')?.scrollTo(0, 0);
      });
    }
    if (activeMailbox) {
      deepLinkHandledRef.current = `${activeMailbox}:${msg.threadId}`;
      const next = new URLSearchParams(searchParams);
      next.set('mailbox', activeMailbox);
      next.set('thread', msg.threadId);
      setSearchParams(next, { replace: true });
    }
    if (!activeMailbox || !msg.isUnread) return;
    try {
      const result = await markGmailMessageRead(activeMailbox, msg.id, msg.threadId);
      applyLocalMessageUpdate(msg.id, {
        isUnread: false,
        labelIds: result.labelIds,
      });
      void loadLabels();
    } catch {
      /* non-blocking */
    }
  };

  const handleToggleStar = async (msg: GmailMessageSummary) => {
    if (!activeMailbox) return;
    try {
      const result = await starGmailMessage(activeMailbox, msg.id, !msg.isStarred, msg.threadId);
      applyLocalMessageUpdate(msg.id, {
        labelIds: result.labelIds,
        isStarred: result.labelIds.includes('STARRED'),
      });
    } catch (e) {
      setError(gmailErrorMessage(e));
    }
  };

  const handleOpenAttachment = useCallback(
    async (attachment: GmailAttachmentSummary) => {
      if (!activeMailbox) return;
      try {
        await openGmailAttachment(activeMailbox, attachment);
      } catch (e) {
        setError(gmailErrorMessage(e));
      }
    },
    [activeMailbox]
  );

  const visibleMessages = messages;

  const allVisibleChecked =
    visibleMessages.length > 0 && visibleMessages.every((m) => checkedMessageIds.has(m.id));

  const checkedVisibleCount = visibleMessages.filter((m) => checkedMessageIds.has(m.id)).length;
  const someVisibleChecked =
    checkedVisibleCount > 0 && checkedVisibleCount < visibleMessages.length;

  const activeInboxUnread = useMemo(() => {
    const inbox = navigationLabels.find((l) => l.id === 'INBOX');
    if (!inbox) return undefined;
    return inbox.threadsUnread ?? inbox.messagesUnread ?? 0;
  }, [navigationLabels]);

  const mailboxTabUnread = (email: string): number => {
    if (email === activeMailbox && activeInboxUnread != null) return activeInboxUnread;
    return mailboxUnreadCounts[email] ?? 0;
  };

  const handleToggleCheck = (msg: GmailMessageSummary) => {
    setCheckedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);
      return next;
    });
  };

  const handleToggleCheckAll = () => {
    if (allVisibleChecked) {
      setCheckedMessageIds(new Set());
      return;
    }
    setCheckedMessageIds(new Set(visibleMessages.map((m) => m.id)));
  };

  const hasCheckedMessages = checkedMessageIds.size > 0;

  const handleNotBookedLabelForThread = useCallback(
    async (message: GmailMessageSummary, submission: AppointmentRequestSubmissionItem) => {
      if (!activeMailbox) return;
      if (notBookedLabelFlowRef.current.has(message.threadId)) return;
      notBookedLabelFlowRef.current.add(message.threadId);
      try {
        const result = await beginAppointmentRequestNotBookedFlow({
          submission,
          returnPath: buildGmailInboxReturnPath(activeMailbox, message.threadId),
          practiceTz,
          navigate,
          mailbox: activeMailbox,
          threadId: message.threadId,
        });
        if (result.kind === 'scheduler_remove') {
          setBanner('Remove this visit from the calendar, then mark the request as not booked.');
          return;
        }
        if (result.kind === 'needs_reason') {
          if (selectedMessageRef.current?.threadId === message.threadId) {
            setNotBookedPromptSubmissionId(submission.id);
          } else {
            pendingNotBookedOpenRef.current = submission.id;
          }
        }
      } catch {
        setError('Could not start the not booked flow for this appointment request.');
      } finally {
        notBookedLabelFlowRef.current.delete(message.threadId);
      }
    },
    [activeMailbox, practiceTz, navigate],
  );

  const handleOnHoldLabelRemovedForThread = useCallback(
    async (message: GmailMessageSummary, submission: AppointmentRequestSubmissionItem) => {
      if (!activeMailbox) return;
      if (onHoldLabelFlowRef.current.has(message.threadId)) return;
      onHoldLabelFlowRef.current.add(message.threadId);
      try {
        const result = await beginAppointmentRequestOnHoldReleaseFlow({
          submission,
          returnPath: buildGmailInboxReturnPath(activeMailbox, message.threadId),
          practiceTz,
          navigate,
          mailbox: activeMailbox,
          threadId: message.threadId,
        });
        if (result.kind === 'scheduler_edit') {
          setBanner(
            'Remove or convert this hold on the calendar before removing the On hold label.',
          );
          const reapply = await applyApptRequestGmailOnHoldLabel({
            mailbox: activeMailbox,
            message: { id: message.id, threadId: message.threadId, labelIds: message.labelIds },
            isOnHold: true,
            userLabels,
          });
          if (reapply.labelIds) {
            const threadId = message.threadId;
            setMessages((prev) =>
              prev.map((m) =>
                m.threadId === threadId ? { ...m, labelIds: reapply.labelIds! } : m,
              ),
            );
            setSelectedMessage((prev) =>
              prev?.threadId === threadId ? { ...prev, labelIds: reapply.labelIds! } : prev,
            );
            void loadLabels();
          }
        }
      } catch {
        setError('Could not verify the linked calendar hold. Try again.');
      } finally {
        onHoldLabelFlowRef.current.delete(message.threadId);
      }
    },
    [activeMailbox, practiceTz, navigate, userLabels, loadLabels],
  );

  const applyLabelUpdates = useCallback(
    (updates: GmailLabelApplyUpdate[]) => {
      if (updates.length === 0) return;

      const apptLabelIds = resolveApptRequestLabelIds(userLabels);
      const notBookedLabelId = apptLabelIds.notBooked;
      if (isApptRequestMailbox && notBookedLabelId && activeMailbox) {
        for (const update of updates) {
          const prevMsg =
            messages.find((m) => m.id === update.messageId) ??
            (selectedMessage?.threadId === update.threadId ? selectedMessage : null) ??
            messages.find((m) => m.threadId === update.threadId);
          if (!prevMsg) continue;
          const hadNotBooked = prevMsg.labelIds.includes(notBookedLabelId);
          const hasNotBooked = update.labelIds.includes(notBookedLabelId);
          if (hadNotBooked || !hasNotBooked) continue;

          const threadEmails =
            update.threadId === selectedMessage?.threadId ? threadBodyEmails : undefined;
          const submission = resolveApptSubmission(prevMsg, threadEmails);
          if (!submission || (submission.status ?? 'new') === 'dismissed') continue;

          void handleNotBookedLabelForThread(prevMsg, submission);
        }
      }

      const onHoldLabelId = apptLabelIds.onHold;
      if (isApptRequestMailbox && onHoldLabelId && activeMailbox) {
        for (const update of updates) {
          const prevMsg =
            messages.find((m) => m.id === update.messageId) ??
            (selectedMessage?.threadId === update.threadId ? selectedMessage : null) ??
            messages.find((m) => m.threadId === update.threadId);
          if (!prevMsg) continue;
          const hadOnHold = prevMsg.labelIds.includes(onHoldLabelId);
          const hasOnHold = update.labelIds.includes(onHoldLabelId);
          if (!hadOnHold || hasOnHold) continue;

          const threadEmails =
            update.threadId === selectedMessage?.threadId ? threadBodyEmails : undefined;
          const submission = resolveApptSubmission(prevMsg, threadEmails);
          if (!submission) continue;

          void handleOnHoldLabelRemovedForThread(
            { ...prevMsg, labelIds: update.labelIds },
            submission,
          );
        }
      }

      const updateByMessageId = new Map(updates.map((u) => [u.messageId, u]));
      const updateByThreadId = new Map(updates.map((u) => [u.threadId, u]));
      setMessages((prev) =>
        prev.map((m) => {
          const update = updateByMessageId.get(m.id) ?? updateByThreadId.get(m.threadId);
          return update ? { ...m, labelIds: update.labelIds } : m;
        })
      );
      setSelectedMessage((prev) => {
        if (!prev) return null;
        const update = updateByMessageId.get(prev.id) ?? updateByThreadId.get(prev.threadId);
        return update ? { ...prev, labelIds: update.labelIds } : prev;
      });
      void loadLabels();
    },
    [
      userLabels,
      isApptRequestMailbox,
      activeMailbox,
      messages,
      selectedMessage,
      threadBodyEmails,
      resolveApptSubmission,
      handleNotBookedLabelForThread,
      handleOnHoldLabelRemovedForThread,
      loadLabels,
    ]
  );

  /** Reaching out (reply/text) on a linked request moves it to Contacted + labels the thread. */
  const markApptRequestContacted = useCallback(
    async (
      submission: AppointmentRequestSubmissionItem,
      message: GmailMessageSummary,
      mailbox: string
    ) => {
      try {
        if ((submission.status ?? 'new') === 'new') {
          const updated = await patchAppointmentRequestSubmission(submission.id, {
            status: 'contacted',
          });
          apptRequestIndex.applyLocalUpdate({ ...updated, kind: 'submission' });
        }
        const ids = resolveApptRequestLabelIds(userLabels);
        const patch = outcomeLabelPatch('contacted', message.labelIds, ids);
        if (patch) {
          const result = await modifyGmailMessage(mailbox, message.id, patch, message.threadId);
          applyLabelUpdates([
            { messageId: message.id, threadId: message.threadId, labelIds: result.labelIds },
          ]);
        }
      } catch {
        /* non-blocking: reach-out already succeeded */
      }
    },
    [userLabels, apptRequestIndex, applyLabelUpdates]
  );

  /** Reset label-sync dedup when switching threads. */
  useEffect(() => {
    apptRequestGmailLabelSyncRef.current = null;
  }, [selectedMessage?.threadId]);

  /**
   * Keep Gmail managed labels (outcome + ON HOLD) aligned with Scout whenever the
   * linked submission changes — including unconfirmed auto-books (no outcome yet).
   */
  useEffect(() => {
    if (!isApptRequestMailbox || !activeMailbox || !selectedMessage || !linkedApptSubmission) {
      return;
    }

    const ids = resolveApptRequestLabelIds(userLabels);
    if (
      apptRequestGmailNotBookedLabelPendingDismissal(
        selectedMessage.labelIds,
        linkedApptSubmission,
        ids,
      )
    ) {
      return;
    }

    const isOnHold = appointmentRequestSubmissionGmailOnHold(
      linkedApptSubmission,
      new Map(),
      null,
    );
    const outcome = resolveApptRequestGmailOutcome(linkedApptSubmission);
    const sig = [
      selectedMessage.threadId,
      outcome ?? 'none',
      apptRequestGmailOnHoldSyncSignature(linkedApptSubmission, isOnHold),
    ].join(':');
    if (apptRequestGmailLabelSyncRef.current === sig) return;

    void syncManagedApptRequestGmailLabels({
      mailbox: activeMailbox,
      message: selectedMessage,
      submission: linkedApptSubmission,
      userLabels,
    }).then((labelIds) => {
      if (!labelIds) return;
      apptRequestGmailLabelSyncRef.current = sig;
      applyLabelUpdates([
        {
          messageId: selectedMessage.id,
          threadId: selectedMessage.threadId,
          labelIds,
        },
      ]);
      const pendingConfirm = readAppointmentRequestStaffConfirmReturnSession();
      if (
        pendingConfirm?.submissionId === linkedApptSubmission.id &&
        outcome === 'booked'
      ) {
        clearAppointmentRequestStaffConfirmReturnSession();
      }
    });
  }, [
    isApptRequestMailbox,
    activeMailbox,
    selectedMessage,
    linkedApptSubmission,
    userLabels,
    applyLabelUpdates,
  ]);

  /** ON HOLD + outcome labels on inbox rows — e.g. unconfirmed auto-books before a thread is opened. */
  useEffect(() => {
    if (!isApptRequestMailbox || !activeMailbox || !apptRequestIndex.ready || userLabels.length === 0) {
      return;
    }
    if (messages.length === 0) return;

    const labelIds = resolveApptRequestLabelIds(userLabels);
    const onHoldId = labelIds.onHold;
    let cancelled = false;

    for (const msg of messages) {
      const threadId = msg.threadId?.trim();
      if (!threadId || managedLabelsSyncedThreadsRef.current.has(threadId)) continue;

      const submission = resolveApptSubmission(msg);
      if (!submission) continue;
      if (!appointmentRequestSubmissionGmailOnHold(submission, new Map(), null)) continue;
      if (onHoldId && msg.labelIds.includes(onHoldId)) {
        managedLabelsSyncedThreadsRef.current.add(threadId);
        continue;
      }

      managedLabelsSyncedThreadsRef.current.add(threadId);

      void (async () => {
        try {
          const thread = await fetchGmailThread(activeMailbox, threadId);
          if (cancelled) return;
          const latest = latestNonDraftThreadMessage(thread.messages ?? []);
          if (!latest?.id) return;

          const nextLabelIds = await syncManagedApptRequestGmailLabels({
            mailbox: activeMailbox,
            message: { id: latest.id, threadId, labelIds: latest.labelIds },
            submission,
            userLabels,
          });
          if (cancelled || !nextLabelIds) return;

          setMessages((prev) =>
            prev.map((row) =>
              row.threadId === threadId ? { ...row, labelIds: nextLabelIds } : row,
            ),
          );
          if (selectedMessage?.threadId === threadId) {
            setThreadMessages((prev) =>
              prev.map((row) => ({ ...row, labelIds: nextLabelIds })),
            );
          }
        } catch {
          managedLabelsSyncedThreadsRef.current.delete(threadId);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [
    isApptRequestMailbox,
    activeMailbox,
    apptRequestIndex.ready,
    userLabels,
    messages,
    resolveApptSubmission,
    selectedMessage?.threadId,
  ]);

  /** After Confirm on calendar → refresh submission; label sync runs above. */
  useEffect(() => {
    if (!isApptRequestMailbox || !selectedMessage?.threadId) return;
    const pending = readAppointmentRequestStaffConfirmReturnSession();
    if (!pending) return;

    apptRequestIndex.refresh();
    void fetchAppointmentRequestSubmission(pending.submissionId)
      .then((item) => apptRequestIndex.applyLocalUpdate({ ...item, kind: 'submission' }))
      .catch(() => {
        /* refresh will catch up */
      });
  }, [
    isApptRequestMailbox,
    selectedMessage?.threadId,
    apptRequestIndex.refresh,
    apptRequestIndex.applyLocalUpdate,
  ]);

  const draftAutoOpenedThreadRef = useRef<string | null>(null);
  /** Threads where the user explicitly discarded a draft — skip auto-reopen until server confirms gone. */
  const discardedDraftThreadsRef = useRef<Set<string>>(new Set());

  const handleComposeDraftSaved = useCallback(
    (info: GmailComposeDraftSavedInfo) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.threadId === info.threadId
            ? {
                ...m,
                hasDraft: true,
                draftId: info.draftId,
                snippet: info.snippet || m.snippet,
                ...(info.labelIds ? { labelIds: info.labelIds } : {}),
              }
            : m,
        ),
      );
      setSelectedMessage((prev) =>
        prev && prev.threadId === info.threadId
          ? {
              ...prev,
              hasDraft: true,
              draftId: info.draftId,
              snippet: info.snippet || prev.snippet,
              ...(info.labelIds ? { labelIds: info.labelIds } : {}),
            }
          : prev,
      );
    },
    [],
  );

  const handleComposeDraftDeleted = useCallback(
    (info: { threadId: string }) => {
      if (!info.threadId) return;
      discardedDraftThreadsRef.current.add(info.threadId);
      setMessages((prev) =>
        prev.map((m) =>
          m.threadId === info.threadId ? { ...m, hasDraft: false, draftId: undefined } : m,
        ),
      );
      setSelectedMessage((prev) =>
        prev && prev.threadId === info.threadId
          ? { ...prev, hasDraft: false, draftId: undefined }
          : prev,
      );
      if (activeMailbox) {
        void discardAllThreadDrafts(activeMailbox, info.threadId)
          .catch(() => {
            /* list state already cleared */
          })
          .finally(() => {
            void fetchGmailThread(activeMailbox, info.threadId)
              .then((thread) => {
                if (!findThreadDraftMessage(thread.messages)) {
                  discardedDraftThreadsRef.current.delete(info.threadId);
                }
                if (selectedMessageRef.current?.threadId === info.threadId) {
                  setThreadMessages(thread.messages);
                }
              })
              .catch(() => {
                /* list state already cleared */
              });
          });
      }
    },
    [activeMailbox],
  );

  const handleComposeSent = useCallback(async () => {
    if (selectedMessage?.threadId && activeMailbox) {
      try {
        await discardAllThreadDrafts(
          activeMailbox,
          selectedMessage.threadId,
          threadMessages,
        );
      } catch {
        /* compose panel may have already cleaned up */
      }
      handleComposeDraftDeleted({ threadId: selectedMessage.threadId });
    }
    setBanner('Message sent.');
    const ctx = composeContext;
    if (
      isApptRequestMailbox &&
      activeMailbox &&
      selectedMessage &&
      linkedApptSubmission &&
      (ctx.mode === 'reply' || ctx.mode === 'replyAll')
    ) {
      void markApptRequestContacted(linkedApptSubmission, selectedMessage, activeMailbox);
    }
    await refreshAll();
  }, [
    composeContext,
    isApptRequestMailbox,
    activeMailbox,
    selectedMessage,
    linkedApptSubmission,
    markApptRequestContacted,
    refreshAll,
    handleComposeDraftDeleted,
    threadMessages,
  ]);

  const handleRemoveMessageLabel = useCallback(
    async (labelId: string) => {
      if (!selectedMessage || !activeMailbox) return;

      if (
        isApptRequestMailbox &&
        isApptRequestOnHoldLabelId(labelId, userLabels) &&
        linkedApptSubmission
      ) {
        const result = await beginAppointmentRequestOnHoldReleaseFlow({
          submission: linkedApptSubmission,
          returnPath: buildGmailInboxReturnPath(activeMailbox, selectedMessage.threadId),
          practiceTz,
          navigate,
          mailbox: activeMailbox,
          threadId: selectedMessage.threadId,
        });
        if (result.kind === 'scheduler_edit') {
          setBanner(
            'Remove or convert this hold on the calendar before removing the On hold label.',
          );
          return;
        }
      }

      setActionBusy(true);
      try {
        await modifyGmailMessage(
          activeMailbox,
          selectedMessage.id,
          { removeLabelIds: [labelId] },
          selectedMessage.threadId,
        );
        const thread = await fetchGmailThread(activeMailbox, selectedMessage.threadId);
        setThreadMessages(thread.messages);
        const labelIds = threadLabelIds(thread.messages);
        const threadId = selectedMessage.threadId;
        setMessages((prev) =>
          prev.map((m) => (m.threadId === threadId ? { ...m, labelIds } : m)),
        );
        setSelectedMessage((prev) => (prev ? { ...prev, labelIds } : null));
        void loadLabels();
      } catch (e) {
        setError(gmailErrorMessage(e));
        throw e;
      } finally {
        setActionBusy(false);
      }
    },
    [selectedMessage, activeMailbox, loadLabels, isApptRequestMailbox, userLabels, linkedApptSubmission, practiceTz, navigate],
  );

  const handleBulkComplete = () => {
    clearProtectedThreadSelection();
    setCheckedMessageIds(new Set());
    setSelectedMessage(null);
    void Promise.all([loadPage(pageIndexRef.current), loadLabels()]);
  };

  const paginationRangeStart = messages.length === 0 ? 0 : pageIndex * GMAIL_MESSAGES_PAGE_SIZE + 1;
  const paginationRangeEnd = pageIndex * GMAIL_MESSAGES_PAGE_SIZE + messages.length;
  const paginationTotal =
    resultSizeEstimate ?? (hasNextPage ? null : messages.length === 0 ? 0 : paginationRangeEnd);

  const selectedMessageIndex = selectedMessage
    ? visibleMessages.findIndex(
        (m) => m.id === selectedMessage.id || m.threadId === selectedMessage.threadId
      )
    : -1;

  const messagePositionLabel =
    selectedMessageIndex >= 0
      ? paginationTotal != null
        ? `${paginationRangeStart + selectedMessageIndex} of ${paginationTotal}`
        : `${paginationRangeStart + selectedMessageIndex} of ${paginationRangeEnd}`
      : '';

  if (gmailAccessLoading) {
    return (
      <div className="gmail-inbox">
        <div className="gmail-inbox__state">Loading…</div>
      </div>
    );
  }

  if (!canAccessGmailInbox) {
    return <Navigate to="/schedule/home" replace />;
  }

  return (
    <div
      className={[
        'gmail-inbox',
        selectedMessage ? 'gmail-inbox--reading' : '',
        labelsDrawerOpen ? 'gmail-inbox--labels-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {banner ? (
        <div
          className={`gmail-inbox__banner${
            banner.includes('failed')
              ? ' gmail-inbox__banner--error'
              : ' gmail-inbox__banner--success'
          }`}
        >
          <span>{banner}</span>
          <button type="button" className="gmail-btn" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {!connected && !loading && activeMailbox ? (
        <div className="gmail-inbox__banner">
          <span>
            Connect <strong>{activeMailbox}</strong> to view this inbox. When Google asks you to
            sign in, choose <strong>{activeMailbox}</strong> (personal VAYD accounts only —
            shared inboxes like info@ / field@ no longer need a shared password when the service
            account is configured).
          </span>
          <div className="gmail-inbox__banner-actions">
            <button
              type="button"
              className="gmail-btn gmail-btn--primary"
              onClick={() => handleConnect(activeMailbox)}
            >
              Connect {mailboxShortLabel(activeMailbox)}
            </button>
          </div>
        </div>
      ) : null}

      {connected && activeMailboxStatus?.mailboxMismatch && !isServiceAccountMailbox ? (
        <div className="gmail-inbox__banner gmail-inbox__banner--error">
          <span>
            Connected as <strong>{activeMailboxStatus.grantedEmail}</strong>, but this tab expects{' '}
            <strong>{activeMailbox}</strong>. Disconnect and connect again while signed into{' '}
            <strong>{activeMailbox}</strong> in Google.
          </span>
          <div className="gmail-inbox__banner-actions">
            <button
              type="button"
              className="gmail-btn"
              onClick={() => handleDisconnect(activeMailbox!)}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : null}

      <header className="gmail-inbox__header">
        <div className="gmail-inbox__mailbox-tabs" role="tablist" aria-label="Gmail accounts">
          {displayMailboxes.map((mb) => (
            <span
              key={mb.email}
              className="gmail-inbox__mailbox-tab-wrap gmail-inbox__mailbox-tab-wrap--custom"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mb.email === activeMailbox}
                className={`gmail-inbox__mailbox-tab${
                  mb.email === activeMailbox ? ' gmail-inbox__mailbox-tab--active' : ''
                }${!mb.connected ? ' gmail-inbox__mailbox-tab--disconnected' : ''}`}
                onClick={() => selectMailbox(mb.email)}
              >
                {mailboxDisplayLabel(mb)}
                {mb.connected && mailboxTabUnread(mb.email) > 0 ? (
                  <sup className="gmail-inbox__mailbox-tab-badge">{mailboxTabUnread(mb.email)}</sup>
                ) : null}
                {!mb.connected ? ' · not connected' : ''}
              </button>
              <button
                type="button"
                className="gmail-inbox__mailbox-tab-remove"
                aria-label={`Remove ${mb.email}`}
                title={`Remove ${mb.email}`}
                onClick={() => void handleRemoveCustomMailbox(mb.email)}
              >
                <X size={12} strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          ))}

          {showAddMailbox ? (
            <span className="gmail-inbox__add-mailbox-form">
              <input
                ref={addMailboxInputRef}
                type="text"
                className="gmail-inbox__add-mailbox-input"
                placeholder={`name@${MAILBOX_DOMAIN}`}
                value={newMailboxValue}
                onChange={(e) => {
                  setNewMailboxValue(e.target.value);
                  if (addMailboxError) setAddMailboxError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMailbox();
                  } else if (e.key === 'Escape') {
                    setShowAddMailbox(false);
                    setNewMailboxValue('');
                    setAddMailboxError(null);
                  }
                }}
              />
              <button
                type="button"
                className="gmail-btn gmail-btn--primary"
                onClick={handleAddMailbox}
              >
                Add
              </button>
              <button
                type="button"
                className="gmail-btn"
                onClick={() => {
                  setShowAddMailbox(false);
                  setNewMailboxValue('');
                  setAddMailboxError(null);
                }}
              >
                Cancel
              </button>
              {addMailboxError ? (
                <span className="gmail-inbox__add-mailbox-error" role="alert">
                  {addMailboxError}
                </span>
              ) : null}
            </span>
          ) : (
            <button
              type="button"
              className="gmail-inbox__mailbox-tab gmail-inbox__mailbox-tab--add"
              onClick={() => setShowAddMailbox(true)}
            >
              <Plus
                size={14}
                strokeWidth={2.5}
                aria-hidden
                style={{ verticalAlign: -2, marginRight: 2 }}
              />
              Add email
            </button>
          )}
        </div>
        <div className="gmail-inbox__toolbar">
          <button
            type="button"
            className="gmail-btn"
            onClick={() => refreshAll()}
            disabled={!activeMailbox || refreshing}
          >
            <RefreshCw size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
            Refresh
          </button>
          {connected && activeMailbox && !isServiceAccountMailbox ? (
            <button
              type="button"
              className="gmail-btn"
              onClick={() => handleDisconnect(activeMailbox)}
            >
              Disconnect
            </button>
          ) : !connected && activeMailbox ? (
            <button
              type="button"
              className="gmail-btn gmail-btn--primary"
              onClick={() => handleConnect(activeMailbox)}
            >
              Connect
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="gmail-inbox__banner gmail-inbox__banner--error">
          <span>{error}</span>
          <button type="button" className="gmail-btn" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="gmail-inbox__state">Loading inboxes…</div>
      ) : displayMailboxes.length === 0 ? (
        <div className="gmail-inbox__state">
          <Mail size={32} strokeWidth={1.5} color="#94a3b8" aria-hidden />
          <p>No Gmail mailboxes yet. Use &ldquo;Add email&rdquo; above to connect one.</p>
        </div>
      ) : !connected ? (
        <div className="gmail-inbox__state">
          <Mail size={32} strokeWidth={1.5} color="#94a3b8" aria-hidden />
          <p>
            Connect <strong>{activeMailbox}</strong> to view this inbox in Scout.
          </p>
          {activeMailbox ? (
            <button
              type="button"
              className="gmail-btn gmail-btn--primary"
              style={{ marginTop: 12 }}
              onClick={() => handleConnect(activeMailbox)}
            >
              Connect {mailboxShortLabel(activeMailbox)}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="gmail-inbox__body">
          {labelsDrawerOpen ? (
            <button
              type="button"
              className="gmail-inbox__labels-backdrop"
              aria-label="Close folders"
              onClick={() => setLabelsDrawerOpen(false)}
            />
          ) : null}
          <section
            className="gmail-inbox__panel gmail-inbox__panel--labels"
            aria-label="Mail folders"
          >
            <div className="gmail-inbox__panel-scroll">
              {connected && activeMailbox ? (
                <button
                  type="button"
                  className="gmail-sidebar__compose"
                  onClick={() => {
                    setLabelsDrawerOpen(false);
                    openCompose({ mode: 'new' });
                  }}
                >
                  <PenSquare size={18} strokeWidth={1.75} aria-hidden />
                  Compose
                </button>
              ) : null}
              <GmailLabelTree
                labels={navigationLabels}
                selectedId={selectedLabelId}
                onSelect={handleSelectLabel}
                expanded={expandedLabels}
                onToggleExpand={(id) =>
                  setExpandedLabels((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
              <div className="gmail-sidebar__section-head">
                <span>Labels</span>
              </div>
              {sidebarUserLabels.length > 0 ? (
                <GmailLabelTree
                  labels={sidebarUserLabels}
                  selectedId={selectedLabelId}
                  onSelect={handleSelectLabel}
                  expanded={expandedLabels}
                  onToggleExpand={(id) =>
                    setExpandedLabels((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="gmail-inbox__labels-footer">
              <button
                type="button"
                className="gmail-btn"
                onClick={() => refreshAll()}
                disabled={!activeMailbox || refreshing}
              >
                <RefreshCw size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
                Refresh
              </button>
              {connected && activeMailbox ? (
                <button
                  type="button"
                  className="gmail-btn"
                  onClick={() => handleDisconnect(activeMailbox)}
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </section>

          <div className="gmail-inbox__main-panel">
            <section
              className={`gmail-inbox__panel gmail-inbox__panel--list${
                selectedMessage ? ' gmail-inbox__panel--concealed' : ''
              }`}
              aria-label="Messages"
              aria-hidden={selectedMessage ? true : undefined}
            >
              <div className="gmail-inbox__list-toolbar">
                <button
                  type="button"
                  className="gmail-inbox__list-toolbar-btn gmail-inbox__menu-btn"
                  aria-label="Open folders"
                  onClick={() => setLabelsDrawerOpen(true)}
                >
                  <Menu size={18} strokeWidth={1.75} aria-hidden />
                </button>
                <input
                  type="checkbox"
                  className="gmail-msg-item__check"
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleChecked;
                  }}
                  checked={allVisibleChecked}
                  aria-label="Select all messages"
                  onChange={handleToggleCheckAll}
                  disabled={visibleMessages.length === 0}
                />
                {hasCheckedMessages ? (
                  <GmailBulkToolbar
                    mailbox={activeMailbox!}
                    targetMessages={visibleMessages.filter((m) => checkedMessageIds.has(m.id))}
                    currentLabelId={selectedLabelId}
                    userLabels={userLabels}
                    userLabelTree={sidebarUserLabels}
                    labelById={labelById}
                    disabled={actionBusy || refreshing}
                    onComplete={handleBulkComplete}
                    onLabelsApplied={applyLabelUpdates}
                    onError={(msg) => setError(msg)}
                    guardArchive={isApptRequestMailbox ? guardApptRequestArchive : undefined}
                  />
                ) : (
                  <button
                    type="button"
                    className="gmail-inbox__list-toolbar-btn"
                    aria-label="Refresh messages"
                    disabled={refreshing}
                    onClick={() => refreshAll()}
                  >
                    <RefreshCw size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                )}
                <GmailSearchBar
                  value={mailSearchInput}
                  onChange={setMailSearchInput}
                  filterOpen={searchFilterOpen}
                  onFilterOpenChange={setSearchFilterOpen}
                  filterDraft={searchFilterDraft}
                  onFilterDraftChange={setSearchFilterDraft}
                  appliedFilter={appliedSearchFilter}
                  onApplyFilter={() => {
                    setAppliedSearchFilter({ ...searchFilterDraft });
                    setDebouncedSearchText(mailSearchInput.trim());
                  }}
                  onSubmit={() => setDebouncedSearchText(mailSearchInput.trim())}
                />
                {(messages.length > 0 || pageIndex > 0) && (
                  <div className="gmail-inbox__pagination">
                    <span className="gmail-inbox__pagination-range">
                      {paginationRangeStart === 0
                        ? '0'
                        : paginationTotal != null
                          ? `${paginationRangeStart}–${paginationRangeEnd} of ${paginationTotal}`
                          : `${paginationRangeStart}–${paginationRangeEnd}`}
                    </span>
                    <button
                      type="button"
                      className="gmail-inbox__list-toolbar-btn"
                      aria-label="Previous page"
                      disabled={pageIndex === 0 || refreshing}
                      onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                    >
                      <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="gmail-inbox__list-toolbar-btn"
                      aria-label="Next page"
                      disabled={!hasNextPage || refreshing}
                      onClick={() => setPageIndex((i) => i + 1)}
                    >
                      <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              <div className="gmail-inbox__panel-scroll">
                <MessageListSection
                  messages={messages}
                  selectedId={null}
                  checkedIds={checkedMessageIds}
                  labelById={labelById}
                  onSelect={handleSelectMessage}
                  onToggleCheck={handleToggleCheck}
                  onToggleStar={handleToggleStar}
                  onOpenAttachment={handleOpenAttachment}
                />
                {messages.length === 0 ? (
                  <div className="gmail-inbox__state">
                    {mailSearch ? 'No messages match your search.' : 'No messages in this label.'}
                  </div>
                ) : null}
              </div>
            </section>

            {selectedMessage && activeMailbox ? (
              <section
                className="gmail-inbox__panel gmail-inbox__panel--message"
                aria-label="Message"
              >
                <GmailMessageView
                  mailbox={activeMailbox}
                  message={selectedMessage}
                  threadMessages={threadMessages}
                  threadLoading={threadLoading}
                  labelById={labelById}
                  userLabels={userLabels}
                  userLabelTree={sidebarUserLabels}
                  currentLabelId={selectedLabelId}
                  listMessages={visibleMessages}
                  messagePositionLabel={messagePositionLabel}
                  actionBusy={actionBusy || refreshing}
                  latestThreadMessage={latestThreadMessage}
                  onBack={() => {
                    clearProtectedThreadSelection();
                    setComposeOpen(false);
                    setSelectedMessage(null);
                    deepLinkHandledRef.current = null;
                    const next = new URLSearchParams(searchParams);
                    next.delete('thread');
                    setSearchParams(next, { replace: true });
                  }}
                  onPrev={() => {
                    if (selectedMessageIndex > 0) {
                      setSelectedMessage(visibleMessages[selectedMessageIndex - 1]!);
                    }
                  }}
                  onNext={() => {
                    if (
                      selectedMessageIndex >= 0 &&
                      selectedMessageIndex < visibleMessages.length - 1
                    ) {
                      setSelectedMessage(visibleMessages[selectedMessageIndex + 1]!);
                    }
                  }}
                  canPrev={selectedMessageIndex > 0}
                  canNext={
                    selectedMessageIndex >= 0 &&
                    selectedMessageIndex < visibleMessages.length - 1
                  }
                  onToolbarComplete={handleBulkComplete}
                  onToolbarError={(msg) => setError(msg)}
                  onLabelsApplied={applyLabelUpdates}
                  onCompose={openCompose}
                  onOpenAttachment={handleOpenAttachment}
                  onRemoveLabel={handleRemoveMessageLabel}
                  guardArchive={isApptRequestMailbox ? guardApptRequestArchive : undefined}
                  composeOpen={composeOpen}
                  composeContext={composeContext}
                  onCloseCompose={() => setComposeOpen(false)}
                  onComposeSent={() => void handleComposeSent()}
                  onComposeDraftSaved={handleComposeDraftSaved}
                  onComposeDraftDeleted={handleComposeDraftDeleted}
                  contactsEnabled={activeMailboxStatus?.contactsEnabled ?? true}
                  appointmentRequestSlot={
                    isApptRequestMailbox && linkedApptSubmission ? (
                      <GmailAppointmentRequestPanel
                        mailbox={activeMailbox}
                        message={selectedMessage}
                        submission={linkedApptSubmission}
                        userLabels={userLabels}
                        onSubmissionUpdated={(item) => apptRequestIndex.applyLocalUpdate(item)}
                        onLabelsApplied={applyLabelUpdates}
                        onError={(msg) => setError(msg)}
                        autoOpenSms={smsPromptSubmissionId === linkedApptSubmission.id}
                        onAutoOpenSmsConsumed={() => setSmsPromptSubmissionId(null)}
                        autoOpenNotBooked={notBookedPromptSubmissionId === linkedApptSubmission.id}
                        onAutoOpenNotBookedConsumed={() => setNotBookedPromptSubmissionId(null)}
                      />
                    ) : isApptRequestMailbox &&
                      isAppointmentRequestNotificationSubject(selectedMessage.subject) &&
                      (!apptRequestIndex.ready || apptRequestIndex.loading) ? (
                      <div className="gmail-appt-panel gmail-appt-panel--loading" aria-busy="true">
                        <div className="gmail-inbox__state">Loading appointment request…</div>
                      </div>
                    ) : null
                  }
                />
              </section>
            ) : null}
          </div>
        </div>
      )}

      {connected && activeMailbox && !selectedMessage && !composeOpen ? (
        <button
          type="button"
          className="gmail-inbox__fab-compose"
          aria-label="Compose"
          onClick={() => openCompose({ mode: 'new' })}
        >
          <PenSquare size={22} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}

      {composeOpen && !selectedMessage && activeMailbox && composeContext.mode === 'new' ? (
        <GmailComposePanel
          mailbox={activeMailbox}
          context={composeContext}
          variant="float"
          contactsEnabled={activeMailboxStatus?.contactsEnabled ?? true}
          onClose={() => setComposeOpen(false)}
          onSent={() => void handleComposeSent()}
          onDraftSaved={handleComposeDraftSaved}
          onDraftDeleted={handleComposeDraftDeleted}
        />
      ) : null}
    </div>
  );
}
