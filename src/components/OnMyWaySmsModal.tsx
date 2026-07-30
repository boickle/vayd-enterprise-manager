import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Appointment } from '../api/roomLoader';
import { fetchSchedulingOutreachSmsFrom, sendClientSms } from '../api/clientSms';
import { fetchPracticeMainPhone } from '../api/clientPortal';
import type { Provider } from '../api/employee';
import { ClientMessagesHistoryModal } from './ClientMessagesHistoryModal';
import {
  buildOnMyWaySmsMessage,
  ON_MY_WAY_SMS_DEFAULT_MINUTES,
  resolveTechnicianFirstNameForAppointment,
} from '../utils/onMyWaySmsMessage';
import { resolveOnMyWaySmsFromLine } from '../utils/onMyWaySmsFromLine';
import { resolveQuoFromLine } from '../utils/quoContact';
import { smsAllowsProductionOverride } from '../utils/smsEnvironment';
import '../pages/Scheduler.css';

type Props = {
  appt: Appointment;
  defaultMinutes?: number;
  onClose: () => void;
  /** `/employees/providers` — used when the calendar row omits `quoLinePhone`. */
  providers?: readonly Provider[];
  practiceId?: number;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function OnMyWaySmsModal({
  appt,
  defaultMinutes,
  onClose,
  providers,
  practiceId,
}: Props) {
  const technicianFirstName = useMemo(
    () => resolveTechnicianFirstNameForAppointment(appt),
    [appt]
  );
  const initialMinutes = defaultMinutes ?? ON_MY_WAY_SMS_DEFAULT_MINUTES;
  const [minutes, setMinutes] = useState(String(initialMinutes));
  const [message, setMessage] = useState(() =>
    buildOnMyWaySmsMessage(technicianFirstName, initialMinutes)
  );
  const [messageTouched, setMessageTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [practiceMainPhone, setPracticeMainPhone] = useState<string | null>(null);
  const [remindersFrom, setRemindersFrom] = useState<string | null>(null);

  const client = appt.client;
  const clientId = client?.id;
  const clientLabel = useMemo(() => {
    if (!client) return 'Client';
    return (
      [pickStr(client.firstName), pickStr(client.lastName)].filter(Boolean).join(' ').trim() ||
      `Client #${client.id}`
    );
  }, [client]);

  const providerId =
    appt.primaryProvider?.id != null && Number.isFinite(Number(appt.primaryProvider.id))
      ? Number(appt.primaryProvider.id)
      : undefined;

  const providerLabel = useMemo(() => {
    if (!appt.primaryProvider) return null;
    return (
      [pickStr(appt.primaryProvider.firstName), pickStr(appt.primaryProvider.lastName)]
        .filter(Boolean)
        .join(' ')
        .trim() || 'provider'
    );
  }, [appt.primaryProvider]);

  const quoFromLine = useMemo(
    () =>
      resolveQuoFromLine({
        appointmentPrimaryProvider: appt.primaryProvider,
        providers,
      }),
    [appt.primaryProvider, providers]
  );

  const fromLineRouting = useMemo(
    () =>
      resolveOnMyWaySmsFromLine({
        primaryProviderId: providerId,
        quoFromLine,
        employeePhone1: appt.primaryProvider?.phone1,
        practiceMainPhone,
        remindersFrom,
      }),
    [
      providerId,
      quoFromLine,
      appt.primaryProvider?.phone1,
      practiceMainPhone,
      remindersFrom,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchPracticeMainPhone(practiceId),
      fetchSchedulingOutreachSmsFrom(),
    ]).then(([main, reminders]) => {
      if (cancelled) return;
      setPracticeMainPhone(main);
      setRemindersFrom(reminders);
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  const parsedMinutes = Number(minutes);
  const minutesValid = Number.isFinite(parsedMinutes) && parsedMinutes > 0;

  const onMinutesChange = (raw: string) => {
    setMinutes(raw);
    if (messageTouched) return;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      setMessage(buildOnMyWaySmsMessage(technicianFirstName, n));
    }
  };

  const handleSend = async (opts: { overrideNonProd: boolean }) => {
    if (!clientId || !message.trim()) return;
    if (!minutesValid) {
      setError('Enter how many minutes away you are.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendClientSms(clientId, {
        message: message.trim(),
        source: 'on_my_way',
        ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
        ...fromLineRouting.payload,
      });
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to send text message.');
    } finally {
      setSending(false);
    }
  };

  const allowOverride = smsAllowsProductionOverride();

  const fromLineHelp = fromLineRouting.usedPracticeBackup
    ? `Sends from the practice backup phone line${
        fromLineRouting.fromLineLabel ? ` (${fromLineRouting.fromLineLabel})` : ''
      } — this visit has no provider Quo line.`
    : `Sends from the appointment provider's phone line${
        providerLabel ? ` (${providerLabel})` : ''
      }. Review the message before sending.`;

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scheduler-modal scheduler-modal--edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="on-my-way-sms-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">On visit day</p>
            <h2 id="on-my-way-sms-title">Send On My Way Text</h2>
            <p className="scheduler-modal-subtitle">{clientLabel}</p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}
          <p className="settings-muted" style={{ marginTop: 0 }}>
            {fromLineHelp}
          </p>

          <label className="scheduler-edit-field" style={{ display: 'block', maxWidth: 160 }}>
            <span>Minutes away</span>
            <input
              type="number"
              className="settings-input"
              min={1}
              max={240}
              step={1}
              value={minutes}
              disabled={sending}
              onChange={(e) => onMinutesChange(e.target.value)}
            />
          </label>

          <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 12 }}>
            <span>Message</span>
            <textarea
              className="settings-input"
              rows={5}
              value={message}
              disabled={sending}
              onChange={(e) => {
                setMessageTouched(true);
                setMessage(e.target.value);
              }}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
            />
          </label>

          {!technicianFirstName ? (
            <p className="settings-muted" style={{ fontSize: 13, marginBottom: 0 }}>
              No technician is listed on this visit — edit the greeting if needed.
            </p>
          ) : null}
        </div>

        <div className="scheduler-edit-footer" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => setMessagesOpen(true)}
            disabled={!clientId}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#4FB128',
              background: 'none',
              border: 'none',
              cursor: clientId ? 'pointer' : 'not-allowed',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Messages history
          </button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn secondary" disabled={sending} onClick={onClose}>
              Cancel
            </button>
            {allowOverride ? (
              <button
                type="button"
                className="btn secondary"
                disabled={sending || !message.trim() || !minutesValid}
                onClick={() => void handleSend({ overrideNonProd: true })}
              >
                {sending ? 'Sending…' : 'Send to actual client'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={sending || !message.trim() || !minutesValid}
              onClick={() => void handleSend({ overrideNonProd: false })}
            >
              {sending ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </div>
      </div>

      {messagesOpen && clientId ? (
        <ClientMessagesHistoryModal
          open
          clientId={clientId}
          clientLabel={clientLabel}
          onClose={() => setMessagesOpen(false)}
        />
      ) : null}
    </div>
  );

  return createPortal(modal, document.body);
}
