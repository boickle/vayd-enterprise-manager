import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ComposeCloseButton,
  UnsentComposeConfirm,
  useUnsentComposeClose,
} from './unsentComposeClose';
import { useClientEmailComposeSetup } from '../hooks/useClientEmailComposeSetup';
import { extractEmail } from './gmail/gmailCompose';
import './gmail/GmailComposeModal.css';

export type SlotOfferEmailSend = {
  mailbox: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  signatureHtml?: string;
};

type Props = {
  open: boolean;
  clientId: number | null;
  clientLabel: string;
  initialSubject: string;
  initialBody: string;
  onClose: () => void;
  onSend: (email: SlotOfferEmailSend) => void;
  sending: boolean;
  sendError?: string | null;
  /** Items the sender should double-check before sending. */
  reviewNotes?: string[];
};

const fieldLabel = { display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 } as const;

export function SlotOfferEmailComposeModal({
  open,
  clientId,
  clientLabel,
  initialSubject,
  initialBody,
  onClose,
  onSend,
  sending,
  sendError,
  reviewNotes,
}: Props) {
  const { confirming, requestClose, keepEditing, discard } = useUnsentComposeClose(open, onClose);
  const setup = useClientEmailComposeSetup({ active: open, clientId });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!open) return;
    setSubject(initialSubject);
    setBody(initialBody);
  }, [open, initialSubject, initialBody]);

  if (!open || typeof document === 'undefined') return null;

  const recipients = setup.to
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const canSend =
    Boolean(
      setup.mailbox && setup.from.trim() && recipients.length > 0 && subject.trim() && body.trim()
    ) &&
    !sending &&
    !setup.loading &&
    !setup.error;

  const handleSend = () => {
    if (!canSend || !setup.mailbox) return;
    onSend({
      mailbox: setup.mailbox,
      from: extractEmail(setup.from),
      to: recipients,
      subject: subject.trim(),
      body: body.trim(),
      ...(setup.signatureHtml.trim() ? { signatureHtml: setup.signatureHtml.trim() } : {}),
    });
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slot-offer-email-title"
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
            <h3
              id="slot-offer-email-title"
              style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}
            >
              Email offer
            </h3>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              Review the email to {clientLabel} before sending. A “Confirm this visit” button is
              added automatically.
            </p>
            {setup.mailbox ? (
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
                From {setup.mailbox}
              </p>
            ) : null}
          </div>
          <ComposeCloseButton onClick={requestClose} disabled={sending} />
        </div>

        {sendError ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
            {sendError}
          </p>
        ) : null}

        {setup.error ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14, margin: '0 0 12px' }}>
            {setup.error}
          </p>
        ) : null}

        {reviewNotes && reviewNotes.length > 0 ? (
          <div
            role="note"
            style={{
              margin: '0 0 12px',
              padding: '10px 12px',
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.45,
              color: '#78350f',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Check before sending</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {reviewNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {setup.loading ? (
          <p className="settings-muted" style={{ margin: '0 0 16px' }}>
            Loading email…
          </p>
        ) : null}

        {!setup.loading && !setup.error ? (
          <>
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={fieldLabel}>To</span>
              <input
                type="email"
                multiple
                value={setup.to}
                onChange={(e) => setup.setTo(e.target.value)}
                disabled={sending}
                className="settings-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={fieldLabel}>From</span>
              {setup.fromOptions.length > 0 ? (
                <select
                  value={setup.from}
                  onChange={(e) => setup.handleFromChange(e.target.value)}
                  disabled={sending}
                  className="settings-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                >
                  {setup.fromOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={setup.from}
                  onChange={(e) => setup.setFrom(e.target.value)}
                  disabled={sending}
                  className="settings-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              )}
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={fieldLabel}>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
                className="settings-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={fieldLabel}>Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
                rows={10}
                style={{
                  width: '100%',
                  padding: 12,
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  fontSize: 14,
                  lineHeight: 1.6,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                placeholder="Enter your message…"
              />
              <span
                style={{
                  display: 'block',
                  margin: '8px 0 0',
                  padding: '10px 12px',
                  border: '1px dashed #d1d5db',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#4b5563',
                }}
              >
                <strong style={{ color: '#4FB128' }}>Confirm this visit</strong> button goes here
              </span>
              {setup.signatureHtml ? (
                <div
                  className="gmail-compose-panel__signature"
                  style={{
                    marginTop: 8,
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: '#f9fafb',
                  }}
                  dangerouslySetInnerHTML={{ __html: setup.signatureHtml }}
                />
              ) : null}
            </label>
          </>
        ) : null}

        {confirming ? (
          <UnsentComposeConfirm kind="email" onKeep={keepEditing} onDiscard={discard} />
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={requestClose} disabled={sending}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!canSend} onClick={handleSend}>
            {sending ? 'Sending…' : 'Send offer'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
