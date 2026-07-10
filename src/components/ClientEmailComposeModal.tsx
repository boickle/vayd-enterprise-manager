import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchGmailMailboxes, gmailErrorMessage } from '../api/gmail';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { clientEmailsFromStaffPayload } from '../utils/clientEmailGmailSearch';
import { plainTextToClientEmailHtml } from '../utils/clientOutreachEmailMessage';
import {
  defaultFromAlias,
  formatFromAlias,
  loadSendAsAliases,
  submitCompose,
} from './gmail/gmailCompose';

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel: string;
  initialSubject: string;
  initialBodyText: string;
  onClose: () => void;
  onOpenEmailHistory?: () => void;
};

export function ClientEmailComposeModal({
  open,
  clientId,
  clientLabel,
  initialSubject,
  initialBodyText,
  onClose,
  onOpenEmailHistory,
}: Props) {
  const { allowed: gmailAllowed, loading: gmailAccessLoading } = useGmailInboxAccess();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');

  useEffect(() => {
    if (!open || clientId == null) {
      setLoading(false);
      setSending(false);
      setLoadError(null);
      setSendError(null);
      setMailbox(null);
      setFrom('');
      setFromOptions([]);
      setTo('');
      setSubject('');
      setBodyText('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSendError(null);
    setSubject(initialSubject);
    setBodyText(initialBodyText);

    void (async () => {
      try {
        if (!gmailAllowed) {
          throw new Error('Gmail access is not available for your account.');
        }
        const [clientRaw, mailboxesRes] = await Promise.all([
          fetchClientByIdStaff(clientId),
          fetchGmailMailboxes(),
        ]);
        if (cancelled) return;

        const emails = clientEmailsFromStaffPayload(clientRaw);
        if (emails.length === 0) {
          throw new Error('No client email address on file.');
        }
        setTo(emails.join(', '));

        const connected = (mailboxesRes.mailboxes ?? []).filter((mb) => mb.connected);
        const sendMailbox =
          connected.find((mb) => mb.email.toLowerCase() === 'info@vetatyourdoor.com')?.email ??
          connected[0]?.email ??
          null;
        if (!sendMailbox) {
          throw new Error('No Gmail mailboxes are connected. Connect OAuth in Scout Email first.');
        }

        const aliases = await loadSendAsAliases(sendMailbox);
        if (cancelled) return;
        setMailbox(sendMailbox);
        setFromOptions(aliases.map((a) => formatFromAlias(a)));
        setFrom(defaultFromAlias(aliases, sendMailbox));
      } catch (e: unknown) {
        if (!cancelled) setLoadError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, clientId, initialSubject, initialBodyText, gmailAllowed]);

  const canSend =
    Boolean(mailbox && from.trim() && to.trim() && subject.trim() && bodyText.trim()) &&
    !sending &&
    !loading;

  const handleSend = async () => {
    if (!mailbox || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const bodyHtml = plainTextToClientEmailHtml(bodyText);
      await submitCompose({
        mailbox,
        from,
        to,
        cc: '',
        subject: subject.trim(),
        bodyText: bodyText.trim(),
        bodyHtml: bodyHtml || undefined,
      });
      onClose();
    } catch (e: unknown) {
      setSendError(gmailErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const showSpinner = loading || gmailAccessLoading;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-email-compose-title"
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
          width: 'min(640px, 92vw)',
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
            <h3 id="client-email-compose-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
              Email client
            </h3>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              Review and edit the email before sending to {clientLabel}.
            </p>
            {mailbox ? (
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
                From {mailbox}
              </p>
            ) : null}
          </div>
          {onOpenEmailHistory ? (
            <button
              type="button"
              className="btn-link"
              onClick={onOpenEmailHistory}
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
              Email history
            </button>
          ) : null}
        </div>

        {loadError ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
            {loadError}
          </p>
        ) : null}

        {sendError ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
            {sendError}
          </p>
        ) : null}

        {showSpinner ? (
          <p className="settings-muted" style={{ margin: '0 0 16px' }}>
            Loading email…
          </p>
        ) : null}

        {!showSpinner && !loadError ? (
          <>
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>To</span>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={sending}
                className="settings-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>From</span>
              {fromOptions.length > 0 ? (
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={sending}
                  className="settings-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                >
                  {fromOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={sending}
                  className="settings-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              )}
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
                className="settings-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Message</span>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                disabled={sending}
                rows={10}
                style={{
                  width: '100%',
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
          </>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!canSend} onClick={() => void handleSend()}>
            {sending ? 'Sending…' : 'Send email'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
