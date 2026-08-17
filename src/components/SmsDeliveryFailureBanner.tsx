import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeStaffSmsDeliveryFailure,
  fetchStaffSmsDeliveryFailures,
  type StaffSmsDeliveryFailure,
} from '../api/clientSms';
import { useAuth } from '../auth/useAuth';

const POLL_MS = 20_000;

function sourceLabel(source: string | null): string {
  switch (source) {
    case 'care_outreach':
      return 'Care Outreach';
    case 'forward_booking':
      return 'Forward Booking';
    case 'slot_offer':
      return 'Text offer';
    case 'holds':
      return 'Holds';
    case 'on_my_way':
      return 'On my way';
    default:
      return 'Text message';
  }
}

/**
 * Global alert when the phone provider reports a staff-sent SMS failed to deliver (e.g. landline).
 * Polls while an employee is signed in.
 */
export default function SmsDeliveryFailureBanner() {
  const { token, role } = useAuth() as { token?: string | null; role?: string | string[] };
  const roles = Array.isArray(role) ? role : role ? [role] : [];
  const isClient = roles.map((r) => String(r).toLowerCase()).includes('client');
  const enabled = Boolean(token) && !isClient;

  const [failures, setFailures] = useState<StaffSmsDeliveryFailure[]>([]);
  const [dismissingId, setDismissingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setFailures([]);
      return;
    }
    try {
      const next = await fetchStaffSmsDeliveryFailures(10);
      setFailures(next);
    } catch {
      /* non-blocking */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setFailures([]);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const dismiss = async (id: number) => {
    setDismissingId(id);
    try {
      await acknowledgeStaffSmsDeliveryFailure(id);
      setFailures((prev) => prev.filter((f) => f.id !== id));
    } catch {
      /* keep visible */
    } finally {
      setDismissingId(null);
    }
  };

  if (!enabled || failures.length === 0) return null;

  return (
    <div className="sms-delivery-failure-stack" role="region" aria-label="Undelivered text messages">
      {failures.map((f) => (
        <div key={f.id} className="sms-delivery-failure-banner" role="alert">
          <div className="sms-delivery-failure-banner__body">
            <strong>Text not delivered</strong>
            <span>
              {sourceLabel(f.source)} to {f.clientName} ({f.phone})
              {f.errorMessage ? ` — ${f.errorMessage}` : ''}. Try calling or emailing instead.
            </span>
          </div>
          <button
            type="button"
            className="sms-delivery-failure-banner__dismiss"
            disabled={dismissingId === f.id}
            onClick={() => void dismiss(f.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
