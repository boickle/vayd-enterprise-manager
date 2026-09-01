import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X } from 'lucide-react';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import {
  fetchGmailMailboxes,
  fetchGmailSendAsAlias,
  gmailErrorMessage,
  mailboxDisplayLabel,
  type GmailComposeAttachment,
  type GmailMailboxStatus,
  type GmailSendAsAlias,
} from '../api/gmail';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { clientEmailsFromStaffPayload } from '../utils/clientEmailGmailSearch';
import {
  defaultSharedMailbox,
  NO_SHARED_GMAIL_MESSAGE,
  sharedConnectedMailboxes,
} from '../utils/practiceGmailMailboxes';
import {
  composeBodiesFromUserContent,
  defaultFromAlias,
  extractEmail,
  formatFromAlias,
  isEmailBodyEmpty,
  loadSendAsAliases,
  signatureHtmlForFromAlias,
  submitCompose,
} from './gmail/gmailCompose';
import MessageTemplatePicker from './messageTemplates/MessageTemplatePicker';
import MessageTemplateHtmlEditor from './messageTemplates/MessageTemplateHtmlEditor';
import { mergeValuesFromNames, type MergeValues } from '../utils/messageTemplateFields';

export type EmailRegardingPatient = { id: number; name: string };

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel: string;
  initialSubject: string;
  initialBodyText: string;
  mergeValues?: MergeValues;
  title?: string;
  initialAttachments?: GmailComposeAttachment[];
  regardingPatients?: EmailRegardingPatient[];
  regardingPatientId?: number | null;
  onRegardingPatientIdChange?: (id: number | null) => void;
  regardingPatientIds?: number[];
  onRegardingPatientIdsChange?: (ids: number[]) => void;
  /** Invoice/receipt-style logging: client comms by default, EMR only if checked. */
  patientEmrLogging?: 'default' | 'opt-in';
  includeInPatientEmr?: boolean;
  onIncludeInPatientEmrChange?: (next: boolean) => void;
  onAfterSend?: (sent: {
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    to: string;
    from: string;
  }) => Promise<void> | void;
  onClose: () => void;
  onOpenEmailHistory?: () => void;
};

export function ClientEmailComposeModal({
  open,
  clientId,
  clientLabel,
  initialSubject,
  initialBodyText,
  mergeValues,
  title = 'Email client',
  initialAttachments,
  regardingPatients,
  regardingPatientId,
  onRegardingPatientIdChange,
  regardingPatientIds,
  onRegardingPatientIdsChange,
  patientEmrLogging = 'default',
  includeInPatientEmr = false,
  onIncludeInPatientEmrChange,
  onAfterSend,
  onClose,
  onOpenEmailHistory,
}: Props) {
  const { allowed: gmailAllowed, loading: gmailAccessLoading } = useGmailInboxAccess();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [sharedInboxes, setSharedInboxes] = useState<GmailMailboxStatus[]>([]);
  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [attachments, setAttachments] = useState<GmailComposeAttachment[]>([]);

  async function applySharedMailbox(sendMailbox: string, cancelled = false) {
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
              a.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase() ? { ...a, ...detail } : a,
            ),
          );
          setSignatureHtml(detail.signature.trim());
        })
        .catch(() => {
          /* signature optional */
        });
    }
  }

  useEffect(() => {
    if (!open || clientId == null) {
      setLoading(false);
      setSending(false);
      setLoadError(null);
      setSendError(null);
      setMailbox(null);
      setSharedInboxes([]);
      setFrom('');
      setFromOptions([]);
      setSendAsAliases([]);
      setSignatureHtml('');
      setTo('');
      setSubject('');
      setBodyText('');
      setAttachments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSendError(null);
    setSignatureHtml('');
    setSubject(initialSubject);
    setBodyText(initialBodyText);
    setAttachments(initialAttachments ?? []);

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

        const shared = sharedConnectedMailboxes(mailboxesRes.mailboxes);
        const sendMailbox = defaultSharedMailbox(shared)?.email ?? null;
        if (!sendMailbox) {
          throw new Error(NO_SHARED_GMAIL_MESSAGE);
        }
        setSharedInboxes(shared);
        await applySharedMailbox(sendMailbox, cancelled);
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

  const emrPetsReady =
    patientEmrLogging !== 'opt-in' ||
    !includeInPatientEmr ||
    (regardingPatientIds ?? []).length > 0;

  const canSend =
    Boolean(mailbox && from.trim() && to.trim() && subject.trim() && !isEmailBodyEmpty(bodyText)) &&
    emrPetsReady &&
    !sending &&
    !loading;

  const handleSend = async () => {
    if (!mailbox || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const { bodyText: text, bodyHtml } = composeBodiesFromUserContent({
        userContent: bodyText,
        signatureHtml,
      });
      await submitCompose({
        mailbox,
        from,
        to,
        cc: '',
        subject: subject.trim(),
        bodyText: text,
        bodyHtml: bodyHtml || undefined,
        attachments,
      });
      await onAfterSend?.({
        subject: subject.trim(),
        bodyText: text,
        bodyHtml: bodyHtml || undefined,
        to,
        from,
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
              {title}
            </h3>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              Review and edit the email before sending to {clientLabel}.
            </p>
            {mailbox && sharedInboxes.length === 1 ? (
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
                Through {mailboxDisplayLabel(sharedInboxes[0])} · {mailbox}
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
            <MessageTemplatePicker
              channel="email"
              mergeValues={mergeValues ?? mergeValuesFromNames({ clientFullName: clientLabel })}
              disabled={sending}
              currentSubject={subject}
              currentBody={bodyText}
              onApply={({ subject: nextSubject, body }) => {
                if (nextSubject.trim()) setSubject(nextSubject);
                setBodyText(body);
              }}
            />
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

            {sharedInboxes.length > 1 ? (
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
                  Inbox
                </span>
                <select
                  value={mailbox ?? ''}
                  disabled={sending}
                  className="settings-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!next || next === mailbox) return;
                    setSendError(null);
                    void applySharedMailbox(next).catch((err: unknown) => {
                      setSendError(gmailErrorMessage(err));
                    });
                  }}
                >
                  {sharedInboxes.map((mb) => (
                    <option key={mb.email} value={mb.email}>
                      {mailboxDisplayLabel(mb)} · {mb.email}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
                From
              </span>
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

            {patientEmrLogging === 'opt-in' ? (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={includeInPatientEmr}
                    disabled={sending}
                    onChange={(e) => onIncludeInPatientEmrChange?.(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>Include in patient EMR</strong>
                    <span style={{ display: 'block', color: '#6b7280', fontSize: 13, marginTop: 2 }}>
                      Saved to client communications. Check this only if this belongs on a medical
                      record.
                    </span>
                  </span>
                </label>
                {includeInPatientEmr && regardingPatients && regardingPatients.length > 0 ? (
                  <fieldset
                    style={{
                      marginTop: 10,
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <legend style={{ fontSize: 14, fontWeight: 600, padding: '0 4px' }}>
                      Put on these patient charts
                    </legend>
                    <p style={{ margin: '0 0 8px', color: '#6b7280', fontSize: 13 }}>
                      Choose every pet this invoice or receipt belongs on. One household visit can
                      include more than one.
                    </p>
                    {regardingPatients.map((p) => {
                      const checked = (regardingPatientIds ?? []).includes(p.id);
                      return (
                        <label
                          key={p.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 14 }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={sending}
                            onChange={() => {
                              const cur = regardingPatientIds ?? [];
                              onRegardingPatientIdsChange?.(
                                checked ? cur.filter((id) => id !== p.id) : [...cur, p.id],
                              );
                            }}
                          />
                          {p.name}
                        </label>
                      );
                    })}
                    {(regardingPatientIds ?? []).length === 0 ? (
                      <p style={{ margin: '4px 0 0', color: '#b45309', fontSize: 13 }}>
                        Select at least one pet.
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}
              </div>
            ) : regardingPatients && regardingPatients.length > 0 ? (
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
                  This is about
                </span>
                <select
                  className="settings-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={regardingPatientId ?? ''}
                  disabled={sending}
                  onChange={(e) =>
                    onRegardingPatientIdChange?.(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Household / clerical (client record)</option>
                  {regardingPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (patient chart)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Message</span>
              <MessageTemplateHtmlEditor
                value={bodyText}
                disabled={sending}
                placeholder="Enter your message…"
                onChange={setBodyText}
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
            <div style={{ marginBottom: 20 }}>
              <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
                Attachments
              </span>
              {attachments.length ? (
                <ul style={{ margin: '0 0 8px', padding: 0, listStyle: 'none' }}>
                  {attachments.map((file, idx) => (
                    <li
                      key={`${file.filename}-${idx}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}
                    >
                      <Paperclip size={14} />
                      <span>{file.filename}</span>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={sending}
                        aria-label={`Remove ${file.filename}`}
                        onClick={() => setAttachments((cur) => cur.filter((_, i) => i !== idx))}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: '0 0 8px', color: '#6b7280', fontSize: 13 }}>None yet.</p>
              )}
              <label className="btn secondary" style={{ display: 'inline-flex', cursor: sending ? 'default' : 'pointer' }}>
                Add attachment
                <input
                  type="file"
                  multiple
                  disabled={sending}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void Promise.all(
                      files.map(
                        (file) =>
                          new Promise<GmailComposeAttachment>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                              const result = String(reader.result || '');
                              const contentBase64 = result.split(',')[1] || '';
                              if (!contentBase64) {
                                reject(new Error(`Could not read ${file.name}`));
                                return;
                              }
                              resolve({
                                filename: file.name,
                                mimeType: file.type || 'application/octet-stream',
                                contentBase64,
                              });
                            };
                            reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
                            reader.readAsDataURL(file);
                          }),
                      ),
                    )
                      .then((added) => setAttachments((cur) => [...cur, ...added]))
                      .catch((err: unknown) =>
                        setSendError(err instanceof Error ? err.message : 'Could not add attachment.'),
                      );
                  }}
                />
              </label>
            </div>
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
