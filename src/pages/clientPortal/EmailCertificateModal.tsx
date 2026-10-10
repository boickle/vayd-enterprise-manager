import React, { useState } from 'react';
import { emailVaccinationCertificate } from '../../api/clientPortal';
import { Icon, PortalModal } from './PortalPrimitives';
import type { PetWithWellness } from './portalShared';
import { possessive } from './portalShared';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailCertificateModal({
  pet,
  defaultTo,
  onClose,
  onSent,
}: {
  pet: PetWithWellness;
  defaultTo?: string | null;
  onClose: () => void;
  onSent: (to: string) => void;
}) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const addr = to.trim();
    if (!EMAIL_RE.test(addr)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!pet.dbId) {
      setError('This pet is missing an id. Please refresh and try again.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await emailVaccinationCertificate(pet.dbId, { to: addr, note: note.trim() || null });
      onSent(addr);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Could not send the certificate. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <PortalModal title={`Email ${possessive(pet.name)} vaccination certificate`} onClose={onClose} labelledBy="pp-email-cert">
      <p className="pp-muted pp-small" style={{ margin: 0 }}>
        We&apos;ll send an official PDF certificate straight from Vet At Your Door — perfect for groomers, boarding, daycare,
        travel, or your own records.
      </p>
      <form onSubmit={(e) => void send(e)} style={{ display: 'grid', gap: 12 }}>
        <label className="pp-field">
          Send to
          <input
            className="pp-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="groomer@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            autoFocus
          />
        </label>
        {defaultTo ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="pp-chip pp-chip--soft" onClick={() => setTo(defaultTo)} style={{ cursor: 'pointer' }}>
              <Icon name="mail" size={14} /> Send to me ({defaultTo})
            </button>
          </div>
        ) : null}
        <label className="pp-field">
          Note (optional)
          <textarea
            className="pp-textarea"
            rows={3}
            maxLength={1000}
            placeholder={`e.g. Here are ${possessive(pet.name)} records for the boarding stay next week.`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error ? <div className="pp-error">{error}</div> : null}
        <div className="pp-modal-foot">
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button type="submit" className="pp-btn pp-btn--primary" disabled={sending}>
            <Icon name="mail" />
            {sending ? 'Sending…' : 'Send certificate'}
          </button>
        </div>
      </form>
    </PortalModal>
  );
}
