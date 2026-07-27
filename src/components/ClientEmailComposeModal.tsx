import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import {
  fetchGmailMailboxes,
  fetchGmailSendAsAlias,
  gmailErrorMessage,
  type GmailSendAsAlias,
} from '../api/gmail';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { clientEmailsFromStaffPayload } from '../utils/clientEmailGmailSearch';
import {
  buildComposeSendBodies,
  defaultFromAlias,
  extractEmail,
  formatFromAlias,
  loadSendAsAliases,
  signatureHtmlForFromAlias,
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
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
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
      setSendAsAliases([]);
      setSignatureHtml('');
      setTo('');
      setSubject('');
      setBodyText('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSendError(null);
    setSignatureHtml('');
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
          throw new Error(
            'No Gmail mailboxes are connected. Open Scout Email — shared inboxes connect automatically when configured; personal mailboxes still need OAuth once.',
          );
        }

        const aliases = await loadSendAsAliases(sendMailbox);
        if (cancelled) return;
        const fromVal = defaultFromAlias(aliases, sendMailbox);
        setMailbox(sendMailbox);
        setSendAsAliases(aliases);
        setFromOptions(aliases.map((a) => formatFromAlias(a)));
        setFrom(fromVal);
        setSignatureHtml(signatureHtmlForFromAlias(aliases, fromVal));

        const sendAsEmail = extractEmail(fromVal);
        if (!signatureHtmlForFromAlias(aliases, fromVal) && sendAsEmail) {
          void fetchGmailSendAsAlias(sendMailbox, sendAsEmail)
            .then((detail) => {
              if (cancelled || !detail.signature?.trim()) return;
              setSendAsAliases((prev) =>
                prev.map((a) =>
                  a.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase()
                    ? { ...a, ...detail }
                    : a,
                ),
              );
              setSignatureHtml(detail.signature.trim());
            })
            .catch(() => {
              /* signature optional */
            });
        }
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

  const handleFromChange = (nextFrom: string) => {
    setFrom(nextFrom);
    const html = signatureHtmlForFromAlias(sendAsAliases, nextFrom);
    setSignatureHtml(html);
    if (html || !mailbox) return;
    const sendAsEmail = extractEmail(nextFrom);
    void fetchGmailSendAsAlias(mailbox, sendAsEmail)
      .then((detail) => {
        if (!detail.signature?.trim()) return;
        setSendAsAliases((prev) =>
          prev.map((a) =>
            a.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase() ? { ...a, ...detail } : a,
          ),
        );
        setSignatureHtml(detail.signature.trim());
      })
      .catch(() => {
        /* signature optional */
      });
  };

  const canSend =
    Boolean(mailbox && from.trim() && to.trim() && subject.trim() && bodyText.trim()) &&
    !sending &&
    !loading;

  const handleSend = async () => {
    if (!mailbox || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const { bodyText: text, bodyHtml } = buildComposeSendBodies({
        userText: bodyText,
        signatureHtml,
        quotedSuffix: '',
      });
      await submitCompose({
        mailbox,
        from,
        to,
        cc: '',
        subject: subject.trim(),
        bodyText: text,
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
                  onChange={(e) => handleFromChange(e.target.value)}
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
                  onChange={(e) => handleFromChange(e.target.value)}
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
                  borderRadius: signatureHtml ? '8px 8px 0 0' : 8,
                  fontSize: 14,
                  lineHeight: 1.6,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                placeholder="Enter your message…"
              />
              {signatureHtml ? (
                <div
                  className="gmail-compose-panel__signature"
                  style={{
                    border: '1px solid #e5e7eb',
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    background: '#f9fafb',
                    padding: '10px 12px',
                  }}
                  dangerouslySetInnerHTML={{ __html: signatureHtml }}
                />
              ) : null}
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
