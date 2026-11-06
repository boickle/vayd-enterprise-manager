import { useEffect, useState } from 'react';
import { sendClientSms } from '../../api/clientSms';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import { addMailApprovalNote, type MailOrder } from '../../api/onlineStore';
import type { EmailRegardingPatient } from '../ClientEmailComposeModal';
import {
  displayNameForQuoLine,
  useOpenPhoneLineDirectory,
} from '../../hooks/useOpenPhoneLineDirectory';
import { formatDisplayPhone } from '../../utils/quoContact';
import { smsAllowsProductionOverride } from '../../utils/smsEnvironment';

type Props = {
  practiceId: number;
  order: MailOrder;
  rxLinePhone: string;
  regardingPatients: EmailRegardingPatient[];
  message: string;
  onMessageChange: (value: string) => void;
  onClose: () => void;
  onRun: (fn: () => Promise<MailOrder>) => Promise<boolean>;
};

export default function MailOrderPayTextModal({
  practiceId,
  order,
  rxLinePhone,
  regardingPatients,
  message,
  onMessageChange,
  onClose,
  onRun,
}: Props) {
  const allowOverride = smsAllowsProductionOverride();
  const { lines: quoLines } = useOpenPhoneLineDirectory(true);
  const [fromPhone, setFromPhone] = useState(rxLinePhone);
  const [toPhone, setToPhone] = useState('');
  const [clientPhones, setClientPhones] = useState<string[]>([]);
  const [overrideNonProd, setOverrideNonProd] = useState(false);
  const [logClientComms, setLogClientComms] = useState(true);
  const [includeEmr, setIncludeEmr] = useState(false);
  const [emrPatientIds, setEmrPatientIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFromPhone(rxLinePhone || '');
  }, [rxLinePhone]);

  useEffect(() => {
    if (!order.clientId) {
      setClientPhones([]);
      setToPhone('');
      return;
    }
    void fetchClientByIdStaff(order.clientId)
      .then((client) => {
        const row = client as { phone1?: string | null; phone2?: string | null } | null;
        const phones = [row?.phone1, row?.phone2]
          .map((p) => String(p || '').trim())
          .filter(Boolean);
        setClientPhones(phones);
        setToPhone(phones[0] ?? '');
      })
      .catch(() => {
        setClientPhones([]);
        setToPhone('');
      });
  }, [order.clientId]);

  async function submit() {
    if (!message.trim()) {
      setError('Add a message for the client.');
      return;
    }
    if (!order.clientId) {
      setError('This order has no client record to text.');
      return;
    }
    if (includeEmr && emrPatientIds.length === 0) {
      setError('Choose at least one pet for the patient EMR.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onRun(async () => {
        const patientIds = [
          ...new Set(
            [order.patientId, ...(order.lines || []).map((line) => line.patientId)].filter(
              (id): id is number => id != null && id > 0,
            ),
          ),
        ];
        const text = message.trim();
        await sendClientSms(order.clientId!, {
          message: text,
          to: toPhone || undefined,
          from: fromPhone || undefined,
          source: 'mail_order',
          practiceId,
          patientIds,
          typeLabel: 'Mail order payment text',
          overrideNonProd: allowOverride ? overrideNonProd : undefined,
        });
        if (logClientComms || includeEmr) {
          await recordScoutChartCommunication({
            clientId: order.clientId!,
            patientIds: includeEmr ? emrPatientIds : [],
            channel: 'sms',
            body: text,
            destination: toPhone || undefined,
            sentFrom: fromPhone || undefined,
            typeLabel: 'Mail order payment text',
            includeOnMedicalRecord: includeEmr,
          });
        }
        return addMailApprovalNote(practiceId, order.id, 'Pay-link text sent');
      });
      if (ok) onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send the text.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-pay-text-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3 id="mail-pay-text-title">Text pay link</h3>
          <button type="button" className="settings-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Review the text, then send it from the RX line. It is not sent until you confirm.
          </p>
          {error ? (
            <p className="settings-muted" role="alert" style={{ color: '#b91c1c' }}>
              {error}
            </p>
          ) : null}
          <label className="settings-label">
            From
            <select
              className="settings-input"
              value={fromPhone}
              onChange={(e) => setFromPhone(e.target.value)}
            >
              <option value="">Default line</option>
              {rxLinePhone ? (
                <option value={rxLinePhone}>
                  RX · {formatDisplayPhone(rxLinePhone) || rxLinePhone}
                </option>
              ) : null}
              {quoLines.map((line) => (
                <option key={line.phone} value={line.phone}>
                  {displayNameForQuoLine(line) || formatDisplayPhone(line.phone) || line.phone}
                </option>
              ))}
            </select>
          </label>
          {clientPhones.length > 1 ? (
            <label className="settings-label">
              To
              <select
                className="settings-input"
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
              >
                {clientPhones.map((phone) => (
                  <option key={phone} value={phone}>
                    {formatDisplayPhone(phone) || phone}
                  </option>
                ))}
              </select>
            </label>
          ) : clientPhones.length === 1 ? (
            <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
              To {formatDisplayPhone(clientPhones[0]) || clientPhones[0]}
            </p>
          ) : null}
          <label className="settings-label">
            Text message
            <textarea
              className="settings-input"
              rows={7}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
            />
          </label>
          <label className="mail-queue__check" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={logClientComms}
              onChange={(e) => setLogClientComms(e.target.checked)}
            />
            <span>
              <strong>Add to client communications</strong>
              <span className="settings-muted" style={{ display: 'block', fontSize: 13 }}>
                Saves a copy on the client record.
              </span>
            </span>
          </label>
          <label className="mail-queue__check" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={includeEmr}
              onChange={(e) => {
                const next = e.target.checked;
                setIncludeEmr(next);
                if (next && emrPatientIds.length === 0 && regardingPatients.length) {
                  setEmrPatientIds(regardingPatients.map((p) => p.id));
                }
              }}
            />
            <span>
              <strong>Include in patient EMR</strong>
              <span className="settings-muted" style={{ display: 'block', fontSize: 13 }}>
                Puts this text on the medical record for the pets you choose below.
              </span>
            </span>
          </label>
          {includeEmr && regardingPatients.length > 0 ? (
            <fieldset
              style={{
                margin: '0 0 12px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <legend style={{ fontSize: 14, fontWeight: 600, padding: '0 4px' }}>
                Put on these patient charts
              </legend>
              {regardingPatients.map((p) => (
                <label key={p.id} className="mail-queue__check" style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={emrPatientIds.includes(p.id)}
                    onChange={() =>
                      setEmrPatientIds((prev) =>
                        prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          {allowOverride ? (
            <label className="settings-label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={overrideNonProd}
                onChange={(e) => setOverrideNonProd(e.target.checked)}
              />
              Allow send in non-production
            </label>
          ) : null}
        </div>
        <div className="settings-modal-footer">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Sending…' : 'Send text'}
          </button>
        </div>
      </div>
    </div>
  );
}
