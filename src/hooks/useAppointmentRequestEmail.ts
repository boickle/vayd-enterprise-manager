/**
 * The request's Gmail thread for the Appointments conversation panel: loads the thread, works out
 * where a reply goes (same thread, same mailbox, default send-as alias and signature), and sends.
 * Same rules as the Email client pop-up (AppointmentRequestEmailModal).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchGmailMailboxes,
  fetchGmailThread,
  gmailErrorMessage,
  latestNonDraftThreadMessage,
  threadLabelIds,
  type GmailSendAsAlias,
  type GmailThreadMessage,
} from '../api/gmail';
import {
  fetchAppointmentRequestGmailLink,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import {
  buildComposeDraft,
  defaultFromAlias,
  loadSendAsAliases,
  submitCompose,
} from '../components/gmail/gmailCompose';
import {
  applySignatureForFrom,
  buildEmailBodies,
  type AppointmentRequestEmailSentContext,
} from '../components/AppointmentRequestEmailModal';
import { requestDataEmail } from '../utils/appointmentRequestDisplay';

const DEFAULT_SUBJECT = 'Your appointment with Vet At Your Door';

type ReplyTarget = {
  mailbox: string;
  from: string;
  subject: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

export function useAppointmentRequestEmail(
  item: AppointmentRequestSubmissionItem,
  opts?: {
    enabled?: boolean;
    onGmailLinked?: (patch: {
      gmailThreadId: string;
      gmailMailbox: string;
      gmailLinkedAt: string | null;
    }) => void;
  }
) {
  const enabled = opts?.enabled !== false;
  const clientEmail = requestDataEmail(item.requestData ?? {});
  const [messages, setMessages] = useState<GmailThreadMessage[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ReplyTarget | null>(null);
  const [, setAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const link = await fetchAppointmentRequestGmailLink(item.id);
        if (cancelled) return;
        let thread: GmailThreadMessage[] = [];
        if (link.threadId && link.mailbox) {
          opts?.onGmailLinked?.({
            gmailThreadId: link.threadId,
            gmailMailbox: link.mailbox,
            gmailLinkedAt: link.linkedAt,
          });
          thread = (await fetchGmailThread(link.mailbox, link.threadId)).messages;
          if (cancelled) return;
        }
        setMessages(thread);

        const mailboxesRes = link.mailbox || item.gmailMailbox ? null : await fetchGmailMailboxes();
        const mailbox =
          link.mailbox ??
          item.gmailMailbox ??
          mailboxesRes?.mailboxes.find((m) => m.connected && m.email === 'info@vetatyourdoor.com')
            ?.email ??
          mailboxesRes?.mailboxes.find((m) => m.connected)?.email ??
          null;
        if (!mailbox) {
          setTarget(null);
          return;
        }
        const aliasList = await loadSendAsAliases(mailbox);
        if (cancelled) return;
        const from = defaultFromAlias(aliasList, mailbox);
        setAliases(aliasList);
        applySignatureForFrom(mailbox, aliasList, from, setAliases, setSignatureHtml);

        const first = thread[0];
        if (link.threadId && first) {
          const draft = buildComposeDraft({
            mode: 'reply',
            threadId: link.threadId,
            replyTo: first,
            mailboxEmail: mailbox,
          });
          setTarget({
            mailbox,
            from,
            subject: draft.subject,
            threadId: draft.threadId ?? link.threadId,
            inReplyTo: draft.inReplyTo,
            references: draft.references,
          });
        } else {
          setTarget({
            mailbox,
            from,
            subject: link.subject?.trim()
              ? `Re: ${link.subject.replace(/^Re:\s*/i, '')}`
              : DEFAULT_SUBJECT,
            threadId: link.threadId ?? undefined,
          });
        }
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per request or on demand
  }, [item.id, enabled, reloadKey]);

  const canSend = Boolean(target && clientEmail);

  const send = useCallback(
    async (text: string): Promise<AppointmentRequestEmailSentContext | null> => {
      if (!target || !clientEmail) throw new Error('No email address or mailbox for this request.');
      const { html, text: plain } = buildEmailBodies(text, messages[0] ?? null, signatureHtml);
      await submitCompose({
        mailbox: target.mailbox,
        from: target.from,
        to: clientEmail,
        cc: '',
        subject: target.subject,
        bodyText: plain,
        bodyHtml: html,
        threadId: target.threadId,
        inReplyTo: target.inReplyTo,
        references: target.references,
      });
      const latest = latestNonDraftThreadMessage(messages);
      const context =
        target.threadId && latest
          ? {
              mailbox: target.mailbox,
              threadId: target.threadId,
              messageId: latest.id,
              labelIds: threadLabelIds(messages),
            }
          : null;
      setReloadKey((k) => k + 1);
      return context;
    },
    [target, clientEmail, messages, signatureHtml]
  );

  return {
    messages,
    loading,
    error,
    canSend,
    clientEmail,
    fromLabel: target?.from ?? null,
    subject: target?.subject ?? null,
    send,
    reload: () => setReloadKey((k) => k + 1),
  };
}
