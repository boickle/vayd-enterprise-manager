/**
 * Email side of a hold's conversation (owner, Nov 12, 2026): recent email threads with the
 * client's address in the practice's shared mailboxes (same search as Email history), newest
 * threads first. Sending goes through the Email client window (From / send as, templates), so
 * there is no inline send here.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchGmailMailboxes,
  fetchGmailMessages,
  fetchGmailThread,
  gmailErrorMessage,
  mergeGmailMessagesByDate,
  type GmailThreadMessage,
} from '../api/gmail';
import {
  buildGmailClientCorrespondenceQuery,
  isEffectiveClientEmail,
} from '../utils/clientEmailGmailSearch';
import { sharedConnectedMailboxes } from '../utils/practiceGmailMailboxes';
import type { ConversationEmail } from '../components/appointmentRequests/ConversationPanel';

/** Threads per mailbox shown in the conversation (older ones are in Email history). */
const THREADS_PER_MAILBOX = 4;

export function useClientEmailConversation(opts: {
  clientEmail: string | null;
  /** The client's second email: searched too, same shared mailboxes. */
  secondEmail?: string | null;
  enabled?: boolean;
  /** Opens the Email client window with what was typed. */
  openWindow: (draft: string) => void;
}): (ConversationEmail & { reload: () => void }) | null {
  // Primary first, then the second email; unusable and duplicate addresses dropped.
  const addresses: string[] = [];
  for (const a of [opts.clientEmail, opts.secondEmail]) {
    const t = a?.trim();
    if (t && isEffectiveClientEmail(t) && !addresses.some((x) => x.toLowerCase() === t.toLowerCase())) {
      addresses.push(t);
    }
  }
  const addressKey = addresses.join('|').toLowerCase();
  const email = addresses[0] ?? null;
  const usable = opts.enabled !== false && addresses.length > 0;
  const [messages, setMessages] = useState<GmailThreadMessage[]>([]);
  const [loading, setLoading] = useState(usable);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!usable || !email) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const mailboxes = sharedConnectedMailboxes((await fetchGmailMailboxes()).mailboxes);
        const perMailbox = await Promise.all(
          mailboxes.flatMap((mb) => addresses.map((address) => ({ mb, address }))).map(async ({ mb, address }) => {
            const q = buildGmailClientCorrespondenceQuery(address);
            const res = await fetchGmailMessages(mb.email, { q, maxResults: 10 });
            const threads = mergeGmailMessagesByDate(res.threads ?? [], res.untaggedQueue ?? []).slice(
              0,
              THREADS_PER_MAILBOX
            );
            const loaded = await Promise.all(
              threads.map((t) =>
                fetchGmailThread(mb.email, t.threadId)
                  .then((r) => r.messages ?? [])
                  .catch(() => [] as GmailThreadMessage[])
              )
            );
            return loaded.flat();
          })
        );
        if (cancelled) return;
        const seen = new Set<string>();
        const all = perMailbox.flat().filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
        setMessages(all);
      } catch (e) {
        if (!cancelled) setError(gmailErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, addressKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const { openWindow } = opts;

  if (!usable) return null;
  return {
    messages,
    loading,
    error,
    canSend: true,
    clientEmail: email,
    subject: null,
    windowOnly: true,
    openWindow,
    send: async () => {
      throw new Error('Use the email window to send.');
    },
    reload,
  };
}
