// Record actual visit start/end from scheduler context menu (single screen for both)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import {
  fetchAppointmentById,
  postAppointmentActualEnd,
  postAppointmentActualStart,
} from '../api/appointments';
import { patchForwardBookingDisposition } from '../api/forwardBookingDisposition';
import { listPracticeBranches } from '../api/branchInventory';
import { createForwardBooking } from '../api/forwardBooking';
import type { Appointment } from '../api/roomLoader';
import { createTask, type TaskLinkInput } from '../api/tasks';
import {
  buildCreateForwardBookingPayloadFromAppointment,
  FORWARD_BOOKING_AMOUNT_OPTIONS,
  FORWARD_BOOKING_UNIT_OPTIONS,
  type ForwardBookingIntervalUnit,
} from '../utils/forwardBookingFromAppointment';
import {
  appointmentPracticeDateKey,
  combineDateAndTimeToUtc,
  formatPracticeDateLabel,
  toTimeLocalValue,
} from '../utils/editVisitTimeFields';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  validateTaskScheduleOrder,
} from '../utils/taskDateTime';
import { notifyTasksChanged } from '../utils/taskOwnership';
import { LABS_PENDING_FORWARD_BOOKING_TASK_BODY } from '../utils/forwardBookingCreateLink';
import {
  buildForwardBookingDispositionPayload,
  forwardBookingDispositionFromAppointment,
  forwardBookingFormStateFromDisposition,
  hasPersistedForwardBookingDisposition,
} from '../utils/forwardBookingDisposition';
import {
  appointmentNotesDisplay,
  appointmentTypeDisplayName,
  formatNextAppointmentWhen,
  loadNextScheduledAppointmentForVisit,
} from '../utils/nextScheduledAppointmentForVisit';
import './Scheduler.css';

export type ActualVisitTimeField = 'start' | 'end' | 'both';

export type ForwardBookingMode =
  | 'booked_at_appointment'
  | 'already_booked'
  | 'labs_pending'
  | 'forward_book_fields'
  | 'not_appropriate';

const FORWARD_BOOKING_MODE_OPTIONS: {
  value: ForwardBookingMode;
  label: string;
  hint: string;
}[] = [
  {
    value: 'booked_at_appointment',
    label: 'Booked at appointment',
    hint: 'Follow-up was booked during this visit — no forward booking list entry.',
  },
  {
    value: 'already_booked',
    label: 'Already booked',
    hint: 'Client already has a follow-up scheduled — no forward booking list entry.',
  },
  {
    value: 'labs_pending',
    label: 'Labs pending',
    hint: 'Assign a task to forward book after lab results are back.',
  },
  {
    value: 'forward_book_fields',
    label: 'Forward book',
    hint: 'Add to the forward booking list using the interval below.',
  },
  {
    value: 'not_appropriate',
    label: 'Not appropriate',
    hint: 'Follow-up is not appropriate for this visit — no forward booking list entry.',
  },
];

function forwardBookingModeOption(mode: ForwardBookingMode) {
  return FORWARD_BOOKING_MODE_OPTIONS.find((o) => o.value === mode);
}

function formatSavedForwardInterval(amount: string, unit: ForwardBookingIntervalUnit | ''): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || !unit) return '—';
  const unitLabel = FORWARD_BOOKING_UNIT_OPTIONS.find((o) => o.value === unit)?.label ?? unit;
  return `${n} ${n === 1 ? unitLabel.replace(/s$/, '') : unitLabel.toLowerCase()}`;
}

function formatSavedTaskDatetime(value: string): string {
  const at = fromDatetimeLocalValue(value);
  if (!at) return '—';
  const dt = DateTime.fromISO(at, { zone: 'utc' }).toLocal();
  return dt.isValid ? dt.toFormat('MMM d, yyyy h:mm a') : '—';
}

type Props = {
  appt: Appointment;
  /** `both` — combined Start / End Visit screen (default from context menu). */
  field?: ActualVisitTimeField;
  practiceId: number;
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

function primaryPatientName(appt: Appointment): string | null {
  const multi = (appt as { patients?: { name?: string | null }[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    return pickStr(multi[0]?.name);
  }
  return pickStr(appt.patient?.name);
}

function defaultLabsPendingTaskTitle(appt: Appointment): string {
  const subject = [primaryPatientName(appt), pickStr(appt.client?.lastName)].filter(Boolean).join(' ');
  if (!subject) return 'Forward book once labs come back.';
  return `Forward book ${subject} once labs come back.`;
}

function defaultStartTimeLocal(
  existingIso: string | null | undefined,
  practiceTz: string
): string {
  if (existingIso) return toTimeLocalValue(existingIso, practiceTz);
  return DateTime.now().setZone(practiceTz).toFormat('HH:mm');
}

function defaultLabsTaskStartLocal(): string {
  return toDatetimeLocalValue(DateTime.now().toISO()) ?? '';
}

function defaultEndTimeLocal(
  existingEndIso: string | null | undefined,
  _existingStartIso: string | null | undefined,
  practiceTz: string
): string {
  if (existingEndIso) return toTimeLocalValue(existingEndIso, practiceTz);
  return '';
}

export function SchedulerActualVisitTimeModal({
  appt,
  field = 'both',
  practiceId,
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

  const defaultLabsTaskTitle = useMemo(() => defaultLabsPendingTaskTitle(appt), [appt]);
  const defaultLabsStartLocal = useMemo(() => defaultLabsTaskStartLocal(), []);

  const initialForwardBookingForm = useMemo(
    () =>
      forwardBookingFormStateFromDisposition(
        appt.forwardBookingDisposition ?? forwardBookingDispositionFromAppointment(appt),
        { labsTaskTitle: defaultLabsTaskTitle, labsTaskStartLocal: defaultLabsStartLocal }
      ),
    [appt, defaultLabsStartLocal, defaultLabsTaskTitle]
  );

  const [startTimeLocal, setStartTimeLocal] = useState(() =>
    isEndOnly ? '' : defaultStartTimeLocal(existingStartIso, practiceTz)
  );
  const [endTimeLocal, setEndTimeLocal] = useState(() =>
    isStartOnly ? '' : defaultEndTimeLocal(existingEndIso, existingStartIso, practiceTz)
  );
  const [forwardBookingMode, setForwardBookingMode] = useState<ForwardBookingMode>(
    () => initialForwardBookingForm.mode
  );
  const [forwardAmount, setForwardAmount] = useState<string>(
    () => initialForwardBookingForm.forwardAmount
  );
  const [forwardUnit, setForwardUnit] = useState<ForwardBookingIntervalUnit | ''>(
    () => initialForwardBookingForm.forwardUnit
  );
  const [bookingNotes, setBookingNotes] = useState(() => initialForwardBookingForm.bookingNotes);
  const [labsAssigneeEmployeeId, setLabsAssigneeEmployeeId] = useState(
    () => initialForwardBookingForm.labsAssigneeEmployeeId
  );
  const [labsTaskTitle, setLabsTaskTitle] = useState(() => initialForwardBookingForm.labsTaskTitle);
  const [labsTaskStartLocal, setLabsTaskStartLocal] = useState(
    () => initialForwardBookingForm.labsTaskStartLocal
  );
  const [labsTaskDueLocal, setLabsTaskDueLocal] = useState(
    () => initialForwardBookingForm.labsTaskDueLocal
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [forwardBookingMetaLoading, setForwardBookingMetaLoading] = useState(false);
  const [nextScheduledAppt, setNextScheduledAppt] = useState<Appointment | null>(null);
  const [nextScheduledApptLoading, setNextScheduledApptLoading] = useState(false);
  const [nextScheduledApptLoaded, setNextScheduledApptLoaded] = useState(false);
  const [dispositionSaveStatus, setDispositionSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [dispositionLocked, setDispositionLocked] = useState(() =>
    hasPersistedForwardBookingDisposition(appt)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispositionHydratedRef = useRef(false);
  const forwardBookingUserEditedRef = useRef(false);
  const dispositionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requiresForwardBooking = !isStartOnly;
  const skipsForwardBookingList =
    forwardBookingMode === 'booked_at_appointment' ||
    forwardBookingMode === 'already_booked' ||
    forwardBookingMode === 'labs_pending' ||
    forwardBookingMode === 'not_appropriate';
  const showForwardBookFields = forwardBookingMode === 'forward_book_fields';
  const showLabsPendingFields = forwardBookingMode === 'labs_pending';
  const forwardBookingFieldsDisabled = saving || !showForwardBookFields;
  const savedForwardBookingOption = useMemo(
    () => forwardBookingModeOption(forwardBookingMode),
    [forwardBookingMode]
  );
  const savedLabsAssigneeLabel = useMemo(() => {
    const id = Number(labsAssigneeEmployeeId);
    if (!Number.isFinite(id)) return '—';
    const em = employees.find((e) => Number(e.id) === id);
    return em ? formatEmployeeDisplayName(em) || em.email || '—' : '—';
  }, [employees, labsAssigneeEmployeeId]);
  const savedForwardIntervalLabel = useMemo(
    () => formatSavedForwardInterval(forwardAmount, forwardUnit),
    [forwardAmount, forwardUnit]
  );
  const nextScheduledAsOfIso = useMemo(() => {
    const candidates = [
      Date.now(),
      existingEndIso ? Date.parse(existingEndIso) : NaN,
      appt.appointmentEnd ? Date.parse(appt.appointmentEnd) : NaN,
    ].filter((ms) => Number.isFinite(ms));
    return new Date(Math.max(...candidates)).toISOString();
  }, [appt.appointmentEnd, existingEndIso]);
  const nextScheduledNotes = useMemo(
    () => (nextScheduledAppt ? appointmentNotesDisplay(nextScheduledAppt) : null),
    [nextScheduledAppt]
  );

  const applyForwardBookingForm = useCallback(
    (form: ReturnType<typeof forwardBookingFormStateFromDisposition>) => {
      setForwardBookingMode(form.mode);
      setForwardAmount(form.forwardAmount);
      setForwardUnit(form.forwardUnit);
      setBookingNotes(form.bookingNotes);
      setLabsAssigneeEmployeeId(form.labsAssigneeEmployeeId);
      setLabsTaskTitle(form.labsTaskTitle);
      setLabsTaskStartLocal(form.labsTaskStartLocal);
      setLabsTaskDueLocal(form.labsTaskDueLocal);
    },
    []
  );

  useEffect(() => {
    if (!requiresForwardBooking) {
      dispositionHydratedRef.current = true;
      return;
    }
    let on = true;
    void (async () => {
      const fresh = await fetchAppointmentById(appt.id, { practiceId });
      if (!on || !fresh) {
        dispositionHydratedRef.current = true;
        return;
      }
      const form = forwardBookingFormStateFromDisposition(
        fresh.forwardBookingDisposition ?? forwardBookingDispositionFromAppointment(fresh),
        { labsTaskTitle: defaultLabsTaskTitle, labsTaskStartLocal: defaultLabsStartLocal }
      );
      if (!forwardBookingUserEditedRef.current) {
        applyForwardBookingForm(form);
      }
      if (hasPersistedForwardBookingDisposition(fresh)) {
        setDispositionLocked(true);
      }
      dispositionHydratedRef.current = true;
    })();
    return () => {
      on = false;
    };
  }, [
    appt.id,
    applyForwardBookingForm,
    defaultLabsStartLocal,
    defaultLabsTaskTitle,
    practiceId,
    requiresForwardBooking,
  ]);

  useEffect(() => {
    if (!requiresForwardBooking) return;
    let on = true;
    setNextScheduledApptLoading(true);
    setNextScheduledApptLoaded(false);
    setNextScheduledAppt(null);
    void (async () => {
      try {
        const next = await loadNextScheduledAppointmentForVisit(appt, practiceId, {
          asOf: nextScheduledAsOfIso,
        });
        if (on) setNextScheduledAppt(next);
      } catch {
        if (on) setNextScheduledAppt(null);
      } finally {
        if (on) {
          setNextScheduledApptLoading(false);
          setNextScheduledApptLoaded(true);
        }
      }
    })();
    return () => {
      on = false;
    };
  }, [appt, nextScheduledAsOfIso, practiceId, requiresForwardBooking]);

  const persistForwardBookingDisposition = useCallback(async () => {
    const payload = buildForwardBookingDispositionPayload({
      mode: forwardBookingMode,
      forwardAmount,
      forwardUnit,
      bookingNotes,
      labsAssigneeEmployeeId,
      labsTaskTitle,
      labsTaskStartLocal,
      labsTaskDueLocal,
    });
    await patchForwardBookingDisposition(appt.id, payload, { practiceId });
  }, [
    appt.id,
    bookingNotes,
    forwardAmount,
    forwardBookingMode,
    forwardUnit,
    labsAssigneeEmployeeId,
    labsTaskDueLocal,
    labsTaskStartLocal,
    labsTaskTitle,
    practiceId,
  ]);

  useEffect(() => {
    if (!requiresForwardBooking || !dispositionHydratedRef.current || saving || dispositionLocked) {
      return;
    }

    if (dispositionSaveTimerRef.current) {
      clearTimeout(dispositionSaveTimerRef.current);
    }

    dispositionSaveTimerRef.current = setTimeout(() => {
      setDispositionSaveStatus('saving');
      void persistForwardBookingDisposition()
        .then(() => setDispositionSaveStatus('saved'))
        .catch(() => setDispositionSaveStatus('error'));
    }, 600);

    return () => {
      if (dispositionSaveTimerRef.current) {
        clearTimeout(dispositionSaveTimerRef.current);
      }
    };
  }, [
    bookingNotes,
    forwardAmount,
    forwardBookingMode,
    forwardUnit,
    labsAssigneeEmployeeId,
    labsTaskDueLocal,
    labsTaskStartLocal,
    labsTaskTitle,
    persistForwardBookingDisposition,
    requiresForwardBooking,
    dispositionLocked,
    saving,
  ]);

  useEffect(() => {
    if (!requiresForwardBooking) return;
    let on = true;
    setForwardBookingMetaLoading(true);
    void (async () => {
      try {
        const [branchList, employeeList] = await Promise.all([
          listPracticeBranches(practiceId),
          fetchAllEmployees(),
        ]);
        if (!on) return;
        const activeBranchIds = (Array.isArray(branchList) ? branchList : [])
          .filter((b) => b.isActive !== false)
          .map((b) => b.id);
        setBranchIds(activeBranchIds);
        setEmployees(Array.isArray(employeeList) ? employeeList : []);
      } catch {
        if (!on) return;
        setBranchIds([]);
        setEmployees([]);
      } finally {
        if (on) setForwardBookingMetaLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [practiceId, requiresForwardBooking]);

  const title = isBoth ? 'Start / End Visit' : isStartOnly ? 'Start visit' : 'End visit';

  const saveStart = useCallback(
    async (body: { at?: string; clear?: boolean }) => postAppointmentActualStart(appt.id, body),
    [appt.id]
  );

  const saveEnd = useCallback(
    async (body: { at?: string; clear?: boolean }) => postAppointmentActualEnd(appt.id, body),
    [appt.id]
  );

  const forwardInterval = useMemo(() => {
    const amount = Number(forwardAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !forwardUnit) return null;
    return { amount, unit: forwardUnit };
  }, [forwardAmount, forwardUnit]);

  const buildLabsPendingTaskLinks = useCallback((): TaskLinkInput[] => {
    const links: TaskLinkInput[] = [{ entityType: 'appointment', entityId: appt.id }];
    const clientId = appt.client?.id;
    if (typeof clientId === 'number' && Number.isFinite(clientId)) {
      links.push({ entityType: 'client', entityId: clientId });
    }
    const patientId = appt.patient?.id;
    if (typeof patientId === 'number' && Number.isFinite(patientId)) {
      links.push({ entityType: 'patient', entityId: patientId });
    }
    return links;
  }, [appt.client?.id, appt.id, appt.patient?.id]);

  const saveForwardBookingIfNeeded = useCallback(
    async (savingEnd: boolean) => {
      if (!savingEnd || isStartOnly || dispositionLocked) return;

      if (forwardBookingMode === 'labs_pending') {
        const assigneeId = Number(labsAssigneeEmployeeId);
        if (!Number.isFinite(assigneeId)) {
          throw new Error('Select a staff member to assign the labs pending task.');
        }
        if (branchIds.length === 0) {
          throw new Error('Could not determine practice branches for the task.');
        }
        const title = labsTaskTitle.trim();
        if (!title) {
          throw new Error('Enter a task description.');
        }
        const startAt = fromDatetimeLocalValue(labsTaskStartLocal);
        if (!startAt) {
          throw new Error('Choose a valid task start date and time.');
        }
        const dueAt = fromDatetimeLocalValue(labsTaskDueLocal);
        const scheduleErr = validateTaskScheduleOrder(startAt, dueAt);
        if (scheduleErr) {
          throw new Error(scheduleErr);
        }
        await createTask({
          title,
          body: LABS_PENDING_FORWARD_BOOKING_TASK_BODY,
          branchIds,
          assignedToEmployeeId: assigneeId,
          startAt,
          dueAt,
          links: buildLabsPendingTaskLinks(),
        });
        notifyTasksChanged();
        return;
      }

      if (skipsForwardBookingList) return;

      if (!forwardInterval) {
        throw new Error('Select how far out to forward book (number and days, weeks, or months).');
      }
      const payload = buildCreateForwardBookingPayloadFromAppointment(
        appt,
        forwardInterval,
        practiceId,
        {
          bookingNotes: bookingNotes.trim() || null,
        }
      );
      if (!payload) {
        throw new Error('This visit cannot create a forward booking (needs client and patient).');
      }
      await createForwardBooking(payload);
    },
    [
      appt,
      bookingNotes,
      branchIds,
      buildLabsPendingTaskLinks,
      forwardBookingMode,
      forwardInterval,
      isStartOnly,
      labsAssigneeEmployeeId,
      labsTaskDueLocal,
      labsTaskStartLocal,
      labsTaskTitle,
      dispositionLocked,
      practiceId,
      skipsForwardBookingList,
    ]
  );

  const postBoth = useCallback(
    async (opts: {
      start?: { at?: string; clear?: boolean };
      end?: { at?: string; clear?: boolean };
    }) => {
      setSaving(true);
      setError(null);
      try {
        const savingEnd = Boolean(opts.end && !opts.end.clear);

        let updated = appt;
        if (opts.start) updated = await saveStart(opts.start);
        if (opts.end) updated = await saveEnd(opts.end);
        if (savingEnd && requiresForwardBooking && !dispositionLocked) {
          await persistForwardBookingDisposition();
        }
        await saveForwardBookingIfNeeded(savingEnd);
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
    [appt, dispositionLocked, onClose, onSaved, persistForwardBookingDisposition, requiresForwardBooking, saveEnd, saveStart, saveForwardBookingIfNeeded]
  );

  const validateForwardBooking = (savingEnd: boolean): boolean => {
    if (!requiresForwardBooking || !savingEnd || dispositionLocked) return true;

    if (forwardBookingMode === 'labs_pending') {
      const assigneeId = Number(labsAssigneeEmployeeId);
      if (!Number.isFinite(assigneeId)) {
        setError('Select a staff member to assign the labs pending task.');
        return false;
      }
      if (branchIds.length === 0) {
        setError('Could not determine practice branches for the task.');
        return false;
      }
      if (!labsTaskTitle.trim()) {
        setError('Enter a task description.');
        return false;
      }
      const startAt = fromDatetimeLocalValue(labsTaskStartLocal);
      if (!startAt) {
        setError('Choose a valid task start date and time.');
        return false;
      }
      const dueAt = fromDatetimeLocalValue(labsTaskDueLocal);
      const scheduleErr = validateTaskScheduleOrder(startAt, dueAt);
      if (scheduleErr) {
        setError(scheduleErr);
        return false;
      }
      return true;
    }

    if (forwardBookingMode === 'not_appropriate') {
      if (!bookingNotes.trim()) {
        setError('Enter why forward booking is not appropriate for this visit.');
        return false;
      }
      return true;
    }

    if (skipsForwardBookingList) return true;

    if (!forwardInterval) {
      setError('Select how far out to forward book (number and days, weeks, or months) before saving.');
      return false;
    }
    return true;
  };

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
      if (!validateForwardBooking(true)) return;
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
    const savingEnd = Boolean(endAt);
    if (!validateForwardBooking(savingEnd)) return;
    void postBoth({
      ...(startAt ? { start: { at: startAt } } : {}),
      ...(endAt ? { end: { at: endAt } } : {}),
    });
  };

  const handleClearStart = () => void postBoth({ start: { clear: true } });
  const handleClearEnd = () => void postBoth({ end: { clear: true } });

  const handleUseNowStart = () => {
    setStartTimeLocal(DateTime.now().setZone(practiceTz).toFormat('HH:mm'));
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
                    onChange={(e) => setStartTimeLocal(e.target.value)}
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

          {requiresForwardBooking ? (
            <section
              className={[
                'scheduler-modal-section',
                'scheduler-forward-booking-section',
                skipsForwardBookingList && !showLabsPendingFields
                  ? 'scheduler-forward-booking-section--override'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="scheduler-forward-booking-section-head">
                <p className="scheduler-modal-eyebrow" style={{ margin: 0 }}>
                  Forward booking
                </p>
                {dispositionLocked ? (
                  <span className="settings-muted scheduler-forward-booking-save-hint">Saved</span>
                ) : dispositionSaveStatus === 'saving' ? (
                  <span className="settings-muted scheduler-forward-booking-save-hint">Saving…</span>
                ) : dispositionSaveStatus === 'saved' ? (
                  <span className="settings-muted scheduler-forward-booking-save-hint">Saved</span>
                ) : dispositionSaveStatus === 'error' ? (
                  <span className="scheduler-forward-booking-save-hint" style={{ color: 'var(--danger, #c62828)' }}>
                    Could not save choice
                  </span>
                ) : null}
              </div>

              {nextScheduledApptLoading ? (
                <p className="settings-muted scheduler-forward-booking-booked-hint">
                  Checking for scheduled follow-ups…
                </p>
              ) : nextScheduledAppt ? (
                <dl className="scheduler-forward-booking-saved-details scheduler-forward-booking-next-appt">
                  <div>
                    <dt>Next scheduled visit</dt>
                    <dd>{formatNextAppointmentWhen(nextScheduledAppt, practiceTz)}</dd>
                  </div>
                  <div>
                    <dt>Appointment type</dt>
                    <dd>{appointmentTypeDisplayName(nextScheduledAppt)}</dd>
                  </div>
                  {nextScheduledNotes ? (
                    <div>
                      <dt>Appointment notes</dt>
                      <dd>{nextScheduledNotes}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : nextScheduledApptLoaded ? (
                <p className="settings-muted scheduler-forward-booking-booked-hint">
                  No upcoming appointment scheduled for this patient.
                </p>
              ) : null}

              {dispositionLocked ? (
                <div className="scheduler-forward-booking-saved">
                  <p className="scheduler-forward-booking-saved-lead">
                    Follow-up choice was saved and cannot be changed here.
                  </p>
                  {savedForwardBookingOption ? (
                    <div className="scheduler-forward-booking-mode-option scheduler-forward-booking-mode-option--active scheduler-forward-booking-mode-option--readonly">
                      <div className="scheduler-forward-booking-mode-row scheduler-forward-booking-mode-row--readonly">
                        <span className="scheduler-forward-booking-mode-copy">
                          <span className="scheduler-forward-booking-mode-label">
                            {savedForwardBookingOption.label}
                          </span>
                          <span className="scheduler-forward-booking-mode-hint">
                            {savedForwardBookingOption.hint}
                          </span>
                        </span>
                      </div>

                      {forwardBookingMode === 'labs_pending' ? (
                        <dl className="scheduler-forward-booking-saved-details">
                          <div>
                            <dt>Assign task to</dt>
                            <dd>{savedLabsAssigneeLabel}</dd>
                          </div>
                          <div>
                            <dt>Task</dt>
                            <dd>{labsTaskTitle.trim() || '—'}</dd>
                          </div>
                          <div>
                            <dt>Start</dt>
                            <dd>{formatSavedTaskDatetime(labsTaskStartLocal)}</dd>
                          </div>
                          <div>
                            <dt>Due</dt>
                            <dd>
                              {labsTaskDueLocal.trim()
                                ? formatSavedTaskDatetime(labsTaskDueLocal)
                                : 'No due date'}
                            </dd>
                          </div>
                        </dl>
                      ) : null}

                      {forwardBookingMode === 'forward_book_fields' ? (
                        <dl className="scheduler-forward-booking-saved-details">
                          <div>
                            <dt>Forward book</dt>
                            <dd>{savedForwardIntervalLabel}</dd>
                          </div>
                          <div>
                            <dt>Forward booking note</dt>
                            <dd>{bookingNotes.trim() || '—'}</dd>
                          </div>
                        </dl>
                      ) : null}

                      {forwardBookingMode === 'not_appropriate' ? (
                        <dl className="scheduler-forward-booking-saved-details">
                          <div>
                            <dt>Reason</dt>
                            <dd>{bookingNotes.trim() || '—'}</dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
              <fieldset className="scheduler-forward-booking-mode-fieldset" disabled={saving}>
                <legend className="scheduler-forward-booking-mode-legend">How should follow-up be handled?</legend>
                <div className="scheduler-forward-booking-mode-stack" role="radiogroup" aria-label="Forward booking option">
                  {FORWARD_BOOKING_MODE_OPTIONS.map(({ value, label, hint }) => {
                    const active = forwardBookingMode === value;
                    return (
                      <div
                        key={value}
                        className={[
                          'scheduler-forward-booking-mode-option',
                          active ? 'scheduler-forward-booking-mode-option--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <label className="scheduler-forward-booking-mode-row">
                          <input
                            type="radio"
                            name="forward-booking-mode"
                            value={value}
                            checked={active}
                            onChange={() => {
                              forwardBookingUserEditedRef.current = true;
                              setForwardBookingMode(value);
                              setError(null);
                            }}
                          />
                          <span className="scheduler-forward-booking-mode-copy">
                            <span className="scheduler-forward-booking-mode-label">{label}</span>
                            <span className="scheduler-forward-booking-mode-hint">{hint}</span>
                          </span>
                        </label>

                        {active && value === 'labs_pending' ? (
                          <div className="scheduler-forward-booking-mode-panel">
                            <label className="scheduler-edit-field">
                              <span>Assign task to *</span>
                              <select
                                value={labsAssigneeEmployeeId}
                                onChange={(e) => {
                                  forwardBookingUserEditedRef.current = true;
                                  setLabsAssigneeEmployeeId(e.target.value);
                                }}
                                disabled={saving || forwardBookingMetaLoading}
                                aria-label="Assign labs pending task to"
                              >
                                <option value="">Select staff member…</option>
                                {employees.map((em) => (
                                  <option key={em.id} value={String(em.id)}>
                                    {formatEmployeeDisplayName(em) || em.email}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="scheduler-edit-field">
                              <span>Task *</span>
                              <input
                                type="text"
                                value={labsTaskTitle}
                                onChange={(e) => {
                                  forwardBookingUserEditedRef.current = true;
                                  setLabsTaskTitle(e.target.value);
                                }}
                                disabled={saving || forwardBookingMetaLoading}
                                placeholder="What needs to be done?"
                                aria-label="Labs pending task description"
                              />
                            </label>
                            <div className="scheduler-edit-two-col" style={{ marginTop: 10 }}>
                              <label className="scheduler-edit-field">
                                <span>Start *</span>
                                <input
                                  type="datetime-local"
                                  value={labsTaskStartLocal}
                                  onChange={(e) => {
                                    forwardBookingUserEditedRef.current = true;
                                    setLabsTaskStartLocal(e.target.value);
                                  }}
                                  disabled={saving || forwardBookingMetaLoading}
                                  required
                                  aria-label="Task start date and time"
                                />
                              </label>
                              <label className="scheduler-edit-field">
                                <span>Due</span>
                                <input
                                  type="datetime-local"
                                  value={labsTaskDueLocal}
                                  onChange={(e) => {
                                    forwardBookingUserEditedRef.current = true;
                                    setLabsTaskDueLocal(e.target.value);
                                  }}
                                  disabled={saving || forwardBookingMetaLoading}
                                  aria-label="Task due date and time"
                                />
                                <span className="settings-muted scheduler-forward-booking-field-hint">
                                  Optional — leave blank for no due date.
                                </span>
                              </label>
                            </div>
                          </div>
                        ) : null}

                        {active && value === 'forward_book_fields' ? (
                          <div className="scheduler-forward-booking-mode-panel">
                            <div className="scheduler-edit-two-col">
                              <label className="scheduler-edit-field">
                                <span>Forward book *</span>
                                <select
                                  value={forwardAmount}
                                  onChange={(e) => {
                                    forwardBookingUserEditedRef.current = true;
                                    setForwardAmount(e.target.value);
                                  }}
                                  disabled={forwardBookingFieldsDisabled}
                                  required
                                  aria-label="Forward book amount"
                                >
                                  <option value="">Select…</option>
                                  {FORWARD_BOOKING_AMOUNT_OPTIONS.map((n) => (
                                    <option key={n} value={String(n)}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="scheduler-edit-field">
                                <span>Unit *</span>
                                <select
                                  value={forwardUnit}
                                  onChange={(e) => {
                                    forwardBookingUserEditedRef.current = true;
                                    setForwardUnit(e.target.value as ForwardBookingIntervalUnit | '');
                                  }}
                                  disabled={forwardBookingFieldsDisabled}
                                  required
                                  aria-label="Forward book unit"
                                >
                                  <option value="">Select…</option>
                                  {FORWARD_BOOKING_UNIT_OPTIONS.map(({ value: unitValue, label: unitLabel }) => (
                                    <option key={unitValue} value={unitValue}>
                                      {unitLabel}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
                              <span>Forward booking note</span>
                              <p
                                className="settings-muted"
                                style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}
                              >
                                Optional — shown on the forward booking list and prefilled when booking the
                                follow-up visit.
                              </p>
                              <textarea
                                className="settings-input"
                                rows={2}
                                value={bookingNotes}
                                onChange={(e) => {
                                  forwardBookingUserEditedRef.current = true;
                                  setBookingNotes(e.target.value);
                                }}
                                disabled={forwardBookingFieldsDisabled}
                                placeholder="e.g. Prefers AM slots, same provider"
                                aria-label="Forward booking note"
                                style={{
                                  width: '100%',
                                  resize: 'vertical',
                                  fontFamily: 'inherit',
                                  fontSize: 14,
                                }}
                              />
                            </label>
                          </div>
                        ) : null}

                        {active && value === 'not_appropriate' ? (
                          <div className="scheduler-forward-booking-mode-panel">
                            <label className="scheduler-edit-field" style={{ display: 'block' }}>
                              <span>Reason *</span>
                              <p
                                className="settings-muted"
                                style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}
                              >
                                Required — why is forward booking not appropriate for this visit?
                              </p>
                              <textarea
                                className="settings-input"
                                rows={3}
                                value={bookingNotes}
                                onChange={(e) => {
                                  forwardBookingUserEditedRef.current = true;
                                  setBookingNotes(e.target.value);
                                }}
                                disabled={saving}
                                required
                                placeholder="e.g. Hospice care, client declined follow-up, single euthanasia visit"
                                aria-label="Reason forward booking is not appropriate"
                                style={{
                                  width: '100%',
                                  resize: 'vertical',
                                  fontFamily: 'inherit',
                                  fontSize: 14,
                                }}
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              )}
            </section>
          ) : null}
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
