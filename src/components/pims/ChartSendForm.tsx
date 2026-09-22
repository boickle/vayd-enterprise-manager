/**
 * Send a form to a client from the patient chart (Communicate → Send form / consent).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  listFormTemplates,
  listFormInvites,
  sendFormInvite,
  type FormField,
  type FormInvite,
  type FormTemplate,
} from '../../api/forms';

type Props = {
  patientId: number;
  clientId?: number | null;
  patientName?: string;
  /** Pre-filled email (from client record). */
  defaultEmail?: string | null;
  open: boolean;
  onClose: () => void;
  /** Refresh chart communications after a successful send. */
  onSent?: () => void;
};

function statusLabel(invite: FormInvite): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (invite.respondedAt) return { text: 'Signed', tone: 'ok' };
  const exp = invite.expiresAt ? new Date(invite.expiresAt) < new Date() : false;
  if (exp) return { text: 'Expired', tone: 'muted' };
  return { text: 'Pending', tone: 'warn' };
}

function cloneFields(fields: FormField[]): FormField[] {
  return fields.map((f) => ({ ...f }));
}

export default function ChartSendForm({
  patientId,
  clientId,
  patientName,
  defaultEmail,
  open,
  onClose,
  onSent,
}: Props) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [invites, setInvites] = useState<FormInvite[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [toEmail, setToEmail] = useState(defaultEmail ?? '');
  const [staffNote, setStaffNote] = useState('');
  const [editFields, setEditFields] = useState<FormField[] | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToEmail(defaultEmail ?? '');
    setError(null);
    setSent(false);
    setEditFields(null);
    setSelectedTemplateId('');
    setStaffNote('');
    setLoadingTemplates(true);
    Promise.all([listFormTemplates(), listFormInvites({ patientId })])
      .then(([tmpl, inv]) => {
        setTemplates(tmpl.filter((t) => t.isPublished));
        setInvites(inv);
      })
      .catch(() => setError('Could not load forms'))
      .finally(() => setLoadingTemplates(false));
  }, [open, patientId, defaultEmail]);

  const selected = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const needsEdit = Boolean(selected?.allowEditBeforeSend);

  function pickTemplate(id: number | '') {
    setSelectedTemplateId(id);
    setEditFields(null);
    if (id === '') return;
    const t = templates.find((x) => x.id === id);
    if (t?.allowEditBeforeSend) setEditFields(cloneFields(t.fields));
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTemplateId) {
      setError('Pick a form');
      return;
    }
    if (!toEmail.trim()) {
      setError('Email is required');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const inv = await sendFormInvite({
        formTemplateId: Number(selectedTemplateId),
        toEmail: toEmail.trim(),
        clientId: clientId ?? null,
        patientId,
        staffNote: staffNote.trim() || null,
        fieldsSnapshot: needsEdit && editFields ? editFields : null,
      });
      setInvites((prev) => [inv, ...prev]);
      setSent(true);
      setSelectedTemplateId('');
      setStaffNote('');
      setEditFields(null);
      onSent?.();
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send form');
    } finally {
      setSending(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  const title = patientName ? `Send form · ${patientName}` : 'Send form / consent';

  return createPortal(
    <div
      className="pims-chart-pick"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chart-send-form-title"
    >
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card chart-send-form chart-send-form--dialog">
        <div className="pims-chart-pick__head chart-send-form__header">
          <h3 id="chart-send-form-title">{title}</h3>
          <button type="button" onClick={onClose} className="chart-send-form__close" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <p className="pims-chart-pick__empty chart-send-form__intro">
          Email a link for the client to fill out and sign. Signed responses are stored on this patient.
        </p>

        {invites.length > 0 && (
          <div className="chart-send-form__history">
            {invites.slice(0, 5).map((inv) => {
              const s = statusLabel(inv);
              return (
                <div key={inv.id} className="chart-send-form__history-row">
                  <span className="chart-send-form__history-name">
                    {inv.formTemplate?.name ?? `Form #${inv.formTemplateId}`}
                  </span>
                  <span className={`chart-send-form__badge chart-send-form__badge--${s.tone}`}>
                    {s.text}
                  </span>
                  <span className="chart-send-form__history-date">
                    {inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <form className="chart-send-form__form" onSubmit={handleSend}>
          {loadingTemplates && <p className="chart-send-form__hint">Loading forms…</p>}
          {!loadingTemplates && templates.length === 0 && (
            <p className="chart-send-form__hint">
              No forms yet — create one in Settings → Communication → Forms.
            </p>
          )}

          {templates.length > 0 && (
            <>
              <label className="chart-send-form__label">
                Form
                <select
                  value={selectedTemplateId}
                  onChange={(e) =>
                    pickTemplate(e.target.value === '' ? '' : Number(e.target.value))
                  }
                >
                  <option value="">Pick a form…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.allowEditBeforeSend ? ' (editable)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="chart-send-form__label">
                Send to email
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </label>

              <label className="chart-send-form__label">
                Staff note (optional, not seen by client)
                <input
                  type="text"
                  value={staffNote}
                  onChange={(e) => setStaffNote(e.target.value)}
                  placeholder="e.g. HW test declined this visit"
                />
              </label>

              {needsEdit && editFields ? (
                <div className="chart-send-form__edit">
                  <p className="chart-send-form__hint">
                    Edit this send before emailing. Changes apply only to this invite.
                  </p>
                  {editFields.map((field, index) => {
                    if (field.type !== 'heading' && field.type !== 'paragraph' && field.type !== 'checkbox') {
                      return null;
                    }
                    const label =
                      field.type === 'heading'
                        ? 'Heading'
                        : field.type === 'paragraph'
                          ? 'Paragraph / waiver text'
                          : 'Checkbox label';
                    const value =
                      field.type === 'checkbox'
                        ? field.checkboxLabel || field.label
                        : field.label;
                    return (
                      <label key={field.key} className="chart-send-form__label">
                        {label}
                        <textarea
                          rows={field.type === 'paragraph' ? 4 : 2}
                          value={value}
                          onChange={(e) => {
                            const next = [...editFields];
                            const cur = { ...next[index] };
                            if (cur.type === 'checkbox') {
                              cur.checkboxLabel = e.target.value;
                              cur.label = e.target.value;
                            } else {
                              cur.label = e.target.value;
                            }
                            next[index] = cur;
                            setEditFields(next);
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {error && <p className="chart-send-form__error">{error}</p>}
              {sent && <p className="chart-send-form__sent">✓ Form sent!</p>}

              <div className="pims-chart-pick__foot chart-send-form__foot">
                <button type="submit" className="brief-btn primary" disabled={sending}>
                  {sending ? 'Sending…' : 'Send form link'}
                </button>
                <button type="button" className="brief-btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
