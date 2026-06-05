import { createPortal } from 'react-dom';
import { smsAllowsProductionOverride } from '../utils/smsEnvironment';

type Props = {
  open: boolean;
  clientLabel: string;
  message: string;
  onMessageChange: (value: string) => void;
  onClose: () => void;
  onSend: (opts: { overrideNonProd: boolean }) => void;
  onOpenMessagesHistory: () => void;
  sending: boolean;
  sendError?: string | null;
  title?: string;
  subtitle?: string;
};

export function ClientSmsComposeModal({
  open,
  clientLabel,
  message,
  onMessageChange,
  onClose,
  onSend,
  onOpenMessagesHistory,
  sending,
  sendError,
  title = 'Text client',
  subtitle,
}: Props) {
  const allowOverride = smsAllowsProductionOverride();

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-sms-compose-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 16,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(600px, 90vw)',
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
            <h3 id="client-sms-compose-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
              {title}
            </h3>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              {subtitle ?? `Review and edit the message before sending to ${clientLabel}.`}
            </p>
          </div>
          <button
            type="button"
            className="btn-link"
            onClick={onOpenMessagesHistory}
            style={{
              flexShrink: 0,
              fontSize: 14,
              fontWeight: 600,
              color: '#4FB128',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Messages history
          </button>
        </div>

        {sendError ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
            {sendError}
          </p>
        ) : null}

        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Message</span>
          <textarea
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            disabled={sending}
            style={{
              width: '100%',
              minHeight: 200,
              padding: 12,
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
            placeholder="Enter your message…"
          />
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          {allowOverride ? (
            <button
              type="button"
              className="btn secondary"
              disabled={sending || !message.trim()}
              onClick={() => onSend({ overrideNonProd: true })}
              title="Send to the client's real number (non-production only)"
            >
              {sending ? 'Sending…' : 'Send to actual client'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={sending || !message.trim()}
            onClick={() => onSend({ overrideNonProd: false })}
          >
            {sending ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
