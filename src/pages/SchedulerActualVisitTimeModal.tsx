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
import { buildCreateForwardBookingPayloadFromAppointment } from '../utils/forwardBookingFromAppointment';
import {
  appointmentPracticeDateKey,
  combineDateAndTimeToUtc,
  formatPracticeDateLabel,
  toTimeLocalValue,
} from '../utils/editVisitTimeFields';
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
  forwardBookingFormValidationMessage,
  shouldLockForwardBookingDisposition,
  type ForwardBookingDispositionFormState,
} from '../utils/forwardBookingDisposition';
import {
  ForwardBookingPetChoice,
  type ForwardBookingPetChoiceValue,
} from '../components/ForwardBookingPetChoice';
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

export type ActualVisitTimeField = 'start' | 'end' | 'both';

type StoredPetForwardChoice = {
  choice: ForwardBookingPetChoiceValue;
  locked: boolean;
};

type DisplayedForwardPet = {
  visit: RescheduleSameDayVisit;
  choice: ForwardBookingPetChoiceValue;
  locked: boolean;
  alreadyForwardBooked: boolean;
};

function skipsForwardBookingListMode(mode: ForwardBookingDispositionFormState['mode']): boolean {
  return (
    mode === 'booked_at_appointment' ||
    mode === 'already_booked' ||
    mode === 'labs_pending' ||
    mode === 'not_appropriate'
  );
}

function choiceFromAppointment(
  source: Appointment,
  visit: RescheduleSameDayVisit,
  anchor: Appointment,
  labsTaskStartLocal: string,
): StoredPetForwardChoice {
  const labsTaskTitle = labsPendingTaskTitleForVisit(visit, anchor, { useCustomTitle: false });
  const form = applyDefaultLabsAssignee(
    forwardBookingFormStateFromDisposition(
      source.forwardBookingDisposition ?? forwardBookingDispositionFromAppointment(source),
      { labsTaskTitle, labsTaskStartLocal },
    ),
    source,
  );
  return {
    locked: shouldLockForwardBookingDisposition(source),
    choice: {
      ...form,
      providerId: defaultForwardBookingProviderId(source),
    },
  };
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

function labsPendingTaskTitleForVisit(
  visit: RescheduleSameDayVisit,
  appt: Appointment,
  options: { customTitle?: string; useCustomTitle: boolean },
): string {
  if (options.useCustomTitle && options.customTitle?.trim()) {
    return options.customTitle.trim();
  }
  const patientName = visit.patientName?.trim() || primaryPatientName(appt);
  const subject = [patientName, pickStr(appt.client?.lastName)].filter(Boolean).join(' ');
  if (!subject) return options.customTitle?.trim() || 'Forward book once labs come back.';
  return `Forward book ${subject} once labs come back.`;
}

function buildLabsPendingTaskLinksForVisit(
  visit: RescheduleSameDayVisit,
  clientId: number | null | undefined,
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

  const defaultLabsStartLocal = useMemo(() => defaultLabsTaskStartLocal(), []);

  const [startTimeLocal, setStartTimeLocal] = useState(() =>
    isEndOnly ? '' : defaultStartTimeLocal(existingStartIso, practiceTz)
  );
  const [endTimeLocal, setEndTimeLocal] = useState(() =>
    isStartOnly ? '' : defaultEndTimeLocal(existingEndIso, existingStartIso, practiceTz)
  );
  const [storedPetChoices, setStoredPetChoices] = useState<Record<string, StoredPetForwardChoice>>(
    {}
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [forwardBookingMetaLoading, setForwardBookingMetaLoading] = useState(false);
  const [forwardBookingIndex, setForwardBookingIndex] = useState<{
    sourceAppointmentIds: ReadonlySet<number>;
    patientIds: ReadonlySet<number>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editedForwardBookingPatientIdsRef = useRef<Set<string>>(new Set());
  const forwardBookingPetsRef = useRef<DisplayedForwardPet[]>([]);

  const requiresForwardBooking = !isStartOnly;
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
    editedForwardBookingPatientIdsRef.current = new Set();
    setStoredPetChoices({});
  }, [appt.id]);

  useEffect(() => {
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

  const forwardBookingVisits = useMemo((): RescheduleSameDayVisit[] => {
    if (householdVisits.length > 0) return householdVisits;
    const patientId = patientIdFromAppointment(appt);
    if (!patientId || typeof appt.id !== 'number') return [];
    return [
      {
        appointmentId: appt.id,
        patientId,
        patientName: primaryPatientName(appt) ?? undefined,
      },
    ];
  }, [appt, householdVisits]);

  const displayedForwardPets = useMemo((): DisplayedForwardPet[] => {
    return forwardBookingVisits.map((visit) => {
      const stored = storedPetChoices[visit.patientId];
      const source =
        visit.appointmentId === appt.id
          ? appt
          : (sameCalendarDayAppointments.find((row) => row.id === visit.appointmentId) ?? appt);
      const derived = choiceFromAppointment(source, visit, appt, defaultLabsStartLocal);
      return {
        visit,
        choice: stored?.choice ?? derived.choice,
        locked: stored?.locked ?? derived.locked,
        alreadyForwardBooked: householdVisitAlreadyForwardBooked(
          visit,
          effectiveForwardBookingSourceIds,
          effectiveForwardBookingPatientIds,
        ),
      };
    });
  }, [
    appt,
    defaultLabsStartLocal,
    effectiveForwardBookingPatientIds,
    effectiveForwardBookingSourceIds,
    forwardBookingVisits,
    sameCalendarDayAppointments,
    storedPetChoices,
  ]);
  forwardBookingPetsRef.current = displayedForwardPets;

  const dispositionLocked =
    displayedForwardPets.length > 0 && displayedForwardPets.every((pet) => pet.locked);
  const forwardBookingSectionSkipsList =
    displayedForwardPets.length > 0 &&
    displayedForwardPets.every(
      (pet) => skipsForwardBookingListMode(pet.choice.mode) && pet.choice.mode !== 'labs_pending',
    );
  const perPetForwardBooking = householdVisits.length > 1;

  const updateForwardPetChoice = useCallback((patientId: string, choice: ForwardBookingPetChoiceValue) => {
    editedForwardBookingPatientIdsRef.current.add(patientId);
    setError(null);
    setStoredPetChoices((prev) => ({
      ...prev,
      [patientId]: {
        choice,
        locked: prev[patientId]?.locked ?? false,
      },
    }));
  }, []);

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

  const forwardBookingReadyToSave = useCallback((): boolean => {
    const pending = forwardBookingPetsRef.current.filter((pet) => !pet.locked);
    return pending.length > 0 && pending.every((pet) => forwardBookingFormStateIsComplete(pet.choice));
  }, []);

  const shouldPersistForwardBookingDisposition = useCallback((): boolean => {
    if (!requiresForwardBooking) return false;
    return forwardBookingPetsRef.current.some(
      (pet) => !pet.locked && forwardBookingFormStateIsComplete(pet.choice),
    );
  }, [requiresForwardBooking]);

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
    const targets = forwardBookingVisits;
    void (async () => {
      const loaded = await Promise.all(
        targets.map(async (visit) => {
          const cached =
            visit.appointmentId === appt.id
              ? appt
              : (sameCalendarDayAppointments.find((row) => row.id === visit.appointmentId) ?? appt);
          try {
            const fresh = await fetchAppointmentById(visit.appointmentId, { practiceId });
            return fresh ?? cached;
          } catch {
            return cached;
          }
        }),
      );
      if (!on) return;
      setStoredPetChoices((prev) => {
        const next = { ...prev };
        targets.forEach((visit, index) => {
          if (editedForwardBookingPatientIdsRef.current.has(visit.patientId)) return;
          const source = loaded[index] ?? appt;
          next[visit.patientId] = choiceFromAppointment(
            source,
            visit,
            appt,
            defaultLabsStartLocal,
          );
        });
        return next;
      });
    })();
    return () => {
      on = false;
    };
  }, [
    appt,
    defaultLabsStartLocal,
    forwardBookingVisits,
    practiceId,
    requiresForwardBooking,
    sameCalendarDayAppointments,
  ]);

  const persistForwardBookingDisposition = useCallback(async () => {
    const pets = forwardBookingPetsRef.current.filter(
      (pet) => !pet.locked && forwardBookingFormStateIsComplete(pet.choice),
    );
    const byAppointment = new Map<number, DisplayedForwardPet[]>();
    for (const pet of pets) {
      const group = byAppointment.get(pet.visit.appointmentId) ?? [];
      group.push(pet);
      byAppointment.set(pet.visit.appointmentId, group);
    }

    let anchorSaved: ForwardBookingDisposition | null = null;
    const savedPatientIds: string[] = [];
    for (const [appointmentId, group] of byAppointment) {
      const payload = buildForwardBookingDispositionPayload(group[0]!.choice);
      const disagree = group.some(
        (pet) =>
          JSON.stringify(buildForwardBookingDispositionPayload(pet.choice)) !==
          JSON.stringify(payload),
      );
      if (!disagree) {
        const saved = await patchForwardBookingDisposition(appointmentId, payload, { practiceId });
        assertForwardBookingDispositionSaved(payload, saved);
        if (appointmentId === appt.id) anchorSaved = saved;
      } else if (appointmentId === appt.id) {
        const anchorPet = group.find((pet) => pet.visit.appointmentId === appt.id);
        if (anchorPet) anchorSaved = buildForwardBookingDispositionPayload(anchorPet.choice);
      }
      for (const pet of group) savedPatientIds.push(pet.visit.patientId);
    }

    if (savedPatientIds.length > 0) {
      setStoredPetChoices((prev) => {
        const next = { ...prev };
        for (const patientId of savedPatientIds) {
          const current = forwardBookingPetsRef.current.find(
            (pet) => pet.visit.patientId === patientId,
          );
          if (!current) continue;
          next[patientId] = { choice: current.choice, locked: true };
        }
        return next;
      });
    }
    return anchorSaved;
  }, [appt.id, practiceId]);

  /** Create forward-booking list rows and labs tasks — one row or task per pet. */
  const ensureFollowUpSideEffects = useCallback(async () => {
    if (isStartOnly || !requiresForwardBooking) return;

    let createdLabsTask = false;
    for (const pet of forwardBookingPetsRef.current) {
      const patientName = pet.visit.patientName?.trim() || 'this pet';
      if (pet.choice.mode === 'labs_pending') {
        const sideEffectsKey = followUpSideEffectsSessionKey(
          [pet.visit.appointmentId],
          'labs_pending_task',
          pet.visit.patientId,
        );
        if (readFollowUpSideEffectsDone(sideEffectsKey)) continue;

        const assigneeId = Number(pet.choice.labsAssigneeEmployeeId);
        if (!Number.isFinite(assigneeId)) {
          throw new Error(`Select a staff member to assign the labs pending task for ${patientName}.`);
        }
        if (branchIds.length === 0) {
          throw new Error('Could not determine practice branches for the task.');
        }
        const title = pet.choice.labsTaskTitle.trim();
        if (!title) throw new Error(`Enter a task description for ${patientName}.`);
        const startAt = fromDatetimeLocalValue(pet.choice.labsTaskStartLocal);
        if (!startAt) throw new Error(`Choose a valid task start date and time for ${patientName}.`);
        const dueAt = fromDatetimeLocalValue(pet.choice.labsTaskDueLocal);
        const scheduleErr = validateTaskScheduleOrder(startAt, dueAt);
        if (scheduleErr) throw new Error(`${patientName}: ${scheduleErr}`);
        await createTask({
          title,
          body: LABS_PENDING_FORWARD_BOOKING_TASK_BODY,
          branchIds,
          assignedToEmployeeId: assigneeId,
          startAt,
          dueAt,
          links: buildLabsPendingTaskLinksForVisit(pet.visit, appt.client?.id),
        });
        createdLabsTask = true;
        markFollowUpSideEffectsDone(sideEffectsKey);
        continue;
      }

      if (pet.choice.mode !== 'forward_book_fields') continue;
      const forwardListKey = followUpSideEffectsSessionKey(
        [pet.visit.appointmentId],
        'forward_booking_list',
        pet.visit.patientId,
      );
      if (readFollowUpSideEffectsDone(forwardListKey) || pet.alreadyForwardBooked) {
        markFollowUpSideEffectsDone(forwardListKey);
        continue;
      }

      const amount = Number(pet.choice.forwardAmount);
      if (!Number.isFinite(amount) || amount <= 0 || !pet.choice.forwardUnit) {
        throw new Error(
          `Select how far out to forward book ${patientName} (number and days, weeks, or months).`,
        );
      }
      if (!pet.choice.bookingNotes.trim()) {
        throw new Error(`Enter a forward booking note for ${patientName} before saving.`);
      }
      const sourceAppt =
        sameCalendarDayAppointments.find((row) => row.id === pet.visit.appointmentId) ?? appt;
      const providerOverride = Number(pet.choice.providerId);
      const payload = buildCreateForwardBookingPayloadFromAppointment(
        sourceAppt,
        { amount, unit: pet.choice.forwardUnit },
        practiceId,
        {
          bookingNotes: pet.choice.bookingNotes.trim() || null,
          patientId: Number(pet.visit.patientId),
          ...(Number.isFinite(providerOverride) && providerOverride > 0
            ? { primaryProviderId: providerOverride }
            : {}),
        },
      );
      if (!payload) {
        throw new Error(`Could not create a forward booking for ${patientName}.`);
      }
      try {
        await createForwardBooking({
          ...payload,
          createdVia: 'end_visit',
        });
      } catch (e: unknown) {
        if (!isActiveForwardBookingExistsError(e)) throw e;
      }
      markFollowUpSideEffectsDone(forwardListKey);
    }
    if (createdLabsTask) notifyTasksChanged();
  }, [
    appt,
    branchIds,
    isStartOnly,
    practiceId,
    requiresForwardBooking,
    sameCalendarDayAppointments,
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
              : `Future appointments could not be cancelled. ${cancelResult.errors[0]}`,
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
          saveOptions?.saveFollowUp ??
          (requiresForwardBooking && (savingEnd || followUpOnly));

        let updated = appt;
        if (opts.start) updated = await saveStart(opts.start);
        if (opts.end) updated = await saveEnd(opts.end);
        if (saveFollowUp && shouldPersistForwardBookingDisposition()) {
          const savedDisposition = await persistForwardBookingDisposition();
          if (savedDisposition) {
            updated = { ...updated, forwardBookingDisposition: savedDisposition };
          }
        }
        if (saveFollowUp) {
          await ensureFollowUpSideEffects();
        }

        let sideEffectWarning: string | null = null;
        if (euthanasiaSideEffects) {
          const warnings = await runEuthanasiaEndSideEffects(euthanasiaSideEffects);
          if (warnings.length > 0) sideEffectWarning = warnings.join(' ');
        }

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
    const pets = forwardBookingPetsRef.current;
    if (pets.length === 0) {
      setError('Could not determine which pets need a follow-up choice.');
      return false;
    }
    const multi = pets.length > 1;
    for (const pet of pets) {
      if (pet.locked) continue;
      const name = pet.visit.patientName?.trim() || 'this pet';
      const message = forwardBookingFormValidationMessage(pet.choice);
      if (message) {
        setError(multi ? `${name}: ${message}` : message);
        return false;
      }
      if (pet.choice.mode === 'labs_pending' && branchIds.length === 0) {
        const branchMessage = 'Could not determine practice branches for the task.';
        setError(multi ? `${name}: ${branchMessage}` : branchMessage);
        return false;
      }
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
            : undefined,
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
      void postBothWithEuthanasiaGuard({ end: endPayload }, { closeModal: true, saveFollowUp: true });
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
      const followUpReady = requiresForwardBooking && forwardBookingReadyToSave();
      if (followUpReady && !validateForwardBooking()) return;
      void postBoth(
        { start: startPayload! },
        { closeModal: true, saveFollowUp: followUpReady }
      );
      return;
    }

    void postBothWithEuthanasiaGuard(
      {
        ...(startPayload ? { start: startPayload } : {}),
        ...(endPayload ? { end: endPayload } : {}),
      },
      {
        closeModal: true,
        saveFollowUp: followUpOnly || savingEnd || forwardBookingReadyToSave(),
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
                forwardBookingSectionSkipsList ? 'scheduler-forward-booking-section--override' : '',
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

              {perPetForwardBooking ? (
                <div className="scheduler-forward-booking-household-pets">
                  <p className="settings-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
                    Choose follow-up for each pet in this household today.
                  </p>
                  <div className="scheduler-forward-booking-pet-list">
                    {displayedForwardPets.map((pet) => {
                      const patientName = pet.visit.patientName?.trim() || `Pet ${pet.visit.patientId}`;
                      return (
                        <div key={pet.visit.patientId} className="scheduler-forward-booking-pet-card">
                          <SchedulerHouseholdPetRow
                            patientId={pet.visit.patientId}
                            patientName={patientName}
                            practiceId={practiceId}
                            practiceTz={practiceTz}
                            membership={membershipForPatientId(pet.visit.patientId)}
                            excludeAppointmentId={pet.visit.appointmentId}
                            isAnchor={isAnchorVisit(pet.visit)}
                            showCheckbox={false}
                            rowClassName={
                              pet.alreadyForwardBooked ? 'scheduler-household-pet-row--saved' : ''
                            }
                            badges={
                              <>
                                {isAnchorVisit(pet.visit) ? (
                                  <span className="scheduler-household-pet-row-badge">This visit</span>
                                ) : null}
                                {pet.alreadyForwardBooked ? (
                                  <span className="scheduler-household-pet-row-badge scheduler-household-pet-row-badge--saved">
                                    Forward booking saved
                                  </span>
                                ) : null}
                              </>
                            }
                          />
                          <div className="scheduler-forward-booking-pet-options">
                            <ForwardBookingPetChoice
                              patientId={pet.visit.patientId}
                              patientName={patientName}
                              value={pet.choice}
                              locked={pet.locked}
                              saving={saving}
                              metaLoading={forwardBookingMetaLoading}
                              employees={employees}
                              providers={providers}
                              onChange={(next) => updateForwardPetChoice(pet.visit.patientId, next)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {forwardBookingPatient ? (
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
                  {displayedForwardPets[0] ? (
                    <ForwardBookingPetChoice
                      patientId={displayedForwardPets[0].visit.patientId}
                      patientName={
                        displayedForwardPets[0].visit.patientName?.trim() ||
                        forwardBookingPatient?.name ||
                        'this pet'
                      }
                      value={displayedForwardPets[0].choice}
                      locked={displayedForwardPets[0].locked}
                      saving={saving}
                      metaLoading={forwardBookingMetaLoading}
                      employees={employees}
                      providers={providers}
                      onChange={(next) =>
                        updateForwardPetChoice(displayedForwardPets[0]!.visit.patientId, next)
                      }
                    />
                  ) : null}
                </>
              )}

              {otherHouseholdPetsLoading ? (
                <p className="settings-muted scheduler-household-other-pets-hint">Loading household pets…</p>
              ) : otherHouseholdPets.length > 0 ? (
                <details className="scheduler-household-other-pets">
                  <summary>
                    Other household pets not scheduled today ({otherHouseholdPets.length})
                  </summary>
                  <p className="settings-muted scheduler-household-other-pets-lead">
                    Review reminders and visit history to align follow-up timing across the household.
                    These pets are not scheduled today, so they are not part of this forward booking.
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
