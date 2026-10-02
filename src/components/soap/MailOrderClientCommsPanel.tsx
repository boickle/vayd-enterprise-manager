import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { sendClientSms } from '../../api/clientSms';
import type { Message } from '../../api/clientPortal';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import {
  fetchClientMessagesCached,
  getCachedClientMessages,
} from '../../utils/clientMessagesCache';
import {
  groupClientMessagesByLine,
  messageTouchesClientPhone,
  practiceLineOnMessage,
} from '../../utils/clientMessagesByLine';
import {
  displayNameForQuoLine,
  resolveLineDirectoryEntry,
  useOpenPhoneLineDirectory,
} from '../../hooks/useOpenPhoneLineDirectory';
import { formatDisplayPhone, phonesMatchForQuo } from '../../utils/quoContact';
import { pharmacyMailAction, type MailOrder } from '../../api/onlineStore';
import { smsAllowsProductionOverride } from '../../utils/smsEnvironment';
import { ClientMessagesHistoryModal } from '../ClientMessagesHistoryModal';
import { ClientEmailHistoryModal } from '../ClientEmailHistoryModal';
import { fetchGmailMailboxes, fetchGmailSendAsAlias, gmailErrorMessage } from '../../api/gmail';
import type { GmailSendAsAlias } from '../../api/gmail';
import { useGmailInboxAccess } from '../../hooks/useGmailInboxAccess';
import { clientEmailsFromStaffPayload } from '../../utils/clientEmailGmailSearch';
import { defaultSharedMailbox, NO_SHARED_GMAIL_MESSAGE } from '../../utils/practiceGmailMailboxes';
import {
  composeBodiesFromUserContent,
  defaultFromAlias,
  extractEmail,
  formatFromAlias,
  isEmailBodyEmpty,
  loadSendAsAliases,
  signatureHtmlForFromAlias,
  submitCompose,
} from '../gmail/gmailCompose';

type Props = {
  practiceId: number;
  order: MailOrder;
  rxLinePhone: string;
  onOrderUpdated: (order: MailOrder) => void;
};

type Channel = 'text' | 'email';

const RX_PREVIEW = 5;

function isIncoming(message: Message): boolean {
  const dir = String(message.direction ?? '').toLowerCase();
  return dir === 'incoming' || dir === 'inbound';
}

function formatWhen(iso: string): string {
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toFormat('MMM d, h:mm a') : iso;
}

export default function MailOrderClientCommsPanel({
  practiceId,
  order,
  rxLinePhone,
  onOrderUpdated,
}: Props) {
  const allowOverride = smsAllowsProductionOverride();
  const { allowed: canEmail, loading: gmailAccessLoading } = useGmailInboxAccess();
  const { directory, lines: quoLines } = useOpenPhoneLineDirectory(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [clientPhones, setClientPhones] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [fromPhone, setFromPhone] = useState(rxLinePhone);
  const [toPhone, setToPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [busyHold, setBusyHold] = useState(false);
  const [overrideNonProd, setOverrideNonProd] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [emailHistoryOpen, setEmailHistoryOpen] = useState(false);
  const [showMoreRx, setShowMoreRx] = useState(false);
  const [channel, setChannel] = useState<Channel>('text');

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailLoadError, setEmailLoadError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [subject, setSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  useEffect(() => {
    setFromPhone(rxLinePhone || '');
  }, [rxLinePhone]);

  useEffect(() => {
    if (!order.clientId) return;
    let cancelled = false;
    const cached = getCachedClientMessages(order.clientId);
    if (cached?.messages?.length) setMessages(cached.messages);
    setLoading(true);
    setError(null);
    setShowMoreRx(false);
    void Promise.all([
      fetchClientMessagesCached(order.clientId, { refresh: true }),
      fetchClientByIdStaff(order.clientId).catch(() => null),
    ])
      .then(([res, client]) => {
        if (cancelled) return;
        setMessages(res.messages || []);
        const phones = [
          (client as { phone1?: string | null; phone2?: string | null } | null)?.phone1,
          (client as { phone1?: string | null; phone2?: string | null } | null)?.phone2,
        ]
          .map((p) => String(p || '').trim())
          .filter(Boolean);
        setClientPhones(phones);
        if (!toPhone && phones[0]) setToPhone(phones[0]);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load messages.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.clientId, order.id]);

  useEffect(() => {
    if (channel !== 'email' || !order.clientId || !canEmail) return;
    let cancelled = false;
    setEmailLoading(true);
    setEmailLoadError(null);

    void (async () => {
      try {
        const [clientRaw, mailboxesRes] = await Promise.all([
          fetchClientByIdStaff(order.clientId!),
          fetchGmailMailboxes(),
        ]);
        if (cancelled) return;

        const emails = clientEmailsFromStaffPayload(clientRaw);
        if (emails.length === 0) {
          throw new Error('No client email address on file.');
        }
        setEmailTo((prev) => prev || emails.join(', '));
        if (!subject.trim()) {
          setSubject(`Mail order #${order.id}`);
        }

        const sendMailbox = defaultSharedMailbox(mailboxesRes.mailboxes)?.email ?? null;
        if (!sendMailbox) {
          throw new Error(NO_SHARED_GMAIL_MESSAGE);
        }

        const aliases = await loadSendAsAliases(sendMailbox);
        if (cancelled) return;
        const fromVal = from || defaultFromAlias(aliases, sendMailbox);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, order.clientId, order.id, canEmail]);

  const groups = useMemo(() => {
    if (!clientPhones.length) return [];
    const grouped = groupClientMessagesByLine(messages, clientPhones, 20);
    if (!rxLinePhone) return grouped;
    return [...grouped].sort((a, b) => {
      const aRx = phonesMatchForQuo(a.linePhone, rxLinePhone) ? 0 : 1;
      const bRx = phonesMatchForQuo(b.linePhone, rxLinePhone) ? 0 : 1;
      if (aRx !== bRx) return aRx - bRx;
      return Date.parse(b.latestAt) - Date.parse(a.latestAt);
    });
  }, [messages, clientPhones, rxLinePhone]);

  const rxGroup = useMemo(() => {
    if (!rxLinePhone) return groups[0] ?? null;
    return (
      groups.find((group) => phonesMatchForQuo(group.linePhone, rxLinePhone)) || null
    );
  }, [groups, rxLinePhone]);

  const rxPreview = useMemo(() => {
    if (!rxGroup) return [];
    const ordered = [...rxGroup.messages].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    return showMoreRx ? ordered.slice(0, 15) : ordered.slice(0, RX_PREVIEW);
  }, [rxGroup, showMoreRx]);

  const pendingAt = order.clientQuestionPendingAt
    ? Date.parse(order.clientQuestionPendingAt)
    : 0;
  const clientReplied =
    pendingAt > 0 &&
    Boolean(rxLinePhone) &&
    messages.some((message) => {
      if (!isIncoming(message)) return false;
      if (Date.parse(message.createdAt) < pendingAt) return false;
      if (!clientPhones.some((phone) => messageTouchesClientPhone(message, phone))) {
        return false;
      }
      return phonesMatchForQuo(practiceLineOnMessage(message, clientPhones), rxLinePhone);
    });

  function handleFromChange(nextFrom: string) {
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
  }

  async function sendText() {
    if (!order.clientId || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendClientSms(order.clientId, {
        message: draft.trim(),
        to: toPhone || undefined,
        from: fromPhone || undefined,
        source: 'mail_order',
        practiceId,
        patientIds: [
          ...new Set(
            [order.patientId, ...(order.lines || []).map((line) => line.patientId)].filter(
              (id): id is number => id != null && id > 0,
            ),
          ),
        ],
        typeLabel: 'Mail order RX text',
        overrideNonProd: allowOverride ? overrideNonProd : undefined,
      });
      setDraft('');
      const refreshed = await fetchClientMessagesCached(order.clientId, { refresh: true });
      setMessages(refreshed.messages || []);
      const next = await pharmacyMailAction(practiceId, order.id, {
        action: 'pending_client',
        notes: 'Waiting on client reply (RX line)',
      });
      onOrderUpdated(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send text.');
    } finally {
      setSending(false);
    }
  }

  async function sendEmail() {
    if (!mailbox || !order.clientId) return;
    if (!from.trim() || !emailTo.trim() || !subject.trim() || isEmailBodyEmpty(emailBody)) return;
    setSending(true);
    setError(null);
    try {
      const { bodyText, bodyHtml } = composeBodiesFromUserContent({
        userContent: emailBody,
        signatureHtml,
      });
      await submitCompose({
        mailbox,
        from,
        to: emailTo,
        cc: '',
        subject: subject.trim(),
        bodyText,
        bodyHtml: bodyHtml || undefined,
      });
      setEmailBody('');
    } catch (e: unknown) {
      setError(gmailErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  async function setPending(pending: boolean) {
    setBusyHold(true);
    setError(null);
    try {
      const next = await pharmacyMailAction(practiceId, order.id, {
        action: pending ? 'pending_client' : 'clear_client_pending',
        notes: pending ? 'Pending client question' : 'Client question cleared',
      });
      onOrderUpdated(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update status.');
    } finally {
      setBusyHold(false);
    }
  }

  if (!order.clientId) {
    return (
      <div className="mail-queue__side-card">
        <h3>Client messages</h3>
        <p className="settings-muted" style={{ margin: 0 }}>
          No client on this order.
        </p>
      </div>
    );
  }

  const rxEntry = rxGroup
    ? resolveLineDirectoryEntry(directory, rxGroup.linePhone)
    : null;

  const canSendEmail =
    canEmail &&
    Boolean(mailbox && from.trim() && emailTo.trim() && subject.trim() && !isEmailBodyEmpty(emailBody)) &&
    !sending &&
    !emailLoading &&
    !emailLoadError;

  return (
    <div className="mail-queue__side-card">
      <h3>Text / email client</h3>
      {clientReplied ? (
        <p className="mail-queue__sent" role="status" style={{ marginTop: 0 }}>
          Client replied on RX line
        </p>
      ) : order.clientQuestionPendingAt ? (
        <p className="settings-muted" style={{ marginTop: 0, fontSize: 12 }}>
          Pending client question
        </p>
      ) : null}

      <div className="mail-queue__actions" style={{ marginBottom: 8, marginTop: 0 }}>
        {order.clientQuestionPendingAt ? (
          <button
            type="button"
            className="mail-queue__btn is-primary"
            disabled={busyHold}
            onClick={() => void setPending(false)}
          >
            Clear hold
          </button>
        ) : (
          <button
            type="button"
            className="mail-queue__btn"
            disabled={busyHold}
            onClick={() => void setPending(true)}
          >
            Mark pending
          </button>
        )}
        <button
          type="button"
          className="mail-queue__btn"
          onClick={() => setHistoryOpen(true)}
        >
          Texts
        </button>
        {canEmail ? (
          <button
            type="button"
            className="mail-queue__btn"
            onClick={() => setEmailHistoryOpen(true)}
          >
            Emails
          </button>
        ) : null}
      </div>

      <div className="mail-queue__channel" role="tablist" aria-label="Message channel">
        <button
          type="button"
          role="tab"
          aria-selected={channel === 'text'}
          className={channel === 'text' ? 'is-on' : undefined}
          onClick={() => setChannel('text')}
        >
          Text
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={channel === 'email'}
          className={channel === 'email' ? 'is-on' : undefined}
          disabled={!canEmail && !gmailAccessLoading}
          title={!canEmail && !gmailAccessLoading ? 'Gmail not available' : undefined}
          onClick={() => setChannel('email')}
        >
          Email
        </button>
      </div>

      {channel === 'text' ? (
        <>
          <label className="settings-label">
            From (RX line first)
            <select
              className="settings-input"
              value={fromPhone}
              onChange={(e) => setFromPhone(e.target.value)}
            >
              <option value="">Default line</option>
              {rxLinePhone ? (
                <option value={rxLinePhone}>
                  RX · {formatDisplayPhone(rxLinePhone) || rxLinePhone}
                </option>
              ) : null}
              {quoLines.map((line) => (
                <option key={line.phone} value={line.phone}>
                  {displayNameForQuoLine(line) || formatDisplayPhone(line.phone) || line.phone}
                </option>
              ))}
            </select>
          </label>
          {clientPhones.length > 1 ? (
            <label className="settings-label">
              To
              <select
                className="settings-input"
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
              >
                {clientPhones.map((phone) => (
                  <option key={phone} value={phone}>
                    {formatDisplayPhone(phone) || phone}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="settings-label">
            Message
            <textarea
              className="settings-input"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about dose, address, pickup timing…"
            />
          </label>
          {allowOverride ? (
            <label
              className="settings-label"
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <input
                type="checkbox"
                checked={overrideNonProd}
                onChange={(e) => setOverrideNonProd(e.target.checked)}
              />
              Send for real (non-prod)
            </label>
          ) : null}
          <div className="mail-queue__actions">
            <button
              type="button"
              className="mail-queue__btn is-primary"
              disabled={sending || !draft.trim()}
              onClick={() => void sendText()}
            >
              {sending ? 'Sending…' : 'Send text + wait'}
            </button>
          </div>
        </>
      ) : (
        <>
          {gmailAccessLoading || emailLoading ? (
            <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
              Loading send-as…
            </p>
          ) : null}
          {emailLoadError ? (
            <p className="settings-error-message" style={{ marginBottom: 8 }}>
              {emailLoadError}
            </p>
          ) : null}
          <label className="settings-label">
            Send as
            <select
              className="settings-input"
              value={from}
              disabled={!fromOptions.length || Boolean(emailLoadError)}
              onChange={(e) => handleFromChange(e.target.value)}
            >
              {!fromOptions.length ? <option value="">No aliases</option> : null}
              {fromOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-label">
            To
            <input
              className="settings-input"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="client@email.com"
            />
          </label>
          <label className="settings-label">
            Subject
            <input
              className="settings-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="settings-label">
            Message
            <textarea
              className="settings-input"
              rows={4}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Write your email…"
            />
          </label>
          {signatureHtml ? (
            <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
              Signature from send-as will be appended.
            </p>
          ) : null}
          <div className="mail-queue__actions">
            <button
              type="button"
              className="mail-queue__btn is-primary"
              disabled={!canSendEmail}
              onClick={() => void sendEmail()}
            >
              {sending ? 'Sending…' : 'Send email'}
            </button>
          </div>
        </>
      )}

      {error ? <p className="settings-error-message">{error}</p> : null}
      {loading && channel === 'text' ? (
        <p className="settings-muted" style={{ fontSize: 12 }}>
          Loading history…
        </p>
      ) : null}

      {channel === 'text' ? (
        <div className="mail-queue__notes" style={{ marginTop: 10 }}>
          <strong style={{ fontSize: 12 }}>
            {rxLinePhone
              ? `RX · ${
                  (rxEntry && displayNameForQuoLine(rxEntry)) ||
                  formatDisplayPhone(rxLinePhone) ||
                  rxLinePhone
                }`
              : 'Recent texts'}
          </strong>
          {!rxPreview.length && !loading ? (
            <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              No RX-line messages yet.
            </p>
          ) : null}
          {rxPreview.map((message) => (
            <div key={message.id} className="mail-queue__note" style={{ marginTop: 4 }}>
              <strong>
                {isIncoming(message) ? 'Client' : 'Clinic'} · {formatWhen(message.createdAt)}
              </strong>
              <div>{message.content}</div>
            </div>
          ))}
          {rxGroup && rxGroup.messages.length > RX_PREVIEW ? (
            <button
              type="button"
              className="mail-queue__pet-link"
              style={{
                marginTop: 6,
                background: 'none',
                border: 0,
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              }}
              onClick={() => setShowMoreRx((v) => !v)}
            >
              {showMoreRx ? 'Show less' : 'View more'}
            </button>
          ) : null}
        </div>
      ) : null}

      {!rxLinePhone && channel === 'text' ? (
        <p className="settings-muted" style={{ marginTop: 8, fontSize: 12 }}>
          Set the pharmacy RX Quo line under Settings → Mail shipping.
        </p>
      ) : null}

      <ClientMessagesHistoryModal
        open={historyOpen}
        clientId={order.clientId}
        clientLabel={order.customerName}
        openPhoneLine={rxLinePhone || null}
        onClose={() => setHistoryOpen(false)}
      />
      {canEmail ? (
        <ClientEmailHistoryModal
          open={emailHistoryOpen}
          clientId={order.clientId}
          clientLabel={order.customerName}
          onClose={() => setEmailHistoryOpen(false)}
        />
      ) : null}
    </div>
  );
}
