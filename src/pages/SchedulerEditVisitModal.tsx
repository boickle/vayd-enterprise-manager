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
import { formatSchedulerBookingApiError } from '../utils/manualBookingPermissions';
import { appointmentFormFlags } from '../utils/appointmentTypeSettings';
import './Scheduler.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeEmployeeIds(ids: readonly number[] | null | undefined): number[] {
  return [...new Set((ids ?? []).filter((id) => Number.isFinite(Number(id)) && Number(id) > 0).map(Number))];
}

function assigneeProviderLabel(p: Appointment['primaryProvider']): string {
  if (!p) return '—';
  const name = [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ');
  if (!name) return '—';
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function allDayInclusiveEndDate(appointmentEnd: string, practiceTz: string): DateTime | null {
  const endExclusive = DateTime.fromISO(appointmentEnd, { zone: 'utc' }).setZone(practiceTz).startOf('day');
  if (!endExclusive.isValid) return null;
  return endExclusive.minus({ days: 1 }).startOf('day');
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
  /** Routing workspace placement preview — bypass manual type permission on PATCH. */
  bookedViaRouting?: boolean;
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
      bookedViaRouting = false,
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
    const primaryProviderId = useMemo(() => String(appt.primaryProvider?.id ?? ''), [appt.primaryProvider?.id]);
    const primaryProviderLabel = useMemo(
      () => assigneeProviderLabel(appt.primaryProvider),
      [appt.primaryProvider]
    );
    const [additionalEmployeeIds, setAdditionalEmployeeIds] = useState<number[]>(() =>
      normalizeEmployeeIds(
        appt.additionalEmployeeIds ??
          appt.additionalEmployees?.map((emp) => Number(emp.id)).filter((id) => Number.isFinite(id))
      )
    );
    const [description, setDescription] = useState(appt.description ?? '');
    const statusName = appt.statusName ?? '';
    const confirmStatusName = appt.confirmStatusName ?? '';
    const isComplete = appt.isComplete;
    const [startTime, setStartTime] = useState(() =>
      toTimeLocalValue(appt.appointmentStart, practiceTz)
    );
    const [endTime, setEndTime] = useState(() => toTimeLocalValue(appt.appointmentEnd, practiceTz));
    const [allDayStartDate, setAllDayStartDate] = useState(() => appointmentDateKey);
    const [allDayEndDate, setAllDayEndDate] = useState(
      () => allDayInclusiveEndDate(appt.appointmentEnd, practiceTz)?.toISODate() ?? appointmentDateKey
    );
    const alternateAddressDisplay = appointmentAlternateAddressText(appt) ?? '';
    const hasAlternateRoutingAddress = appointmentHasAlternateLocation(appt);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const placementPreviewWasActiveRef = useRef(false);

    const additionalEmployeeOptions = useMemo(() => {
      return providers
        .map((p) => {
          const id = Number(p.id);
          if (!Number.isFinite(id) || id <= 0) return null;
          const label = p.name?.trim() || `Provider ${id}`;
          return { id, label };
        })
        .filter((row): row is { id: number; label: string } => row != null)
        .filter((row) => String(row.id) !== primaryProviderId)
        .sort((a, b) => a.label.localeCompare(b.label));
    }, [providers, primaryProviderId]);

    const additionalProviderIdSet = useMemo(
      () => new Set(additionalEmployeeOptions.map((row) => row.id)),
      [additionalEmployeeOptions]
    );

    const visitStartEnd = useMemo(() => {
      const start = DateTime.fromISO(appt.appointmentStart, { zone: practiceTz });
      const end = DateTime.fromISO(appt.appointmentEnd, { zone: practiceTz });
      return { start, end };
    }, [appt.appointmentStart, appt.appointmentEnd, practiceTz]);

    useEffect(() => {
      if (!primaryProviderId.trim()) return;
      setAdditionalEmployeeIds((prev) =>
        prev.filter((id) => String(id) !== primaryProviderId && additionalProviderIdSet.has(id))
      );
    }, [primaryProviderId, additionalProviderIdSet]);

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
      if (appt.allDay) {
        const start = DateTime.fromISO(allDayStartDate, { zone: practiceTz }).startOf('day');
        const endInclusive = DateTime.fromISO(allDayEndDate, { zone: practiceTz }).startOf('day');
        if (!start.isValid || !endInclusive.isValid) {
          return { startUtc: null, endUtc: null };
        }
        return {
          startUtc: start.toUTC().toISO(),
          endUtc: endInclusive.plus({ days: 1 }).toUTC().toISO(),
        };
      }
      const startUtc = combineDateAndTimeToUtc(appointmentDateKey, startTime, practiceTz);
      const endUtc = combineDateAndTimeToUtc(appointmentDateKey, endTime, practiceTz);
      return { startUtc, endUtc };
    }, [appt.allDay, allDayStartDate, allDayEndDate, appointmentDateKey, startTime, endTime, practiceTz]);

    const initialTypeId = String(appt.appointmentType?.id ?? '');

    const timesDirty = useMemo(() => {
      if (appt.allDay) {
        const origStart = appointmentPracticeDateKey(appt.appointmentStart, practiceTz) ?? '';
        const origEnd = allDayInclusiveEndDate(appt.appointmentEnd, practiceTz)?.toISODate() ?? origStart;
        return allDayStartDate.trim() !== origStart || allDayEndDate.trim() !== origEnd;
      }
      const origStart = toTimeLocalValue(appt.appointmentStart, practiceTz);
      const origEnd = toTimeLocalValue(appt.appointmentEnd, practiceTz);
      return startTime.trim() !== origStart || endTime.trim() !== origEnd;
    }, [
      appt.allDay,
      appt.appointmentStart,
      appt.appointmentEnd,
      practiceTz,
      allDayStartDate,
      allDayEndDate,
      startTime,
      endTime,
    ]);

    const typeDirty = appointmentTypeId !== initialTypeId;

    const previewKind: EditVisitPreviewKind = timesDirty ? 'time' : 'type';

    const selectedEditType = useMemo(
      () => appointmentTypes.find((t) => String(t.id) === appointmentTypeId),
      [appointmentTypes, appointmentTypeId]
    );
    const editTypeFormFlags = useMemo(
      () => appointmentFormFlags(selectedEditType),
      [selectedEditType]
    );

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
        additionalEmployeeIds,
        description,
        statusName,
        confirmStatusName,
        isComplete,
        allDay: appt.allDay,
      });
    }, [
      onFormSnapshotChange,
      effectiveAppointmentTypeId,
      primaryProviderId,
      additionalEmployeeIds,
      description,
      statusName,
      confirmStatusName,
      isComplete,
      appt.allDay,
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
      if (appt.allDay || !placementPreviewActive || !onPlacementTimesChange) {
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
      appt.allDay,
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
        setError(appt.allDay ? 'Start and end dates are required.' : 'Start and end times are required.');
        return;
      }
      if (DateTime.fromISO(endUtc) <= DateTime.fromISO(startUtc)) {
        setError(appt.allDay ? 'End date must be on or after the start date.' : 'End time must be after start time.');
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
            additionalEmployeeIds,
            description,
            statusName,
            confirmStatusName,
            isComplete,
            allDay: appt.allDay,
          },
          previewAppointmentTypeId: tidFromPreview,
          bookedViaRouting: bookedViaRouting || undefined,
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
        setError(formatSchedulerBookingApiError(e));
      } finally {
        setSaving(false);
      }
    }, [
      appointmentTypeId,
      primaryProviderId,
      additionalEmployeeIds,
      buildStartEndUtc,
      appt,
      description,
      statusName,
      confirmStatusName,
      isComplete,
      practiceId,
      placementPreviewActive,
      placementPreviewKind,
      draftPreviewAppointmentTypeId,
      bookedViaRouting,
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
        setError(appt.allDay ? 'Enter valid start and end dates.' : 'Enter valid start and end times.');
        return null;
      }
      if (DateTime.fromISO(endUtc) <= DateTime.fromISO(startUtc)) {
        setError(appt.allDay ? 'End date must be on or after the start date.' : 'End time must be after start time.');
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

    const canViewPlacement = Boolean(!appt.allDay && onViewPlacement && timesDirty && !placementPreviewActive);
    const canPreviewSchedule = Boolean(!appt.allDay && onPreviewSchedule && typeDirty && !placementPreviewActive);

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
                {appt.allDay ? (
                  (() => {
                    const endInclusive = allDayInclusiveEndDate(appt.appointmentEnd, practiceTz);
                    const startLabel = visitStartEnd.start.startOf('day').toFormat('EEEE, MMMM d, yyyy');
                    const endLabel = endInclusive?.toFormat('EEEE, MMMM d, yyyy') ?? startLabel;
                    return startLabel === endLabel
                      ? `${startLabel} · All day`
                      : `${startLabel} – ${endLabel} · All day`;
                  })()
                ) : (
                  <>
                    {visitStartEnd.start.toFormat('EEEE, MMMM d, yyyy')}
                    <span className="scheduler-modal-subtitle-sep">·</span>
                    {visitStartEnd.start.toFormat('h:mm a')} – {visitStartEnd.end.toFormat('h:mm a')}
                  </>
                )}
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
              <div className="scheduler-edit-two-col">
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
                  {editTypeFormFlags.showNotRoutedHint ? (
                    <p className="scheduler-edit-hint">Not routed — excluded from drive routing.</p>
                  ) : null}
                </label>

                <div className="scheduler-edit-field scheduler-edit-readonly">
                  <span>Primary provider</span>
                  <div className="scheduler-edit-date-value">{primaryProviderLabel}</div>
                </div>
              </div>

              {appt.allDay ? (
                <div className="scheduler-edit-two-col">
                  <label className="scheduler-edit-field">
                    <span>Start date *</span>
                    <input
                      type="date"
                      value={allDayStartDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setAllDayStartDate(next);
                        setAllDayEndDate((prev) => {
                          const prevDt = DateTime.fromISO(prev || next, { zone: practiceTz }).startOf('day');
                          const nextDt = DateTime.fromISO(next, { zone: practiceTz }).startOf('day');
                          if (!prevDt.isValid || !nextDt.isValid || prevDt < nextDt) return next;
                          return prevDt.toISODate() ?? next;
                        });
                      }}
                    />
                  </label>

                  <label className="scheduler-edit-field">
                    <span>End date *</span>
                    <input
                      type="date"
                      value={allDayEndDate}
                      min={allDayStartDate}
                      onChange={(e) => setAllDayEndDate(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              {appt.allDay ? (
                <label className="scheduler-edit-field scheduler-edit-field--full">
                  <span>Also show on provider calendars</span>
                  <div className="scheduler-edit-checklist" role="group" aria-label="Additional providers">
                    {additionalEmployeeOptions.length > 0 ? (
                      additionalEmployeeOptions.map((emp) => {
                        const checked = additionalEmployeeIds.includes(emp.id);
                        return (
                          <label key={emp.id} className="scheduler-edit-checklist-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextChecked = e.target.checked;
                                setAdditionalEmployeeIds((prev) =>
                                  nextChecked
                                    ? normalizeEmployeeIds([...prev, emp.id])
                                    : prev.filter((id) => id !== emp.id)
                                );
                              }}
                            />
                            <span>{emp.label}</span>
                          </label>
                        );
                      })
                    ) : (
                      <span className="scheduler-edit-checklist-empty">
                        No other primary providers are available for this all-day appointment.
                      </span>
                    )}
                  </div>
                  <p className="scheduler-edit-hint">
                    The primary provider remains the owner. Checked providers will also see this appointment on
                    their calendars.
                  </p>
                </label>
              ) : null}

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

              {appt.allDay ? (
                <p className="scheduler-edit-hint scheduler-edit-hint--time">
                  All-day appointments use an inclusive start and end date and are shown on every covered day.
                </p>
              ) : (
                <>
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
                    Date and primary provider can only be changed by rescheduling. Adjust start or end time
                    here, or use View placement for a new slot.
                  </p>
                </>
              )}

              {hasAlternateRoutingAddress ? (
                <div
                  className="scheduler-edit-alternate-callout"
                  role="status"
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
                    The visit address cannot be changed here. Reschedule the visit to change it.
                  </p>
                  <p className="scheduler-edit-alternate-callout-address">{alternateAddressDisplay}</p>
                  {clientHomeSummary ? (
                    <p className="scheduler-edit-hint">
                      Client home: {clientHomeSummary.replace(/\n/g, ', ')}
                    </p>
                  ) : null}
                </div>
              ) : clientHomeSummary ? (
                <div className="scheduler-edit-field scheduler-edit-readonly">
                  <span>Visit address</span>
                  <div className="scheduler-edit-client-home">{clientHomeSummary}</div>
                  <p className="scheduler-edit-hint">
                    The visit address cannot be changed here. Reschedule the visit to change it.
                  </p>
                </div>
              ) : null}
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
