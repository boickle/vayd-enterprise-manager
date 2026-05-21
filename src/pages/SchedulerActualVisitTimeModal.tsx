// Record actual visit start/end from scheduler context menu
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  postAppointmentActualEnd,
  postAppointmentActualStart,
} from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import {
  appointmentPracticeDateKey,
  combineDateAndTimeToUtc,
  formatPracticeDateLabel,
  toTimeLocalValue,
} from '../utils/editVisitTimeFields';
import './Scheduler.css';

export type ActualVisitTimeField = 'start' | 'end';

type Props = {
  appt: Appointment;
  field: ActualVisitTimeField;
  practiceTz: string;
  accentColor: string;
  onClose: () => void;
  onSaved: (updated: Appointment) => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function formatPracticeTime(isoUtc: string | null | undefined, practiceTz: string): string {
  if (!isoUtc) return '—';
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(practiceTz);
  return dt.isValid ? dt.toFormat('h:mm a') : '—';
}

function patientsLabel(appt: Appointment): string {
  const multi = (appt as { patients?: { name?: string | null }[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    return multi.map((p) => pickStr(p.name) ?? '—').join(', ');
  }
  return pickStr(appt.patient?.name) ?? '—';
}

export function SchedulerActualVisitTimeModal({
  appt,
  field,
  practiceTz,
  accentColor,
  onClose,
  onSaved,
}: Props) {
  const isStart = field === 'start';
  const existingIso = isStart ? appt.appointmentStartActual : appt.appointmentEndActual;
  const dateKey = useMemo(() => {
    const ref = existingIso ?? appt.appointmentStart;
    return appointmentPracticeDateKey(ref, practiceTz) ?? '';
  }, [existingIso, appt.appointmentStart, practiceTz]);
  const dateLabel = useMemo(
    () => (dateKey ? formatPracticeDateLabel(dateKey, practiceTz) : '—'),
    [dateKey, practiceTz]
  );

  const [timeLocal, setTimeLocal] = useState(() => {
    if (existingIso) return toTimeLocalValue(existingIso, practiceTz);
    return DateTime.now().setZone(practiceTz).toFormat('HH:mm');
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = isStart ? 'Start visit' : 'End visit';
  const fieldLabel = isStart ? 'Actual start time' : 'Actual end time';

  const post = useCallback(
    async (body: { at?: string; clear?: boolean }) => {
      setSaving(true);
      setError(null);
      try {
        const updated = isStart
          ? await postAppointmentActualStart(appt.id, body)
          : await postAppointmentActualEnd(appt.id, body);
        onSaved(updated);
        onClose();
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
        const m = ax?.response?.data?.message;
        if (Array.isArray(m)) setError(m.join(', '));
        else if (typeof m === 'string' && m.trim()) setError(m);
        else if (ax?.message) setError(ax.message);
        else setError('Could not save visit time.');
      } finally {
        setSaving(false);
      }
    },
    [appt.id, isStart, onClose, onSaved]
  );

  const handleUseNow = () => void post({});

  const handleSaveTime = () => {
    if (!dateKey) {
      setError('Could not determine visit date.');
      return;
    }
    const at = combineDateAndTimeToUtc(dateKey, timeLocal, practiceTz);
    if (!at) {
      setError('Enter a valid time.');
      return;
    }
    void post({ at });
  };

  const handleClear = () => void post({ clear: true });

  const clientName = useMemo(() => {
    const c = appt.client;
    if (!c) return '—';
    const fn = pickStr(c.firstName);
    const ln = pickStr(c.lastName);
    return [fn, ln].filter(Boolean).join(' ').trim() || '—';
  }, [appt.client]);

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
        aria-labelledby="scheduler-actual-visit-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">{title}</p>
            <h2 id="scheduler-actual-visit-title">{title}</h2>
            <p className="scheduler-modal-subtitle">
              {clientName}
              <span className="scheduler-modal-subtitle-sep">·</span>
              {patientsLabel(appt)}
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}

          <section className="scheduler-modal-section">
            <p className="scheduler-actual-visit-scheduled">
              Scheduled: {formatPracticeTime(appt.appointmentStart, practiceTz)} –{' '}
              {formatPracticeTime(appt.appointmentEnd, practiceTz)}
              {existingIso ? (
                <>
                  <br />
                  Recorded {isStart ? 'start' : 'end'}: {formatPracticeTime(existingIso, practiceTz)}
                </>
              ) : null}
            </p>

            <div className="scheduler-edit-grid">
              <div className="scheduler-edit-field scheduler-edit-readonly">
                <span>Date</span>
                <input type="text" readOnly value={dateLabel} />
              </div>

              <label className="scheduler-edit-field">
                <span>{fieldLabel}</span>
                <input
                  type="time"
                  value={timeLocal}
                  onChange={(e) => setTimeLocal(e.target.value)}
                  disabled={saving}
                />
              </label>
            </div>

          </section>
        </div>

        <div className="scheduler-edit-footer scheduler-actual-visit-footer">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          {existingIso ? (
            <button type="button" className="btn secondary" disabled={saving} onClick={handleClear}>
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="btn secondary"
            disabled={saving || !timeLocal.trim()}
            onClick={handleSaveTime}
          >
            {saving ? 'Saving…' : 'Save entered time'}
          </button>
          <button type="button" className="btn" disabled={saving} onClick={handleUseNow}>
            {saving ? 'Saving…' : 'Use current time'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
