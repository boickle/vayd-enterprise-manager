import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { fetchGmailMailboxes, sendGmailMessage } from '../../api/gmail';
import { useGmailInboxAccess } from '../../hooks/useGmailInboxAccess';

type Props = {
  open: boolean;
  title: string;
  transcript: string;
  onClose: () => void;
};

export default function BriefEmailModal({ open, title, transcript, onClose }: Props) {
  const { allowed } = useGmailInboxAccess();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(title);
  const [body, setBody] = useState(transcript);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo('');
    setSubject(title);
    setBody(transcript);
    setError(null);
    setSent(false);
    if (!allowed) return;
    let canceled = false;
    void fetchGmailMailboxes()
      .then((res) => {
        if (canceled) return;
        const connected = res.mailboxes.find((m) => m.connected);
        setMailbox(res.defaultMailbox ?? connected?.email ?? null);
      })
      .catch(() => {
        if (!canceled) setMailbox(null);
      });
    return () => {
      canceled = true;
    };
  }, [open, title, transcript, allowed]);

  if (!open) return null;

  const send = async () => {
    const recipients = to
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      setError('Add at least one recipient.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (allowed && mailbox) {
        await sendGmailMessage(mailbox, {
          from: mailbox,
          to: recipients,
          subject: subject.trim() || title,
          bodyText: body,
        });
        setSent(true);
      } else {
        const href = `mailto:${encodeURIComponent(recipients.join(','))}?subject=${encodeURIComponent(subject.trim() || title)}&body=${encodeURIComponent(body)}`;
        window.location.href = href;
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brief-modal" role="dialog" aria-modal aria-labelledby="brief-email-title">
      <button
        type="button"
        className="brief-modal__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="brief-modal__card brief-modal__card--narrow">
        <div className="brief-modal__head">
          <h2 id="brief-email-title">Email transcript</h2>
          <button type="button" className="brief-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {sent ? (
          <p className="brief-muted">Sent. You can close this window.</p>
        ) : (
          <>
            <label className="brief-field">
              <span className="brief-field-label">To</span>
              <input
                className="brief-input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="name@clinic.com"
              />
            </label>
            <label className="brief-field">
              <span className="brief-field-label">Subject</span>
              <input
                className="brief-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="brief-field">
              <span className="brief-field-label">Message</span>
              <textarea
                className="brief-textarea"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {error ? <p className="brief-error">{error}</p> : null}
            <p className="brief-hint">
              {allowed && mailbox
                ? `Sending from ${mailbox}.`
                : 'Gmail isn’t connected for this user — this opens your mail app instead.'}
            </p>
          </>
        )}
        <div className="brief-modal__foot">
          {sent ? (
            <button type="button" className="brief-btn" onClick={onClose}>
              Done
            </button>
          ) : (
            <button
              type="button"
              className="brief-btn primary"
              disabled={busy}
              onClick={() => void send()}
            >
              <Send size={14} aria-hidden /> {busy ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
