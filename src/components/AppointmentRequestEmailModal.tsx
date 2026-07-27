import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import {
  decodeGmailSnippet,
  fetchGmailMailboxes,
  fetchGmailSendAsAlias,
  fetchGmailThread,
  formatGmailAddress,
  gmailErrorMessage,
  latestNonDraftThreadMessage,
  threadLabelIds,
  type GmailSendAsAlias,
  type GmailThreadMessage,
} from '../api/gmail';
import { fetchAppointmentRequestGmailLink } from '../api/appointmentRequestSubmissions';
import {
  buildComposeDraft,
  buildComposeSendBodies,
  defaultFromAlias,
  extractEmail,
  formatFromAlias,
  loadSendAsAliases,
  plainTextFromHtml,
  signatureHtmlForFromAlias,
  submitCompose,
} from './gmail/gmailCompose';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import {
  clientDisplayNameFromRequestData,
  requestDataEmail,
} from '../utils/appointmentRequestDisplay';
import { resolveAppointmentRequestSmsMessage } from '../utils/appointmentRequestSmsMessage';
import '../pages/GmailInbox.css';
import './AppointmentRequestEmailModal.css';

export type AppointmentRequestEmailSentContext = {
  mailbox: string;
  threadId: string;
  messageId: string;
  labelIds: string[];
};

type Props = {
  item: AppointmentRequestSubmissionItem;
  practiceId: number;
  practiceTz: string;
  onClose: () => void;
  onSent?: (context: AppointmentRequestEmailSentContext | null) => void;
  onGmailLinked?: (patch: {
    gmailThreadId: string;
    gmailMailbox: string;
    gmailLinkedAt: string | null;
  }) => void;
};

function senderInitial(from: GmailThreadMessage['from']): string {
  const name = from.name?.trim();
  if (name) return name.charAt(0).toUpperCase();
  return (from.email.charAt(0) || '?').toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

const EMAIL_BODY_FONT =
  'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;';

/** Rich HTML + plain-text fallback for the outgoing reply, with signature + Gmail-style quote. */
function buildEmailBodies(
  message: string,
  original: GmailThreadMessage | null,
  signatureHtml: string,
): { html: string; text: string } {
  const { bodyText: withSigText, bodyHtml: withSigHtml } = buildComposeSendBodies({
    userText: message,
    signatureHtml,
    quotedSuffix: '',
  });
  let html =
    withSigHtml?.trim() ||
    `<div style="${EMAIL_BODY_FONT}">${plainTextToHtml(message.trim())}</div>`;
  let text = withSigText.trim() || message.trim();

  if (original) {
    const attribution = `On ${new Date(original.date).toLocaleString()}, ${formatGmailAddress(
      original.from,
    )} wrote:`;
    const originalHtml =
      original.body.html ?? plainTextToHtml(original.body.text ?? original.snippet);
    html +=
      `<br><div class="gmail_quote">` +
      `<div dir="ltr" style="${EMAIL_BODY_FONT}">${escapeHtml(attribution)}<br></div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">` +
      `${originalHtml}</blockquote></div>`;
    text += `\n\n---\n${attribution}\n${original.body.text ?? original.snippet}`;
  }

  return { html, text };
}

function applySignatureForFrom(
  mailbox: string,
  aliases: GmailSendAsAlias[],
  fromFormatted: string,
  setAliases: Dispatch<SetStateAction<GmailSendAsAlias[]>>,
  setSignatureHtml: (html: string) => void,
): void {
  const html = signatureHtmlForFromAlias(aliases, fromFormatted);
  setSignatureHtml(html);
  if (html) return;
  const sendAsEmail = extractEmail(fromFormatted);
  if (!sendAsEmail || !mailbox) return;
  void fetchGmailSendAsAlias(mailbox, sendAsEmail)
    .then((detail) => {
      if (!detail.signature?.trim()) return;
      setAliases((prev) =>
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

export function AppointmentRequestEmailModal({
  item,
  practiceId,
  practiceTz,
  onClose,
  onSent,
  onGmailLinked,
}: Props) {
  const clientLabel = clientDisplayNameFromRequestData(item.requestData ?? {});
  const clientEmail = requestDataEmail(item.requestData ?? {});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<GmailThreadMessage[]>([]);
  const [liaisonSubject, setLiaisonSubject] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [to, setTo] = useState(clientEmail ?? '');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [replyThreadId, setReplyThreadId] = useState<string | undefined>();
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadFound = threadMessages.length > 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setSignatureHtml('');
      setSendAsAliases([]);
      try {
        const [link, defaultMessage] = await Promise.all([
          fetchAppointmentRequestGmailLink(item.id),
          resolveAppointmentRequestSmsMessage(item, practiceTz, {
            practiceId,
            greeting: 'email',
          }),
        ]);
        if (cancelled) return;

        if (link.threadId && link.mailbox) {
          setLiaisonSubject(link.subject);
          onGmailLinked?.({
            gmailThreadId: link.threadId,
            gmailMailbox: link.mailbox,
            gmailLinkedAt: link.linkedAt,
          });
          const thread = await fetchGmailThread(link.mailbox, link.threadId);
          if (!cancelled) {
            setThreadMessages(thread.messages);
            const liaisonMessage = thread.messages[0];
            if (liaisonMessage) {
              const draft = buildComposeDraft({
                mode: 'reply',
                threadId: link.threadId,
                replyTo: liaisonMessage,
                mailboxEmail: link.mailbox,
              });
              setSubject(draft.subject);
              setReplyThreadId(draft.threadId ?? link.threadId);
              setInReplyTo(draft.inReplyTo);
              setReferences(draft.references);
              setBodyText(defaultMessage);
            } else {
              setBodyText(defaultMessage);
              setSubject(
                link.subject?.trim()
                  ? `Re: ${link.subject.replace(/^Re:\s*/i, '')}`
                  : 'Your appointment with Vet At Your Door',
              );
              setReplyThreadId(link.threadId);
            }
          }
        } else {
          setBodyText(defaultMessage);
          setSubject('Your appointment with Vet At Your Door');
        }

        if (link.mailbox) {
          setMailbox(link.mailbox);
        }

        const mailboxesRes =
          link.mailbox || item.gmailMailbox ? null : await fetchGmailMailboxes();
        const sendMailbox =
          link.mailbox ??
          item.gmailMailbox ??
          mailboxesRes?.mailboxes.find(
            (m) => m.connected && m.email === 'info@vetatyourdoor.com',
          )?.email ??
          mailboxesRes?.mailboxes.find((m) => m.connected)?.email ??
          null;
        if (sendMailbox) {
          const aliases = await loadSendAsAliases(sendMailbox);
          if (!cancelled) {
            const fromVal = defaultFromAlias(aliases, sendMailbox);
            setSendAsAliases(aliases);
            setFromOptions(aliases.map((a) => formatFromAlias(a)));
            setFrom(fromVal);
            setMailbox(sendMailbox);
            applySignatureForFrom(
              sendMailbox,
              aliases,
              fromVal,
              setSendAsAliases,
              setSignatureHtml,
            );
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per item
  }, [item.id, practiceId, practiceTz]);

  const handleFromChange = (nextFrom: string) => {
    setFrom(nextFrom);
    if (!mailbox) {
      setSignatureHtml(signatureHtmlForFromAlias(sendAsAliases, nextFrom));
      return;
    }
    applySignatureForFrom(mailbox, sendAsAliases, nextFrom, setSendAsAliases, setSignatureHtml);
  };

  const canSend = Boolean(
    mailbox && from.trim() && to.trim() && subject.trim() && bodyText.trim() && !sending && !loading,
  );

  const handleSend = async () => {
    if (!mailbox || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const { html, text } = buildEmailBodies(
        bodyText,
        threadMessages[0] ?? null,
        signatureHtml,
      );
      await submitCompose({
        mailbox,
        from,
        to,
        cc: '',
        subject,
        bodyText: text,
        bodyHtml: html,
        threadId: replyThreadId,
        inReplyTo,
        references,
      });
      let sentContext: AppointmentRequestEmailSentContext | null = null;
      if (mailbox && replyThreadId && threadMessages.length > 0) {
        const latest = latestNonDraftThreadMessage(threadMessages);
        if (latest) {
          sentContext = {
            mailbox,
            threadId: replyThreadId,
            messageId: latest.id,
            labelIds: threadLabelIds(threadMessages),
          };
        }
      }
      onSent?.(sentContext);
      onClose();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const threadHeadline = useMemo(() => {
    if (liaisonSubject) return liaisonSubject;
    return threadMessages[0]?.subject ?? 'Appointment request email';
  }, [liaisonSubject, threadMessages]);

  const signaturePlainPreview = signatureHtml ? plainTextFromHtml(signatureHtml) : '';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="appt-request-email-modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appt-request-email-title"
      onClick={onClose}
    >
      <div className="appt-request-email-modal" onClick={(e) => e.stopPropagation()}>
        <header className="appt-request-email-modal__header">
          <div>
            <h2 id="appt-request-email-title">Email client</h2>
            <p className="appt-request-email-modal__subtitle">
              {clientLabel}
              {clientEmail ? ` · ${clientEmail}` : ''}
            </p>
          </div>
          <button type="button" className="btn secondary" onClick={onClose} disabled={sending}>
            Close
          </button>
        </header>

        {loadError ? (
          <p className="appt-request-email-modal__error" role="alert">
            {loadError}
          </p>
        ) : null}

        {loading ? (
          <p className="settings-muted appt-request-email-modal__loading">Loading email…</p>
        ) : (
          <>
            <section className="appt-request-email-modal__thread-section" aria-label="Liaison email">
              <h3 className="appt-request-email-modal__section-title">Request notification</h3>
              {threadFound ? (
                <div className="appt-request-email-modal__thread-scroll">
                  <div className="gmail-message-view__head">
                    <h4 className="gmail-message-view__subject">{threadHeadline}</h4>
                  </div>
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
                              <span className="gmail-message-view__date">
                                {new Date(msg.date).toLocaleString(undefined, {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </span>
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
                </div>
              ) : (
                <p className="settings-muted appt-request-email-modal__thread-missing">
                  No matching liaison Gmail thread found yet. You can still email the client below.
                </p>
              )}
            </section>

            <section className="appt-request-email-modal__compose" aria-label="Compose email to client">
              <h3 className="appt-request-email-modal__section-title">Message to client</h3>
              {!clientEmail && !to.trim() ? (
                <p className="appt-request-email-modal__error" role="alert">
                  This request has no email address on file.
                </p>
              ) : null}
              {!mailbox ? (
                <p className="appt-request-email-modal__error" role="alert">
                  Connect a practice Gmail mailbox in Scout Email to send from Gmail.
                </p>
              ) : null}

              {sendError ? (
                <p className="appt-request-email-modal__error" role="alert">
                  {sendError}
                </p>
              ) : null}

              <div className="appt-request-email-modal__field">
                <label htmlFor="appt-request-email-from">From</label>
                {fromOptions.length > 0 ? (
                  <select
                    id="appt-request-email-from"
                    value={from}
                    onChange={(e) => handleFromChange(e.target.value)}
                    disabled={sending}
                  >
                    {fromOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="appt-request-email-from"
                    value={from}
                    onChange={(e) => handleFromChange(e.target.value)}
                    disabled={sending || !mailbox}
                  />
                )}
              </div>

              <div className="appt-request-email-modal__field">
                <label htmlFor="appt-request-email-to">To</label>
                <input
                  id="appt-request-email-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={sending}
                  placeholder="client@example.com"
                />
              </div>

              <div className="appt-request-email-modal__field">
                <label htmlFor="appt-request-email-subject">Subject</label>
                <input
                  id="appt-request-email-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={sending}
                />
              </div>

              <div className="appt-request-email-modal__field appt-request-email-modal__field--body">
                <label htmlFor="appt-request-email-body">Message</label>
                <textarea
                  id="appt-request-email-body"
                  rows={8}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  disabled={sending}
                  className={
                    signatureHtml
                      ? 'appt-request-email-modal__body-input appt-request-email-modal__body-input--with-sig'
                      : 'appt-request-email-modal__body-input'
                  }
                />
                {signatureHtml ? (
                  <div
                    className="appt-request-email-modal__signature"
                    aria-label="Email signature"
                    title={signaturePlainPreview || undefined}
                    dangerouslySetInnerHTML={{ __html: signatureHtml }}
                  />
                ) : null}
              </div>

              {threadMessages[0] ? (
                <div className="appt-request-email-modal__quote-preview">
                  <div className="appt-request-email-modal__quote-attribution">
                    On{' '}
                    {new Date(threadMessages[0].date).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    , {formatGmailAddress(threadMessages[0].from)} wrote:
                  </div>
                  <blockquote className="appt-request-email-modal__quote-block">
                    {threadMessages[0].body.html ? (
                      <div
                        className="gmail-thread-message__body gmail-thread-message__body--html"
                        dangerouslySetInnerHTML={{ __html: threadMessages[0].body.html }}
                      />
                    ) : (
                      <div className="gmail-thread-message__body">
                        {decodeGmailSnippet(
                          threadMessages[0].body.text ?? threadMessages[0].snippet,
                        )}
                      </div>
                    )}
                  </blockquote>
                </div>
              ) : null}
            </section>
          </>
        )}

        <footer className="appt-request-email-modal__footer">
          <button type="button" className="btn secondary" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSend}
            onClick={() => void handleSend()}
          >
            {sending ? 'Sending…' : 'Send email'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
