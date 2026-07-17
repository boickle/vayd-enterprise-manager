import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Appointment } from '../api/roomLoader';
import {
  sendEuthanasiaConsent,
  type EuthanasiaConsentVariant,
} from '../api/euthanasiaConsent';

type Props = {
  appt: Appointment;
  variant: EuthanasiaConsentVariant;
  onClose: () => void;
  onToast: (msg: string) => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function doctorDisplayName(appt: Appointment): string | undefined {
  const p = appt.primaryProvider;
  if (!p) return undefined;
  const name = [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ');
  return name ? `Dr. ${name}` : undefined;
}

export function SchedulerEuthanasiaConsentSendModal({ appt, variant, onClose, onToast }: Props) {
  const defaultEmail = pickStr(appt.client?.email) || '';
  const [email, setEmail] = useState(defaultEmail);
  const [allowAshHomeDelivery, setAllowAshHomeDelivery] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const title = useMemo(
    () =>
      variant === 'cv' ? 'Send Euthanasia Consent (CV)' : 'Send Euthanasia Consent Form',
    [variant]
  );

  const appointmentId = Number(appt.id);
  const canSend = Number.isFinite(appointmentId) && appointmentId > 0;

  async function send(skipEmail: boolean) {
    if (!canSend) {
      setError('This appointment has no numeric id.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendEuthanasiaConsent({
        variant,
        appointmentId,
        email: email.trim() || undefined,
        allowAshHomeDelivery,
        skipEmail,
        doctorDisplayName: doctorDisplayName(appt),
      });
      setLastUrl(result.formUrl);
      if (skipEmail) {
        onToast('Consent form link ready — copy and share with the client.');
      } else {
        onToast(
          result.sentTo
            ? `Consent form emailed to ${result.sentTo}.`
            : 'Consent form created.'
        );
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message || 'Could not send consent form.';
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!lastUrl) return;
    try {
      await navigator.clipboard.writeText(lastUrl);
      onToast('Link copied.');
    } catch {
      onToast(lastUrl);
    }
  }

  return createPortal(
    <div className="scheduler-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scheduler-modal" style={{ maxWidth: 440 }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p className="scheduler-modal-muted" style={{ marginTop: 0 }}>
          Prefills client/pet from this appointment. Uncheck home ash delivery if the client is
          more than 45 minutes from the depot.
        </p>
        <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 14 }}>
          Client email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={{ padding: '8px 10px', fontSize: 14 }}
          />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={allowAshHomeDelivery}
            onChange={(e) => setAllowAshHomeDelivery(e.target.checked)}
            disabled={busy}
          />
          Offer home ash delivery (uncheck if &gt;45 min from depot)
        </label>
        {error ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 14 }}>
            {error}
          </p>
        ) : null}
        {lastUrl ? (
          <p style={{ fontSize: 13, wordBreak: 'break-all' }}>
            <a href={lastUrl} target="_blank" rel="noreferrer">
              Open form
            </a>
            {' · '}
            <button type="button" onClick={() => void copyLink()} disabled={busy}>
              Copy link
            </button>
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="button" onClick={() => void send(true)} disabled={busy || !canSend}>
            {busy ? 'Working…' : 'Create link only'}
          </button>
          <button type="button" onClick={() => void send(false)} disabled={busy || !canSend || !email.trim()}>
            {busy ? 'Sending…' : 'Email client'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
