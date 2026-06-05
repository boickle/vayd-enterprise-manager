import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  completeForwardBooking,
  fetchForwardBookingFutureAppointments,
  type ForwardBookingEntry,
  type ForwardBookingFutureAppointment,
} from '../api/forwardBooking';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import '../pages/Scheduler.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type Props = {
  entry: ForwardBookingEntry;
  onClose: () => void;
  onCompleted: (updated: ForwardBookingEntry) => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function formatApptOption(a: ForwardBookingFutureAppointment, practiceTz: string): string {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const end = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  const datePart = start.isValid ? start.toFormat('EEE, MMM d, yyyy') : '—';
  const timePart =
    start.isValid && end.isValid
      ? `${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`
      : start.isValid
        ? start.toFormat('h:mm a')
        : '—';
  const typeName =
    pickStr(a.appointmentType?.prettyName) ?? pickStr(a.appointmentType?.name) ?? '';
  const pet = pickStr(a.patient?.name) ?? '';
  const desc = pickStr(a.description);
  const parts = [datePart, timePart, typeName, pet, desc].filter(Boolean);
  return parts.join(' · ');
}

export function ForwardBookingManualCompleteModal({ entry, onClose, onCompleted }: Props) {
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ForwardBookingFutureAppointment[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  const clientLabel = useMemo(() => {
    const c = entry.client;
    if (!c) return 'Client';
    return (
      [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() || `Client #${c.id}`
    );
  }, [entry.client]);

  const patientLabel = pickStr(entry.patient?.name) ?? `Patient #${entry.patientId}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchForwardBookingFutureAppointments(entry.id, {
        practiceId: PRACTICE_ID,
        asOf: new Date().toISOString(),
      });
      setOptions(list);
      if (list.length === 1 && list[0]?.id != null) {
        setSelectedId(String(list[0].id));
      }
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not load future appointments.');
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [entry.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const apptId = Number(selectedId);
    if (!Number.isFinite(apptId) || apptId <= 0) {
      setError('Select a future appointment to link.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await completeForwardBooking(entry.id, {
        appointmentId: apptId,
        completedVia: 'manual',
      });
      onCompleted(updated);
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not mark forward booking complete.');
    } finally {
      setSaving(false);
    }
  };

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
        aria-labelledby="forward-booking-manual-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Forward booking</p>
            <h2 id="forward-booking-manual-title">Mark complete manually</h2>
            <p className="scheduler-modal-subtitle">
              {clientLabel}
              <span className="scheduler-modal-subtitle-sep">·</span>
              {patientLabel}
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Link an existing future appointment for this client and patient. The forward booking will
            show as booked in the list until that visit occurs.
          </p>

          {loading ? (
            <p className="settings-muted">Loading appointments…</p>
          ) : options.length === 0 ? (
            <p className="settings-muted">
              No future appointments found for this client and patient. Schedule one on the calendar
              first, or use Book to create one via routing.
            </p>
          ) : (
            <label className="scheduler-edit-field" style={{ display: 'block' }}>
              <span>Future appointment</span>
              <select
                className="settings-input"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={saving}
                style={{ width: '100%', maxWidth: '100%' }}
              >
                <option value="">Select appointment…</option>
                {options.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {formatApptOption(a, practiceTz)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving || loading || options.length === 0}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Mark complete'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
