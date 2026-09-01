import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import {
  decodeGmailSnippet,
  fetchGmailMailboxes,
  fetchGmailThread,
  formatGmailAddress,
  gmailErrorMessage,
  mailboxDisplayLabel,
  mergeGmailMessagesByDate,
  fetchGmailMessages,
  type GmailMailboxStatus,
  type GmailMessageSummary,
  type GmailThreadMessage,
} from '../api/gmail';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import {
  buildGmailClientCorrespondenceQuery,
  CLIENT_EMAIL_THREADS_PER_ADDRESS,
  clientEmailsFromStaffPayload,
} from '../utils/clientEmailGmailSearch';
import { NO_SHARED_GMAIL_MESSAGE, sharedConnectedMailboxes } from '../utils/practiceGmailMailboxes';
import { threadCacheKey, threadListPreviewFromMessages } from '../utils/gmailThreadPreview';
import GmailOpenTrackingBadge from './gmail/GmailOpenTrackingBadge';
import '../pages/GmailInbox.css';

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel?: string;
  onClose: () => void;
};

type EmailHistoryThread = GmailMessageSummary & {
  listPreview: string;
};

type EmailHistorySection = {
  mailbox: string;
  mailboxLabel: string;
  clientEmail: string;
  threads: EmailHistoryThread[];
  error?: string | null;
};

type SelectedThread = {
  mailbox: string;
  threadId: string;
  subject: string;
};

function senderInitial(from: GmailThreadMessage['from']): string {
  const name = from.name?.trim();
  if (name) return name.charAt(0).toUpperCase();
  return (from.email.charAt(0) || '?').toUpperCase();
}

function formatThreadDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function enrichThreadsWithPreviews(
  mailbox: string,
  threads: GmailMessageSummary[],
): Promise<{ threads: EmailHistoryThread[]; cache: Map<string, GmailThreadMessage[]> }> {
  const cache = new Map<string, GmailThreadMessage[]>();
  const enriched = await Promise.all(
    threads.map(async (thread): Promise<EmailHistoryThread> => {
      let listPreview = decodeGmailSnippet(thread.snippet);
      try {
        const res = await fetchGmailThread(mailbox, thread.threadId);
        const messages = res.messages ?? [];
        cache.set(threadCacheKey(mailbox, thread.threadId), messages);
        const preview = threadListPreviewFromMessages(messages);
        if (preview) listPreview = preview;
      } catch {
        /* keep Gmail list snippet */
      }
      return { ...thread, listPreview };
    }),
  );
  return { threads: enriched, cache };
}

async function loadSectionsForMailboxes(
  mailboxes: GmailMailboxStatus[],
  clientEmails: string[],
): Promise<{ sections: EmailHistorySection[]; threadCache: Map<string, GmailThreadMessage[]> }> {
  const connected = mailboxes.filter((mb) => mb.connected);
  const threadCache = new Map<string, GmailThreadMessage[]>();
  const sections = await Promise.all(
    connected.flatMap((mb) =>
      clientEmails.map(async (clientEmail): Promise<EmailHistorySection> => {
        try {
          const res = await fetchGmailMessages(mb.email, {
            q: buildGmailClientCorrespondenceQuery(clientEmail),
            maxResults: 20,
          });
          const threadSummaries = mergeGmailMessagesByDate(
            res.threads ?? [],
            res.untaggedQueue ?? [],
          ).slice(0, CLIENT_EMAIL_THREADS_PER_ADDRESS);
          const { threads, cache } = await enrichThreadsWithPreviews(mb.email, threadSummaries);
          for (const [key, messages] of cache) threadCache.set(key, messages);
          return {
            mailbox: mb.email,
            mailboxLabel: mailboxDisplayLabel(mb),
            clientEmail,
            threads,
          };
        } catch (e: unknown) {
          return {
            mailbox: mb.email,
            mailboxLabel: mailboxDisplayLabel(mb),
            clientEmail,
            threads: [],
            error: gmailErrorMessage(e),
          };
        }
      }),
    ),
  );

  sections.sort((a, b) => {
    const ml = a.mailboxLabel.localeCompare(b.mailboxLabel, undefined, { sensitivity: 'base' });
    if (ml !== 0) return ml;
    return a.clientEmail.localeCompare(b.clientEmail, undefined, { sensitivity: 'base' });
  });

  return { sections, threadCache };
}

export function ClientEmailHistoryModal({ open, clientId, clientLabel, onClose }: Props) {
  const { allowed: gmailAllowed, loading: gmailAccessLoading } = useGmailInboxAccess();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientEmails, setClientEmails] = useState<string[]>([]);
  const [sections, setSections] = useState<EmailHistorySection[]>([]);
  const threadMessageCacheRef = useRef<Map<string, GmailThreadMessage[]>>(new Map());
  const [selectedThread, setSelectedThread] = useState<SelectedThread | null>(null);
  const [threadMessages, setThreadMessages] = useState<GmailThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || clientId == null) {
      setLoading(false);
      setError(null);
      setClientEmails([]);
      setSections([]);
      threadMessageCacheRef.current = new Map();
      setSelectedThread(null);
      setThreadMessages([]);
      setThreadLoading(false);
      setThreadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSections([]);
    threadMessageCacheRef.current = new Map();
    setSelectedThread(null);
    setThreadMessages([]);

    void (async () => {
      try {
        if (!gmailAllowed) {
          setError('Gmail access is not available for your account.');
          return;
        }

        const [clientRaw, mailboxRes] = await Promise.all([
          fetchClientByIdStaff(clientId),
          fetchGmailMailboxes(),
        ]);
        if (cancelled) return;

        const emails = clientEmailsFromStaffPayload(clientRaw);
        setClientEmails(emails);

        if (emails.length === 0) {
          setError('No client email addresses on file.');
          return;
        }

        const shared = sharedConnectedMailboxes(mailboxRes.mailboxes);
        if (shared.length === 0) {
          setError(NO_SHARED_GMAIL_MESSAGE);
          return;
        }

        const { sections: loaded, threadCache } = await loadSectionsForMailboxes(shared, emails);
        if (!cancelled) {
          setSections(loaded);
          threadMessageCacheRef.current = threadCache;
        }
      } catch (e: unknown) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, clientId, gmailAllowed]);

  useEffect(() => {
    if (!selectedThread) {
      setThreadMessages([]);
      setThreadError(null);
      setThreadLoading(false);
      return;
    }
    const cacheKey = threadCacheKey(selectedThread.mailbox, selectedThread.threadId);
    const cached = threadMessageCacheRef.current.get(cacheKey);
    if (cached?.length) {
      setThreadMessages(cached);
      setThreadError(null);
      setThreadLoading(false);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setThreadError(null);
    void fetchGmailThread(selectedThread.mailbox, selectedThread.threadId)
      .then((res) => {
        if (cancelled) return;
        const messages = res.messages ?? [];
        threadMessageCacheRef.current.set(cacheKey, messages);
        setThreadMessages(messages);
      })
      .catch((e: unknown) => {
        if (!cancelled) setThreadError(gmailErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedThread]);

  const threadCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.threads.length, 0),
    [sections],
  );

  if (!open || typeof document === 'undefined') return null;

  const showSpinner = loading || gmailAccessLoading;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-email-history-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
        padding: 16,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(860px, 92vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 24,
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <div
          style={{
            marginBottom: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div>
            <h3 id="client-email-history-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
              Email history
            </h3>
            {clientLabel ? (
              <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: 14 }}>{clientLabel}</p>
            ) : null}
            {clientEmails.length > 0 ? (
              <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: 14 }}>
                {clientEmails.join(' · ')}
              </p>
            ) : null}
            {!selectedThread && sections.length > 0 ? (
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
                {threadCount} {threadCount === 1 ? 'thread' : 'threads'} across connected Gmail
                accounts (up to {CLIENT_EMAIL_THREADS_PER_ADDRESS} per address)
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#6b7280',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {selectedThread ? (
          <div>
            <button
              type="button"
              className="btn secondary"
              style={{ marginBottom: 16 }}
              onClick={() => setSelectedThread(null)}
            >
              ← Back to threads
            </button>
            <h4 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 600 }}>
              {selectedThread.subject || '(no subject)'}
            </h4>
            {threadLoading ? (
              <p className="settings-muted">Loading thread…</p>
            ) : null}
            {threadError ? (
              <p role="alert" style={{ color: '#dc2626' }}>
                {threadError}
              </p>
            ) : null}
            {!threadLoading && !threadError ? (
              <div className="gmail-message-view__thread">
                {threadMessages.map((msg) => (
                  <article key={msg.id} className="gmail-thread-message">
                    <div className="gmail-message-view__sender-row">
                      <span className="gmail-message-view__avatar" aria-hidden>
                        {senderInitial(msg.from)}
                      </span>
                      <div className="gmail-message-view__sender-meta">
                        <div className="gmail-message-view__sender-line">
                          <strong>{formatGmailAddress(msg.from)}</strong>
                          <GmailOpenTrackingBadge
                            tracking={msg.tracking}
                            mailbox={selectedThread.mailbox}
                          />
                          <span className="gmail-message-view__date">{formatThreadDate(msg.date)}</span>
                        </div>
                        {msg.headers.to ? (
                          <div className="gmail-message-view__to">to {msg.headers.to}</div>
                        ) : null}
                      </div>
                    </div>
                    {msg.body.html ? (
                      <div
                        className="gmail-thread-message__body gmail-thread-message__body--html"
                        dangerouslySetInnerHTML={{ __html: msg.body.html }}
                      />
                    ) : (
                      <div className="gmail-thread-message__body">
                        {decodeGmailSnippet(msg.body.text ?? msg.snippet)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {showSpinner ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading email history…</div>
            ) : null}

            {error ? (
              <div
                role="alert"
                style={{
                  padding: 16,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  color: '#dc2626',
                }}
              >
                {error}
              </div>
            ) : null}

            {!showSpinner && !error ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {sections.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
                    No email threads found for this client.
                  </div>
                ) : (
                  sections.map((section) => (
                    <section
                      key={`${section.mailbox}:${section.clientEmail}`}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '12px 16px',
                          background: '#f9fafb',
                          borderBottom: '1px solid #e5e7eb',
                        }}
                      >
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
                          {section.mailboxLabel}
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                          {section.mailbox}
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                          Client address: {section.clientEmail}
                        </div>
                      </div>
                      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {section.error ? (
                          <p style={{ margin: 0, color: '#dc2626', fontSize: 14 }}>{section.error}</p>
                        ) : null}
                        {!section.error && section.threads.length === 0 ? (
                          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
                            No threads on this mailbox for this address.
                          </p>
                        ) : null}
                        {section.threads.map((thread) => (
                          <button
                            key={thread.threadId}
                            type="button"
                            onClick={() =>
                              setSelectedThread({
                                mailbox: section.mailbox,
                                threadId: thread.threadId,
                                subject: thread.subject?.trim() || '(no subject)',
                              })
                            }
                            style={{
                              textAlign: 'left',
                              padding: 14,
                              border: '1px solid #4FB128',
                              borderRadius: 8,
                              background: '#f0f7f4',
                              borderLeft: '4px solid #4FB128',
                              cursor: 'pointer',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                marginBottom: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <strong style={{ fontSize: 14, color: '#111827' }}>
                                {thread.subject?.trim() || '(no subject)'}
                              </strong>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: 12,
                                  color: '#6b7280',
                                }}
                              >
                                <GmailOpenTrackingBadge tracking={thread.tracking} />
                                {formatThreadDate(thread.date)}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 4 }}>
                              {thread.listPreview}
                            </div>
                            <div style={{ fontSize: 12, color: '#9ca3af' }}>
                              {thread.participants?.trim() ||
                                formatGmailAddress(thread.from)}
                              {thread.threadMessageCount && thread.threadMessageCount > 1
                                ? ` · ${thread.threadMessageCount} messages`
                                : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
