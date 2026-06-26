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
import {
  commitEditVisit,
  commitLinkClientFromEditVisitSelection,
  resolveEditVisitAssignPatient,
  validateEditVisitLinkSelection,
  validateEditVisitPatientSelection,
  type EditVisitFormSnapshot,
} from '../utils/editVisitCommit';
import type { Appointment, Patient } from '../api/roomLoader';
import {
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
  isPracticeCalendarBlockAppointment,
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
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import {
  EditVisitAddPatientPanel,
  type EditVisitPatientSelection,
} from '../components/EditVisitAddPatientPanel';
import {
  EditVisitLinkClientPanel,
  type EditVisitLinkSelection,
} from '../components/EditVisitLinkClientPanel';
import {
  SchedulerVisitClientHeaderAlerts,
  SchedulerVisitClientZoneBadge,
  SchedulerVisitPatientContext,
} from '../components/SchedulerVisitPatientContext';
import { submitEditVisitPreviewAcceptedFeedback } from '../utils/routingBookFeedback';
import { appointmentHasNoPatient, excludePatientIdsAtSlot, patientsForAppointment } from '../utils/schedulerAddPet';
import { fetchPatientDisplayById } from '../utils/schedulerPatientEnrich';
import { fullClientHouseholdName } from '../utils/schedulerVisitDisplay';
import { formatSchedulerBookingApiError } from '../utils/manualBookingPermissions';
import { appointmentFormFlags, sortAppointmentTypesForPicker } from '../utils/appointmentTypeSettings';
import { useAuth } from '../auth/useAuth';
import { resolveAppointmentChangeActorFromAuth, detectEditVisitChanges } from '../utils/appointmentChangeAuditNote';
import {
  appointmentResolvedClientId,
  editVisitLinkClearsAlternateAddress,
  visitAddressForLinkMatching,
} from '../utils/visitAddressMatch';
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
  /** Validate, flush form snapshot, then run parent preview confirm (Book / Adjust time). */
  confirmPreview: () => void;
};

type Props = {
  appt: Appointment;
  /** Arrival window from doctor-day effectiveWindow (when available). */
  arrivalWindowLine?: string | null;
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
  /** Restored after sidebar portal remount during placement preview. */
  initialFormSnapshot?: EditVisitFormSnapshot | null;
  /** Parent-owned link selection (survives portal remount during preview). */
  linkSelection?: EditVisitLinkSelection | null;
  onLinkSelectionChange?: (selection: EditVisitLinkSelection | null) => void;
  /** When linking client, prefer this pet name from the online request (case-insensitive). */
  linkPreferredPatientName?: string | null;
  /** Patient to attach when visit has a client but no patient. */
  patientSelection?: EditVisitPatientSelection | null;
  onPatientSelectionChange?: (selection: EditVisitPatientSelection | null) => void;
  /** Practice calendar appointments — used to block duplicate pets in the same time slot. */
  practiceAppointments?: Appointment[];
  onClose: () => void;
  onSaved: (updated?: Appointment, detail?: { routingFeedbackWarning?: string }) => void;
  onViewPlacement?: (startUtc: string, endUtc: string) => void;
  /** Preview drive/windows when only the appointment type changes (times unchanged). */
  onPreviewSchedule?: (startUtc: string, endUtc: string, appointmentTypeId: number) => void;
  /** Book / Adjust time while placement preview is on the calendar. */
  onConfirmPreview?: () => void | Promise<void>;
  /** Surface preview validation blocks outside the modal (e.g. calendar popover Book). */
  onPreviewBlock?: (message: string) => void;
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
  /** When false, Save calls onSaved but leaves the form open (embedded confirm flow). */
  closeAfterSave?: boolean;
  /** Hide View Placement / Preview schedule (embedded confirm review). */
  hideRescheduleActions?: boolean;
  cancelLabel?: string;
};

export const SchedulerEditVisitModal = forwardRef<SchedulerEditVisitModalHandle, Props>(
  function SchedulerEditVisitModal(
    {
      appt,
      arrivalWindowLine,
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
      initialFormSnapshot = null,
      linkSelection = null,
      onLinkSelectionChange,
      linkPreferredPatientName = null,
      patientSelection = null,
      onPatientSelectionChange,
      practiceAppointments = [],
      onClose,
      onSaved,
      onViewPlacement,
      onPreviewSchedule,
      onConfirmPreview,
      onPreviewBlock,
      onPlacementTimesChange,
      typeScoreCompare = null,
      typeScoreLoading = false,
      typeScoreError = null,
      bookedSummary = null,
      closeAfterSave = true,
      hideRescheduleActions = false,
      cancelLabel = 'Cancel',
    },
    ref
  ) {
    const { token, userEmail, doctorId } = useAuth() as {
      token: string | null;
      userEmail?: string | null;
      doctorId?: string | null;
    };
    const editedByActor = useMemo(
      () =>
        resolveAppointmentChangeActorFromAuth({
          token,
          userEmail,
          doctorId,
          providers,
        }),
      [token, userEmail, doctorId, providers]
    );

    const sortedAppointmentTypes = useMemo(
      () => sortAppointmentTypesForPicker(appointmentTypes, { unrankedOrder: 'preserve' }),
      [appointmentTypes]
    );

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
      if (
        initialFormSnapshot?.appointmentTypeId != null &&
        Number.isFinite(Number(initialFormSnapshot.appointmentTypeId))
      ) {
        return String(initialFormSnapshot.appointmentTypeId);
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
        initialFormSnapshot?.additionalEmployeeIds ??
          appt.additionalEmployeeIds ??
          appt.additionalEmployees?.map((emp) => Number(emp.id)).filter((id) => Number.isFinite(id))
      )
    );
    const [description, setDescription] = useState(
      () => initialFormSnapshot?.description ?? appt.description ?? ''
    );
    const [instructions, setInstructions] = useState(
      () => initialFormSnapshot?.instructions ?? appt.instructions ?? ''
    );
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
    const visitAddressForLink = useMemo(() => visitAddressForLinkMatching(appt), [appt]);
    const resolvedClientId = useMemo(() => appointmentResolvedClientId(appt), [appt]);
    const showLinkClientPanel = useMemo(() => !resolvedClientId, [resolvedClientId]);
    const showAddPatientPanel = useMemo(
      () => Boolean(resolvedClientId && appointmentHasNoPatient(appt)),
      [resolvedClientId, appt]
    );
    const currentPatientId = useMemo(() => {
      const p = patientsForAppointment(appt)[0];
      return p?.id != null ? String(p.id) : null;
    }, [appt]);
    const displayPatientId = useMemo(() => {
      const selected = patientSelection?.patientId?.trim();
      if (selected) return selected;
      return currentPatientId;
    }, [patientSelection?.patientId, currentPatientId]);
    const displayPatientLabel = useMemo(() => {
      if (patientSelection?.patientLabel?.trim()) return patientSelection.patientLabel.trim();
      const saved = patientsForAppointment(appt)[0];
      return saved?.name?.trim() ?? '';
    }, [patientSelection?.patientLabel, appt]);
    const previewingDifferentPatient = useMemo(
      () =>
        Boolean(
          patientSelection?.patientId?.trim() &&
            patientSelection.patientId.trim() !== (currentPatientId ?? '')
        ),
      [patientSelection?.patientId, currentPatientId]
    );
    const [displayPatient, setDisplayPatient] = useState<Patient | null>(null);
    useEffect(() => {
      if (!displayPatientId) {
        setDisplayPatient(null);
        return;
      }
      const saved = patientsForAppointment(appt)[0];
      const isSavedPatient =
        saved && String(saved.id) === displayPatientId && !previewingDifferentPatient;
      if (isSavedPatient) {
        setDisplayPatient(saved);
        return;
      }
      let cancelled = false;
      void fetchPatientDisplayById(displayPatientId, { name: displayPatientLabel })
        .then((loaded) => {
          if (!cancelled) setDisplayPatient(loaded);
        })
        .catch(() => {
          if (!cancelled) setDisplayPatient(null);
        });
      return () => {
        cancelled = true;
      };
    }, [displayPatientId, displayPatientLabel, appt, previewingDifferentPatient]);
    const displayAppt = useMemo((): Appointment => {
      if (!displayPatient) return appt;
      const pcp = displayPatient.primaryProvider;
      return {
        ...appt,
        patient: displayPatient,
        patients: [displayPatient],
        ...(previewingDifferentPatient
          ? {
              patientPrimaryProvider: pcp
                ? {
                    id: pcp.id,
                    firstName: pcp.firstName,
                    lastName: pcp.lastName,
                    title: pcp.title,
                    designation: pcp.title,
                    isProvider: pcp.isProvider,
                  }
                : null,
            }
          : {}),
      } as Appointment;
    }, [appt, displayPatient, previewingDifferentPatient]);
    const patientsOverride = useMemo(() => {
      if (displayPatient) return [displayPatient];
      if (displayPatientId && displayPatientLabel) {
        const numericId = Number(displayPatientId);
        return [
          {
            id: Number.isFinite(numericId) && numericId > 0 ? numericId : 0,
            name: displayPatientLabel,
            isActive: true,
            isDeleted: false,
          },
        ];
      }
      return undefined;
    }, [displayPatient, displayPatientId, displayPatientLabel]);
    const showChangePatientPanel = useMemo(
      () =>
        Boolean(
          resolvedClientId &&
            !appointmentHasNoPatient(appt) &&
            !appt.allDay &&
            !isPracticeCalendarBlockAppointment(appt)
        ),
      [resolvedClientId, appt]
    );
    const showPatientPickerPanel = showAddPatientPanel || showChangePatientPanel;
    const addPatientClientLabel = useMemo(
      () => fullClientHouseholdName(appt.client) || 'Client',
      [appt.client]
    );
    const clearsAlternateOnLink = useMemo(
      () => editVisitLinkClearsAlternateAddress(appt, linkSelection),
      [appt, linkSelection]
    );
    const showAlternateRoutingCallout = hasAlternateRoutingAddress && !clearsAlternateOnLink;
    const editVisitTitle = useMemo(() => {
      if (appointmentResolvedClientId(appt)) return fullClientHouseholdName(appt.client);
      const addr = visitAddressForLink?.trim();
      if (addr) return addr.length > 52 ? `${addr.slice(0, 49)}…` : addr;
      return (
        pickStr(appt.appointmentType?.prettyName) ??
        pickStr(appt.appointmentType?.name) ??
        pickStr(appt.description) ??
        'Unlinked visit'
      );
    }, [appt, visitAddressForLink]);
    const handleLinkSelectionChange = useCallback(
      (selection: EditVisitLinkSelection | null) => {
        onLinkSelectionChange?.(selection);
      },
      [onLinkSelectionChange]
    );

    useEffect(() => {
      if (!linkSelection?.clientId?.trim()) return;
      setError((cur) => {
        if (!cur) return cur;
        if (
          cur.includes('home address does not match') ||
          cur.includes('Keep as alternate address') ||
          cur.includes('Choose a patient for this client')
        ) {
          return null;
        }
        return cur;
      });
    }, [linkSelection]);
    const handlePatientSelectionChange = useCallback(
      (selection: EditVisitPatientSelection | null) => {
        onPatientSelectionChange?.(selection);
      },
      [onPatientSelectionChange]
    );
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

    const blockedPatientIdsForSlot = useMemo(() => {
      if (!resolvedClientId || appt.allDay) return [];
      const { startUtc, endUtc } = buildStartEndUtc();
      if (!startUtc || !endUtc) return [];
      const start = DateTime.fromISO(startUtc, { zone: 'utc' });
      const end = DateTime.fromISO(endUtc, { zone: 'utc' });
      if (!start.isValid || !end.isValid) return [];
      const excludeAppointmentId = typeof appt.id === 'number' ? appt.id : undefined;
      return excludePatientIdsAtSlot(
        resolvedClientId,
        start.toMillis(),
        end.toMillis(),
        practiceAppointments,
        { excludeAppointmentId }
      );
    }, [
      resolvedClientId,
      appt.allDay,
      appt.id,
      practiceAppointments,
      buildStartEndUtc,
    ]);

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

    const buildFormSnapshot = useCallback((): EditVisitFormSnapshot | null => {
      const tid = effectiveAppointmentTypeId;
      const pid = Number(primaryProviderId);
      if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(pid) || pid <= 0) {
        return null;
      }
      return {
        appointmentTypeId: tid,
        primaryProviderId: pid,
        additionalEmployeeIds,
        description,
        instructions,
        statusName,
        confirmStatusName,
        isComplete,
        allDay: appt.allDay,
      };
    }, [
      effectiveAppointmentTypeId,
      primaryProviderId,
      additionalEmployeeIds,
      description,
      instructions,
      statusName,
      confirmStatusName,
      isComplete,
      appt.allDay,
    ]);

    const flushFormSnapshot = useCallback(() => {
      const snapshot = buildFormSnapshot();
      onFormSnapshotChange?.(snapshot);
      return snapshot;
    }, [buildFormSnapshot, onFormSnapshotChange]);

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
      onFormSnapshotChange(buildFormSnapshot());
    }, [onFormSnapshotChange, buildFormSnapshot]);

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
      flushFormSnapshot();
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
      const linkingClient = Boolean(linkSelection?.clientId?.trim());
      if (editTypeFormFlags.requirePatient) {
        const hasPatient =
          !appointmentHasNoPatient(appt) ||
          Boolean(patientSelection?.patientId?.trim()) ||
          (linkingClient && linkSelection?.patientId?.trim());
        const needsPatient = resolvedClientId != null || linkingClient;
        if (needsPatient && !hasPatient) {
          setError('This appointment type requires a patient on the visit.');
          return;
        }
      }
      const linkValidationError = validateEditVisitLinkSelection({
        linkSelection,
        visitAddress: visitAddressForLink,
        requirePatient: editTypeFormFlags.requirePatient,
      });
      if (linkValidationError) {
        setError(linkValidationError);
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

      const patientValidationError = validateEditVisitPatientSelection({
        appt,
        patientSelection,
        slotStartIso: startUtc,
        slotEndIso: endUtc,
        allAppointments: practiceAppointments,
      });
      if (patientValidationError) {
        setError(patientValidationError);
        return;
      }

      setSaving(true);
      try {
        const editChanges = detectEditVisitChanges(
          {
            description: appt.description,
            instructions: appt.instructions,
            appointmentTypeId: appt.appointmentType?.id,
            appointmentStart: appt.appointmentStart,
            appointmentEnd: appt.appointmentEnd,
          },
          {
            description,
            instructions,
            appointmentTypeId: tid,
            appointmentStart: startUtc,
            appointmentEnd: endUtc,
          }
        );
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
            instructions,
            statusName,
            confirmStatusName,
            isComplete,
            allDay: appt.allDay,
          },
          previewAppointmentTypeId: tidFromPreview,
          editedByAudit: {
            actor: editedByActor,
            practiceTz,
            changes: editChanges,
          },
          linkClient:
            linkingClient && linkSelection
              ? commitLinkClientFromEditVisitSelection(appt, linkSelection, {
                  actor: editedByActor,
                  practiceTz,
                })
              : undefined,
          assignPatient: resolveEditVisitAssignPatient(appt, patientSelection),
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
        if (closeAfterSave) {
          onClose();
        }
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
      instructions,
      statusName,
      confirmStatusName,
      isComplete,
      practiceId,
      placementPreviewActive,
      placementPreviewKind,
      draftPreviewAppointmentTypeId,
      editedByActor,
      practiceTz,
      typeScoreCompare,
      editTypeFormFlags,
      linkSelection,
      patientSelection,
      resolvedClientId,
      visitAddressForLink,
      practiceAppointments,
      onSaved,
      onClose,
      closeAfterSave,
      flushFormSnapshot,
    ]);

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
      flushFormSnapshot();
      const times = validateTimes();
      if (!times) return;
      onViewPlacement?.(times.startUtc, times.endUtc);
    }

    function handlePreviewScheduleClick() {
      flushFormSnapshot();
      const times = validateTimes();
      if (!times) return;
      const tid = Number(appointmentTypeId);
      if (!Number.isFinite(tid) || tid <= 0) {
        setError('Choose a valid appointment type.');
        return;
      }
      const previewTypeFlags = appointmentFormFlags(
        appointmentTypes.find((t) => Number(t.id) === tid)
      );
      const linkValidationError = validateEditVisitLinkSelection({
        linkSelection,
        visitAddress: visitAddressForLink,
        requirePatient: previewTypeFlags.requirePatient,
      });
      if (linkValidationError) {
        setError(linkValidationError);
        return;
      }
      onPreviewSchedule?.(times.startUtc, times.endUtc, tid);
    }

    const canViewPlacement = Boolean(
      !hideRescheduleActions && !appt.allDay && onViewPlacement && timesDirty && !placementPreviewActive,
    );
    const canPreviewSchedule = Boolean(
      !hideRescheduleActions && !appt.allDay && onPreviewSchedule && typeDirty && !placementPreviewActive,
    );
    const previewConfirmLabel =
      placementPreviewKind === 'type' ? (saving ? 'Booking…' : 'Book') : saving ? 'Saving…' : 'Adjust time';

    const handleConfirmPreviewClick = useCallback(() => {
      if (!onConfirmPreview) return;
      const blockPreview = (message: string) => {
        setError(message);
        onPreviewBlock?.(message);
      };
      flushFormSnapshot();
      const linkingClient = Boolean(linkSelection?.clientId?.trim());
      if (editTypeFormFlags.requirePatient) {
        const hasPatient =
          !appointmentHasNoPatient(appt) ||
          Boolean(patientSelection?.patientId?.trim()) ||
          (linkingClient && linkSelection?.patientId?.trim());
        const needsPatient = resolvedClientId != null || linkingClient;
        if (needsPatient && !hasPatient) {
          blockPreview('This appointment type requires a patient on the visit.');
          return;
        }
      }
      const linkValidationError = validateEditVisitLinkSelection({
        linkSelection,
        visitAddress: visitAddressForLink,
        requirePatient: editTypeFormFlags.requirePatient,
      });
      if (linkValidationError) {
        blockPreview(linkValidationError);
        return;
      }
      if (
        editTypeFormFlags.requirePatient &&
        showPatientPickerPanel &&
        !patientSelection?.patientId?.trim()
      ) {
        blockPreview('Choose a patient for this visit before booking.');
        return;
      }
      const previewTimes = buildStartEndUtc();
      if (previewTimes.startUtc && previewTimes.endUtc) {
        const patientValidationError = validateEditVisitPatientSelection({
          appt,
          patientSelection,
          slotStartIso: previewTimes.startUtc,
          slotEndIso: previewTimes.endUtc,
          allAppointments: practiceAppointments,
        });
        if (patientValidationError) {
          blockPreview(patientValidationError);
          return;
        }
      }
      setSaving(true);
      void Promise.resolve(onConfirmPreview())
        .catch((e: unknown) => {
          blockPreview(formatSchedulerBookingApiError(e));
        })
        .finally(() => {
          setSaving(false);
        });
    }, [
      onConfirmPreview,
      onPreviewBlock,
      flushFormSnapshot,
      linkSelection,
      visitAddressForLink,
      editTypeFormFlags.requirePatient,
      resolvedClientId,
      appt,
      showPatientPickerPanel,
      patientSelection,
      practiceAppointments,
      buildStartEndUtc,
    ]);

    useImperativeHandle(ref, () => ({ save: handleSave, confirmPreview: handleConfirmPreviewClick }), [
      handleSave,
      handleConfirmPreviewClick,
    ]);

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
        <div className="scheduler-modal-scroll scheduler-modal-scroll--edit">
          <div className="scheduler-modal-header">
            <div className="scheduler-modal-header-text">
              <p className="scheduler-modal-eyebrow">Edit visit</p>
              <h2 id="scheduler-edit-title" className="scheduler-modal-title-h">
                <span className="scheduler-modal-title-client">
                  {editVisitTitle}
                </span>
                <SchedulerVisitClientZoneBadge appt={appt} compact />
              </h2>
              <SchedulerVisitClientHeaderAlerts appt={appt} />
              <SchedulerVisitPatientContext
                appt={displayAppt}
                providers={providers}
                practiceTz={practiceTz}
                patientsOverride={patientsOverride}
                showMembership={!previewingDifferentPatient}
                patientDetailsAction={
                  displayPatientId ? (
                    <BookPatientChartButton
                      key={displayPatientId}
                      patientId={displayPatientId}
                      patientName={displayPatient?.name ?? displayPatientLabel}
                      practiceId={practiceId}
                      practiceTz={practiceTz}
                      excludeAppointmentId={appt.id}
                      label="View Patient Details"
                    />
                  ) : null
                }
              />
              {showChangePatientPanel && resolvedClientId ? (
                <EditVisitAddPatientPanel
                  compact
                  clientId={resolvedClientId}
                  clientLabel={addPatientClientLabel}
                  requiresPatient={editTypeFormFlags.requirePatient}
                  mode="change"
                  initialPatientId={currentPatientId}
                  blockedPatientIds={blockedPatientIdsForSlot}
                  persistedSelection={patientSelection}
                  onSelectionChange={handlePatientSelectionChange}
                />
              ) : null}
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
            {arrivalWindowLine ? (
              <p className="scheduler-modal-subtitle">
                Window of arrival: {arrivalWindowLine}
              </p>
            ) : null}
            {bookedSummary ? (
              <p className="scheduler-edit-booked-summary" role="status">
                {bookedSummary}
              </p>
            ) : placementPreviewActive ? (
              <p className="scheduler-edit-preview-hint">
                {placementPreviewKind === 'type'
                  ? 'Type preview is on the calendar — use Book in the panel beside the visit or below.'
                  : 'Time preview is on the calendar — use Adjust time in the panel beside the visit or below.'}
              </p>
            ) : null}
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={handleCancel}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error && !inlinePaneMode ? <p className="scheduler-edit-error">{error}</p> : null}

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
                    {sortedAppointmentTypes.map((t) => (
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

              {showAlternateRoutingCallout ? (
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
                    {showLinkClientPanel
                      ? linkSelection?.keepAlternateAddress
                        ? 'Alternate visit address stays on this appointment. Link the client and patient below.'
                        : 'This is the visit address used for routing. Link a client whose home matches, or check “Keep as alternate address” below if they visit elsewhere.'
                      : 'The visit address cannot be changed here. Reschedule the visit to change it.'}
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

              {showLinkClientPanel ? (
                <EditVisitLinkClientPanel
                  practiceId={practiceId}
                  visitAddress={visitAddressForLink}
                  requiresPatient={editTypeFormFlags.requirePatient}
                  hasAlternateAddress={hasAlternateRoutingAddress}
                  persistedSelection={linkSelection}
                  preferredPatientName={linkPreferredPatientName}
                  onSelectionChange={handleLinkSelectionChange}
                  hideVisitAddress={hasAlternateRoutingAddress}
                />
              ) : null}

              {showAddPatientPanel && resolvedClientId ? (
                <EditVisitAddPatientPanel
                  clientId={resolvedClientId}
                  clientLabel={addPatientClientLabel}
                  requiresPatient={editTypeFormFlags.requirePatient}
                  mode="add"
                  blockedPatientIds={blockedPatientIdsForSlot}
                  persistedSelection={patientSelection}
                  onSelectionChange={handlePatientSelectionChange}
                />
              ) : null}

              <label className="scheduler-edit-field scheduler-edit-field--full scheduler-edit-field--staff-notes">
                <span>Staff notes</span>
                <textarea
                  rows={4}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Internal notes — Scout routing, rescheduled/edited by…"
                />
              </label>
            </div>
          </section>
        </div>
        </div>

        <div className="scheduler-edit-footer">
          {error ? (
            <p className="scheduler-edit-error scheduler-edit-footer-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="scheduler-edit-footer-actions">
          <button type="button" className="btn secondary" onClick={handleCancel} disabled={saving}>
            {cancelLabel}
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
          ) : placementPreviewActive && onConfirmPreview ? (
            <button
              type="button"
              className="btn"
              onClick={handleConfirmPreviewClick}
              disabled={saving || typeScoreLoading}
            >
              {previewConfirmLabel}
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
