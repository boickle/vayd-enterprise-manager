// Edit visit from scheduler — PATCH /appointments/:id
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { DateTime } from 'luxon';
import { patchAppointment, putAppointmentAlternateAddress } from '../api/appointments';
import type { Appointment, Patient } from '../api/roomLoader';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Provider } from '../api/employee';
import {
  appointmentPracticeDateKey,
  combineDateAndTimeToUtc,
  formatPracticeDateLabel,
  toTimeLocalValue,
} from '../utils/editVisitTimeFields';
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

export type SchedulerEditVisitModalHandle = {
  save: () => Promise<void>;
};

type Props = {
  appt: Appointment;
  practiceTz: string;
  appointmentTypes: AppointmentType[];
  providers: Provider[];
  accentColor: string;
  /** Overlay on routing pane before placement preview. */
  dockInRoutingPane?: boolean;
  /** Inline panel in split sidebar (main schedule or routing after View Placement). */
  inlinePaneMode?: boolean;
  placementPreviewActive?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onViewPlacement?: (startUtc: string, endUtc: string) => void;
  /** While placement preview is on the calendar, keep drive/calendar in sync. */
  onPlacementTimesChange?: (startUtc: string, endUtc: string) => void;
};

export const SchedulerEditVisitModal = forwardRef<SchedulerEditVisitModalHandle, Props>(
  function SchedulerEditVisitModal(
    {
      appt,
      practiceTz,
      appointmentTypes,
      providers,
      accentColor,
      dockInRoutingPane = false,
      inlinePaneMode = false,
      placementPreviewActive = false,
      onClose,
      onSaved,
      onViewPlacement,
      onPlacementTimesChange,
    },
    ref
  ) {
    const patients = useMemo(() => patientsForAppointment(appt), [appt]);

    const appointmentDateKey = useMemo(
      () => appointmentPracticeDateKey(appt.appointmentStart, practiceTz) ?? '',
      [appt.appointmentStart, practiceTz]
    );
    const appointmentDateLabel = useMemo(
      () => (appointmentDateKey ? formatPracticeDateLabel(appointmentDateKey, practiceTz) : '—'),
      [appointmentDateKey, practiceTz]
    );

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
    const [startTime, setStartTime] = useState(() =>
      toTimeLocalValue(appt.appointmentStart, practiceTz)
    );
    const [endTime, setEndTime] = useState(() => toTimeLocalValue(appt.appointmentEnd, practiceTz));
    const [alternateAddressText, setAlternateAddressText] = useState(
      () => appt.alternateAddress?.addressText ?? ''
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const patientLine = useMemo(() => {
      if (patients.length === 0) return '—';
      return patients.map((p) => p.name).join(', ');
    }, [patients]);

    const clientHomeSummary = useMemo(() => {
      const c = appt.client;
      if (!c) return null;
      const parts = [
        pickStr(c.address1),
        pickStr(c.address2),
        [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ') || null,
        pickStr(c.zipcode),
      ].filter(Boolean);
      return parts.length ? parts.join('\n') : null;
    }, [appt.client]);

    const buildStartEndUtc = useCallback(() => {
      const startUtc = combineDateAndTimeToUtc(appointmentDateKey, startTime, practiceTz);
      const endUtc = combineDateAndTimeToUtc(appointmentDateKey, endTime, practiceTz);
      return { startUtc, endUtc };
    }, [appointmentDateKey, startTime, endTime, practiceTz]);

    const timesDirty = useMemo(() => {
      const { startUtc, endUtc } = buildStartEndUtc();
      if (!startUtc || !endUtc) return false;
      return startUtc !== appt.appointmentStart || endUtc !== appt.appointmentEnd;
    }, [buildStartEndUtc, appt.appointmentStart, appt.appointmentEnd]);

    useEffect(() => {
      if (!placementPreviewActive || !onPlacementTimesChange) return;
      const { startUtc, endUtc } = buildStartEndUtc();
      if (startUtc && endUtc) onPlacementTimesChange(startUtc, endUtc);
    }, [startTime, endTime, placementPreviewActive, onPlacementTimesChange, buildStartEndUtc]);

    const handleSave = useCallback(async () => {
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
      const { startUtc, endUtc } = buildStartEndUtc();
      if (!startUtc || !endUtc) {
        setError('Start and end times are required.');
        return;
      }
      if (DateTime.fromISO(endUtc) <= DateTime.fromISO(startUtc)) {
        setError('End time must be after start time.');
        return;
      }
      const trimmedAlt = alternateAddressText.trim();
      if (trimmedAlt.length > 4000) {
        setError('Alternate address must be 4000 characters or fewer.');
        return;
      }
      const initialAlt = (appt.alternateAddress?.addressText ?? '').trim();
      const alternateDirty = initialAlt !== trimmedAlt;

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
        if (alternateDirty) {
          try {
            await putAppointmentAlternateAddress(appt.id, {
              addressText: trimmedAlt === '' ? null : trimmedAlt,
            });
          } catch (putErr: unknown) {
            onSaved();
            const ax = putErr as {
              response?: { data?: { message?: string | string[] } };
              message?: string;
            };
            const m = ax?.response?.data?.message;
            if (Array.isArray(m)) setError(`Visit saved, but alternate address failed: ${m.join(', ')}`);
            else if (typeof m === 'string' && m.trim())
              setError(`Visit saved, but alternate address failed: ${m}`);
            else if (ax?.message) setError(`Visit saved, but alternate address failed: ${ax.message}`);
            else setError('Visit saved, but the alternate address could not be updated. Try again.');
            return;
          }
        }
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
    }, [
      appointmentTypeId,
      primaryProviderId,
      buildStartEndUtc,
      alternateAddressText,
      appt,
      description,
      statusName,
      confirmStatusName,
      isComplete,
      onSaved,
      onClose,
    ]);

    useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

    function handleCancel() {
      onClose();
    }

    function handleViewPlacementClick() {
      setError(null);
      const { startUtc, endUtc } = buildStartEndUtc();
      if (!startUtc || !endUtc) {
        setError('Enter valid start and end times.');
        return;
      }
      if (DateTime.fromISO(endUtc) <= DateTime.fromISO(startUtc)) {
        setError('End time must be after start time.');
        return;
      }
      onViewPlacement?.(startUtc, endUtc);
    }

    const canViewPlacement = Boolean(onViewPlacement && timesDirty && !placementPreviewActive);

    const modalPanel = (
      <div
        className={[
          'scheduler-modal',
          'scheduler-modal--edit',
          inlinePaneMode ? 'scheduler-modal--edit-inline' : '',
          dockInRoutingPane ? 'scheduler-modal--edit-docked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal={!inlinePaneMode}
        aria-labelledby="scheduler-edit-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Edit visit</p>
            <h2 id="scheduler-edit-title">Edit Visit</h2>
            {placementPreviewActive ? (
              <p className="scheduler-edit-preview-hint">
                Preview on the calendar — use Adjust time on the visit or dismiss with ×.
              </p>
            ) : null}
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={handleCancel}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
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
                <span>Patient</span>
                <input type="text" readOnly value={patientLine} />
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

              <label className="scheduler-edit-field scheduler-edit-field--full">
                <span>Description</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>

              <div className="scheduler-edit-meta-row">
                <div className="scheduler-edit-field scheduler-edit-readonly">
                  <span>Created</span>
                  <div>
                    {pickStr(appt.created)
                      ? DateTime.fromISO(appt.created!).toLocaleString(DateTime.DATETIME_MED)
                      : '—'}
                  </div>
                </div>
                <div className="scheduler-edit-field scheduler-edit-readonly">
                  <span>Modified</span>
                  <div>
                    {pickStr(appt.updated)
                      ? DateTime.fromISO(appt.updated!).toLocaleString(DateTime.DATETIME_MED)
                      : '—'}
                  </div>
                </div>
              </div>

              <div className="scheduler-edit-time-block">
                <div className="scheduler-edit-field scheduler-edit-readonly">
                  <span>Date</span>
                  <div className="scheduler-edit-date-value">{appointmentDateLabel}</div>
                </div>
                <label className="scheduler-edit-field">
                  <span>Start time *</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </label>
                <label className="scheduler-edit-field">
                  <span>End time *</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </label>
              </div>
              <p className="scheduler-edit-hint scheduler-edit-hint--time">
                Date cannot be changed here. Adjust start and end times only.
              </p>

              {clientHomeSummary ? (
                <div className="scheduler-edit-field scheduler-edit-readonly">
                  <span>Client home address</span>
                  <div className="scheduler-edit-client-home">{clientHomeSummary}</div>
                </div>
              ) : null}

              <label className="scheduler-edit-field scheduler-edit-field--full">
                <span>Alternate address (routing)</span>
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={alternateAddressText}
                  onChange={(e) => setAlternateAddressText(e.target.value)}
                  placeholder="Leave blank to use the client's home address for routing."
                  aria-describedby="scheduler-edit-alt-hint"
                />
                <p id="scheduler-edit-alt-hint" className="scheduler-edit-hint">
                  Optional. Clear and save to remove ({alternateAddressText.length}/4000).
                </p>
              </label>
            </div>
          </section>
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" onClick={handleCancel} disabled={saving}>
            Cancel
          </button>
          {canViewPlacement ? (
            <button
              type="button"
              className="btn"
              onClick={handleViewPlacementClick}
              disabled={saving}
            >
              View Placement
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    );

    if (inlinePaneMode) {
      return <div className="scheduler-edit-inline-pane">{modalPanel}</div>;
    }

    return (
      <div
        className={
          dockInRoutingPane
            ? 'scheduler-modal-backdrop scheduler-modal-backdrop--routing-dock'
            : 'scheduler-modal-backdrop'
        }
        role="presentation"
        onMouseDown={handleCancel}
      >
        {modalPanel}
      </div>
    );
  }
);
