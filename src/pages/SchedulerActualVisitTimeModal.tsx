// Record actual visit start/end from scheduler context menu (single screen for both)
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

export type ActualVisitTimeField = 'start' | 'end' | 'both';

type Props = {
  appt: Appointment;
  /** `both` — combined Start / End Visit screen (default from context menu). */
  field?: ActualVisitTimeField;
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

function defaultStartTimeLocal(
  existingIso: string | null | undefined,
  practiceTz: string
): string {
  if (existingIso) return toTimeLocalValue(existingIso, practiceTz);
  return DateTime.now().setZone(practiceTz).toFormat('HH:mm');
}

function defaultEndTimeLocal(
  existingEndIso: string | null | undefined,
  existingStartIso: string | null | undefined,
  practiceTz: string
): string {
  if (existingEndIso) return toTimeLocalValue(existingEndIso, practiceTz);
  if (existingStartIso) return DateTime.now().setZone(practiceTz).toFormat('HH:mm');
  return '';
}

export function SchedulerActualVisitTimeModal({
  appt,
  field = 'both',
  practiceTz,
  accentColor,
  onClose,
  onSaved,
}: Props) {
  const isBoth = field === 'both';
  const isStartOnly = field === 'start';
  const isEndOnly = field === 'end';

  const existingStartIso = appt.appointmentStartActual ?? null;
  const existingEndIso = appt.appointmentEndActual ?? null;

  const dateKey = useMemo(() => {
    const ref = existingStartIso ?? existingEndIso ?? appt.appointmentStart;
    return appointmentPracticeDateKey(ref, practiceTz) ?? '';
  }, [existingStartIso, existingEndIso, appt.appointmentStart, practiceTz]);
  const dateLabel = useMemo(
    () => (dateKey ? formatPracticeDateLabel(dateKey, practiceTz) : '—'),
    [dateKey, practiceTz]
  );

  const [startTimeLocal, setStartTimeLocal] = useState(() =>
    isEndOnly ? '' : defaultStartTimeLocal(existingStartIso, practiceTz)
  );
  const [endTimeLocal, setEndTimeLocal] = useState(() =>
    isStartOnly ? '' : defaultEndTimeLocal(existingEndIso, existingStartIso, practiceTz)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = isBoth ? 'Start / End Visit' : isStartOnly ? 'Start visit' : 'End visit';

  const saveStart = useCallback(
    async (body: { at?: string; clear?: boolean }) => postAppointmentActualStart(appt.id, body),
    [appt.id]
  );

  const saveEnd = useCallback(
    async (body: { at?: string; clear?: boolean }) => postAppointmentActualEnd(appt.id, body),
    [appt.id]
  );

  const postBoth = useCallback(
    async (opts: {
      start?: { at?: string; clear?: boolean };
      end?: { at?: string; clear?: boolean };
    }) => {
      setSaving(true);
      setError(null);
      try {
        let updated = appt;
        if (opts.start) updated = await saveStart(opts.start);
        if (opts.end) updated = await saveEnd(opts.end);
        onSaved(updated);
        onClose();
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
        const m = ax?.response?.data?.message;
        if (Array.isArray(m)) setError(m.join(', '));
        else if (typeof m === 'string' && m.trim()) setError(m);
        else if (ax?.message) setError(ax.message);
        else setError('Could not save visit times.');
      } finally {
        setSaving(false);
      }
    },
    [appt, onClose, onSaved, saveEnd, saveStart]
  );

  const handleSave = () => {
    if (!dateKey) {
      setError('Could not determine visit date.');
      return;
    }
    if (isStartOnly) {
      const at = combineDateAndTimeToUtc(dateKey, startTimeLocal, practiceTz);
      if (!at) {
        setError('Enter a valid start time.');
        return;
      }
      void postBoth({ start: { at } });
      return;
    }
    if (isEndOnly) {
      const at = combineDateAndTimeToUtc(dateKey, endTimeLocal, practiceTz);
      if (!at) {
        setError('Enter a valid end time.');
        return;
      }
      void postBoth({ end: { at } });
      return;
    }
    const startAt = startTimeLocal.trim()
      ? combineDateAndTimeToUtc(dateKey, startTimeLocal, practiceTz)
      : null;
    const endAt = endTimeLocal.trim()
      ? combineDateAndTimeToUtc(dateKey, endTimeLocal, practiceTz)
      : null;
    if (!startAt && !endAt) {
      setError('Enter at least one time.');
      return;
    }
    if (startTimeLocal.trim() && !startAt) {
      setError('Enter a valid start time.');
      return;
    }
    if (endTimeLocal.trim() && !endAt) {
      setError('Enter a valid end time.');
      return;
    }
    void postBoth({
      ...(startAt ? { start: { at: startAt } } : {}),
      ...(endAt ? { end: { at: endAt } } : {}),
    });
  };

  const handleClearStart = () => void postBoth({ start: { clear: true } });
  const handleClearEnd = () => void postBoth({ end: { clear: true } });

  const handleUseNowStart = () => {
    setStartTimeLocal(DateTime.now().setZone(practiceTz).toFormat('HH:mm'));
    if (!endTimeLocal.trim() && (existingStartIso || startTimeLocal)) {
      setEndTimeLocal(DateTime.now().setZone(practiceTz).toFormat('HH:mm'));
    }
  };

  const handleUseNowEnd = () => {
    setEndTimeLocal(DateTime.now().setZone(practiceTz).toFormat('HH:mm'));
  };

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
            <p className="scheduler-modal-eyebrow">Visit times</p>
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
              {existingStartIso || existingEndIso ? (
                <>
                  <br />
                  Recorded:{' '}
                  {existingStartIso ? formatPracticeTime(existingStartIso, practiceTz) : '—'}
                  {' – '}
                  {existingEndIso ? formatPracticeTime(existingEndIso, practiceTz) : '—'}
                </>
              ) : null}
            </p>

            <div className="scheduler-edit-grid">
              <div className="scheduler-edit-field scheduler-edit-readonly">
                <span>Date</span>
                <input type="text" readOnly value={dateLabel} />
              </div>

              {!isEndOnly ? (
                <label className="scheduler-edit-field">
                  <span>Actual start time</span>
                  <input
                    type="time"
                    value={startTimeLocal}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStartTimeLocal(v);
                      if (v.trim() && !endTimeLocal.trim() && !existingEndIso) {
                        setEndTimeLocal(DateTime.now().setZone(practiceTz).toFormat('HH:mm'));
                      }
                    }}
                    disabled={saving}
                  />
                </label>
              ) : null}

              {!isStartOnly ? (
                <label className="scheduler-edit-field">
                  <span>Actual end time</span>
                  <input
                    type="time"
                    value={endTimeLocal}
                    onChange={(e) => setEndTimeLocal(e.target.value)}
                    disabled={saving}
                  />
                </label>
              ) : null}
            </div>
          </section>
        </div>

        <div className="scheduler-edit-footer scheduler-actual-visit-footer">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          {existingStartIso && !isEndOnly ? (
            <button type="button" className="btn secondary" disabled={saving} onClick={handleClearStart}>
              Clear start
            </button>
          ) : null}
          {existingEndIso && !isStartOnly ? (
            <button type="button" className="btn secondary" disabled={saving} onClick={handleClearEnd}>
              Clear end
            </button>
          ) : null}
          {!isEndOnly ? (
            <button type="button" className="btn secondary" disabled={saving} onClick={handleUseNowStart}>
              Now (start)
            </button>
          ) : null}
          {!isStartOnly ? (
            <button type="button" className="btn secondary" disabled={saving} onClick={handleUseNowEnd}>
              Now (end)
            </button>
          ) : null}
          <button type="button" className="btn" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
