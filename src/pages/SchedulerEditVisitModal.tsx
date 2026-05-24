// Edit visit from scheduler — PATCH /appointments/:id
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DateTime } from 'luxon';
import { commitEditVisit, type EditVisitFormSnapshot } from '../utils/editVisitCommit';
import type { Appointment } from '../api/roomLoader';
import {
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
} from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Provider } from '../api/employee';
import {
  appointmentPracticeDateKey,
  combineDateAndTimeToUtc,
  formatPracticeDateLabel,
  toTimeLocalValue,
} from '../utils/editVisitTimeFields';
import type { EditVisitPreviewKind } from '../utils/editVisitTimePreview';
import type { EditVisitPreviewScoreCompare } from '../utils/editVisitTypeScoreCompare';
import { EditVisitOverflowTag } from '../components/EditVisitOverflowTag';
import {
  SchedulerVisitClientHeaderAlerts,
  SchedulerVisitClientZoneBadge,
  SchedulerVisitPatientContext,
} from '../components/SchedulerVisitPatientContext';
import { submitEditVisitPreviewAcceptedFeedback } from '../utils/routingBookFeedback';
import { fullClientHouseholdName } from '../utils/schedulerVisitDisplay';
import './Scheduler.css';

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
  practiceId: number;
  practiceTz: string;
  appointmentTypes: AppointmentType[];
  providers: Provider[];
  accentColor: string;
  /** Overlay on routing pane before placement preview. */
  dockInRoutingPane?: boolean;
  /** Inline panel in split sidebar (main schedule or routing after View Placement). */
  inlinePaneMode?: boolean;
  placementPreviewActive?: boolean;
  placementPreviewKind?: EditVisitPreviewKind | null;
  /** When type preview is on the calendar, PATCH uses this id (matches preview storage). */
  draftPreviewAppointmentTypeId?: number | null;
  /** Authoritative preview times while placement preview is active (survives sidebar portal remount). */
  draftPreviewAppointmentStart?: string | null;
  draftPreviewAppointmentEnd?: string | null;
  /** Latest form values for calendar Book / Adjust time. */
  onFormSnapshotChange?: (snapshot: EditVisitFormSnapshot | null) => void;
  onClose: () => void;
  onSaved: (updated?: Appointment, detail?: { routingFeedbackWarning?: string }) => void;
  onViewPlacement?: (startUtc: string, endUtc: string) => void;
  /** Preview drive/windows when only the appointment type changes (times unchanged). */
  onPreviewSchedule?: (startUtc: string, endUtc: string, appointmentTypeId: number) => void;
  /** While placement preview is on the calendar, keep drive/calendar in sync. */
  onPlacementTimesChange?: (
    startUtc: string,
    endUtc: string,
    appointmentTypeId: number,
    kind: EditVisitPreviewKind
  ) => void;
  typeScoreCompare?: EditVisitPreviewScoreCompare | null;
  typeScoreLoading?: boolean;
  typeScoreError?: string | null;
  /** Shown after Book from type preview (split view stays open). */
  bookedSummary?: string | null;
};

export const SchedulerEditVisitModal = forwardRef<SchedulerEditVisitModalHandle, Props>(
  function SchedulerEditVisitModal(
    {
      appt,
      practiceId,
      practiceTz,
      appointmentTypes,
      providers,
      accentColor,
      dockInRoutingPane = false,
      inlinePaneMode = false,
      placementPreviewActive = false,
      placementPreviewKind = null,
      draftPreviewAppointmentTypeId = null,
      draftPreviewAppointmentStart = null,
      draftPreviewAppointmentEnd = null,
      onFormSnapshotChange,
      onClose,
      onSaved,
      onViewPlacement,
      onPreviewSchedule,
      onPlacementTimesChange,
      typeScoreCompare = null,
      typeScoreLoading = false,
      typeScoreError = null,
      bookedSummary = null,
    },
    ref
  ) {
    const appointmentDateKey = useMemo(
      () => appointmentPracticeDateKey(appt.appointmentStart, practiceTz) ?? '',
      [appt.appointmentStart, practiceTz]
    );
    const appointmentDateLabel = useMemo(
      () => (appointmentDateKey ? formatPracticeDateLabel(appointmentDateKey, practiceTz) : '—'),
      [appointmentDateKey, practiceTz]
    );

    const [appointmentTypeId, setAppointmentTypeId] = useState<string>(() => {
      if (
        placementPreviewKind === 'type' &&
        draftPreviewAppointmentTypeId != null &&
        Number.isFinite(Number(draftPreviewAppointmentTypeId))
      ) {
        return String(draftPreviewAppointmentTypeId);
      }
      return String(appt.appointmentType?.id ?? '');
    });
    const primaryProviderId = String(appt.primaryProvider?.id ?? '');
    const [description, setDescription] = useState(appt.description ?? '');
    const statusName = appt.statusName ?? '';
    const confirmStatusName = appt.confirmStatusName ?? '';
    const isComplete = appt.isComplete;
    const [startTime, setStartTime] = useState(() =>
      toTimeLocalValue(appt.appointmentStart, practiceTz)
    );
    const [endTime, setEndTime] = useState(() => toTimeLocalValue(appt.appointmentEnd, practiceTz));
    const alternateAddressText = appointmentAlternateAddressText(appt) ?? '';
    const hasAlternateRoutingAddress = appointmentHasAlternateLocation(appt);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const placementPreviewWasActiveRef = useRef(false);

    const visitStartEnd = useMemo(() => {
      const start = DateTime.fromISO(appt.appointmentStart, { zone: practiceTz });
      const end = DateTime.fromISO(appt.appointmentEnd, { zone: practiceTz });
      return { start, end };
    }, [appt.appointmentStart, appt.appointmentEnd, practiceTz]);

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

    const initialTypeId = String(appt.appointmentType?.id ?? '');

    const timesDirty = useMemo(() => {
      const origStart = toTimeLocalValue(appt.appointmentStart, practiceTz);
      const origEnd = toTimeLocalValue(appt.appointmentEnd, practiceTz);
      return startTime.trim() !== origStart || endTime.trim() !== origEnd;
    }, [appt.appointmentStart, appt.appointmentEnd, practiceTz, startTime, endTime]);

    const typeDirty = appointmentTypeId !== initialTypeId;

    const previewKind: EditVisitPreviewKind = timesDirty ? 'time' : 'type';

    const effectiveAppointmentTypeId = useMemo(() => {
      if (
        placementPreviewKind === 'type' &&
        draftPreviewAppointmentTypeId != null &&
        Number.isFinite(Number(draftPreviewAppointmentTypeId))
      ) {
        return Number(draftPreviewAppointmentTypeId);
      }
      return Number(appointmentTypeId);
    }, [placementPreviewKind, draftPreviewAppointmentTypeId, appointmentTypeId]);

    useEffect(() => {
      if (
        placementPreviewActive &&
        placementPreviewKind === 'type' &&
        draftPreviewAppointmentTypeId != null &&
        Number.isFinite(Number(draftPreviewAppointmentTypeId))
      ) {
        const next = String(draftPreviewAppointmentTypeId);
        setAppointmentTypeId((prev) => (prev === next ? prev : next));
      }
    }, [placementPreviewActive, placementPreviewKind, draftPreviewAppointmentTypeId]);

    useEffect(() => {
      if (!onFormSnapshotChange) return;
      const tid = effectiveAppointmentTypeId;
      const pid = Number(primaryProviderId);
      if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(pid) || pid <= 0) {
        onFormSnapshotChange(null);
        return;
      }
      onFormSnapshotChange({
        appointmentTypeId: tid,
        primaryProviderId: pid,
        description,
        statusName,
        confirmStatusName,
        isComplete,
        alternateAddressText,
        initialAlternateAddressText: (appt.alternateAddress?.addressText ?? '').trim(),
      });
    }, [
      onFormSnapshotChange,
      effectiveAppointmentTypeId,
      primaryProviderId,
      description,
      statusName,
      confirmStatusName,
      isComplete,
      alternateAddressText,
      appt.alternateAddress?.addressText,
    ]);

    useLayoutEffect(() => {
      if (!placementPreviewActive || !draftPreviewAppointmentStart || !draftPreviewAppointmentEnd) {
        return;
      }
      const nextStart = toTimeLocalValue(draftPreviewAppointmentStart, practiceTz);
      const nextEnd = toTimeLocalValue(draftPreviewAppointmentEnd, practiceTz);
      if (nextStart) setStartTime(nextStart);
      if (nextEnd) setEndTime(nextEnd);
    }, [
      placementPreviewActive,
      draftPreviewAppointmentStart,
      draftPreviewAppointmentEnd,
      practiceTz,
    ]);

    useEffect(() => {
      if (!placementPreviewActive || !onPlacementTimesChange) {
        placementPreviewWasActiveRef.current = false;
        return;
      }
      const justActivated = !placementPreviewWasActiveRef.current;
      placementPreviewWasActiveRef.current = true;
      // Preview times were set by View Placement / Preview schedule — do not overwrite on mount
      // (sidebar portal remount resets local time fields to saved appointment times).
      if (justActivated) return;

      const { startUtc, endUtc } = buildStartEndUtc();
      const tid = effectiveAppointmentTypeId;
      if (!startUtc || !endUtc || !Number.isFinite(tid) || tid <= 0) return;
      onPlacementTimesChange(startUtc, endUtc, tid, previewKind);
    }, [
      startTime,
      endTime,
      effectiveAppointmentTypeId,
      placementPreviewActive,
      onPlacementTimesChange,
      buildStartEndUtc,
      previewKind,
    ]);

    const handleSave = useCallback(async () => {
      setError(null);
      const tidFromPreview =
        placementPreviewActive &&
        placementPreviewKind === 'type' &&
        draftPreviewAppointmentTypeId != null &&
        Number.isFinite(Number(draftPreviewAppointmentTypeId))
          ? Number(draftPreviewAppointmentTypeId)
          : null;
      const tid = tidFromPreview ?? Number(appointmentTypeId);
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

      setSaving(true);
      try {
        const updated = await commitEditVisit({
          appointmentId: Number(appt.id),
          practiceId,
          appointmentStart: startUtc,
          appointmentEnd: endUtc,
          form: {
            appointmentTypeId: tid,
            primaryProviderId: pid,
            description,
            statusName,
            confirmStatusName,
            isComplete,
            alternateAddressText,
            initialAlternateAddressText: alternateAddressText,
          },
          previewAppointmentTypeId: tidFromPreview,
        });
        let routingFeedbackWarning: string | undefined;
        if (placementPreviewActive && typeScoreCompare?.feedbackHandoff) {
          const fb = await submitEditVisitPreviewAcceptedFeedback(typeScoreCompare.feedbackHandoff);
          if (!fb.submitted && fb.error) {
            routingFeedbackWarning =
              'Appointment saved, but routing score could not be linked. ' + fb.error;
          }
        }
        onSaved(updated, routingFeedbackWarning ? { routingFeedbackWarning } : undefined);
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
      practiceId,
      placementPreviewActive,
      placementPreviewKind,
      draftPreviewAppointmentTypeId,
      typeScoreCompare,
      onSaved,
      onClose,
    ]);

    useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

    function handleCancel() {
      onClose();
    }

    function validateTimes(): { startUtc: string; endUtc: string } | null {
      setError(null);
      const { startUtc, endUtc } = buildStartEndUtc();
      if (!startUtc || !endUtc) {
        setError('Enter valid start and end times.');
        return null;
      }
      if (DateTime.fromISO(endUtc) <= DateTime.fromISO(startUtc)) {
        setError('End time must be after start time.');
        return null;
      }
      return { startUtc, endUtc };
    }

    function handleViewPlacementClick() {
      const times = validateTimes();
      if (!times) return;
      onViewPlacement?.(times.startUtc, times.endUtc);
    }

    function handlePreviewScheduleClick() {
      const times = validateTimes();
      if (!times) return;
      const tid = Number(appointmentTypeId);
      if (!Number.isFinite(tid) || tid <= 0) {
        setError('Choose a valid appointment type.');
        return;
      }
      onPreviewSchedule?.(times.startUtc, times.endUtc, tid);
    }

    const canViewPlacement = Boolean(onViewPlacement && timesDirty && !placementPreviewActive);
    const canPreviewSchedule = Boolean(onPreviewSchedule && typeDirty && !placementPreviewActive);

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
            <h2 id="scheduler-edit-title" className="scheduler-modal-title-h">
              <span className="scheduler-modal-title-client">
                {fullClientHouseholdName(appt.client)}
              </span>
              <SchedulerVisitClientZoneBadge appt={appt} compact />
            </h2>
            <SchedulerVisitClientHeaderAlerts appt={appt} />
            <SchedulerVisitPatientContext appt={appt} providers={providers} practiceTz={practiceTz} />
            {visitStartEnd.start.isValid && visitStartEnd.end.isValid ? (
              <p className="scheduler-modal-subtitle">
                {visitStartEnd.start.toFormat('EEEE, MMMM d, yyyy')}
                <span className="scheduler-modal-subtitle-sep">·</span>
                {visitStartEnd.start.toFormat('h:mm a')} – {visitStartEnd.end.toFormat('h:mm a')}
              </p>
            ) : (
              <p className="scheduler-modal-subtitle">{appointmentDateLabel}</p>
            )}
            {bookedSummary ? (
              <p className="scheduler-edit-booked-summary" role="status">
                {bookedSummary}
              </p>
            ) : placementPreviewActive ? (
              <p className="scheduler-edit-preview-hint">
                {placementPreviewKind === 'type'
                  ? 'Appointment type preview on the calendar — hover the visit to book or dismiss (×).'
                  : 'Time preview on the calendar — hover the visit for Adjust time or dismiss (×).'}
              </p>
            ) : null}
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={handleCancel}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}

          {placementPreviewActive ? (
            <div
              className="scheduler-edit-type-score-panel"
              role="status"
              aria-live="polite"
            >
              <p className="scheduler-edit-type-score-panel-title">
                {placementPreviewKind === 'type'
                  ? 'Routing score (same slot, in-place compare)'
                  : 'Routing score (proposed time, in-place compare)'}
              </p>
              {typeScoreLoading ? (
                <p className="scheduler-edit-hint">
                  {placementPreviewKind === 'type'
                    ? 'Comparing scores for the new appointment type…'
                    : 'Comparing scores for the proposed time…'}
                </p>
              ) : typeScoreError ? (
                <p className="scheduler-edit-hint scheduler-edit-type-score-panel-error">
                  {typeScoreError}
                </p>
              ) : typeScoreCompare?.summaryLine ||
                typeScoreCompare?.originalScoreLine ||
                typeScoreCompare?.newTypeUnavailableLine ||
                typeScoreCompare?.overflowOverrunSeconds != null ? (
                <>
                  {typeScoreCompare.summaryLine ? (
                    <p className="scheduler-edit-type-score-panel-line">{typeScoreCompare.summaryLine}</p>
                  ) : null}
                  {typeScoreCompare.originalScoreLine &&
                  typeScoreCompare.originalScoreLine !== typeScoreCompare.summaryLine ? (
                    <p className="scheduler-edit-type-score-panel-line scheduler-edit-hint">
                      {typeScoreCompare.originalScoreLine}
                    </p>
                  ) : null}
                  {typeScoreCompare.newTypeUnavailableLine ? (
                    <p className="scheduler-edit-hint scheduler-edit-type-score-panel-unavailable">
                      {typeScoreCompare.newTypeUnavailableLine}
                    </p>
                  ) : null}
                  {typeScoreCompare.overflowOverrunSeconds != null ? (
                    <EditVisitOverflowTag overrunSeconds={typeScoreCompare.overflowOverrunSeconds} />
                  ) : null}
                  {placementPreviewKind === 'type' && typeScoreCompare.windowLine ? (
                    <p className="scheduler-edit-hint">
                      {typeScoreCompare.windowLine}
                      {typeScoreCompare.windowWarningMayChange
                        ? ' Window warnings on the calendar may change after you book.'
                        : null}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="scheduler-edit-hint">Score comparison will appear when routing data loads.</p>
              )}
            </div>
          ) : null}

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
                      {t.name || t.prettyName}
                    </option>
                  ))}
                </select>
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
                Date can only be changed by rescheduling. Adjust start and end times only.
              </p>

              {hasAlternateRoutingAddress ? (
                <div
                  className="scheduler-edit-alternate-callout"
                  role="alert"
                  aria-label="Alternate routing address"
                >
                  <div className="scheduler-edit-alternate-callout-head">
                    <span
                      className="scheduler-alt-location-badge scheduler-alt-location-badge--callout"
                      title="Alternate routing address (overrides client home for drive time)"
                      aria-hidden
                    >
                      ALT
                    </span>
                    <span className="scheduler-edit-alternate-callout-title">
                      Alternate address (routing)
                    </span>
                  </div>
                  <p className="scheduler-edit-alternate-callout-lead">
                    This visit routes to a different stop than the client&apos;s home address.
                  </p>
                  <p className="scheduler-edit-alternate-callout-address">
                    {alternateAddressText || 'Alternate address on file (loading…)'}
                  </p>
                  {clientHomeSummary ? (
                    <p className="scheduler-edit-alternate-callout-home">
                      <span className="scheduler-edit-alternate-callout-home-label">Client home: </span>
                      {clientHomeSummary.replace(/\n/g, ', ')}
                    </p>
                  ) : null}
                  <p className="scheduler-edit-alternate-callout-hint">
                    Drive time and ETA use the alternate address above. To change it, reschedule this visit.
                  </p>
                </div>
              ) : (
                <>
                  {clientHomeSummary ? (
                    <div className="scheduler-edit-field scheduler-edit-readonly">
                      <span>Client home address</span>
                      <div className="scheduler-edit-client-home">{clientHomeSummary}</div>
                    </div>
                  ) : null}

                  <div className="scheduler-edit-field scheduler-edit-readonly scheduler-edit-field--full">
                    <span>Alternate address (routing)</span>
                    <div className="scheduler-edit-client-home">Uses client home address for routing.</div>
                    <p className="scheduler-edit-hint">
                      Alternate stop location can only be set when rescheduling.
                    </p>
                  </div>
                </>
              )}
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
          ) : canPreviewSchedule ? (
            <button
              type="button"
              className="btn"
              onClick={handlePreviewScheduleClick}
              disabled={saving}
            >
              Preview schedule
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
