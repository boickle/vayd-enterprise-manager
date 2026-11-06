import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, MessageSquare, X } from 'lucide-react';
import { sendClientSms } from '../../api/clientSms';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import {
  fetchGmailMailboxes,
  fetchGmailSendAsAlias,
  gmailErrorMessage,
  mailboxDisplayLabel,
} from '../../api/gmail';
import type { GmailMailboxStatus, GmailSendAsAlias } from '../../api/gmail';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import { useGmailInboxAccess } from '../../hooks/useGmailInboxAccess';
import { clientEmailsFromStaffPayload } from '../../utils/clientEmailGmailSearch';
import {
  defaultSharedMailbox,
  NO_SHARED_GMAIL_MESSAGE,
  sharedConnectedMailboxes,
} from '../../utils/practiceGmailMailboxes';
import { smsAllowsProductionOverride } from '../../utils/smsEnvironment';
import {
  composeBodiesFromUserContent,
  defaultFromAlias,
  isEmailBodyEmpty,
  extractEmail,
  formatFromAlias,
  loadSendAsAliases,
  signatureHtmlForFromAlias,
  submitCompose,
} from '../gmail/gmailCompose';
import MessageTemplatePicker from '../messageTemplates/MessageTemplatePicker';
import MessageTemplateHtmlEditor from '../messageTemplates/MessageTemplateHtmlEditor';
import { mergeValuesFromNames } from '../../utils/messageTemplateFields';
import { htmlToMultilinePlain } from '../../utils/messageTemplateHtml';
import { looksLikeHtmlFragment } from '../../utils/sanitizeCommunicationHtml';

type Channel = 'sms' | 'email';

type Props = {
  patientId: number;
  clientId: number;
  patientName: string;
  clientName: string;
  canText: boolean;
  onClose: () => void;
  onSent: () => void;
};

export function PimsChartMessageComposeModal({
  patientId,
  clientId,
  patientName,
  clientName,
  canText,
  onClose,
  onSent,
}: Props) {
  const { allowed: canEmail } = useGmailInboxAccess();
  const allowSmsOverride = smsAllowsProductionOverride();
  const [channel, setChannel] = useState<Channel>(canText ? 'sms' : 'email');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState(`${patientName} — note from the clinic`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideNonProd, setOverrideNonProd] = useState(false);
  const [includeOnMedicalRecord, setIncludeOnMedicalRecord] = useState(false);

  const [mailbox, setMailbox] = useState<string | null>(null);
  const [sharedInboxes, setSharedInboxes] = useState<GmailMailboxStatus[]>([]);
  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [to, setTo] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  useEffect(() => {
    if (channel !== 'email' || !canEmail) return;
    let cancelled = false;
    setEmailLoading(true);
    setError(null);
    void (async () => {
      try {
        const [clientRaw, mailboxesRes] = await Promise.all([
          fetchClientByIdStaff(clientId),
          fetchGmailMailboxes(),
        ]);
        if (cancelled) return;
        const emails = clientEmailsFromStaffPayload(clientRaw);
        if (emails.length === 0) throw new Error('No client email address on file.');
        setTo(emails.join(', '));
        const shared = sharedConnectedMailboxes(mailboxesRes.mailboxes);
        const sendMailbox = defaultSharedMailbox(shared)?.email ?? null;
        if (!sendMailbox) {
          throw new Error(NO_SHARED_GMAIL_MESSAGE);
        }
        setSharedInboxes(shared);
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
              setSignatureHtml(detail.signature!.trim());
            })
            .catch(() => {
              /* optional */
            });
        }
      } catch (e: unknown) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setEmailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel, canEmail, clientId]);

  async function send() {
    const smsText = looksLikeHtmlFragment(body) ? htmlToMultilinePlain(body) : body.trim();
    if (channel === 'sms' ? !smsText : isEmailBodyEmpty(body) || sending) return;
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      if (channel === 'sms') {
        await sendClientSms(clientId, {
          message: smsText,
          useRemindersFrom: true,
          source: 'chart',
          ...(overrideNonProd ? { overrideNonProd: true } : {}),
        });
        await recordScoutChartCommunication({
          patientId,
          clientId,
          channel: 'sms',
          body: smsText,
          includeOnMedicalRecord,
        });
      } else {
        if (!mailbox || !from.trim() || !to.trim()) {
          throw new Error('Email is not ready to send.');
        }
        const { bodyText, bodyHtml } = composeBodiesFromUserContent({
          userContent: body,
          signatureHtml,
        });
        await submitCompose({
          mailbox,
          from,
          to,
          cc: '',
          subject: subject.trim() || `${patientName} — note from the clinic`,
          bodyText,
          bodyHtml: bodyHtml || undefined,
        });
        await recordScoutChartCommunication({
          patientId,
          clientId,
          channel: 'email',
          body: bodyHtml || bodyText,
          subject: subject.trim() || undefined,
          destination: to,
          sentFrom: from,
          includeOnMedicalRecord,
        });
      }
      onSent();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-chart-msg-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card pims-chart-compose">
        <div className="pims-chart-pick__head">
          <div>
            <h3 id="pims-chart-msg-title">Message · {clientName}</h3>
            <p className="pims-chart-compose__hint">
              One message. Send as text or email. Saved for your workflow — not on the medical
              record unless you check the box below.
            </p>
          </div>
          <button type="button" className="pims-chart-pick__close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="pims-chart-compose__channels" role="tablist">
          <button
            type="button"
            role="tab"
            className={`brief-btn${channel === 'sms' ? ' primary' : ''}`}
            disabled={!canText}
            aria-selected={channel === 'sms'}
            onClick={() => {
              setChannel('sms');
              if (looksLikeHtmlFragment(body)) setBody(htmlToMultilinePlain(body));
            }}
          >
            <MessageSquare size={14} aria-hidden />
            Text
          </button>
          <button
            type="button"
            role="tab"
            className={`brief-btn${channel === 'email' ? ' primary' : ''}`}
            disabled={!canEmail}
            aria-selected={channel === 'email'}
            onClick={() => setChannel('email')}
          >
            <Mail size={14} aria-hidden />
            Email
          </button>
        </div>

        <MessageTemplatePicker
          channel={channel === 'sms' ? 'sms' : 'email'}
          mergeValues={mergeValuesFromNames({
            clientFullName: clientName,
            patientName,
          })}
          disabled={sending}
          currentSubject={subject}
          currentBody={body}
          onApply={({ subject: nextSubject, body: nextBody }) => {
            if (nextSubject.trim()) setSubject(nextSubject);
            setBody(nextBody);
          }}
        />

        {channel === 'email' ? (
          <label className="pims-chart-compose__field">
            <span>Subject</span>
            <input
              className="pims-chart-compose__input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
        ) : null}
        {channel === 'email' && sharedInboxes.length > 1 ? (
          <label className="pims-chart-compose__field">
            <span>Inbox</span>
            <select
              className="pims-chart-compose__input"
              value={mailbox ?? ''}
              disabled={sending || emailLoading}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setMailbox(next);
                setEmailLoading(true);
                void loadSendAsAliases(next)
                  .then((aliases) => {
                    const fromVal = defaultFromAlias(aliases, next);
                    setSendAsAliases(aliases);
                    setFromOptions(aliases.map((a) => formatFromAlias(a)));
                    setFrom(fromVal);
                    setSignatureHtml(signatureHtmlForFromAlias(aliases, fromVal));
                  })
                  .catch((err: unknown) => setError(gmailErrorMessage(err)))
                  .finally(() => setEmailLoading(false));
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
        {channel === 'email' && fromOptions.length > 1 ? (
          <label className="pims-chart-compose__field">
            <span>From</span>
            <select
              className="pims-chart-compose__input"
              value={from}
              disabled={sending}
              onChange={(e) => setFrom(e.target.value)}
            >
              {fromOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {channel === 'email' && to ? (
          <p className="pims-chart-compose__meta">To {to}</p>
        ) : null}

        {channel === 'email' ? (
          <MessageTemplateHtmlEditor
            value={body}
            disabled={sending}
            placeholder="Write the message…"
            onChange={setBody}
          />
        ) : (
          <textarea
            className="pims-chart-compose__textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the message…"
            autoFocus
            rows={10}
          />
        )}

        {error ? <p className="pims-chart-compose__error">{error}</p> : null}
        <label className="pims-chart-compose__override">
          <input
            type="checkbox"
            checked={includeOnMedicalRecord}
            onChange={(e) => setIncludeOnMedicalRecord(e.target.checked)}
          />
          Add this message to the medical record
        </label>
        {allowSmsOverride && channel === 'sms' ? (
          <label className="pims-chart-compose__override">
            <input
              type="checkbox"
              checked={overrideNonProd}
              onChange={(e) => setOverrideNonProd(e.target.checked)}
            />
            Send to the actual client
          </label>
        ) : null}

        <div className="pims-chart-pick__foot pims-chart-compose__foot">
          <button type="button" className="brief-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="brief-btn primary"
            disabled={
              sending ||
              emailLoading ||
              (channel === 'sms' ? !body.trim() || !canText : isEmailBodyEmpty(body) || !canEmail)
            }
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : channel === 'sms' ? 'Send text' : 'Send email'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
