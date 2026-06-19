import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { bookAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { clientDisplayNameFromRequestData } from '../utils/appointmentRequestDisplay';
import '../pages/Scheduler.css';

type Props = {
  item: AppointmentRequestSubmissionItem;
  onClose: () => void;
  onLinked: (updated: AppointmentRequestSubmissionItem) => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function AppointmentRequestManualBookModal({ item, onClose, onLinked }: Props) {
  const [appointmentId, setAppointmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientLabel = clientDisplayNameFromRequestData(item.requestData ?? {});

  const handleSave = useCallback(async () => {
    const apptId = Number(appointmentId.trim());
    if (!Number.isFinite(apptId) || apptId <= 0) {
      setError('Enter a valid appointment ID.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await bookAppointmentRequestSubmission(item.id, { appointmentId: apptId });
      onLinked({ ...item, ...updated, kind: 'submission' });
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not link appointment.');
    } finally {
      setSaving(false);
    }
  }, [appointmentId, item, onClose, onLinked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        aria-labelledby="appt-request-manual-book-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="appt-request-manual-book-title" className="scheduler-modal-title">
          Link booked appointment
        </h3>
        <p className="settings-muted" style={{ marginTop: 0 }}>
          For {clientLabel}. Create the appointment through the normal booking flow first, then enter
          its ID here to mark this request as booked.
        </p>
        <label htmlFor="appt-request-manual-book-id" style={{ display: 'block', marginBottom: 8 }}>
          Appointment ID
        </label>
        <input
          id="appt-request-manual-book-id"
          type="number"
          className="settings-input"
          value={appointmentId}
          onChange={(e) => {
            setAppointmentId(e.target.value);
            setError(null);
          }}
          placeholder="e.g. 98765"
          style={{ width: '100%', marginBottom: 12 }}
          autoFocus
        />
        {error ? (
          <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }} role="alert">
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Linking…' : 'Link appointment'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null;
}

export function appointmentRequestHasSmsPhone(item: AppointmentRequestSubmissionItem): boolean {
  const phone = pickStr(item.requestData?.phoneNumber) ?? pickStr(item.requestData?.bestPhoneNumber);
  return Boolean(phone && phone.replace(/\D/g, '').length >= 7);
}
