import { useEffect, useState } from 'react';
import {
  buildComposeDraft,
  defaultFromAlias,
  formatFromAlias,
  loadSendAsAliases,
  submitCompose,
  type ComposeContext,
  type ComposeMode,
} from './gmailCompose';
import type { GmailSendAsAlias } from '../../api/gmail';
import './GmailComposeModal.css';

type Props = {
  open: boolean;
  mailbox: string;
  context: ComposeContext;
  onClose: () => void;
  onSent: () => void;
};

export default function GmailComposeModal({
  open,
  mailbox,
  context,
  onClose,
  onSent,
}: Props) {
  const [aliases, setAliases] = useState<GmailSendAsAlias[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const draft = buildComposeDraft({ ...context, mailboxEmail: mailbox });
    setTo(draft.to);
    setCc(draft.cc);
    setSubject(draft.subject);
    setBodyText(draft.bodyText);
    setThreadId(draft.threadId);
    setInReplyTo(draft.inReplyTo);
    setReferences(draft.references);
    setError(null);

    loadSendAsAliases(mailbox)
      .then((list) => {
        setAliases(list);
        setFrom(defaultFromAlias(list, mailbox));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load send-as aliases'));
  }, [open, mailbox, context]);

  if (!open) return null;

  const title: Record<ComposeMode, string> = {
    new: 'New message',
    reply: 'Reply',
    replyAll: 'Reply all',
  };

  const handleSend = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitCompose({
        mailbox,
        from,
        to,
        cc,
        subject,
        bodyText,
        threadId,
        inReplyTo,
        references,
      });
      onSent();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gmail-compose-backdrop" role="presentation" onClick={onClose}>
      <div
        className="gmail-compose-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gmail-compose-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gmail-compose-modal__header">
          <h2 id="gmail-compose-title">{title[context.mode]}</h2>
          <button type="button" className="gmail-btn" onClick={onClose}>
            Close
          </button>
        </header>

        {error ? <div className="gmail-compose-modal__error">{error}</div> : null}

        <div className="gmail-compose-modal__field">
          <label htmlFor="gmail-compose-from">From</label>
          {aliases.length > 0 ? (
            <select
              id="gmail-compose-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              {aliases.map((a) => {
                const val = formatFromAlias(a);
                return (
                  <option key={a.sendAsEmail} value={val}>
                    {val}
                  </option>
                );
              })}
            </select>
          ) : (
            <input id="gmail-compose-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </div>

        <div className="gmail-compose-modal__field">
          <label htmlFor="gmail-compose-to">To</label>
          <input id="gmail-compose-to" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="gmail-compose-modal__field">
          <label htmlFor="gmail-compose-cc">Cc</label>
          <input id="gmail-compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
        </div>

        <div className="gmail-compose-modal__field">
          <label htmlFor="gmail-compose-subject">Subject</label>
          <input
            id="gmail-compose-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="gmail-compose-modal__field gmail-compose-modal__field--body">
          <label htmlFor="gmail-compose-body">Message</label>
          <textarea
            id="gmail-compose-body"
            rows={12}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
          />
        </div>

        <footer className="gmail-compose-modal__footer">
          <button type="button" className="gmail-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="gmail-btn gmail-btn--primary"
            onClick={handleSend}
            disabled={busy || !to.trim() || !subject.trim()}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </footer>
      </div>
    </div>
  );
}
