import { useEffect, useState } from 'react';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchGmailMailboxes, fetchGmailSendAsAlias, gmailErrorMessage } from '../api/gmail';
import type { GmailSendAsAlias } from '../api/gmail';
import { clientEmailsFromStaffPayload } from '../utils/clientEmailGmailSearch';
import {
  defaultFromAlias,
  extractEmail,
  formatFromAlias,
  loadSendAsAliases,
  signatureHtmlForFromAlias,
} from '../components/gmail/gmailCompose';

/**
 * Loads what a staff email to a client needs: the client's addresses, the shared
 * (or first connected) Gmail mailbox, its send-as aliases, and the alias signature.
 * Reloads each time it becomes active and clears when inactive.
 */
export function useClientEmailComposeSetup(opts: { active: boolean; clientId: number | null }) {
  const { active, clientId } = opts;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [fromOptions, setFromOptions] = useState<string[]>([]);
  const [sendAsAliases, setSendAsAliases] = useState<GmailSendAsAlias[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (!active || clientId == null) {
      setLoading(false);
      setError(null);
      setMailbox(null);
      setFrom('');
      setFromOptions([]);
      setSendAsAliases([]);
      setSignatureHtml('');
      setTo('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

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
          throw new Error(
            'No Gmail mailboxes are connected. Open Scout Email — shared inboxes connect automatically when configured; personal mailboxes still need OAuth once.'
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
        if (!signatureHtmlForFromAlias(aliases, fromVal)) {
          void fetchGmailSendAsAlias(sendMailbox, sendAsEmail)
            .then((detail) => {
              if (cancelled || !detail.signature?.trim()) return;
              setSendAsAliases((prev) =>
                prev.map((a) =>
                  a.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase()
                    ? { ...a, ...detail }
                    : a
                )
              );
              setSignatureHtml(detail.signature!.trim());
            })
            .catch(() => {
              /* signature optional */
            });
        }
      } catch (e: unknown) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, clientId]);

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
            a.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase() ? { ...a, ...detail } : a
          )
        );
        setSignatureHtml(detail.signature!.trim());
      })
      .catch(() => {
        /* signature optional */
      });
  };

  return {
    loading,
    error,
    mailbox,
    from,
    setFrom,
    fromOptions,
    handleFromChange,
    signatureHtml,
    to,
    setTo,
  };
}
