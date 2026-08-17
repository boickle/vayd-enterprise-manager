import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { fetchClientMessages, type ClientMessagesResponse, type Message } from '../api/clientPortal';
import {
  fetchClientMessagesCached,
  getCachedClientMessages,
} from '../utils/clientMessagesCache';
import {
  CLIENT_MESSAGES_PER_LINE,
  groupClientMessagesByLine,
  type ClientMessagesLineGroup,
} from '../utils/clientMessagesByLine';
import {
  directoryEntryMatchesPhone,
  resolveLineDirectoryEntry,
  useOpenPhoneLineDirectory,
} from '../hooks/useOpenPhoneLineDirectory';
import { phonesMatchForQuo } from '../utils/quoContact';
import { phoneProviderDisplayName } from '../config/phoneProvider';

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel?: string;
  /** When set, highlight this line in the grouped view (all lines are still shown). */
  openPhoneLine?: string | null;
  onClose: () => void;
};

function MessageBubble({ message }: { message: Message }) {
  const isIncoming = message.direction === 'incoming';
  const createdAt = DateTime.fromISO(message.createdAt);
  const formattedDate = createdAt.isValid
    ? createdAt.toFormat('MMM dd, yyyy h:mm a')
    : message.createdAt;

  return (
    <div
      style={{
        padding: 16,
        background: isIncoming ? '#f0f7f4' : '#f9fafb',
        border: `1px solid ${isIncoming ? '#4FB128' : '#e5e7eb'}`,
        borderRadius: 8,
        borderLeft: `4px solid ${isIncoming ? '#4FB128' : '#6b7280'}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#6b7280',
            textTransform: 'uppercase',
          }}
        >
          {isIncoming ? 'Incoming' : 'Outgoing'}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>{formattedDate}</div>
      </div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{message.content}</div>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        {isIncoming
          ? `From: ${message.from}`
          : `To: ${Array.isArray(message.to) ? message.to.join(', ') : message.to}`}
        {message.status ? ` · ${message.status}` : ''}
      </div>
    </div>
  );
}

function LineSection({
  group,
  highlighted,
  directory,
}: {
  group: ClientMessagesLineGroup;
  highlighted: boolean;
  directory: ReturnType<typeof useOpenPhoneLineDirectory>['directory'];
}) {
  const entry = resolveLineDirectoryEntry(directory, group.linePhone);

  return (
    <section
      style={{
        border: highlighted ? '2px solid #4FB128' : '1px solid #e5e7eb',
        borderRadius: 10,
        overflow: 'hidden',
        background: highlighted ? '#fafff8' : '#fff',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          background: highlighted ? '#ecfdf3' : '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{entry.label}</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{entry.phone}</div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
          Last {group.messages.length} message{group.messages.length === 1 ? '' : 's'} on this line
        </div>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {group.messages.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>No messages on this line.</p>
        ) : (
          group.messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </div>
    </section>
  );
}

export function ClientMessagesHistoryModal({
  open,
  clientId,
  clientLabel,
  openPhoneLine,
  onClose,
}: Props) {
  const [data, setData] = useState<ClientMessagesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { directory } = useOpenPhoneLineDirectory(open);

  useEffect(() => {
    if (!open || clientId == null) {
      setData(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let cancelled = false;
    const cached = getCachedClientMessages(clientId);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
      setData(null);
    }

    void (async () => {
      try {
        const res = await fetchClientMessagesCached(clientId, { refresh: Boolean(cached) });
        if (cancelled) return;
        setData(res);
      } catch (e: unknown) {
        if (cancelled) return;
        if (!cached) {
          const ax = e as { response?: { data?: { message?: string } }; message?: string };
          setError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to load messages');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  const lineGroups = useMemo(() => {
    if (!data?.messages?.length) return [];
    return groupClientMessagesByLine(data.messages, data.phoneNumber, CLIENT_MESSAGES_PER_LINE);
  }, [data]);

  const highlightedLineKey = useMemo(() => {
    const trimmed = openPhoneLine?.trim();
    if (!trimmed) return null;
    for (const group of lineGroups) {
      if (phonesMatchForQuo(group.linePhone, trimmed)) return group.lineKey;
    }
    for (const [key, entry] of directory) {
      if (directoryEntryMatchesPhone(entry, trimmed)) return key;
    }
    return null;
  }, [directory, lineGroups, openPhoneLine]);

  const orderedGroups = useMemo(() => {
    if (!highlightedLineKey) return lineGroups;
    const highlighted = lineGroups.filter((g) => g.lineKey === highlightedLineKey);
    const rest = lineGroups.filter((g) => g.lineKey !== highlightedLineKey);
    return [...highlighted, ...rest];
  }, [highlightedLineKey, lineGroups]);

  const lineCount = lineGroups.length;
  const totalMessages = data?.totalMessages ?? data?.messages.length ?? 0;

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-messages-history-title"
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
          width: 'min(800px, 90vw)',
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
            <h3 id="client-messages-history-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
              Messages history
            </h3>
            {clientLabel ? (
              <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: 14 }}>{clientLabel}</p>
            ) : null}
            {data ? (
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
                {lineCount} {phoneProviderDisplayName()} {lineCount === 1 ? 'line' : 'lines'} · {totalMessages}{' '}
                {totalMessages === 1 ? 'message' : 'messages'} total · up to {CLIENT_MESSAGES_PER_LINE}{' '}
                per line
                {refreshing ? ' · refreshing…' : ''}
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

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading messages…</div>
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

        {data && !loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {orderedGroups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
                No messages found for this client.
              </div>
            ) : (
              orderedGroups.map((group) => (
                <LineSection
                  key={group.lineKey}
                  group={group}
                  highlighted={group.lineKey === highlightedLineKey}
                  directory={directory}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
