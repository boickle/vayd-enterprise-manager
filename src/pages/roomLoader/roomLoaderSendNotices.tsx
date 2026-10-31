import React from 'react';

const CANCELED = 'Canceled Appointment';

type PetLike = {
  patient?: { isActive?: boolean | null; isDeleted?: boolean | null } | null;
  appointments?: Array<{ confirmStatusName?: string | null; isDeleted?: boolean | null }> | null;
};

/** RL-07: a pet that has passed away (inactive), or whose every visit here is cancelled or deleted, is left out of the check-in. */
export function isInactiveCheckInPet(item: PetLike): boolean {
  if (item.patient?.isActive === false || item.patient?.isDeleted) return true;
  const appts = item.appointments ?? [];
  return appts.length > 0 && appts.every((a) => a.confirmStatusName === CANCELED || !!a.isDeleted);
}

export function InactivePetNotice({ petName }: { petName: string }) {
  return (
    <div
      role="note"
      data-testid="room-loader-inactive-pet"
      style={{ marginBottom: 12, padding: '10px 14px', background: '#f1f3f5', border: '1px solid #ced4da', borderRadius: 6, color: '#495057' }}
    >
      <strong>{petName} is inactive.</strong> This pet is left out of the check-in and will not be sent to the client.
    </div>
  );
}

export type EmailNotSentReason = 'no_email' | 'send_failed';

/** The reason to warn about after send-to-client, or null when the email went (or was not wanted). */
export function emailNotSentReasonFromSend(
  sendData: { emailSent?: boolean; reason?: string } | null | undefined,
  opts: { skipEmail?: boolean; sendViaSms?: boolean },
): EmailNotSentReason | null {
  if (opts.skipEmail || opts.sendViaSms) return null;
  if (sendData?.emailSent === false && sendData?.reason) return sendData.reason as EmailNotSentReason;
  return null;
}

export function emailNotSentText(reason: EmailNotSentReason): string {
  return reason === 'no_email'
    ? 'Email not sent: no email address on file.'
    : 'Email not sent: the email failed to send.';
}

/** RL-14: shown after a send when the API says the email did not go. */
export function EmailNotSentWarning({
  reason,
  canSendBySms,
  sending,
  onSendBySms,
  onDismiss,
}: {
  reason: EmailNotSentReason;
  canSendBySms: boolean;
  sending?: boolean;
  onSendBySms: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="room-loader-email-not-sent"
      style={{ margin: '12px 0', padding: '12px 16px', background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: 6, color: '#664d03' }}
    >
      <div style={{ fontWeight: 600 }}>{emailNotSentText(reason)}</div>
      <div style={{ marginTop: 4 }}>The client has not received the check-in link yet.</div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        {canSendBySms && (
          <button type="button" onClick={onSendBySms} disabled={sending}>
            Send by SMS
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
