import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  Archive,
  Mail,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from 'lucide-react';
import GmailComposeModal from '../components/gmail/GmailComposeModal';
import type { ComposeContext } from '../components/gmail/gmailCompose';
import '../components/gmail/GmailComposeModal.css';
import GmailLabelTree from '../components/gmail/GmailLabelTree';
import {
  archiveGmailMessage,
  disconnectGmail,
  fetchGmailLabels,
  fetchGmailMailboxes,
  fetchGmailMessages,
  fetchGmailOAuthConnectUrl,
  fetchGmailThread,
  flattenUserLabels,
  formatGmailAddress,
  gmailErrorMessage,
  labelDisplayName,
  mailboxShortLabel,
  mailboxDisplayLabel,
  markGmailMessageRead,
  markGmailMessageUnread,
  modifyGmailMessage,
  starGmailMessage,
  trashGmailMessage,
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

function MessageListSection({
  title,
  messages,
  selectedId,
  onSelect,
}: {
  title?: string;
  messages: GmailMessageSummary[];
  selectedId: string | null;
  onSelect: (msg: GmailMessageSummary) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="gmail-msg-section">
      {title ? <div className="gmail-msg-section__title">{title}</div> : null}
      <ul className="gmail-msg-list">
        {messages.map((msg) => (
          <li
            key={msg.id}
            className={[
              'gmail-msg-item',
              msg.isUnread ? 'gmail-msg-item--unread' : '',
              selectedId === msg.id ? 'gmail-msg-item--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button type="button" className="gmail-msg-item__btn" onClick={() => onSelect(msg)}>
              <div className="gmail-msg-item__top">
                <span className="gmail-msg-item__from">
                  {msg.from.name?.trim() || msg.from.email}
                </span>
                <span className="gmail-msg-item__date">{formatMessageDate(msg.date)}</span>
              </div>
              <div className="gmail-msg-item__subject">{msg.subject}</div>
              <div className="gmail-msg-item__snippet">{msg.snippet}</div>
              <div className="gmail-msg-item__meta">
                {msg.isStarred ? <Star size={12} fill="#eab308" color="#eab308" aria-hidden /> : null}
                {msg.hasAttachments ? <span>Attachment</span> : null}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GmailInbox() {
  const { allowed: canAccessGmailInbox, loading: gmailAccessLoading } = useGmailInboxAccess();
  const { token } = useAuth() as { token?: string | null };
  const [searchParams, setSearchParams] = useSearchParams();
  const [mailboxes, setMailboxes] = useState<GmailMailboxStatus[]>([]);
  const [defaultMailbox, setDefaultMailbox] = useState<string | null>(null);
  const [selectedMailbox, setSelectedMailbox] = useState<string | null>(null);
  const [labels, setLabels] = useState<GmailLabelNode[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState('INBOX');
  const [expandedLabels, setExpandedLabels] = useState<Set<string>>(() => new Set(['INBOX']));
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [untaggedQueue, setUntaggedQueue] = useState<GmailMessageSummary[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<GmailMessageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [labelPicker, setLabelPicker] = useState('');
  const [threadMessages, setThreadMessages] = useState<GmailThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeContext, setComposeContext] = useState<ComposeContext>({ mode: 'new' });

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

  const userLabels = useMemo(() => flattenUserLabels(labels), [labels]);
  const labelById = useMemo(() => {
    const map = new Map<string, GmailLabelNode>();
    const walk = (nodes: GmailLabelNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children.length) walk(n.children);
      }
    };
    walk(labels);
    return map;
  }, [labels]);

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
    const tree = await fetchGmailLabels(activeMailbox);
    setLabels(tree);
    setExpandedLabels((prev) => {
      const next = new Set(prev);
      for (const n of tree) {
        if (n.type === 'user' && n.children.length) next.add(n.id);
      }
      return next;
    });
  }, [activeMailbox]);

  const loadMessages = useCallback(
    async (opts?: { pageToken?: string; append?: boolean }) => {
      if (!activeMailbox) return;
      const res = await fetchGmailMessages(activeMailbox, {
        labelId: selectedLabelId,
        pageToken: opts?.pageToken,
      });
      setUntaggedQueue(res.untaggedQueue ?? []);
      setMessages((prev) =>
        opts?.append ? [...prev, ...(res.threads ?? [])] : (res.threads ?? []),
      );
      setNextPageToken(res.nextPageToken ?? null);
      return res;
    },
    [activeMailbox, selectedLabelId],
  );

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await loadMailboxes();
      if (!activeMailbox || !activeMailboxStatus?.connected) {
        setLabels([]);
        setMessages([]);
        setUntaggedQueue([]);
        setSelectedMessage(null);
        return;
      }
      await Promise.all([loadLabels(), loadMessages()]);
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [loadMailboxes, activeMailbox, activeMailboxStatus?.connected, loadLabels, loadMessages]);

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
      setLabels([]);
      setMessages([]);
      setUntaggedQueue([]);
      setSelectedMessage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      setSelectedLabelId('INBOX');
      try {
        await Promise.all([loadLabels(), loadMessages()]);
        if (!cancelled) setSelectedMessage(null);
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMailbox, activeMailboxStatus?.connected, loadLabels, loadMessages]);

  useEffect(() => {
    if (!connected || !activeMailbox) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        await loadMessages();
        if (!cancelled) setSelectedMessage(null);
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, activeMailbox, selectedLabelId, loadMessages]);

  useEffect(() => {
    if (!connected || !activeMailbox || !canAccessGmailInbox) return;

    const practiceId = resolvePracticeIdFromToken(token ?? localStorage.getItem('accessToken'));
    return subscribeGmailInbox({
      practiceId,
      mailboxEmail: activeMailbox,
      onInboxChange: () => {
        void loadMessages().catch(() => {
          /* non-blocking */
        });
      },
    });
  }, [connected, activeMailbox, canAccessGmailInbox, token, loadMessages]);

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
      setLabels([]);
      setMessages([]);
      setUntaggedQueue([]);
      setSelectedMessage(null);
    } catch (e) {
      setError(gmailErrorMessage(e));
    }
  };

  const selectMailbox = (email: string) => {
    setSelectedMailbox(email);
    const next = new URLSearchParams(searchParams);
    next.set('mailbox', email);
    setSearchParams(next, { replace: true });
  };

  const applyLocalMessageUpdate = (id: string, patch: Partial<GmailMessageSummary>) => {
    const updater = (list: GmailMessageSummary[]) =>
      list.map((m) => (m.id === id ? { ...m, ...patch } : m));
    setMessages((prev) => updater(prev));
    setUntaggedQueue((prev) => updater(prev));
    setSelectedMessage((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const removeMessageFromLists = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setUntaggedQueue((prev) => prev.filter((m) => m.id !== id));
    setSelectedMessage((prev) => (prev?.id === id ? null : prev));
  };

  const runAction = async (fn: () => Promise<{ labelIds: string[] }>) => {
    if (!selectedMessage) return;
    setActionBusy(true);
    setError(null);
    try {
      const result = await fn();
      applyLocalMessageUpdate(selectedMessage.id, {
        labelIds: result.labelIds,
        isUnread: result.labelIds.includes('UNREAD'),
        isStarred: result.labelIds.includes('STARRED'),
      });
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setActionBusy(false);
    }
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
      const result = await markGmailMessageRead(activeMailbox, msg.id);
        applyLocalMessageUpdate(msg.id, {
          isUnread: false,
          labelIds: result.labelIds,
        });
      } catch {
        /* non-blocking */
      }
  };

  const handleAddLabel = async () => {
    if (!selectedMessage || !labelPicker) return;
    setActionBusy(true);
    try {
      const result = await modifyGmailMessage(activeMailbox!, selectedMessage.id, {
        addLabelIds: [labelPicker],
      });
      applyLocalMessageUpdate(selectedMessage.id, { labelIds: result.labelIds });
      setLabelPicker('');
      await loadMessages();
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveLabel = async (labelId: string) => {
    if (!selectedMessage) return;
    setActionBusy(true);
    try {
      const result = await modifyGmailMessage(activeMailbox!, selectedMessage.id, {
        removeLabelIds: [labelId],
      });
      applyLocalMessageUpdate(selectedMessage.id, { labelIds: result.labelIds });
      await loadMessages();
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setActionBusy(false);
    }
  };

  const showUntagged = selectedLabelId === 'INBOX';

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
          <h1 className="gmail-inbox__title">Email</h1>
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
                  {!mb.connected ? ' · not connected' : ''}
                </button>
              ))}
            </div>
          ) : null}
          <p className="gmail-inbox__subtitle">
            {activeMailbox ? `Viewing ${activeMailbox}` : 'Practice inboxes'}
            {activeMailboxStatus?.displayLabel
              ? ` · ${activeMailboxStatus.displayLabel}`
              : activeMailbox
                ? ` · ${mailboxDisplayLabel({ email: activeMailbox, displayLabel: undefined, kind: undefined })}`
                : ''}
            {activeMailboxStatus?.grantedEmail
              ? ` · Connected as ${activeMailboxStatus.grantedEmail}`
              : ''}
          </p>
        </div>
        <div className="gmail-inbox__toolbar">
          {connected && activeMailbox ? (
            <button
              type="button"
              className="gmail-btn gmail-btn--primary"
              onClick={() => openCompose({ mode: 'new' })}
            >
              <PenSquare size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
              Compose
            </button>
          ) : null}
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
          <section className="gmail-inbox__panel gmail-inbox__panel--labels" aria-label="Labels">
            <div className="gmail-inbox__panel-head">Labels</div>
            <div className="gmail-inbox__panel-scroll">
              <GmailLabelTree
                labels={labels}
                selectedId={selectedLabelId}
                onSelect={setSelectedLabelId}
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
            </div>
          </section>

          <section className="gmail-inbox__panel gmail-inbox__panel--list" aria-label="Messages">
            <div className="gmail-inbox__panel-head">
              {labelById.get(selectedLabelId)
                ? labelDisplayName(labelById.get(selectedLabelId)!)
                : 'Messages'}
            </div>
            <div className="gmail-inbox__panel-scroll">
              {showUntagged ? (
                <MessageListSection
                  title="Unclaimed"
                  messages={untaggedQueue}
                  selectedId={selectedMessage?.id ?? null}
                  onSelect={handleSelectMessage}
                />
              ) : null}
              <MessageListSection
                title={showUntagged && untaggedQueue.length > 0 ? 'Tagged' : undefined}
                messages={messages}
                selectedId={selectedMessage?.id ?? null}
                onSelect={handleSelectMessage}
              />
              {messages.length === 0 && untaggedQueue.length === 0 ? (
                <div className="gmail-inbox__state">No messages in this label.</div>
              ) : null}
              {nextPageToken ? (
                <div style={{ padding: 12, textAlign: 'center' }}>
                  <button
                    type="button"
                    className="gmail-btn"
                    disabled={refreshing}
                    onClick={async () => {
                      setRefreshing(true);
                      try {
                        await loadMessages({ pageToken: nextPageToken, append: true });
                      } catch (e) {
                        setError(gmailErrorMessage(e));
                      } finally {
                        setRefreshing(false);
                      }
                    }}
                  >
                    Load more
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="gmail-inbox__panel" aria-label="Message detail">
            <div className="gmail-inbox__panel-head">Message</div>
            <div className="gmail-inbox__panel-scroll">
              {!selectedMessage ? (
                <div className="gmail-detail__empty">Select a message to read.</div>
              ) : (
                <div className="gmail-detail">
                  <h2 className="gmail-detail__subject">{selectedMessage.subject}</h2>
                  <div className="gmail-detail__meta">
                    <div>
                      <strong>From:</strong> {formatGmailAddress(selectedMessage.from)}
                    </div>
                    {selectedMessage.to.length > 0 ? (
                      <div>
                        <strong>To:</strong>{' '}
                        {selectedMessage.to.map((t) => formatGmailAddress(t)).join(', ')}
                      </div>
                    ) : null}
                    <div>
                      <strong>Date:</strong> {new Date(selectedMessage.date).toLocaleString()}
                    </div>
                  </div>

                  <div className="gmail-detail__actions">
                    <button
                      type="button"
                      className="gmail-btn"
                      disabled={actionBusy || threadLoading || !latestThreadMessage}
                      onClick={() =>
                        openCompose({
                          mode: 'reply',
                          threadId: selectedMessage.threadId,
                          replyTo: latestThreadMessage ?? undefined,
                        })
                      }
                    >
                      <Reply size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
                      Reply
                    </button>
                    <button
                      type="button"
                      className="gmail-btn"
                      disabled={actionBusy || threadLoading || !latestThreadMessage}
                      onClick={() =>
                        openCompose({
                          mode: 'replyAll',
                          threadId: selectedMessage.threadId,
                          replyTo: latestThreadMessage ?? undefined,
                        })
                      }
                    >
                      <ReplyAll size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
                      Reply all
                    </button>
                    <button
                      type="button"
                      className="gmail-btn"
                      disabled={actionBusy}
                      onClick={() =>
                        runAction(() =>
                          selectedMessage.isStarred
                            ? starGmailMessage(activeMailbox!, selectedMessage.id, false)
                            : starGmailMessage(activeMailbox!, selectedMessage.id, true),
                        )
                      }
                    >
                      <Star size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
                      {selectedMessage.isStarred ? 'Unstar' : 'Star'}
                    </button>
                    <button
                      type="button"
                      className="gmail-btn"
                      disabled={actionBusy}
                      onClick={() =>
                        runAction(() =>
                          selectedMessage.isUnread
                            ? markGmailMessageRead(activeMailbox!, selectedMessage.id)
                            : markGmailMessageUnread(activeMailbox!, selectedMessage.id),
                        )
                      }
                    >
                      {selectedMessage.isUnread ? 'Mark read' : 'Mark unread'}
                    </button>
                    <button
                      type="button"
                      className="gmail-btn"
                      disabled={actionBusy}
                      onClick={async () => {
                        setActionBusy(true);
                        try {
                          await archiveGmailMessage(activeMailbox!, selectedMessage.id);
                          removeMessageFromLists(selectedMessage.id);
                        } catch (e) {
                          setError(gmailErrorMessage(e));
                        } finally {
                          setActionBusy(false);
                        }
                      }}
                    >
                      <Archive size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
                      Archive
                    </button>
                    <button
                      type="button"
                      className="gmail-btn gmail-btn--danger"
                      disabled={actionBusy}
                      onClick={async () => {
                        if (!window.confirm('Move this message to trash?')) return;
                        setActionBusy(true);
                        try {
                          await trashGmailMessage(activeMailbox!, selectedMessage.id);
                          removeMessageFromLists(selectedMessage.id);
                        } catch (e) {
                          setError(gmailErrorMessage(e));
                        } finally {
                          setActionBusy(false);
                        }
                      }}
                    >
                      <Trash2 size={14} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
                      Trash
                    </button>
                  </div>

                  {selectedMessage.labelIds.length > 0 ? (
                    <div className="gmail-detail__labels">
                      {selectedMessage.labelIds
                        .filter((id) => labelById.has(id))
                        .map((id) => {
                          const label = labelById.get(id)!;
                          if (label.type !== 'user') return null;
                          return (
                            <span key={id} className="gmail-chip">
                              {labelDisplayName(label)}
                              <button
                                type="button"
                                aria-label={`Remove label ${labelDisplayName(label)}`}
                                onClick={() => handleRemoveLabel(id)}
                                disabled={actionBusy}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  padding: 0,
                                  lineHeight: 1,
                                }}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                    </div>
                  ) : null}

                  <div className="gmail-label-picker">
                    <label htmlFor="gmail-add-label">Add label</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <select
                        id="gmail-add-label"
                        value={labelPicker}
                        onChange={(e) => setLabelPicker(e.target.value)}
                      >
                        <option value="">Select label…</option>
                        {userLabels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="gmail-btn"
                        disabled={!labelPicker || actionBusy}
                        onClick={handleAddLabel}
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  {threadLoading ? (
                    <div className="gmail-inbox__state">Loading thread…</div>
                  ) : threadMessages.length > 0 ? (
                    <div className="gmail-detail__thread">
                      {threadMessages.map((msg) => (
                        <article key={msg.id} className="gmail-thread-message">
                          <div className="gmail-thread-message__meta">
                            <strong>{formatGmailAddress(msg.from)}</strong>
                            {' · '}
                            {new Date(msg.date).toLocaleString()}
                          </div>
                          {msg.body.html ? (
                            <div
                              className="gmail-thread-message__body gmail-thread-message__body--html"
                              dangerouslySetInnerHTML={{ __html: msg.body.html }}
                            />
                          ) : (
                            <div className="gmail-thread-message__body">
                              {msg.body.text ?? msg.snippet}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="gmail-detail__snippet">{selectedMessage.snippet}</div>
                  )}
                </div>
              )}
            </div>
          </section>
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
