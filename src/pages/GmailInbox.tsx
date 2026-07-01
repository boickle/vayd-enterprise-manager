import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Mail,
  PenSquare,
  RefreshCw,
  Star,
} from 'lucide-react';
import GmailBulkToolbar from '../components/gmail/GmailBulkToolbar';
import GmailComposeModal from '../components/gmail/GmailComposeModal';
import GmailMessageView from '../components/gmail/GmailMessageView';
import GmailSearchBar from '../components/gmail/GmailSearchBar';
import {
  buildGmailSearchQuery,
  EMPTY_GMAIL_SEARCH_FILTER,
  searchLabelIdForScope,
  type GmailSearchFilterFields,
} from '../components/gmail/gmailSearch';
import type { ComposeContext } from '../components/gmail/gmailCompose';
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
  resolveGmailMessageListParams,
  isMoreNavLabel,
  GMAIL_MORE_GROUP_ID,
  gmailErrorMessage,
  labelDisplayName,
  mailboxShortLabel,
  mailboxDisplayLabel,
  markGmailMessageRead,
  openGmailAttachment,
  starGmailMessage,
  truncateAttachmentFilename,
  decodeGmailSnippet,
  hasScheduledSend,
  type GmailAttachmentSummary,
  type GmailLabelNode,
  type GmailMailboxStatus,
  type GmailMessageSummary,
  type GmailThreadMessage,
} from '../api/gmail';
import './GmailInbox.css';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { useAuth } from '../auth/useAuth';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { subscribeGmailInbox } from '../utils/gmailRealtime';

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

function attachmentUsesImageIcon(mimeType: string): boolean {
  return mimeType.startsWith('image/');
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
              <button type="button" className="gmail-msg-item__btn" onClick={() => onSelect(msg)}>
                <div className="gmail-msg-item__main">
                  <span className="gmail-msg-item__from">
                    <span className="gmail-msg-item__participants">
                      {msg.participants?.trim() ||
                        msg.from.name?.trim() ||
                        msg.from.email}
                    </span>
                    {(msg.threadMessageCount ?? 1) > 1 ? (
                      <span className="gmail-msg-item__thread-count">
                        {msg.threadMessageCount}
                      </span>
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
                        <span className="gmail-msg-item__subject">{msg.subject || '(no subject)'}</span>
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
                        {msg.attachments.map((attachment) => {
                          const Icon = attachmentUsesImageIcon(attachment.mimeType)
                            ? ImageIcon
                            : FileText;
                          return (
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
                              <Icon size={14} strokeWidth={1.75} aria-hidden />
                              {truncateAttachmentFilename(attachment.filename, 20)}
                            </button>
                          );
                        })}
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
              </button>
            </li>
          );
        })}
      </ul>
  );
}

export default function GmailInbox() {
  const { allowed: canAccessGmailInbox, loading: gmailAccessLoading } = useGmailInboxAccess();
  const { token } = useAuth() as { token?: string | null };
  const [searchParams, setSearchParams] = useSearchParams();
  const [mailboxes, setMailboxes] = useState<GmailMailboxStatus[]>([]);
  const [defaultMailbox, setDefaultMailbox] = useState<string | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<GmailThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeContext, setComposeContext] = useState<ComposeContext>({ mode: 'new' });
  const [mailSearchInput, setMailSearchInput] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [searchFilterDraft, setSearchFilterDraft] = useState<GmailSearchFilterFields>(
    () => ({ ...EMPTY_GMAIL_SEARCH_FILTER }),
  );
  const [appliedSearchFilter, setAppliedSearchFilter] = useState<GmailSearchFilterFields>(
    () => ({ ...EMPTY_GMAIL_SEARCH_FILTER }),
  );
  const [searchFilterOpen, setSearchFilterOpen] = useState(false);
  const [checkedMessageIds, setCheckedMessageIds] = useState<Set<string>>(() => new Set());
  const [mailboxUnreadCounts, setMailboxUnreadCounts] = useState<Record<string, number>>({});
  const deepLinkHandledRef = useRef<string | null>(null);

  const deepLinkThreadId = searchParams.get('thread')?.trim() ?? null;

  const mailSearch = useMemo(
    () => buildGmailSearchQuery(appliedSearchFilter, debouncedSearchText),
    [appliedSearchFilter, debouncedSearchText],
  );

  const searchLabelId = useMemo(
    () => searchLabelIdForScope(appliedSearchFilter.scope, selectedLabelId),
    [appliedSearchFilter.scope, selectedLabelId],
  );

  const messageListParams = useMemo(
    () => resolveGmailMessageListParams(selectedLabelId, mailSearch, searchLabelId),
    [selectedLabelId, mailSearch, searchLabelId],
  );

  const activeMailbox = useMemo(() => {
    if (selectedMailbox) return selectedMailbox;
    const fromUrl = searchParams.get('mailbox')?.trim().toLowerCase();
    if (fromUrl) return fromUrl;
    return defaultMailbox;
  }, [selectedMailbox, searchParams, defaultMailbox]);

  const activeMailboxStatus = useMemo(
    () => mailboxes.find((m) => m.email === activeMailbox) ?? null,
    [mailboxes, activeMailbox],
  );

  const connected = activeMailboxStatus?.connected === true;
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
        setSelectedLabelId('INBOX');
        setSelectedMessage(threadMessageToSummary(latest));
        setThreadMessages(thread.messages);
        const next = new URLSearchParams(searchParams);
        next.delete('thread');
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
    setSelectedMessage(null);
    setSelectedLabelId(labelId);
    if (isMoreNavLabel(labelId)) {
      setExpandedLabels((prev) => {
        const next = new Set(prev);
        next.add(GMAIL_MORE_GROUP_ID);
        return next;
      });
    }
  }, []);

  const loadMailboxes = useCallback(async () => {
    const res = await fetchGmailMailboxes();
    setMailboxes(res.mailboxes);
    setDefaultMailbox(res.defaultMailbox);
    if (!selectedMailbox && !searchParams.get('mailbox')) {
      setSelectedMailbox(res.defaultMailbox);
    }
    return res;
  }, [selectedMailbox, searchParams]);

  const loadLabels = useCallback(async () => {
    if (!activeMailbox) return;
    const { labels, inboxUnreadCount } = await fetchGmailLabels(activeMailbox);
    const { navigation, userLabels: userLabelTree } = prepareSidebarLabels(labels);
    setNavigationLabels(patchInboxUnreadCount(navigation, inboxUnreadCount));
    setSidebarUserLabels(userLabelTree);
    setExpandedLabels((prev) => {
      const next = new Set(prev);
      for (const n of userLabelTree) {
        if (n.children.length) next.add(n.id);
      }
      if (navigation.some((n) => n.id === GMAIL_CATEGORIES_GROUP_ID)) {
        next.add(GMAIL_CATEGORIES_GROUP_ID);
      }
      return next;
    });
  }, [activeMailbox]);

  const connectedMailboxKey = mailboxes
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
        }),
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
    [activeMailbox, messageListParams],
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
      setSelectedMessage(null);
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
        if (!cancelled) setSelectedMessage(null);
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
      setSelectedMessage(null);
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
      return (
        messages.find((m) => m.id === prev.id || m.threadId === prev.threadId) ?? null
      );
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
    try {
      const url = await fetchGmailOAuthConnectUrl(mailbox, '/schedule/email');
      window.location.assign(url);
    } catch (e) {
      setError(gmailErrorMessage(e));
    }
  };

  const handleDisconnect = async (mailbox: string) => {
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

  const selectMailbox = (email: string) => {
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
        threadWasUnread = prev.some(
          (m) => m.threadId === target.threadId && m.isUnread,
        );
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
          }),
        );
      } else if (patch.isUnread === true && !threadWasUnread) {
        setNavigationLabels((prev) =>
          prev.map((label) => {
            if (label.id !== 'INBOX') return label;
            const base = label.threadsUnread ?? label.messagesUnread ?? 0;
            return { ...label, threadsUnread: base + 1, messagesUnread: base + 1 };
          }),
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
          : selected,
      );
      return prev.filter((m) => m.id !== id && (!threadId || m.threadId !== threadId));
    });
  };

  const openCompose = (context: ComposeContext) => {
    setComposeContext(context);
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

  const handleSelectMessage = async (msg: GmailMessageSummary) => {
    setSelectedMessage(msg);
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
    [activeMailbox],
  );

  const visibleMessages = messages;

  const allVisibleChecked =
    visibleMessages.length > 0 && visibleMessages.every((m) => checkedMessageIds.has(m.id));

  const checkedVisibleCount = visibleMessages.filter((m) =>
    checkedMessageIds.has(m.id),
  ).length;
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

  const handleBulkComplete = () => {
    setCheckedMessageIds(new Set());
    setSelectedMessage(null);
    void Promise.all([loadPage(pageIndexRef.current), loadLabels()]);
  };

  const paginationRangeStart =
    messages.length === 0 ? 0 : pageIndex * GMAIL_MESSAGES_PAGE_SIZE + 1;
  const paginationRangeEnd = pageIndex * GMAIL_MESSAGES_PAGE_SIZE + messages.length;
  const paginationTotal =
    resultSizeEstimate ??
    (hasNextPage ? null : messages.length === 0 ? 0 : paginationRangeEnd);

  const selectedMessageIndex = selectedMessage
    ? visibleMessages.findIndex(
        (m) =>
          m.id === selectedMessage.id || m.threadId === selectedMessage.threadId,
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
    <div className="gmail-inbox">
      {banner ? (
        <div
          className={`gmail-inbox__banner${
            banner.includes('failed') ? ' gmail-inbox__banner--error' : ' gmail-inbox__banner--success'
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
            sign in, choose <strong>{activeMailbox}</strong>.
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

      {connected && activeMailboxStatus?.mailboxMismatch ? (
        <div className="gmail-inbox__banner gmail-inbox__banner--error">
          <span>
            Connected as <strong>{activeMailboxStatus.grantedEmail}</strong>, but this tab expects{' '}
            <strong>{activeMailbox}</strong>. Disconnect and connect again while signed into{' '}
            <strong>{activeMailbox}</strong> in Google.
          </span>
          <div className="gmail-inbox__banner-actions">
            <button type="button" className="gmail-btn" onClick={() => handleDisconnect(activeMailbox!)}>
              Disconnect
            </button>
          </div>
        </div>
      ) : null}

      <header className="gmail-inbox__header">
        <div>
          {mailboxes.length > 0 ? (
            <div className="gmail-inbox__mailbox-tabs" role="tablist" aria-label="Gmail accounts">
              {mailboxes.map((mb) => (
                <button
                  key={mb.email}
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
                    <sup className="gmail-inbox__mailbox-tab-badge">
                      {mailboxTabUnread(mb.email)}
                    </sup>
                  ) : null}
                  {!mb.connected ? ' · not connected' : ''}
                </button>
              ))}
            </div>
          ) : null}
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
          {connected && activeMailbox ? (
            <button type="button" className="gmail-btn" onClick={() => handleDisconnect(activeMailbox)}>
              Disconnect
            </button>
          ) : activeMailbox ? (
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
      ) : mailboxes.length === 0 ? (
        <div className="gmail-inbox__state">
          <Mail size={32} strokeWidth={1.5} color="#94a3b8" aria-hidden />
          <p>No practice Gmail mailboxes are available for your account.</p>
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
          <section className="gmail-inbox__panel gmail-inbox__panel--labels" aria-label="Mail folders">
            <div className="gmail-inbox__panel-scroll">
              {connected && activeMailbox ? (
                <button
                  type="button"
                  className="gmail-sidebar__compose"
                  onClick={() => openCompose({ mode: 'new' })}
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
          </section>

          {selectedMessage && activeMailbox ? (
            <section className="gmail-inbox__panel gmail-inbox__panel--message" aria-label="Message">
              <GmailMessageView
                mailbox={activeMailbox}
                message={selectedMessage}
                threadMessages={threadMessages}
                threadLoading={threadLoading}
                labelById={labelById}
                userLabels={userLabels}
                currentLabelId={selectedLabelId}
                listMessages={visibleMessages}
                messagePositionLabel={messagePositionLabel}
                actionBusy={actionBusy || refreshing}
                latestThreadMessage={latestThreadMessage}
                onBack={() => setSelectedMessage(null)}
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
                onCompose={openCompose}
                onOpenAttachment={handleOpenAttachment}
              />
            </section>
          ) : (
            <section className="gmail-inbox__panel gmail-inbox__panel--list" aria-label="Messages">
              <div className="gmail-inbox__list-toolbar">
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
                    targetMessages={visibleMessages.filter((m) =>
                      checkedMessageIds.has(m.id),
                    )}
                    currentLabelId={selectedLabelId}
                    userLabels={userLabels}
                    labelById={labelById}
                    disabled={actionBusy || refreshing}
                    onComplete={handleBulkComplete}
                    onError={(msg) => setError(msg)}
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
                  <div className="gmail-inbox__state">No messages in this label.</div>
                ) : null}
              </div>
            </section>
          )}
        </div>
      )}

      {activeMailbox ? (
        <GmailComposeModal
          open={composeOpen}
          mailbox={activeMailbox}
          context={composeContext}
          onClose={() => setComposeOpen(false)}
          onSent={async () => {
            setBanner('Message sent.');
            await refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}
