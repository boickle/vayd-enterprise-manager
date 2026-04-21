// Edit visit from scheduler — PATCH /appointments/:id
import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { patchAppointment } from '../api/appointments';
import type { Appointment, Patient } from '../api/roomLoader';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Provider } from '../api/employee';
import './Scheduler.css';

function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function toDatetimeLocalValue(isoUtc: string, practiceTz: string): string {
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '';
  return dt.toFormat("yyyy-LL-dd'T'HH:mm");
}

function fromDatetimeLocalToUtc(value: string, practiceTz: string): string | null {
  const dt = DateTime.fromISO(value, { zone: practiceTz });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

type Props = {
  appt: Appointment;
  practiceTz: string;
  appointmentTypes: AppointmentType[];
  providers: Provider[];
  accentColor: string;
  onClose: () => void;
  onSaved: () => void;
};

export function SchedulerEditVisitModal({
  appt,
  practiceTz,
  appointmentTypes,
  providers,
  accentColor,
  onClose,
  onSaved,
}: Props) {
  const patients = useMemo(() => patientsForAppointment(appt), [appt]);

  const [appointmentTypeId, setAppointmentTypeId] = useState<string>(
    String(appt.appointmentType?.id ?? '')
  );
  const [primaryProviderId, setPrimaryProviderId] = useState<string>(
    String(appt.primaryProvider?.id ?? '')
  );
  const [description, setDescription] = useState(appt.description ?? '');
  const [statusName, setStatusName] = useState(appt.statusName ?? '');
  const [confirmStatusName, setConfirmStatusName] = useState(appt.confirmStatusName ?? '');
  const [isComplete, setIsComplete] = useState(appt.isComplete);
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(appt.appointmentStart, practiceTz));
  const [endLocal, setEndLocal] = useState(() => toDatetimeLocalValue(appt.appointmentEnd, practiceTz));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patientLine = useMemo(() => {
    if (patients.length === 0) return '—';
    return patients.map((p) => p.name).join(', ');
  }, [patients]);

  async function handleSave() {
    setError(null);
    const tid = Number(appointmentTypeId);
    const pid = Number(primaryProviderId);
    if (!Number.isFinite(tid) || tid <= 0) {
      setError('Choose a valid appointment type.');
      return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      setError('Choose a primary provider.');
      return;
    }
    const startUtc = fromDatetimeLocalToUtc(startLocal, practiceTz);
    const endUtc = fromDatetimeLocalToUtc(endLocal, practiceTz);
    if (!startUtc || !endUtc) {
      setError('Start and end date/time are required.');
      return;
    }
    setSaving(true);
    try {
      await patchAppointment(appt.id, {
        appointmentTypeId: tid,
        primaryProviderId: pid,
        description: description.trim() || null,
        statusName: statusName.trim() || null,
        confirmStatusName: confirmStatusName.trim() || null,
        isComplete,
        appointmentStart: startUtc,
        appointmentEnd: endUtc,
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const m = ax?.response?.data?.message;
      if (Array.isArray(m)) setError(m.join(', '));
      else if (typeof m === 'string' && m.trim()) setError(m);
      else if (ax?.message) setError(ax.message);
      else setError('Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="scheduler-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="scheduler-modal scheduler-modal--edit"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-edit-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Edit visit</p>
            <h2 id="scheduler-edit-title">Edit Visit</h2>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}

          <section className="scheduler-modal-section">
            <div className="scheduler-edit-grid">
              <label className="scheduler-edit-field">
                <span>Type *</span>
                <select
                  value={appointmentTypeId}
                  onChange={(e) => setAppointmentTypeId(e.target.value)}
                >
                  <option value="">—</option>
                  {appointmentTypes.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.prettyName || t.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="scheduler-edit-field scheduler-edit-field--full">
                <span>Description</span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>

              <label className="scheduler-edit-field">
                <span>Patient</span>
                <input type="text" readOnly value={patientLine} />
              </label>

              <label className="scheduler-edit-field">
                <span>Primary provider *</span>
                <select
                  value={primaryProviderId}
                  onChange={(e) => setPrimaryProviderId(e.target.value)}
                >
                  <option value="">—</option>
                  {providers.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="scheduler-edit-field">
                <span>Status</span>
                <input
                  type="text"
                  value={statusName}
                  onChange={(e) => setStatusName(e.target.value)}
                  placeholder="— None —"
                />
              </label>

              <label className="scheduler-edit-field">
                <span>Confirm status</span>
                <input
                  type="text"
                  value={confirmStatusName}
                  onChange={(e) => setConfirmStatusName(e.target.value)}
                  placeholder="—"
                />
              </label>

              <label className="scheduler-edit-field scheduler-edit-field--checkbox">
                <input
                  type="checkbox"
                  checked={isComplete}
                  onChange={(e) => setIsComplete(e.target.checked)}
                />
                <span>Is complete</span>
              </label>

              <div className="scheduler-edit-field scheduler-edit-field--full scheduler-edit-readonly">
                <span>Created</span>
                <div>{pickStr(appt.created) ? DateTime.fromISO(appt.created!).toLocaleString(DateTime.DATETIME_MED) : '—'}</div>
              </div>
              <div className="scheduler-edit-field scheduler-edit-field--full scheduler-edit-readonly">
                <span>Modified</span>
                <div>{pickStr(appt.updated) ? DateTime.fromISO(appt.updated!).toLocaleString(DateTime.DATETIME_MED) : '—'}</div>
              </div>

              <label className="scheduler-edit-field scheduler-edit-field--full">
                <span>Appointment start *</span>
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </label>

              <label className="scheduler-edit-field scheduler-edit-field--full">
                <span>Appointment end *</span>
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                />
              </label>
            </div>
          </section>
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
