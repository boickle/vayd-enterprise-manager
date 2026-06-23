import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { bookAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import { fetchClientAppointmentsStaff } from '../api/pimsAppointments';
import {
  clientDisplayNameFromRequestData,
  requestDataRequestedStartIso,
} from '../utils/appointmentRequestDisplay';
import { resolveRequestDataClientIdStaff } from '../utils/resolveRequestDataClientId';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import '../pages/Scheduler.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

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

function appointmentTypeLabel(a: Appointment): string {
  const t = a.appointmentType;
  if (t && typeof t === 'object') {
    const o = t as { prettyName?: unknown; name?: unknown };
    return pickStr(o.prettyName) ?? pickStr(o.name) ?? 'Appointment';
  }
  return 'Appointment';
}

function formatLinkAppointmentOption(a: Appointment, practiceTz: string): string {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const datePart = start.isValid ? start.toFormat('EEE, MMM d, yyyy') : '—';
  const timePart = start.isValid ? start.toFormat('h:mm a') : '';
  const typeName = appointmentTypeLabel(a);
  return [datePart, timePart, typeName].filter(Boolean).join(' · ');
}

function formatRequestedDateHint(iso: string | null, practiceTz: string): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return null;
  return dt.toFormat('EEEE, MMMM d, yyyy');
}

export function AppointmentRequestManualBookModal({ item, onClose, onLinked }: Props) {
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Appointment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [manualId, setManualId] = useState('');
  const [showManualId, setShowManualId] = useState(false);
  const [clientResolved, setClientResolved] = useState<boolean | null>(null);

  const rd = item.requestData ?? {};
  const clientLabel = clientDisplayNameFromRequestData(rd);
  const requestedStartIso = requestDataRequestedStartIso(rd);
  const requestedDateHint = formatRequestedDateHint(requestedStartIso, practiceTz);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShowManualId(false);

    const clientId = await resolveRequestDataClientIdStaff(rd);
    setClientResolved(Boolean(clientId));
    if (!clientId) {
      setOptions([]);
      setShowManualId(true);
      setLoading(false);
      return;
    }

    const cutoff = requestedStartIso
      ? DateTime.fromISO(requestedStartIso, { zone: 'utc' }).setZone(practiceTz).startOf('day')
      : DateTime.now().setZone(practiceTz).startOf('day');
    const rangeStart = cutoff.isValid ? cutoff.toUTC().toISO()! : new Date().toISOString();
    const rangeEnd = cutoff.plus({ years: 1 }).toUTC().toISO()!;

    try {
      const rows = await fetchClientAppointmentsStaff(clientId, {
        practiceId: PRACTICE_ID,
        start: rangeStart,
        end: rangeEnd,
      });
      const filtered = rows
        .filter((a) => !a.isDeleted && a.isActive !== false)
        .filter((a) => {
          const startMs = Date.parse(a.appointmentStart);
          const cutoffMs = Date.parse(rangeStart);
          return Number.isFinite(startMs) && Number.isFinite(cutoffMs) && startMs >= cutoffMs;
        })
        .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart));

      setOptions(filtered);
      if (filtered.length === 1 && filtered[0]?.id != null) {
        setSelectedId(String(filtered[0].id));
      } else {
        setSelectedId('');
      }
      if (filtered.length === 0) setShowManualId(true);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not load appointments.');
      setOptions([]);
      setShowManualId(true);
    } finally {
      setLoading(false);
    }
  }, [item.id, requestedStartIso, practiceTz]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    const apptId = showManualId && manualId.trim()
      ? Number(manualId.trim())
      : Number(selectedId);
    if (!Number.isFinite(apptId) || apptId <= 0) {
      setError(showManualId ? 'Enter a valid appointment ID.' : 'Select an appointment to link.');
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
  }, [manualId, selectedId, showManualId, item, onClose, onLinked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emptyHint = useMemo(() => {
    if (clientResolved === false) {
      return 'Could not match this request to a client record. Enter the appointment ID manually after booking.';
    }
    if (requestedDateHint) {
      return `No appointments found on or after ${requestedDateHint}. Create one through the normal booking flow first, then link it here — or enter the appointment ID below.`;
    }
    return 'No upcoming appointments found for this client. Create one through the normal booking flow first, then link it here — or enter the appointment ID below.';
  }, [clientResolved, requestedDateHint]);

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
        aria-labelledby="appt-request-manual-book-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Appointment request</p>
            <h2 id="appt-request-manual-book-title">Link booked appointment</h2>
            <p className="scheduler-modal-subtitle">{clientLabel}</p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}
          <p className="settings-muted" style={{ margin: 0 }}>
            Create the appointment through the normal booking flow first, then select it here to mark
            this request as booked.
            {requestedDateHint ? (
              <>
                {' '}
                Showing appointments on or after <strong>{requestedDateHint}</strong>.
              </>
            ) : null}
          </p>

          {loading ? (
            <p className="settings-muted">Loading appointments…</p>
          ) : options.length > 0 ? (
            <label className="scheduler-edit-field" style={{ display: 'block' }}>
              <span>Appointment</span>
              <select
                className="settings-input"
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setError(null);
                }}
                disabled={saving}
                style={{ width: '100%', maxWidth: '100%' }}
              >
                <option value="">Select appointment…</option>
                {options.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {formatLinkAppointmentOption(a, practiceTz)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="settings-muted">{emptyHint}</p>
          )}

          {(showManualId || options.length === 0) && (
            <label className="scheduler-edit-field" style={{ display: 'block' }}>
              <span>{options.length > 0 ? 'Or enter appointment ID' : 'Appointment ID'}</span>
              <input
                type="number"
                className="settings-input"
                value={manualId}
                onChange={(e) => {
                  setManualId(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. 98765"
                disabled={saving}
                style={{ width: '100%', maxWidth: '100%' }}
              />
            </label>
          )}
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleSave()}
            disabled={saving || loading || (!selectedId && !manualId.trim())}
          >
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
