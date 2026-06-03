import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { fetchClientMessages, type ClientMessagesResponse } from '../api/clientPortal';

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel?: string;
  onClose: () => void;
};

export function ClientMessagesHistoryModal({ open, clientId, clientLabel, onClose }: Props) {
  const [data, setData] = useState<ClientMessagesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || clientId == null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void (async () => {
      try {
        const res = await fetchClientMessages(clientId);
        if (cancelled) return;
        setData({
          ...res,
          messages: res.messages.slice(0, 50),
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const ax = e as { response?: { data?: { message?: string } }; message?: string };
        setError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

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
                {data.totalMessages} {data.totalMessages === 1 ? 'message' : 'messages'} total
                {data.totalMessages > 50 ? ' (showing most recent 50)' : ''}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
                No messages found for this client.
              </div>
            ) : (
              data.messages.map((message) => {
                const isIncoming = message.direction === 'incoming';
                const createdAt = DateTime.fromISO(message.createdAt);
                const formattedDate = createdAt.isValid
                  ? createdAt.toFormat('MMM dd, yyyy h:mm a')
                  : message.createdAt;
                return (
                  <div
                    key={message.id}
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
              })
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
