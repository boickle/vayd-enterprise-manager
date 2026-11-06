import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Paperclip } from 'lucide-react';
import {
  decodeGmailSnippet,
  fetchGmailMailboxes,
  fetchGmailMessages,
  openGmailAttachment,
  type GmailAttachmentSummary,
  type GmailMessageSummary,
} from '../../api/gmail';
import { defaultSharedMailbox } from '../../utils/practiceGmailMailboxes';
import { buildRecordsEmailSearchQuery } from '../../utils/recordsEmailGmailSearch';
import { apiErrorMessage } from '../../api/http';
import './RecordsEmailLookup.css';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Searches the shared inbox for mail that might be this patient's records.
 * Read-only: it surfaces candidates and links out, it never files anything.
 * Nothing here is a match guarantee — the CL decides.
 */
export default function RecordsEmailLookup({
  patientName,
  clientName,
  hospitalName,
}: {
  patientName: string | null;
  clientName: string | null;
  hospitalName: string | null;
}) {
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [threads, setThreads] = useState<GmailMessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => buildRecordsEmailSearchQuery({ patientName, clientName, hospitalName }),
    [patientName, clientName, hospitalName],
  );

  useEffect(() => {
    if (!query) {
      setLoading(false);
      setError('Not enough detail on this request to search the inbox.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { mailboxes } = await fetchGmailMailboxes();
        const shared = defaultSharedMailbox(mailboxes);
        if (!shared) {
          if (!cancelled) {
            setError('No shared practice inbox is connected, so there is nothing to search.');
          }
          return;
        }
        if (!cancelled) setMailbox(shared.email);
        const result = await fetchGmailMessages(shared.email, { q: query, maxResults: 15 });
        if (!cancelled) {
          setThreads(result.threads ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err) || 'Could not search the inbox.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const openAttachment = (att: GmailAttachmentSummary) => {
    if (!mailbox) return;
    void openGmailAttachment(mailbox, att).catch((err) => {
      setError(apiErrorMessage(err) || 'Could not open that attachment.');
    });
  };

  if (loading) return <p className="records-email__muted">Searching the inbox…</p>;
  if (error) return <p className="records-email__muted">{error}</p>;
  if (!threads.length) {
    return (
      <p className="records-email__muted">
        Nothing in the inbox mentions {patientName || 'this patient'}
        {clientName ? ` or ${clientName}` : ''} yet.
      </p>
    );
  }

  return (
    <div className="records-email">
      <p className="records-email__muted">
        Possible matches in {mailbox}. Check before filing — these are name matches, not
        confirmed records.
      </p>
      <ul className="records-email__list">
        {threads.map((msg) => (
          <li key={msg.threadId || msg.id} className="records-email__row">
            <div className="records-email__head">
              <strong>{msg.subject?.trim() || '(no subject)'}</strong>
              <span className="records-email__when">{formatWhen(msg.date)}</span>
            </div>
            <div className="records-email__from">
              {msg.participants || msg.from?.name || msg.from?.email}
            </div>
            {msg.snippet ? (
              <div className="records-email__snippet">{decodeGmailSnippet(msg.snippet)}</div>
            ) : null}
            <div className="records-email__actions">
              {(msg.attachments ?? []).map((att) => (
                <button
                  key={att.attachmentId}
                  type="button"
                  className="records-email__att"
                  onClick={() => openAttachment(att)}
                  title={att.filename}
                >
                  <Paperclip size={11} aria-hidden />
                  {att.filename || 'attachment'}
                </button>
              ))}
              {mailbox ? (
                <a
                  className="records-email__open"
                  href={`/schedule/email?mailbox=${encodeURIComponent(mailbox)}&thread=${encodeURIComponent(msg.threadId || msg.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={11} aria-hidden /> Open in inbox
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
