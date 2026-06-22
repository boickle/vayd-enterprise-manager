// Record actual visit start/end from scheduler context menu (single screen for both)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchAppointmentById,
  postAppointmentActualEnd,
  postAppointmentActualStart,
} from '../api/appointments';
import {
  patchForwardBookingDisposition,
  type ForwardBookingDisposition,
} from '../api/forwardBookingDisposition';
import { listPracticeBranches } from '../api/branchInventory';
import { createForwardBooking, fetchForwardBookingCalendarIndex } from '../api/forwardBooking';
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
  assertForwardBookingDispositionSaved,
  buildForwardBookingDispositionPayload,
  forwardBookingDispositionFromAppointment,
  forwardBookingFormStateFromDisposition,
  forwardBookingFormStateIsComplete,
  shouldLockForwardBookingDisposition,
  type ForwardBookingDispositionFormState,
} from '../utils/forwardBookingDisposition';
import { SchedulerHouseholdPetRow } from '../components/SchedulerHouseholdPetRow';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { patientsForAppointment } from '../utils/schedulerAddPet';
import {
  enrichRoutingClientPatientsMembership,
  extractActivePatientsFromClientStaffRecord,
  patientMembershipFromRecord,
  type RoutingClientPatientRow,
} from '../utils/routingPatientHoverData';
import {
  collectSameDayHouseholdVisits,
  type RescheduleSameDayVisit,
} from '../utils/routingRescheduleIntent';
import {
  buildForwardBookingCalendarIndexSets,
  householdVisitAlreadyForwardBooked,
} from '../utils/appointmentVisitTimesBadge';
import './Scheduler.css';

function isActiveForwardBookingExistsError(e: unknown): boolean {
  const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  const text = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : ax?.message ?? '';
  return /active forward booking already exists/i.test(text);
}

/** Debounced PATCH of follow-up choice while End Visit is open — not a final lock. */
const FORWARD_BOOKING_DISPOSITION_AUTOSAVE_MS = 3000;

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
    hint: 'Recommended: assign this to the doctor first. Once labs are reviewed and the follow-up timing is determined, the doctor can reassign the forward-booking task to the technician.',
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

function allHouseholdPatientIds(visits: RescheduleSameDayVisit[]): Set<string> {
  return new Set(visits.map((visit) => visit.patientId));
}

function membershipForHouseholdVisit(
  visit: RescheduleSameDayVisit,
  anchorAppt: Appointment,
  sameCalendarDayAppointments: Appointment[]
): { isMember: boolean; membershipName: string | null } {
  const appt =
    sameCalendarDayAppointments.find((a) => a.id === visit.appointmentId) ??
    (anchorAppt.id === visit.appointmentId ? anchorAppt : undefined);
  if (!appt) return { isMember: false, membershipName: null };
  for (const p of patientsForAppointment(appt)) {
    if (p.id != null && String(p.id) === visit.patientId) {
      return patientMembershipFromRecord(p);
    }
  }
  return patientMembershipFromRecord(appt);
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

/** Map a time input to set, clear, or skip — clearing a recorded time sends `{ clear: true }`. */
function actualTimeFieldPayload(
  timeLocal: string,
  existingIso: string | null,
  dateKey: string,
  practiceTz: string
): { at: string } | { clear: true } | null {
  const trimmed = timeLocal.trim();
  if (trimmed) {
    const at = combineDateAndTimeToUtc(dateKey, trimmed, practiceTz);
    return at ? { at } : null;
  }
  if (existingIso) return { clear: true };
  return null;
}

type Props = {
  appt: Appointment;
  /** `both` — combined Start / End Visit screen (default from context menu). */
  field?: ActualVisitTimeField;
  practiceId: number;
  practiceTz: string;
  /** Same-day calendar rows — used to offer forward booking for all household pets. */
  sameCalendarDayAppointments?: Appointment[];
  /** Forward-booking calendar index — grey out household pets already on the list. */
  forwardBookingSourceAppointmentIds?: ReadonlySet<number>;
  forwardBookingSavedPatientIds?: ReadonlySet<number>;
  accentColor: string;
  onClose: () => void;
  onSaved: (updated: Appointment, options?: { closeModal?: boolean }) => void;
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

function primaryPatientContext(appt: Appointment): {
  id: string;
  name: string;
  alerts: string | null;
} | null {
  const multi = (appt as { patients?: { id?: number | string; name?: string | null; alerts?: string | null }[] })
    .patients;
  const row =
    Array.isArray(multi) && multi.length > 0
      ? multi[0]
      : appt.patient
        ? {
            id: appt.patient.id,
            name: appt.patient.name,
            alerts: appt.patient.alerts,
          }
        : null;
  if (!row?.id) return null;
  const id = String(row.id).trim();
  if (!id) return null;
  return {
    id,
    name: pickStr(row.name) ?? 'Patient',
    alerts: pickStr(row.alerts),
  };
}

function anchorPatientIdsForAppointment(appt: Appointment): string[] {
  const multi = (appt as { patients?: { id?: number | string }[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    return multi
      .map((p) => (p.id != null ? String(p.id) : null))
      .filter((id): id is string => Boolean(id));
  }
  if (appt.patient?.id != null) return [String(appt.patient.id)];
  return [];
}

function orderHouseholdVisitsForAnchor(
  visits: RescheduleSameDayVisit[],
  appt: Appointment
): RescheduleSameDayVisit[] {
  if (visits.length <= 1) return visits;
  const anchorPatientOrder = new Map(
    anchorPatientIdsForAppointment(appt).map((id, index) => [id, index])
  );
  const anchorApptId = appt.id;
  return [...visits].sort((a, b) => {
    const aIsAnchor = a.appointmentId === anchorApptId || anchorPatientOrder.has(a.patientId);
    const bIsAnchor = b.appointmentId === anchorApptId || anchorPatientOrder.has(b.patientId);
    if (aIsAnchor !== bIsAnchor) return aIsAnchor ? -1 : 1;
    if (aIsAnchor && bIsAnchor) {
      const aOrder = anchorPatientOrder.get(a.patientId);
      const bOrder = anchorPatientOrder.get(b.patientId);
      if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
      if (aOrder != null && bOrder == null) return -1;
      if (aOrder == null && bOrder != null) return 1;
      if (a.appointmentId === anchorApptId && b.appointmentId !== anchorApptId) return -1;
      if (a.appointmentId !== anchorApptId && b.appointmentId === anchorApptId) return 1;
    }
    return (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    });
  });
}

function isAnchorHouseholdVisit(visit: RescheduleSameDayVisit, appt: Appointment): boolean {
  if (visit.appointmentId === appt.id) return true;
  const anchorIds = anchorPatientIdsForAppointment(appt);
  return anchorIds.length === 1 && anchorIds[0] === visit.patientId;
}

function defaultLabsPendingTaskTitle(appt: Appointment): string {
  const subject = [primaryPatientName(appt), pickStr(appt.client?.lastName)].filter(Boolean).join(' ');
  if (!subject) return 'Forward book once labs come back.';
  return `Forward book ${subject} once labs come back.`;
}

function defaultLabsAssigneeEmployeeId(appt: Appointment): string {
  const id = appt.primaryProvider?.id;
  if (id == null || !Number.isFinite(Number(id))) return '';
  return String(id);
}

function defaultForwardBookingProviderId(appt: Appointment): string {
  return defaultLabsAssigneeEmployeeId(appt);
}

function providerSelectLabel(p: Provider): string {
  const name =
    [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() ||
    pickStr(p.name) ||
    `Provider #${p.id}`;
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function applyDefaultLabsAssignee(
  form: ForwardBookingDispositionFormState,
  appt: Appointment
): ForwardBookingDispositionFormState {
  if (form.labsAssigneeEmployeeId.trim()) return form;
  const def = defaultLabsAssigneeEmployeeId(appt);
  return def ? { ...form, labsAssigneeEmployeeId: def } : form;
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
  sameCalendarDayAppointments = [],
  forwardBookingSourceAppointmentIds = new Set<number>(),
  forwardBookingSavedPatientIds = new Set<number>(),
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
      applyDefaultLabsAssignee(
        forwardBookingFormStateFromDisposition(
          appt.forwardBookingDisposition ?? forwardBookingDispositionFromAppointment(appt),
          { labsTaskTitle: defaultLabsTaskTitle, labsTaskStartLocal: defaultLabsStartLocal }
        ),
        appt
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
  const [forwardBookingProviderId, setForwardBookingProviderId] = useState(() =>
    defaultForwardBookingProviderId(appt)
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [forwardBookingMetaLoading, setForwardBookingMetaLoading] = useState(false);
  const [dispositionSaveStatus, setDispositionSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [dispositionLocked, setDispositionLocked] = useState(() =>
    shouldLockForwardBookingDisposition(appt)
  );
  const [forwardBookingIndex, setForwardBookingIndex] = useState<{
    sourceAppointmentIds: ReadonlySet<number>;
    patientIds: ReadonlySet<number>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispositionHydratedRef = useRef(false);
  const forwardBookingUserEditedRef = useRef(false);
  const dispositionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forwardBookingListEnsuredRef = useRef(false);
  const labsPendingTaskEnsuredRef = useRef(false);
  const forwardBookingFormRef = useRef<ForwardBookingDispositionFormState>({
    mode: initialForwardBookingForm.mode,
    forwardAmount: initialForwardBookingForm.forwardAmount,
    forwardUnit: initialForwardBookingForm.forwardUnit,
    bookingNotes: initialForwardBookingForm.bookingNotes,
    labsAssigneeEmployeeId: initialForwardBookingForm.labsAssigneeEmployeeId,
    labsTaskTitle: initialForwardBookingForm.labsTaskTitle,
    labsTaskStartLocal: initialForwardBookingForm.labsTaskStartLocal,
    labsTaskDueLocal: initialForwardBookingForm.labsTaskDueLocal,
  });

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
  const savedForwardBookingProviderLabel = useMemo(() => {
    const id = Number(forwardBookingProviderId);
    if (!Number.isFinite(id)) return '—';
    const row = providers.find((p) => Number(p.id) === id);
    return row ? providerSelectLabel(row) : '—';
  }, [forwardBookingProviderId, providers]);
  const savedForwardIntervalLabel = useMemo(
    () => formatSavedForwardInterval(forwardAmount, forwardUnit),
    [forwardAmount, forwardUnit]
  );
  const forwardBookingPatient = useMemo(() => primaryPatientContext(appt), [appt]);
  const effectiveForwardBookingSourceIds = useMemo(
    () => forwardBookingIndex?.sourceAppointmentIds ?? forwardBookingSourceAppointmentIds,
    [forwardBookingIndex, forwardBookingSourceAppointmentIds]
  );
  const effectiveForwardBookingPatientIds = useMemo(
    () => forwardBookingIndex?.patientIds ?? forwardBookingSavedPatientIds,
    [forwardBookingIndex, forwardBookingSavedPatientIds]
  );
  const householdVisits = useMemo(() => {
    const visits = collectSameDayHouseholdVisits(appt, sameCalendarDayAppointments, practiceTz);
    return orderHouseholdVisitsForAnchor(visits, appt);
  }, [appt, sameCalendarDayAppointments, practiceTz]);
  const householdMembershipByPatientId = useMemo(() => {
    const map = new Map<string, { isMember: boolean; membershipName: string | null }>();
    for (const visit of householdVisits) {
      map.set(
        visit.patientId,
        membershipForHouseholdVisit(visit, appt, sameCalendarDayAppointments)
      );
    }
    return map;
  }, [appt, householdVisits, sameCalendarDayAppointments]);
  const [clientHouseholdPets, setClientHouseholdPets] = useState<RoutingClientPatientRow[]>([]);
  const [otherHouseholdPetsLoading, setOtherHouseholdPetsLoading] = useState(false);
  const isAnchorVisit = useCallback(
    (visit: RescheduleSameDayVisit) => isAnchorHouseholdVisit(visit, appt),
    [appt]
  );
  const [selectedHouseholdPatientIds, setSelectedHouseholdPatientIds] = useState<Set<string>>(
    () => allHouseholdPatientIds(householdVisits)
  );
  const [selectedVisitTimePatientIds, setSelectedVisitTimePatientIds] = useState<Set<string>>(
    () => new Set(householdVisits.map((visit) => visit.patientId))
  );

  useEffect(() => {
    setSelectedHouseholdPatientIds(allHouseholdPatientIds(householdVisits));
    setSelectedVisitTimePatientIds(new Set(householdVisits.map((visit) => visit.patientId)));
  }, [appt.id, householdVisits]);

  useEffect(() => {
    const clientId = appt.client?.id;
    if (clientId == null) {
      setClientHouseholdPets([]);
      setOtherHouseholdPetsLoading(false);
      return;
    }
    let cancelled = false;
    setOtherHouseholdPetsLoading(true);
    void fetchClientByIdStaff(clientId)
      .then((raw) => extractActivePatientsFromClientStaffRecord(raw))
      .then((rows) => enrichRoutingClientPatientsMembership(rows))
      .then((rows) => {
        if (cancelled) return;
        setClientHouseholdPets(rows);
      })
      .catch(() => {
        if (!cancelled) setClientHouseholdPets([]);
      })
      .finally(() => {
        if (!cancelled) setOtherHouseholdPetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appt.client?.id]);

  const clientMembershipByPatientId = useMemo(() => {
    const map = new Map<string, { isMember: boolean; membershipName: string | null }>();
    for (const row of clientHouseholdPets) {
      map.set(String(row.id), {
        isMember: row.isMember === true,
        membershipName: row.membershipName ?? null,
      });
    }
    return map;
  }, [clientHouseholdPets]);

  const otherHouseholdPets = useMemo(() => {
    const scheduledTodayIds = new Set(householdVisits.map((visit) => visit.patientId));
    return clientHouseholdPets.filter((row) => !scheduledTodayIds.has(String(row.id)));
  }, [clientHouseholdPets, householdVisits]);

  const membershipForPatientId = useCallback(
    (patientId: string) =>
      householdMembershipByPatientId.get(patientId) ??
      clientMembershipByPatientId.get(patientId) ?? {
        isMember: false,
        membershipName: null,
      },
    [clientMembershipByPatientId, householdMembershipByPatientId]
  );

  const householdFollowUpAppointmentIds = useCallback((): number[] => {
    if (householdVisits.length <= 1) {
      return typeof appt.id === 'number' ? [appt.id] : [];
    }
    const ids = [
      ...new Set(
        householdVisits
          .filter((visit) => selectedHouseholdPatientIds.has(visit.patientId))
          .map((visit) => visit.appointmentId)
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    return ids.length > 0 ? ids : [];
  }, [appt.id, householdVisits, selectedHouseholdPatientIds]);

  const visitTimeAppointmentIds = useCallback((): number[] => {
    if (householdVisits.length <= 1) {
      return typeof appt.id === 'number' ? [appt.id] : [];
    }
    const ids = [
      ...new Set(
        householdVisits
          .filter((visit) => selectedVisitTimePatientIds.has(visit.patientId))
          .map((visit) => visit.appointmentId)
      ),
    ];
    return ids.length > 0 ? ids : typeof appt.id === 'number' ? [appt.id] : [];
  }, [appt.id, householdVisits, selectedVisitTimePatientIds]);

  const householdVisitScheduledLabel = useCallback(
    (visit: (typeof householdVisits)[number]): string => {
      const row =
        sameCalendarDayAppointments.find((a) => a.id === visit.appointmentId) ?? appt;
      const start = formatPracticeTime(row.appointmentStart, practiceTz);
      const end = formatPracticeTime(row.appointmentEnd, practiceTz);
      return `${start} – ${end}`;
    },
    [appt, practiceTz, sameCalendarDayAppointments]
  );

  useEffect(() => {
    forwardBookingFormRef.current = {
      mode: forwardBookingMode,
      forwardAmount,
      forwardUnit,
      bookingNotes,
      labsAssigneeEmployeeId,
      labsTaskTitle,
      labsTaskStartLocal,
      labsTaskDueLocal,
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
  ]);

  const currentForwardBookingFormState = useCallback((): ForwardBookingDispositionFormState => {
    return forwardBookingFormRef.current;
  }, []);

  const shouldPersistForwardBookingDisposition = useCallback((): boolean => {
    if (!requiresForwardBooking || dispositionLocked) return false;
    return forwardBookingFormStateIsComplete(currentForwardBookingFormState());
  }, [currentForwardBookingFormState, dispositionLocked, requiresForwardBooking]);

  const clearPendingDispositionSave = useCallback(() => {
    if (dispositionSaveTimerRef.current) {
      clearTimeout(dispositionSaveTimerRef.current);
      dispositionSaveTimerRef.current = null;
    }
  }, []);

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
    if (!requiresForwardBooking) return;
    let cancelled = false;
    void fetchForwardBookingCalendarIndex(practiceId)
      .then((index) => {
        if (!cancelled) setForwardBookingIndex(buildForwardBookingCalendarIndexSets(index));
      })
      .catch(() => {
        /* keep props fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [appt.id, practiceId, requiresForwardBooking]);

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
      const form = applyDefaultLabsAssignee(
        forwardBookingFormStateFromDisposition(
          fresh.forwardBookingDisposition ?? forwardBookingDispositionFromAppointment(fresh),
          { labsTaskTitle: defaultLabsTaskTitle, labsTaskStartLocal: defaultLabsStartLocal }
        ),
        fresh
      );
      if (!forwardBookingUserEditedRef.current) {
        applyForwardBookingForm(form);
      }
      setDispositionLocked(shouldLockForwardBookingDisposition(fresh));
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

  const persistForwardBookingDisposition = useCallback(async () => {
    const formState = currentForwardBookingFormState();
    const payload = buildForwardBookingDispositionPayload(formState);
    const appointmentIds = householdFollowUpAppointmentIds();
    if (appointmentIds.length === 0) {
      throw new Error('Select at least one pet for the follow-up choice.');
    }
    let saved: ForwardBookingDisposition = payload;
    for (const appointmentId of appointmentIds) {
      saved = await patchForwardBookingDisposition(appointmentId, payload, { practiceId });
    }
    assertForwardBookingDispositionSaved(payload, saved);
    return saved;
  }, [currentForwardBookingFormState, householdFollowUpAppointmentIds, practiceId]);

  const forwardInterval = useMemo(() => {
    const amount = Number(forwardAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !forwardUnit) return null;
    return { amount, unit: forwardUnit };
  }, [forwardAmount, forwardUnit]);

  const buildLabsPendingTaskLinks = useCallback((): TaskLinkInput[] => {
    const links: TaskLinkInput[] = [];
    const seen = new Set<string>();
    const add = (entityType: TaskLinkInput['entityType'], entityId: number) => {
      const key = `${entityType}:${entityId}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ entityType, entityId });
    };

    const visits =
      householdVisits.length > 1
        ? householdVisits.filter((visit) => selectedHouseholdPatientIds.has(visit.patientId))
        : [];

    const clientId = appt.client?.id;
    if (typeof clientId === 'number' && Number.isFinite(clientId)) {
      add('client', clientId);
    }

    if (visits.length > 0) {
      for (const visit of visits) {
        add('appointment', visit.appointmentId);
        const patientId = Number(visit.patientId);
        if (Number.isFinite(patientId) && patientId > 0) add('patient', patientId);
      }
      return links;
    }

    add('appointment', appt.id);
    const patientId = appt.patient?.id;
    if (typeof patientId === 'number' && Number.isFinite(patientId)) {
      add('patient', patientId);
    }
    return links;
  }, [appt.client?.id, appt.id, appt.patient?.id, householdVisits, selectedHouseholdPatientIds]);

  /** Create forward-booking list rows and labs tasks — not tied to visit end time or disposition lock. */
  const ensureFollowUpSideEffects = useCallback(async () => {
    if (isStartOnly || !requiresForwardBooking) return;

    if (forwardBookingMode === 'labs_pending') {
      if (labsPendingTaskEnsuredRef.current || dispositionLocked) return;

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
      labsPendingTaskEnsuredRef.current = true;
      return;
    }

    if (skipsForwardBookingList) return;
    if (forwardBookingListEnsuredRef.current) return;
    if (dispositionLocked) {
      forwardBookingListEnsuredRef.current = true;
      return;
    }

    if (!forwardInterval) {
      throw new Error('Select how far out to forward book (number and days, weeks, or months).');
    }
    const visitsToBook =
      householdVisits.length > 1
        ? householdVisits.filter((visit) => selectedHouseholdPatientIds.has(visit.patientId))
        : householdVisits;
    if (householdVisits.length > 1 && visitsToBook.length === 0) {
      throw new Error('Select at least one pet to forward book.');
    }
    const pendingVisits = visitsToBook.filter(
      (visit) =>
        !householdVisitAlreadyForwardBooked(
          visit,
          effectiveForwardBookingSourceIds,
          effectiveForwardBookingPatientIds
        )
    );
    if (pendingVisits.length === 0) {
      forwardBookingListEnsuredRef.current = true;
      return;
    }
    for (const visit of pendingVisits) {
      const sourceAppt =
        sameCalendarDayAppointments.find((row) => row.id === visit.appointmentId) ?? appt;
      const providerOverride = Number(forwardBookingProviderId);
      const payload = buildCreateForwardBookingPayloadFromAppointment(
        sourceAppt,
        forwardInterval,
        practiceId,
        {
          bookingNotes: bookingNotes.trim() || null,
          patientId: Number(visit.patientId),
          ...(Number.isFinite(providerOverride) && providerOverride > 0
            ? { primaryProviderId: providerOverride }
            : {}),
        }
      );
      if (!payload) {
        throw new Error(
          `Could not create a forward booking for ${visit.patientName ?? 'this pet'}.`
        );
      }
      try {
        await createForwardBooking({
          ...payload,
          createdVia: 'end_visit',
        });
      } catch (e: unknown) {
        if (!isActiveForwardBookingExistsError(e)) throw e;
      }
    }
    forwardBookingListEnsuredRef.current = true;
  }, [
    appt,
    bookingNotes,
    branchIds,
    buildLabsPendingTaskLinks,
    dispositionLocked,
    effectiveForwardBookingPatientIds,
    effectiveForwardBookingSourceIds,
    forwardBookingMode,
    forwardBookingProviderId,
    forwardInterval,
    householdVisits,
    isStartOnly,
    labsAssigneeEmployeeId,
    labsTaskDueLocal,
    labsTaskStartLocal,
    labsTaskTitle,
    practiceId,
    requiresForwardBooking,
    sameCalendarDayAppointments,
    selectedHouseholdPatientIds,
    skipsForwardBookingList,
  ]);

  useEffect(() => {
    if (!requiresForwardBooking || !dispositionHydratedRef.current || saving || dispositionLocked) {
      return;
    }

    const formState: ForwardBookingDispositionFormState = {
      mode: forwardBookingMode,
      forwardAmount,
      forwardUnit,
      bookingNotes,
      labsAssigneeEmployeeId,
      labsTaskTitle,
      labsTaskStartLocal,
      labsTaskDueLocal,
    };
    if (!forwardBookingFormStateIsComplete(formState)) {
      clearPendingDispositionSave();
      return;
    }
    if (householdVisits.length > 1 && selectedHouseholdPatientIds.size === 0) {
      clearPendingDispositionSave();
      return;
    }

    clearPendingDispositionSave();
    setDispositionSaveStatus((s) => (s === 'saved' ? 'idle' : s));

    dispositionSaveTimerRef.current = setTimeout(() => {
      setDispositionSaveStatus('saving');
      void persistForwardBookingDisposition()
        .then(() => {
          setDispositionSaveStatus('saved');
        })
        .catch(() => setDispositionSaveStatus('error'));
    }, FORWARD_BOOKING_DISPOSITION_AUTOSAVE_MS);

    return () => {
      clearPendingDispositionSave();
    };
  }, [
    bookingNotes,
    clearPendingDispositionSave,
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
    selectedHouseholdPatientIds,
    householdVisits.length,
  ]);

  useEffect(() => {
    if (!requiresForwardBooking) return;
    let on = true;
    setForwardBookingMetaLoading(true);
    void (async () => {
      try {
        const [branchList, employeeList, providerList] = await Promise.all([
          listPracticeBranches(practiceId),
          fetchAllEmployees(),
          fetchPrimaryProviders(),
        ]);
        if (!on) return;
        const activeBranchIds = (Array.isArray(branchList) ? branchList : [])
          .filter((b) => b.isActive !== false)
          .map((b) => b.id);
        setBranchIds(activeBranchIds);
        setEmployees(Array.isArray(employeeList) ? employeeList : []);
        setProviders(Array.isArray(providerList) ? providerList : []);
      } catch {
        if (!on) return;
        setBranchIds([]);
        setEmployees([]);
        setProviders([]);
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
    async (body: { at?: string; clear?: boolean }) => {
      let last = appt;
      for (const id of visitTimeAppointmentIds()) {
        last = await postAppointmentActualStart(id, body);
      }
      return last;
    },
    [appt, visitTimeAppointmentIds]
  );

  const saveEnd = useCallback(
    async (body: { at?: string; clear?: boolean }) => {
      let last = appt;
      for (const id of visitTimeAppointmentIds()) {
        last = await postAppointmentActualEnd(id, body);
      }
      return last;
    },
    [appt, visitTimeAppointmentIds]
  );

  const postBoth = useCallback(
    async (
      opts: {
        start?: { at?: string; clear?: boolean };
        end?: { at?: string; clear?: boolean };
      },
      saveOptions?: { closeModal?: boolean; saveFollowUp?: boolean }
    ) => {
      setSaving(true);
      setError(null);
      try {
        const savingStart = Boolean(opts.start);
        const savingEnd = Boolean(opts.end);
        const followUpOnly = !savingStart && !savingEnd;
        const saveFollowUp =
          saveOptions?.saveFollowUp ??
          (requiresForwardBooking && (savingEnd || followUpOnly));

        let updated = appt;
        if (opts.start) updated = await saveStart(opts.start);
        if (opts.end) updated = await saveEnd(opts.end);
        if (saveFollowUp && shouldPersistForwardBookingDisposition()) {
          clearPendingDispositionSave();
          const savedDisposition = await persistForwardBookingDisposition();
          updated = { ...updated, forwardBookingDisposition: savedDisposition };
          setDispositionLocked(shouldLockForwardBookingDisposition(updated));
        }
        if (saveFollowUp) {
          await ensureFollowUpSideEffects();
        }

        const closeModal =
          saveOptions?.closeModal ??
          (isEndOnly || isStartOnly || (isBoth && savingEnd));

        onSaved(updated, { closeModal });
        if (closeModal) onClose();
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
    [
      appt,
      clearPendingDispositionSave,
      onClose,
      onSaved,
      persistForwardBookingDisposition,
      saveEnd,
      saveStart,
      ensureFollowUpSideEffects,
      shouldPersistForwardBookingDisposition,
      isBoth,
      isEndOnly,
      isStartOnly,
      requiresForwardBooking,
    ]
  );

  const validateForwardBooking = (): boolean => {
    if (!requiresForwardBooking) return true;
    if (dispositionLocked) return true;

    if (householdVisits.length > 1 && selectedHouseholdPatientIds.size === 0) {
      setError('Select at least one pet for the follow-up choice.');
      return false;
    }

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
    const visitTimeChangePending =
      startTimeLocal.trim() ||
      endTimeLocal.trim() ||
      (existingStartIso && !startTimeLocal.trim()) ||
      (existingEndIso && !endTimeLocal.trim());
    if (
      householdVisits.length > 1 &&
      selectedVisitTimePatientIds.size === 0 &&
      visitTimeChangePending
    ) {
      setError('Select at least one pet to apply visit times to.');
      return;
    }
    if (isStartOnly) {
      const startPayload = actualTimeFieldPayload(
        startTimeLocal,
        existingStartIso,
        dateKey,
        practiceTz
      );
      if (!startPayload) {
        setError('Enter a valid start time.');
        return;
      }
      void postBoth({ start: startPayload }, { closeModal: true, saveFollowUp: false });
      return;
    }
    if (isEndOnly) {
      const endPayload = actualTimeFieldPayload(endTimeLocal, existingEndIso, dateKey, practiceTz);
      if (!endPayload) {
        setError('Enter a valid end time.');
        return;
      }
      if (!validateForwardBooking()) return;
      void postBoth({ end: endPayload }, { closeModal: true, saveFollowUp: true });
      return;
    }
    const startPayload = actualTimeFieldPayload(
      startTimeLocal,
      existingStartIso,
      dateKey,
      practiceTz
    );
    const endPayload = actualTimeFieldPayload(endTimeLocal, existingEndIso, dateKey, practiceTz);
    if (startTimeLocal.trim() && !startPayload) {
      setError('Enter a valid start time.');
      return;
    }
    if (endTimeLocal.trim() && !endPayload) {
      setError('Enter a valid end time.');
      return;
    }
    const savingStart = Boolean(startPayload);
    const savingEnd = Boolean(endPayload);
    const followUpOnly = !savingStart && !savingEnd;

    if (followUpOnly) {
      if (!validateForwardBooking()) return;
      void postBoth({}, { closeModal: false, saveFollowUp: true });
      return;
    }

    if (savingEnd && !validateForwardBooking()) return;

    if (savingStart && !savingEnd) {
      void postBoth(
        { start: startPayload! },
        { closeModal: false, saveFollowUp: false }
      );
      return;
    }

    void postBoth(
      {
        ...(startPayload ? { start: startPayload } : {}),
        ...(endPayload ? { end: endPayload } : {}),
      },
      { closeModal: true, saveFollowUp: savingEnd }
    );
  };

  const handleClearStart = () =>
    void postBoth({ start: { clear: true } }, { closeModal: false, saveFollowUp: false });
  const handleClearEnd = () =>
    void postBoth({ end: { clear: true } }, { closeModal: false, saveFollowUp: false });

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

        <div className="scheduler-modal-body">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}

          <section className="scheduler-modal-section">
            {householdVisits.length > 1 ? (
              <>
                <p className="scheduler-actual-visit-scheduled">
                  This visit ({patientsLabel(appt)}):{' '}
                  {formatPracticeTime(appt.appointmentStart, practiceTz)} –{' '}
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
                <div className="scheduler-forward-booking-household-pets" style={{ marginBottom: 14 }}>
                  <p className="settings-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
                    Apply actual start/end times to pets in this household today (same times for each
                    selected pet):
                  </p>
                  <div className="scheduler-household-pet-list">
                    {householdVisits.map((visit) => (
                      <SchedulerHouseholdPetRow
                        key={`visit-time-${visit.patientId}`}
                        patientId={visit.patientId}
                        patientName={visit.patientName?.trim() || `Pet ${visit.patientId}`}
                        practiceId={practiceId}
                        practiceTz={practiceTz}
                        membership={membershipForPatientId(visit.patientId)}
                        excludeAppointmentId={visit.appointmentId}
                        isAnchor={isAnchorVisit(visit)}
                        checked={selectedVisitTimePatientIds.has(visit.patientId)}
                        checkboxDisabled={saving}
                        onCheckedChange={(checked) => {
                          setSelectedVisitTimePatientIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(visit.patientId);
                            else next.delete(visit.patientId);
                            return next;
                          });
                        }}
                        badges={
                          isAnchorVisit(visit) ? (
                            <span className="scheduler-household-pet-row-badge">This visit</span>
                          ) : null
                        }
                        trailingMeta={
                          <span className="settings-muted scheduler-household-pet-row-scheduled">
                            Scheduled {householdVisitScheduledLabel(visit)}
                          </span>
                        }
                      />
                    ))}
                  </div>
                </div>
              </>
            ) : (
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
            )}

            <div className="scheduler-edit-grid">
              <div className="scheduler-edit-field scheduler-edit-readonly">
                <span>Date</span>
                <input type="text" readOnly value={dateLabel} />
              </div>

              {isBoth ? (
                <p className="settings-muted scheduler-actual-visit-times-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  Save start anytime. Follow-up is required when you save end time — you can fill
                  visit times and forward booking in any order.
                </p>
              ) : null}

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
                  <span className="settings-muted scheduler-forward-booking-save-hint">
                    Draft saved — you can keep editing
                  </span>
                ) : dispositionSaveStatus === 'error' ? (
                  <span className="scheduler-forward-booking-save-hint" style={{ color: 'var(--danger, #c62828)' }}>
                    Could not save choice
                  </span>
                ) : null}
              </div>

              {householdVisits.length > 1 ? (
                <div className="scheduler-forward-booking-household-pets">
                  <p className="settings-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
                    {showForwardBookFields
                      ? 'Forward book for pets in this household today (same interval for each selected pet):'
                      : 'Apply this follow-up choice to pets in this household today (same choice for each selected pet):'}
                  </p>
                  <div className="scheduler-household-pet-list">
                    {householdVisits.map((visit) => {
                      const alreadyForwardBooked = householdVisitAlreadyForwardBooked(
                        visit,
                        effectiveForwardBookingSourceIds,
                        effectiveForwardBookingPatientIds
                      );
                      const disableForForwardBook =
                        showForwardBookFields &&
                        (forwardBookingFieldsDisabled || alreadyForwardBooked);
                      return (
                        <SchedulerHouseholdPetRow
                          key={visit.patientId}
                          patientId={visit.patientId}
                          patientName={visit.patientName?.trim() || `Pet ${visit.patientId}`}
                          practiceId={practiceId}
                          practiceTz={practiceTz}
                          membership={membershipForPatientId(visit.patientId)}
                          excludeAppointmentId={visit.appointmentId}
                          isAnchor={isAnchorVisit(visit)}
                          checked={selectedHouseholdPatientIds.has(visit.patientId)}
                          checkboxDisabled={saving || disableForForwardBook}
                          rowClassName={
                            alreadyForwardBooked && showForwardBookFields
                              ? 'scheduler-household-pet-row--saved'
                              : ''
                          }
                          onCheckedChange={(checked) => {
                            forwardBookingUserEditedRef.current = true;
                            setSelectedHouseholdPatientIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(visit.patientId);
                              else next.delete(visit.patientId);
                              return next;
                            });
                          }}
                          badges={
                            <>
                              {isAnchorVisit(visit) ? (
                                <span className="scheduler-household-pet-row-badge">This visit</span>
                              ) : null}
                              {alreadyForwardBooked && showForwardBookFields ? (
                                <span className="scheduler-household-pet-row-badge scheduler-household-pet-row-badge--saved">
                                  Forward booking saved
                                </span>
                              ) : null}
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ) : forwardBookingPatient ? (
                <div className="scheduler-forward-booking-patient-context">
                  <SchedulerHouseholdPetRow
                    patientId={forwardBookingPatient.id}
                    patientName={forwardBookingPatient.name}
                    practiceId={practiceId}
                    practiceTz={practiceTz}
                    membership={membershipForPatientId(forwardBookingPatient.id)}
                    excludeAppointmentId={appt.id}
                    isAnchor
                    showCheckbox={false}
                  />
                  {forwardBookingPatient.alerts ? (
                    <div
                      className="scheduler-modal-alerts-box scheduler-book-patient-alerts"
                      role="alert"
                    >
                      <span className="scheduler-modal-alerts-box-label">Patient alerts</span>
                      {forwardBookingPatient.alerts}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {otherHouseholdPetsLoading ? (
                <p className="settings-muted scheduler-household-other-pets-hint">Loading household pets…</p>
              ) : otherHouseholdPets.length > 0 ? (
                <details className="scheduler-household-other-pets">
                  <summary>
                    Other household pets not scheduled today ({otherHouseholdPets.length})
                  </summary>
                  <p className="settings-muted scheduler-household-other-pets-lead">
                    Review reminders and visit history to align follow-up timing across the household.
                    These pets are not included in today&apos;s forward booking selection.
                  </p>
                  <div className="scheduler-household-pet-list">
                    {otherHouseholdPets.map((pet) => (
                      <SchedulerHouseholdPetRow
                        key={`other-${pet.id}`}
                        patientId={String(pet.id)}
                        patientName={pet.name}
                        practiceId={practiceId}
                        practiceTz={practiceTz}
                        membership={{
                          isMember: pet.isMember === true,
                          membershipName: pet.membershipName ?? null,
                        }}
                        showCheckbox={false}
                        rowClassName="scheduler-household-pet-row--reference"
                      />
                    ))}
                  </div>
                </details>
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
                            <dt>Forward booking with</dt>
                            <dd>{savedForwardBookingProviderLabel}</dd>
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
                              if (value === 'labs_pending' && !labsAssigneeEmployeeId.trim()) {
                                const def = defaultLabsAssigneeEmployeeId(appt);
                                if (def) setLabsAssigneeEmployeeId(def);
                              }
                              if (value === 'forward_book_fields' && !forwardBookingProviderId.trim()) {
                                const def = defaultForwardBookingProviderId(appt);
                                if (def) setForwardBookingProviderId(def);
                              }
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
                              <span>Forward booking with</span>
                              <select
                                className="settings-input"
                                value={forwardBookingProviderId}
                                onChange={(e) => {
                                  forwardBookingUserEditedRef.current = true;
                                  setForwardBookingProviderId(e.target.value);
                                }}
                                disabled={forwardBookingFieldsDisabled || forwardBookingMetaLoading}
                                aria-label="Forward booking provider"
                                style={{ width: '100%' }}
                              >
                                <option value="">Select provider…</option>
                                {providers.map((p) => (
                                  <option key={String(p.id)} value={String(p.id)}>
                                    {providerSelectLabel(p)}
                                  </option>
                                ))}
                              </select>
                            </label>
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
