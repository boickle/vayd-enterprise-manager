import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sendClientSms } from '../api/clientSms';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchGmailMailboxes, fetchGmailSendAsAlias, gmailErrorMessage } from '../api/gmail';
import type { GmailSendAsAlias } from '../api/gmail';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { clientEmailsFromStaffPayload } from '../utils/clientEmailGmailSearch';
import {
  careOutreachSmsToEmail,
  forwardBookingSmsToEmail,
} from '../utils/clientOutreachEmailMessage';
import { smsAllowsProductionOverride } from '../utils/smsEnvironment';
import {
  buildComposeSendBodies,
  defaultFromAlias,
  extractEmail,
  formatFromAlias,
  loadSendAsAliases,
  signatureHtmlForFromAlias,
  submitCompose,
} from './gmail/gmailCompose';
import './gmail/GmailComposeModal.css';

type Channel = 'text' | 'email';

type EmailFormat = 'care_outreach' | 'forward_booking';

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel: string;
  initialSmsMessage: string;
  providerLastName?: string | null;
  emailFormat?: EmailFormat;
  canText: boolean;
  onClose: () => void;
  onOpenMessagesHistory?: () => void;
  onOpenEmailHistory?: () => void;
  smsFromLine?: string | null;
  /** Mark Quo/OpenPhone conversation done after send (forward booking outreach). */
  markInboxDone?: boolean;
};

function smsToEmailDraft(
  smsText: string,
  format: EmailFormat,
  providerLastName?: string | null,
): { subject: string; bodyText: string; bodyHtml: string } {
  return format === 'forward_booking'
    ? forwardBookingSmsToEmail(smsText)
    : careOutreachSmsToEmail(smsText, providerLastName);
}

export function ClientContactComposeModal({
  open,
  clientId,
  clientLabel,
  initialSmsMessage,
  providerLastName,
  emailFormat = 'care_outreach',
  canText,
  onClose,
  onOpenMessagesHistory,
  onOpenEmailHistory,
  smsFromLine,
  markInboxDone,
}: Props) {
  const { allowed: canEmail, loading: gmailAccessLoading } = useGmailInboxAccess();
  const allowSmsOverride = smsAllowsProductionOverride();

  const [channel, setChannel] = useState<Channel>('text');
  const [smsMessage, setSmsMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailLoadError, setEmailLoadError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [userBody, setUserBody] = useState('');

  const showText = canText;
  const showEmail = canEmail;

  useEffect(() => {
    if (!open) {
      setChannel('text');
      setSmsMessage('');
      setSending(false);
      setSendError(null);
      setEmailLoading(false);
      setEmailLoadError(null);
      setMailbox(null);
      setFrom('');
      setFromOptions([]);
      setSendAsAliases([]);
      setSignatureHtml('');
      setTo('');
      setSubject('');
      setUserBody('');
      return;
    }

    setSmsMessage(initialSmsMessage);
    setSendError(null);
    setChannel(canText ? 'text' : canEmail ? 'email' : 'text');
  }, [open, initialSmsMessage, canText, canEmail]);

  useEffect(() => {
    if (!open || channel !== 'email' || clientId == null || !canEmail) return;

    let cancelled = false;
    setEmailLoading(true);
    setEmailLoadError(null);

    const email = smsToEmailDraft(smsMessage, emailFormat, providerLastName);
    setSubject(email.subject);
    setUserBody(email.bodyText);

    void (async () => {
      try {
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
        const fromVal = defaultFromAlias(aliases, sendMailbox);
        setMailbox(sendMailbox);
        setSendAsAliases(aliases);
        setFromOptions(aliases.map((a) => formatFromAlias(a)));
        setFrom(fromVal);
        setSignatureHtml(signatureHtmlForFromAlias(aliases, fromVal));

        const sendAsEmail = extractEmail(fromVal);
        if (!signatureHtmlForFromAlias(aliases, fromVal)) {
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
              setSignatureHtml(detail.signature!.trim());
            })
            .catch(() => {
              /* signature optional */
            });
        }
      } catch (e: unknown) {
        if (!cancelled) setEmailLoadError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setEmailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, channel, clientId, canEmail, smsMessage, providerLastName, emailFormat]);

  const switchToEmail = () => {
    const email = smsToEmailDraft(smsMessage, emailFormat, providerLastName);
    setSubject(email.subject);
    setUserBody(email.bodyText);
    setChannel('email');
    setSendError(null);
  };

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
        setSignatureHtml(detail.signature!.trim());
      })
      .catch(() => {
        /* signature optional */
      });
  };

  const canSendText = showText && Boolean(clientId && smsMessage.trim()) && !sending;
  const canSendEmail =
    showEmail &&
    Boolean(mailbox && from.trim() && to.trim() && subject.trim() && userBody.trim()) &&
    !sending &&
    !emailLoading &&
    !emailLoadError;

  const handleSendText = async (overrideNonProd: boolean) => {
    if (!clientId || !canSendText) return;
    setSending(true);
    setSendError(null);
    try {
      await sendClientSms(clientId, {
        message: smsMessage.trim(),
        useRemindersFrom: true,
        ...(markInboxDone ? { markInboxDone: true } : {}),
        ...(overrideNonProd ? { overrideNonProd: true } : {}),
      });
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setSendError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to send text message.');
    } finally {
      setSending(false);
    }
  };

  const handleSendEmail = async () => {
    if (!mailbox || !canSendEmail) return;
    setSending(true);
    setSendError(null);
    try {
      const { bodyText, bodyHtml } = buildComposeSendBodies({
        userText: userBody,
        signatureHtml,
        quotedSuffix: '',
      });
      await submitCompose({
        mailbox,
        from,
        to,
        cc: '',
        subject: subject.trim(),
        bodyText,
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

  const showEmailSpinner = channel === 'email' && (emailLoading || gmailAccessLoading);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-contact-compose-title"
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
            <h3 id="client-contact-compose-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
              Contact client
            </h3>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              Review and edit the message before sending to {clientLabel}.
            </p>
            {channel === 'text' && smsFromLine?.trim() ? (
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
                From {smsFromLine.trim()}
              </p>
            ) : null}
            {channel === 'email' && mailbox ? (
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
                From {mailbox}
              </p>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {onOpenMessagesHistory && showText ? (
              <button
                type="button"
                className="btn-link"
                onClick={onOpenMessagesHistory}
                style={{
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
            ) : null}
            {onOpenEmailHistory && showEmail ? (
              <button
                type="button"
                className="btn-link"
                onClick={onOpenEmailHistory}
                style={{
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
        </div>

        {showText && showEmail ? (
          <div
            style={{
              display: 'inline-flex',
              marginBottom: 16,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setChannel('text');
                setSendError(null);
              }}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: channel === 'text' ? '#4FB128' : '#fff',
                color: channel === 'text' ? '#fff' : '#374151',
              }}
            >
              Text
            </button>
            <button
              type="button"
              onClick={switchToEmail}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                borderLeft: '1px solid #e5e7eb',
                cursor: 'pointer',
                background: channel === 'email' ? '#4FB128' : '#fff',
                color: channel === 'email' ? '#fff' : '#374151',
              }}
            >
              Email
            </button>
          </div>
        ) : null}

        {sendError ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
            {sendError}
          </p>
        ) : null}

        {channel === 'text' && showText ? (
          <label style={{ display: 'block', marginBottom: 20 }}>
            <span style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Message</span>
            <textarea
              value={smsMessage}
              onChange={(e) => setSmsMessage(e.target.value)}
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
        ) : null}

        {channel === 'email' && showEmail ? (
          <>
            {emailLoadError ? (
              <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
                {emailLoadError}
              </p>
            ) : null}

            {showEmailSpinner ? (
              <p className="settings-muted" style={{ margin: '0 0 16px' }}>
                Loading email…
              </p>
            ) : null}

            {!showEmailSpinner && !emailLoadError ? (
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
                    value={userBody}
                    onChange={(e) => setUserBody(e.target.value)}
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
                      }}
                      dangerouslySetInnerHTML={{ __html: signatureHtml }}
                    />
                  ) : null}
                </label>
              </>
            ) : null}
          </>
        ) : null}

        {!showText && !showEmail ? (
          <p className="settings-muted" style={{ margin: '0 0 16px' }}>
            No text or email contact options are available for your account.
          </p>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          {channel === 'text' && showText ? (
            <>
              {allowSmsOverride ? (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!canSendText}
                  onClick={() => void handleSendText(true)}
                  title="Send to the client's real number (non-production only)"
                >
                  {sending ? 'Sending…' : 'Send to actual client'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn primary"
                disabled={!canSendText}
                onClick={() => void handleSendText(false)}
              >
                {sending ? 'Sending…' : 'Send text'}
              </button>
            </>
          ) : null}
          {channel === 'email' && showEmail ? (
            <button
              type="button"
              className="btn primary"
              disabled={!canSendEmail}
              onClick={() => void handleSendEmail()}
            >
              {sending ? 'Sending…' : 'Send email'}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
