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
  type ForwardBookingDispositionMode,
} from '../api/forwardBookingDisposition';
import { listPracticeBranches } from '../api/branchInventory';
import { createForwardBooking, fetchForwardBookingCalendarIndex } from '../api/forwardBooking';
import type { Appointment } from '../api/roomLoader';
import { createTask, type TaskLinkInput } from '../api/tasks';
import {
  buildCreateForwardBookingPayloadFromAppointment,
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
  followUpSideEffectsSessionKey,
  markFollowUpSideEffectsDone,
  readFollowUpSideEffectsDone,
} from '../utils/visitFollowUpSideEffectsSession';
import {
  assertForwardBookingDispositionSaved,
  buildForwardBookingDispositionPayload,
  forwardBookingDispositionFromAppointment,
  forwardBookingFormStateFromDisposition,
  forwardBookingFormStateIsComplete,
  shouldLockForwardBookingDisposition,
  type ForwardBookingDispositionFormState,
} from '../utils/forwardBookingDisposition';
import ForwardBookingDecisionFields, {
  forwardBookingModeOption,
} from '../components/forwardBooking/ForwardBookingDecisionFields';
import { SchedulerHouseholdPetRow } from '../components/SchedulerHouseholdPetRow';
import EuthanasiaFutureAppointmentsModal from '../components/EuthanasiaFutureAppointmentsModal';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { patientsForAppointment } from '../utils/schedulerAddPet';
import {
  cancelEuthanasiaFutureAppointments,
  findFutureAppointmentsForPatients,
  inactivateEuthanasiaPatients,
  isEuthanasiaAppointment,
  type EuthanasiaFutureAppointmentRow,
} from '../utils/euthanasiaFutureAppointments';
import { patientIdFromAppointment } from '../api/pimsAppointments';
import { markVisitCompleted } from '../api/visitWorkflow';
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
  const text = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : (ax?.message ?? '');
  return /active forward booking already exists/i.test(text);
}

export type ActualVisitTimeField = 'start' | 'end' | 'both';

/** The five follow-up outcomes; the prompt itself is shared with checkout and the
 * visit wrap-up (see ForwardBookingDecisionFields). */
export type ForwardBookingMode = ForwardBookingDispositionMode;

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
  const multi = (
    appt as { patients?: { id?: number | string; name?: string | null; alerts?: string | null }[] }
  ).patients;
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
  const patientName = primaryPatientName(appt);
  const subject = [patientName, pickStr(appt.client?.lastName)].filter(Boolean).join(' ');
  if (!subject) return 'Forward book once labs come back.';
  return `Forward book ${subject} once labs come back.`;
}

function labsPendingTaskTitleForVisit(
  visit: RescheduleSameDayVisit,
  appt: Appointment,
  options: { customTitle?: string; useCustomTitle: boolean }
): string {
  if (options.useCustomTitle && options.customTitle?.trim()) {
    return options.customTitle.trim();
  }
  const patientName = visit.patientName?.trim() || primaryPatientName(appt);
  const subject = [patientName, pickStr(appt.client?.lastName)].filter(Boolean).join(' ');
  if (!subject) return options.customTitle?.trim() || 'Forward book once labs come back.';
  return `Forward book ${subject} once labs come back.`;
}

function labsPendingVisitsToTask(
  householdVisits: RescheduleSameDayVisit[],
  selectedHouseholdPatientIds: Set<string>,
  appt: Appointment
): RescheduleSameDayVisit[] {
  if (householdVisits.length > 1) {
    return householdVisits.filter((visit) => selectedHouseholdPatientIds.has(visit.patientId));
  }
  if (householdVisits.length === 1) return householdVisits;
  const patientId = appt.patient?.id;
  if (patientId == null) return [];
  return [
    {
      appointmentId: appt.id,
      patientId: String(patientId),
      patientName: primaryPatientName(appt) ?? undefined,
    },
  ];
}

function buildLabsPendingTaskLinksForVisit(
  visit: RescheduleSameDayVisit,
  clientId: number | null | undefined
): TaskLinkInput[] {
  const links: TaskLinkInput[] = [];
  if (typeof clientId === 'number' && Number.isFinite(clientId)) {
    links.push({ entityType: 'client', entityId: clientId });
  }
  links.push({ entityType: 'appointment', entityId: visit.appointmentId });
  const patientId = Number(visit.patientId);
  if (Number.isFinite(patientId) && patientId > 0) {
    links.push({ entityType: 'patient', entityId: patientId });
  }
  return links;
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

function defaultStartTimeLocal(existingIso: string | null | undefined, practiceTz: string): string {
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
  const [dispositionLocked, setDispositionLocked] = useState(() =>
    shouldLockForwardBookingDisposition(appt)
  );
  const [forwardBookingIndex, setForwardBookingIndex] = useState<{
    sourceAppointmentIds: ReadonlySet<number>;
    patientIds: ReadonlySet<number>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forwardBookingUserEditedRef = useRef(false);
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
  const [selectedHouseholdPatientIds, setSelectedHouseholdPatientIds] = useState<Set<string>>(() =>
    allHouseholdPatientIds(householdVisits)
  );
  const [selectedVisitTimePatientIds, setSelectedVisitTimePatientIds] = useState<Set<string>>(
    () => new Set(householdVisits.map((visit) => visit.patientId))
  );
  const [euthanasiaFutureRows, setEuthanasiaFutureRows] = useState<
    EuthanasiaFutureAppointmentRow[] | null
  >(null);
  const [checkingEuthanasiaFuture, setCheckingEuthanasiaFuture] = useState(false);
  const euthanasiaEndConfirmedRef = useRef(false);
  const pendingEuthanasiaEndRef = useRef<{
    postOpts: {
      start?: { at?: string; clear?: boolean };
      end?: { at?: string; clear?: boolean };
    };
    saveOptions?: { closeModal?: boolean; saveFollowUp?: boolean };
    patientIdsToInactivate: string[];
    futureRows: EuthanasiaFutureAppointmentRow[];
  } | null>(null);

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
      const row = sameCalendarDayAppointments.find((a) => a.id === visit.appointmentId) ?? appt;
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
    if (!requiresForwardBooking) return;
    let on = true;
    void (async () => {
      const fresh = await fetchAppointmentById(appt.id, { practiceId });
      if (!on || !fresh) return;
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
    if (!dispositionLocked || !requiresForwardBooking) return;
    const ids = householdFollowUpAppointmentIds();
    if (ids.length === 0) return;
    if (forwardBookingMode === 'labs_pending') {
      if (readFollowUpSideEffectsDone(followUpSideEffectsSessionKey(ids, 'labs_pending_task'))) {
        labsPendingTaskEnsuredRef.current = true;
      }
    }
    if (forwardBookingMode === 'forward_book_fields') {
      if (readFollowUpSideEffectsDone(followUpSideEffectsSessionKey(ids, 'forward_booking_list'))) {
        forwardBookingListEnsuredRef.current = true;
      }
    }
  }, [
    dispositionLocked,
    requiresForwardBooking,
    forwardBookingMode,
    householdFollowUpAppointmentIds,
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

  const labsPendingVisitsForTask = useMemo(
    () => labsPendingVisitsToTask(householdVisits, selectedHouseholdPatientIds, appt),
    [householdVisits, selectedHouseholdPatientIds, appt]
  );
  const createsMultipleLabsPendingTasks = labsPendingVisitsForTask.length > 1;

  /** Create forward-booking list rows and labs tasks — not tied to visit end time or disposition lock. */
  const ensureFollowUpSideEffects = useCallback(async () => {
    if (isStartOnly || !requiresForwardBooking) return;

    if (forwardBookingMode === 'labs_pending') {
      const sideEffectsKey = followUpSideEffectsSessionKey(
        householdFollowUpAppointmentIds(),
        'labs_pending_task'
      );
      if (labsPendingTaskEnsuredRef.current || readFollowUpSideEffectsDone(sideEffectsKey)) {
        labsPendingTaskEnsuredRef.current = true;
        return;
      }

      const assigneeId = Number(labsAssigneeEmployeeId);
      if (!Number.isFinite(assigneeId)) {
        throw new Error('Select a staff member to assign the labs pending task.');
      }
      if (branchIds.length === 0) {
        throw new Error('Could not determine practice branches for the task.');
      }
      const visitsToTask = labsPendingVisitsToTask(
        householdVisits,
        selectedHouseholdPatientIds,
        appt
      );
      if (visitsToTask.length === 0) {
        throw new Error('Select at least one pet for the labs pending task.');
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
      const multiPet = visitsToTask.length > 1;
      for (const visit of visitsToTask) {
        const title = labsPendingTaskTitleForVisit(visit, appt, {
          customTitle: labsTaskTitle,
          useCustomTitle: !multiPet,
        });
        if (!title.trim()) {
          throw new Error('Enter a task description.');
        }
        await createTask({
          title,
          body: LABS_PENDING_FORWARD_BOOKING_TASK_BODY,
          branchIds,
          assignedToEmployeeId: assigneeId,
          startAt,
          dueAt,
          links: buildLabsPendingTaskLinksForVisit(visit, appt.client?.id),
        });
      }
      notifyTasksChanged();
      labsPendingTaskEnsuredRef.current = true;
      markFollowUpSideEffectsDone(sideEffectsKey);
      return;
    }

    if (skipsForwardBookingList) return;
    const forwardListKey = followUpSideEffectsSessionKey(
      householdFollowUpAppointmentIds(),
      'forward_booking_list'
    );
    if (forwardBookingListEnsuredRef.current || readFollowUpSideEffectsDone(forwardListKey)) {
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
    markFollowUpSideEffectsDone(forwardListKey);
  }, [
    appt,
    bookingNotes,
    branchIds,
    dispositionLocked,
    effectiveForwardBookingPatientIds,
    effectiveForwardBookingSourceIds,
    forwardBookingMode,
    forwardBookingProviderId,
    forwardInterval,
    householdFollowUpAppointmentIds,
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

  const resolveEuthanasiaPatientsForVisitTimes = useCallback((): {
    patientId: string;
    patientName?: string | null;
  }[] => {
    const ids = new Set(visitTimeAppointmentIds());
    const apptsById = new Map<number, Appointment>();
    apptsById.set(Number(appt.id), appt);
    for (const a of sameCalendarDayAppointments) {
      if (a.id != null) apptsById.set(Number(a.id), a);
    }

    const out: { patientId: string; patientName?: string | null }[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const row = apptsById.get(id);
      if (!row || !isEuthanasiaAppointment(row)) continue;
      const patientId = patientIdFromAppointment(row);
      if (!patientId || seen.has(patientId)) continue;
      seen.add(patientId);
      const name =
        patientsForAppointment(row)[0]?.name ??
        row.patient?.name ??
        householdVisits.find((v) => v.patientId === patientId)?.patientName ??
        null;
      out.push({ patientId, patientName: name });
    }
    return out;
  }, [appt, householdVisits, sameCalendarDayAppointments, visitTimeAppointmentIds]);

  const runEuthanasiaEndSideEffects = useCallback(
    async (args: {
      patientIdsToInactivate: string[];
      futureRows: EuthanasiaFutureAppointmentRow[];
    }) => {
      const warnings: string[] = [];
      if (args.futureRows.length > 0) {
        const cancelResult = await cancelEuthanasiaFutureAppointments({
          rows: args.futureRows,
          practiceId,
        });
        if (cancelResult.errors.length > 0) {
          warnings.push(
            cancelResult.cancelledIds.length > 0
              ? `Removed ${cancelResult.cancelledIds.length} future visit(s); ${cancelResult.errors.length} could not be cancelled.`
              : `Future appointments could not be cancelled. ${cancelResult.errors[0]}`
          );
        }
      }
      if (args.patientIdsToInactivate.length > 0) {
        const inactivateResult = await inactivateEuthanasiaPatients(args.patientIdsToInactivate);
        // Inactivation is best-effort (Scout PATCH may 404; eVet often owns status).
        // Never block End Visit / forward-booking save on these failures.
        const softOrHard = [...inactivateResult.softErrors, ...inactivateResult.errors];
        if (softOrHard.length > 0) {
          console.warn(
            '[euthanasia] patient inactivation incomplete after end visit',
            softOrHard,
          );
        }
      }
      return warnings;
    },
    [practiceId]
  );

  const postBoth = useCallback(
    async (
      opts: {
        start?: { at?: string; clear?: boolean };
        end?: { at?: string; clear?: boolean };
      },
      saveOptions?: { closeModal?: boolean; saveFollowUp?: boolean },
      euthanasiaSideEffects?: {
        patientIdsToInactivate: string[];
        futureRows: EuthanasiaFutureAppointmentRow[];
      }
    ) => {
      setSaving(true);
      setError(null);
      try {
        const savingStart = Boolean(opts.start);
        const savingEnd = Boolean(opts.end);
        const followUpOnly = !savingStart && !savingEnd;
        const saveFollowUp =
          saveOptions?.saveFollowUp ?? (requiresForwardBooking && (savingEnd || followUpOnly));

        let updated = appt;
        if (opts.start) updated = await saveStart(opts.start);
        if (opts.end) updated = await saveEnd(opts.end);
        if (saveFollowUp && shouldPersistForwardBookingDisposition()) {
          const savedDisposition = await persistForwardBookingDisposition();
          updated = { ...updated, forwardBookingDisposition: savedDisposition };
          setDispositionLocked(shouldLockForwardBookingDisposition(updated));
        }
        if (saveFollowUp) {
          await ensureFollowUpSideEffects();
        }

        const warnings: string[] = [];

        // End Visit is the real "visit completed" event, so it fires the VisitCompleted hub
        // event (euthanasia off-session capture). Checkout no longer marks visits completed.
        if (savingEnd && opts.end?.clear !== true) {
          try {
            const completed = await markVisitCompleted(appt.id);
            const charge = completed.euthanasiaCharge;
            if (charge?.needsManualCollection) {
              warnings.push(
                `Euthanasia payment needs manual collection: ${charge.message ?? 'card declined'}`
              );
            }
          } catch {
            // Never block saving visit times on downstream automation.
          }
        }

        if (euthanasiaSideEffects) {
          warnings.push(...(await runEuthanasiaEndSideEffects(euthanasiaSideEffects)));
        }
        const sideEffectWarning = warnings.length > 0 ? warnings.join(' ') : null;

        const closeModal =
          saveOptions?.closeModal ??
          (isEndOnly || isStartOnly || (isBoth && (savingEnd || savingStart)));

        onSaved(updated, { closeModal: closeModal && !sideEffectWarning });
        if (sideEffectWarning) {
          setError(sideEffectWarning);
        } else if (closeModal) {
          onClose();
        }
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
      runEuthanasiaEndSideEffects,
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
      if (!createsMultipleLabsPendingTasks && !labsTaskTitle.trim()) {
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
      setError(
        'Select how far out to forward book (number and days, weeks, or months) before saving.'
      );
      return false;
    }
    return true;
  };

  const postBothWithEuthanasiaGuard = useCallback(
    async (
      opts: {
        start?: { at?: string; clear?: boolean };
        end?: { at?: string; clear?: boolean };
      },
      saveOptions?: { closeModal?: boolean; saveFollowUp?: boolean }
    ) => {
      const endingVisit = Boolean(opts.end) && opts.end?.clear !== true;
      if (!endingVisit || euthanasiaEndConfirmedRef.current) {
        euthanasiaEndConfirmedRef.current = false;
        const pending = pendingEuthanasiaEndRef.current;
        pendingEuthanasiaEndRef.current = null;
        await postBoth(
          opts,
          saveOptions,
          pending
            ? {
                patientIdsToInactivate: pending.patientIdsToInactivate,
                futureRows: pending.futureRows,
              }
            : undefined
        );
        return;
      }

      const euthPatients = resolveEuthanasiaPatientsForVisitTimes();
      if (euthPatients.length === 0) {
        await postBoth(opts, saveOptions);
        return;
      }

      setCheckingEuthanasiaFuture(true);
      try {
        const futureRows = await findFutureAppointmentsForPatients({
          practiceId,
          practiceTz,
          patients: euthPatients,
          excludeAppointmentIds: visitTimeAppointmentIds(),
        });
        pendingEuthanasiaEndRef.current = {
          postOpts: opts,
          saveOptions,
          patientIdsToInactivate: euthPatients.map((p) => p.patientId),
          futureRows,
        };
        if (futureRows.length > 0) {
          setEuthanasiaFutureRows(futureRows);
          return;
        }
        // No future appointments — still inactivate after end without a list warning.
        euthanasiaEndConfirmedRef.current = true;
        const pending = pendingEuthanasiaEndRef.current;
        pendingEuthanasiaEndRef.current = null;
        await postBoth(
          opts,
          saveOptions,
          pending
            ? {
                patientIdsToInactivate: pending.patientIdsToInactivate,
                futureRows: pending.futureRows,
              }
            : undefined
        );
      } finally {
        setCheckingEuthanasiaFuture(false);
      }
    },
    [
      postBoth,
      practiceId,
      practiceTz,
      resolveEuthanasiaPatientsForVisitTimes,
      visitTimeAppointmentIds,
    ]
  );

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
      void postBothWithEuthanasiaGuard(
        { end: endPayload },
        { closeModal: true, saveFollowUp: true }
      );
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
      const followUpReady =
        requiresForwardBooking && forwardBookingFormStateIsComplete(forwardBookingFormRef.current);
      if (followUpReady && !validateForwardBooking()) return;
      void postBoth({ start: startPayload! }, { closeModal: true, saveFollowUp: followUpReady });
      return;
    }

    void postBothWithEuthanasiaGuard(
      {
        ...(startPayload ? { start: startPayload } : {}),
        ...(endPayload ? { end: endPayload } : {}),
      },
      {
        closeModal: true,
        saveFollowUp:
          followUpOnly ||
          savingEnd ||
          (requiresForwardBooking &&
            forwardBookingFormStateIsComplete(forwardBookingFormRef.current) &&
            !dispositionLocked),
      }
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
          <button
            type="button"
            className="scheduler-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
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
                <div
                  className="scheduler-forward-booking-household-pets"
                  style={{ marginBottom: 14 }}
                >
                  <p className="settings-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
                    Apply actual start/end times to pets in this household today (same times for
                    each selected pet):
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
                <p
                  className="settings-muted scheduler-actual-visit-times-hint"
                  style={{ gridColumn: '1 / -1', margin: 0 }}
                >
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
                                <span className="scheduler-household-pet-row-badge">
                                  This visit
                                </span>
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
                <p className="settings-muted scheduler-household-other-pets-hint">
                  Loading household pets…
                </p>
              ) : otherHouseholdPets.length > 0 ? (
                <details className="scheduler-household-other-pets">
                  <summary>
                    Other household pets not scheduled today ({otherHouseholdPets.length})
                  </summary>
                  <p className="settings-muted scheduler-household-other-pets-lead">
                    Review reminders and visit history to align follow-up timing across the
                    household. These pets are not included in today&apos;s forward booking
                    selection.
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
                            <dt>Task{labsPendingVisitsForTask.length > 1 ? 's' : ''}</dt>
                            <dd>
                              {labsPendingVisitsForTask.length > 1
                                ? `${labsPendingVisitsForTask.length} tasks (one per selected pet)`
                                : labsTaskTitle.trim() || '—'}
                            </dd>
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
                <ForwardBookingDecisionFields
                  radioGroupName="forward-booking-mode"
                  value={{
                    mode: forwardBookingMode,
                    forwardAmount,
                    forwardUnit,
                    bookingNotes,
                    labsAssigneeEmployeeId,
                    labsTaskTitle,
                    labsTaskStartLocal,
                    labsTaskDueLocal,
                  }}
                  onChange={(patch) => {
                    forwardBookingUserEditedRef.current = true;
                    if (patch.mode !== undefined) setForwardBookingMode(patch.mode);
                    if (patch.forwardAmount !== undefined) setForwardAmount(patch.forwardAmount);
                    if (patch.forwardUnit !== undefined) setForwardUnit(patch.forwardUnit);
                    if (patch.bookingNotes !== undefined) setBookingNotes(patch.bookingNotes);
                    if (patch.labsAssigneeEmployeeId !== undefined)
                      setLabsAssigneeEmployeeId(patch.labsAssigneeEmployeeId);
                    if (patch.labsTaskTitle !== undefined) setLabsTaskTitle(patch.labsTaskTitle);
                    if (patch.labsTaskStartLocal !== undefined)
                      setLabsTaskStartLocal(patch.labsTaskStartLocal);
                    if (patch.labsTaskDueLocal !== undefined)
                      setLabsTaskDueLocal(patch.labsTaskDueLocal);
                  }}
                  onModeChange={(mode) => {
                    setError(null);
                    if (mode === 'labs_pending' && !labsAssigneeEmployeeId.trim()) {
                      const def = defaultLabsAssigneeEmployeeId(appt);
                      if (def) setLabsAssigneeEmployeeId(def);
                    }
                    if (mode === 'forward_book_fields' && !forwardBookingProviderId.trim()) {
                      const def = defaultForwardBookingProviderId(appt);
                      if (def) setForwardBookingProviderId(def);
                    }
                  }}
                  disabled={saving}
                  fieldsDisabled={!showForwardBookFields}
                  metaLoading={forwardBookingMetaLoading}
                  employees={employees}
                  providers={providers.map((p) => ({ id: p.id, label: providerSelectLabel(p) }))}
                  providerId={forwardBookingProviderId}
                  onProviderIdChange={(v) => {
                    forwardBookingUserEditedRef.current = true;
                    setForwardBookingProviderId(v);
                  }}
                  multiPetLabsTasks={createsMultipleLabsPendingTasks}
                />
              )}
            </section>
          ) : null}
        </div>

        <div className="scheduler-edit-footer scheduler-actual-visit-footer">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          {existingStartIso && !isEndOnly ? (
            <button
              type="button"
              className="btn secondary"
              disabled={saving}
              onClick={handleClearStart}
            >
              Clear start
            </button>
          ) : null}
          {existingEndIso && !isStartOnly ? (
            <button
              type="button"
              className="btn secondary"
              disabled={saving}
              onClick={handleClearEnd}
            >
              Clear end
            </button>
          ) : null}
          {!isEndOnly ? (
            <button
              type="button"
              className="btn secondary"
              disabled={saving}
              onClick={handleUseNowStart}
            >
              Now (start)
            </button>
          ) : null}
          {!isStartOnly ? (
            <button
              type="button"
              className="btn secondary"
              disabled={saving}
              onClick={handleUseNowEnd}
            >
              Now (end)
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={saving || checkingEuthanasiaFuture}
            onClick={handleSave}
          >
            {saving || checkingEuthanasiaFuture ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modal, document.body)}
      <EuthanasiaFutureAppointmentsModal
        open={Boolean(euthanasiaFutureRows?.length)}
        mode="end_visit"
        rows={euthanasiaFutureRows ?? []}
        continuing={saving || checkingEuthanasiaFuture}
        onCancel={() => {
          if (saving) return;
          setEuthanasiaFutureRows(null);
          pendingEuthanasiaEndRef.current = null;
          euthanasiaEndConfirmedRef.current = false;
        }}
        onConfirmDelete={() => {
          const pending = pendingEuthanasiaEndRef.current;
          if (!pending) {
            setEuthanasiaFutureRows(null);
            return;
          }
          setEuthanasiaFutureRows(null);
          euthanasiaEndConfirmedRef.current = true;
          void postBothWithEuthanasiaGuard(pending.postOpts, pending.saveOptions);
        }}
      />
    </>
  );
}
