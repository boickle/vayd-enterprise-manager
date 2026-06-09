// Book appointment from scheduler (double-click slot) — POST /appointments
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  createAppointment,
  patchAppointment,
  putAppointmentAlternateAddress,
} from '../api/appointments';
import type {
  ManualBookPreviewDraft,
  RoutingCalendarPreviewPayloadV1,
} from '../utils/routingCalendarPreviewStorage';
import {
  clientAddressPartsFromPayload,
  coordsFromClientPayload,
} from '../utils/manualBookCalendarPreview';
import { submitRoutingAcceptedFeedbackFromPreview } from '../utils/routingBookFeedback';
import { completeForwardBookingFromBook } from '../utils/forwardBookingBookComplete';
import { fetchClientByIdStaff, type ClientSearchRow } from '../api/clientsStaff';
import {
  searchPimsClientsAndPatients,
  type PimsPatientSearchHit,
} from '../api/pimsSearch';
import type { Provider } from '../api/employee';
import {
  fetchManualBookableAppointmentTypes,
  type AppointmentType,
} from '../api/appointmentSettings';
import { useAuth } from '../auth/useAuth';
import type { RescheduleVisitPatch } from '../utils/routingRescheduleIntent';
import { resolveBookModalDefaultAppointmentTypeId } from '../utils/routingCalculateTimeType';
import { Field } from '../components/Field';
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import { appendBookedStaffNote } from '../utils/bookedAppointmentDescription';
import {
  appendRescheduledByStaffNote,
  resolveAppointmentChangeActorFromAuth,
} from '../utils/appointmentChangeAuditNote';
import {
  filterAppointmentTypesByIds,
  formatSchedulerBookingApiError,
  rolesIncludeAdminBypass,
} from '../utils/manualBookingPermissions';
import { ScheduleOverrideDayFields } from '../components/ScheduleOverrideDayFields';
import {
  applyScheduleOverridesForBook,
  loadScheduleOverrideDraftForBook,
  type ScheduleOverrideDraft,
} from '../utils/scheduleOverrideBook';
import {
  appointmentFormFlags,
  appointmentTypeAllowsAllDay,
  appointmentTypeRequiresPatient,
  normalizeAppointmentTypeFromApi,
  sortAppointmentTypesForPicker,
} from '../utils/appointmentTypeSettings';
import './Scheduler.css';

function allDayBookableTypesFromCatalog(types: AppointmentType[]): AppointmentType[] {
  return types
    .map((t) => normalizeAppointmentTypeFromApi(t))
    .filter((t) => appointmentTypeAllowsAllDay(t));
}

export type { RescheduleVisitPatch };

type RescheduleVisitEdit = {
  appointmentId: number;
  patientId: string;
  patientName: string;
  appointmentTypeId?: number;
  appointmentTypeLabel: string;
  scheduledTimeLabel: string;
  originalAppointmentStartIso?: string;
  description: string;
  instructions: string;
};

type RoutingBookVisitEdit = {
  patientId: string;
  patientName: string;
  selected: boolean;
  appointmentTypeId: string;
  description: string;
  instructions: string;
  /** Routing preview — book without linking a patient. */
  isNoPatient?: boolean;
};

function routingBookTypesForVisit(
  visit: RoutingBookVisitEdit,
  fullTypes: AppointmentType[],
  noPatientTypes: AppointmentType[]
): AppointmentType[] {
  if (visit.isNoPatient) return noPatientTypes;
  return fullTypes;
}

function resolveRoutingVisitTypeId(
  visit: RoutingBookVisitEdit,
  fullTypes: AppointmentType[],
  noPatientTypes: AppointmentType[]
): string {
  const allowed = routingBookTypesForVisit(visit, fullTypes, noPatientTypes);
  const id = visit.appointmentTypeId.trim();
  if (id && allowed.some((t) => String(t.id) === id)) return id;
  return '';
}

function toggleRoutingBookVisitSelected(
  rows: RoutingBookVisitEdit[],
  idx: number,
  checked: boolean,
  fullTypes: AppointmentType[],
  noPatientTypes: AppointmentType[]
): RoutingBookVisitEdit[] {
  const target = rows[idx];
  if (!target) return rows;
  let next = rows.map((row, i) => {
    if (i === idx) return { ...row, selected: checked };
    if (!checked) return row;
    if (target.isNoPatient || row.isNoPatient) return { ...row, selected: false };
    return row;
  });
  if (checked && target.isNoPatient) {
    next = next.map((row, i) => {
      if (i !== idx) return row;
      const typeOk = noPatientTypes.some((t) => String(t.id) === row.appointmentTypeId);
      return {
        ...row,
        appointmentTypeId: typeOk
          ? row.appointmentTypeId
          : noPatientTypes[0]
            ? String(noPatientTypes[0].id)
            : '',
      };
    });
  }
  return next;
}

export type SchedulerBookSlot = {
  start: DateTime;
  end: DateTime;
};

/** Optional prefill when opening from routing / calendar preview (same form as empty-slot book). */
export type SchedulerBookPrefill = {
  /** Omitted when routing by address only — user picks a client in the book dialog. */
  clientId?: string;
  clientLabel?: string;
  /** Routing address for PUT /appointments/:id/alternate-address (overrides client home for routing). */
  routingAlternateAddress?: string;
  appointmentTypeId?: number;
  /** When true, hide client search — only admins should get false from routing. */
  lockClient?: boolean;
  defaultDescription?: string;
  /** When set, use this provider (internal or PIMS id string) instead of `defaultProviderId` from props. */
  providerId?: string;
  /** Patient ids to omit from the picker (e.g. already booked this client at this time). */
  excludePatientIds?: string[];
  /** Do not replace slot length with the selected appointment type’s default duration. */
  preserveDurationFromSlot?: boolean;
  /** When true, provider dropdown is read-only (same-doctor co-visit). */
  lockProvider?: boolean;
  /** Replaces the default “Book appointment” dialog title. */
  modalTitle?: string;
  /** When true with `lockClient` false, show read-only client (routing: admin cannot search-change client here). */
  disableClientSearch?: boolean;
  /** Employee “add another pet” same-slot flow — copy only. */
  coVisitAddPet?: boolean;
  /** When true, date / start time / duration cannot be changed (same-slot co-visit). */
  lockSlotTimes?: boolean;
  /** When set with routing preview — PATCH existing visit instead of POST create. */
  rescheduleAppointmentId?: number;
  /** Reschedule all of these visits to the new slot (e.g. household same-day). */
  rescheduleAppointmentIds?: number[];
  /** Per-appointment patient, type, and description when rescheduling (e.g. all pets today). */
  rescheduleVisitPatches?: RescheduleVisitPatch[];
  /** Prefer this patient in the picker (e.g. reschedule). */
  preferredPatientId?: string;
  /** Initial selection when booking from routing preview (e.g. preview chip pets). */
  preferredPatientIds?: string[];
  /** Routing calendar preview — lock slot/provider; multi-pet book at same time. */
  routingPreviewBook?: boolean;
  defaultInstructions?: string;
  allDay?: boolean;
  additionalEmployeeIds?: number[];
  /** Forward booking list → routing book — server + POST …/complete attribution. */
  forwardBookingTrackingToken?: string;
  forwardBookingEntryId?: number;
  /** Calculate Time type name from routing (for reschedule book type resolution). */
  routingStatsTypeKey?: string;
};

/** True when the book modal was opened from routing (not empty-slot / co-visit manual book). */
export function isSchedulerRoutingBookPrefill(
  prefill: SchedulerBookPrefill | null | undefined
): boolean {
  if (!prefill) return false;
  if (prefill.routingPreviewBook) return true;
  if (prefill.rescheduleAppointmentId != null && prefill.preserveDurationFromSlot) return true;
  if (prefill.routingAlternateAddress?.trim()) return true;
  return false;
}

type Props = {
  open: boolean;
  slot: SchedulerBookSlot | null;
  practiceId: number;
  practiceTz: string;
  appointmentTypes: AppointmentType[];
  providers: Provider[];
  defaultProviderId: string | null;
  prefill?: SchedulerBookPrefill | null;
  /** When set, POST /routing/feedback after a successful book/reschedule from routing preview. */
  routingLinkPreview?: RoutingCalendarPreviewPayloadV1 | null;
  /** Timed manual book — preview on calendar before saving (all-day books save directly). */
  onPreviewOnCalendar?: (draft: ManualBookPreviewDraft) => void;
  onClose: () => void;
  onBooked: (detail?: {
    routingFeedbackWarning?: string;
    forwardBookingWarning?: string;
    schedulingOverrideWarning?: string;
    schedulingOverridesApplied?: boolean;
    savedAppointmentId?: number;
    /** Internal provider id used for the saved visit (for calendar focus after cross-doctor reschedule). */
    primaryProviderId?: string;
    /** Practice-local date (YYYY-MM-DD) of the booked slot. */
    anchorDate?: string;
  }) => void;
};

type PetRow = {
  id: number | string;
  name: string;
  alerts?: string | null;
  isActive?: boolean;
  isDeleted?: boolean;
};

type ProviderAssigneeOption = {
  id: number;
  label: string;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeEmployeeIds(ids: readonly number[] | null | undefined): number[] {
  return [...new Set((ids ?? []).filter((id) => Number.isFinite(Number(id)) && Number(id) > 0).map(Number))];
}

export function extractPatientsFromClientPayload(payload: unknown): PetRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const raw =
    p.patients ??
    p.patientList ??
    p.pets ??
    (Array.isArray(p.patient) ? p.patient : null);
  if (!Array.isArray(raw)) return [];
  const out: PetRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const idRaw = o.id ?? o.patientId;
    if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) continue;
    const id = idRaw;
    const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
    const name = pickStr(o.name) ?? (joined || 'Patient');
    out.push({
      id,
      name,
      alerts: pickStr(o.alerts),
      isActive: o.isActive === true || o.isActive === 1 ? true : o.isActive === false ? false : undefined,
      isDeleted: o.isDeleted === true || o.isDeleted === 1 ? true : o.isDeleted === false ? false : undefined,
    });
  }
  return out;
}

export function extractClientAlertsFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  return pickStr(row.alerts) ?? pickStr(row.clientAlert);
}

function BookClientAlerts({ alerts }: { alerts: string | null | undefined }) {
  const text = alerts?.trim();
  if (!text) return null;
  return (
    <div className="scheduler-modal-client-header-alerts scheduler-book-client-alerts" role="alert">
      <span className="scheduler-modal-client-header-alerts-title">Client alerts</span>
      {text}
    </div>
  );
}

function BookPatientAlerts({ alerts }: { alerts: string | null | undefined }) {
  const text = alerts?.trim();
  if (!text) return null;
  return (
    <div className="scheduler-modal-alerts-box scheduler-book-patient-alerts" role="alert">
      <span className="scheduler-modal-alerts-box-label">Patient alerts</span>
      {text}
    </div>
  );
}

function BookSelectedClientCard({
  name,
  address,
  visitAddress,
  homeAddress,
  alerts,
  onClear,
  hint,
  style,
}: {
  name: string;
  address: string | null;
  visitAddress?: string | null;
  homeAddress?: string | null;
  alerts: string | null;
  onClear?: () => void;
  hint?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="scheduler-book-selected scheduler-book-selected-client" style={style}>
      {onClear ? (
        <button
          type="button"
          className="scheduler-book-selected-clear"
          onClick={onClear}
          aria-label="Remove client"
          title="Remove client"
        >
          ×
        </button>
      ) : null}
      <span className="scheduler-book-selected-label">Client</span>
      <span className="scheduler-book-selected-value">{name}</span>
      {visitAddress ? (
        <>
          <span className="scheduler-book-selected-label scheduler-book-selected-label--visit">
            Visit location
          </span>
          <span className="scheduler-book-selected-visit-address">{visitAddress}</span>
          {homeAddress ? (
            <span className="scheduler-book-selected-address scheduler-book-selected-home-address">
              Home: {homeAddress}
            </span>
          ) : null}
        </>
      ) : address ? (
        <span className="scheduler-book-selected-address">{address}</span>
      ) : null}
      <BookClientAlerts alerts={alerts} />
      {hint}
    </div>
  );
}

function clientDisplayName(c: ClientSearchRow): string {
  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const both = [fn, ln].filter(Boolean).join(' ');
  return both || `Client #${c.id}`;
}

function clientAddressFromRecord(c: Record<string, unknown>): string | null {
  const zip = pickStr(c.zip) ?? pickStr(c.zipcode);
  const parts = [pickStr(c.address1), [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', '), zip].filter(
    Boolean
  );
  return parts.length ? parts.join(', ') : null;
}

function clientAddressLine(c: ClientSearchRow): string | null {
  return clientAddressFromRecord(c);
}

function extractClientAddressFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  return clientAddressFromRecord(payload as Record<string, unknown>);
}

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

export function SchedulerBookModal({
  open,
  slot,
  practiceId,
  practiceTz,
  appointmentTypes,
  providers,
  defaultProviderId,
  prefill,
  routingLinkPreview,
  onPreviewOnCalendar,
  onClose,
  onBooked,
}: Props) {
  const [combinedQuery, setCombinedQuery] = useState('');
  const [combinedClientResults, setCombinedClientResults] = useState<ClientSearchRow[]>([]);
  const [combinedPatientResults, setCombinedPatientResults] = useState<PimsPatientSearchHit[]>([]);
  const [combinedSearching, setCombinedSearching] = useState(false);
  const [showCombinedDd, setShowCombinedDd] = useState(false);
  const combinedDdRef = useRef<HTMLDivElement>(null);
  const latestCombinedQ = useRef('');

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientLabel, setSelectedClientLabel] = useState('');
  const [selectedClientAddress, setSelectedClientAddress] = useState<string | null>(null);
  const [selectedClientLat, setSelectedClientLat] = useState<number | undefined>(undefined);
  const [selectedClientLon, setSelectedClientLon] = useState<number | undefined>(undefined);
  const [selectedClientCity, setSelectedClientCity] = useState<string | undefined>(undefined);
  const [selectedClientState, setSelectedClientState] = useState<string | undefined>(undefined);
  const [selectedClientZip, setSelectedClientZip] = useState<string | undefined>(undefined);
  const [selectedClientAlerts, setSelectedClientAlerts] = useState<string | null>(null);
  const [clientPets, setClientPets] = useState<PetRow[]>([]);
  const [loadingClientPets, setLoadingClientPets] = useState(false);

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');

  const [providerId, setProviderId] = useState<string>('');
  const [typeId, setTypeId] = useState<string>('');
  const [manualBookableTypeIds, setManualBookableTypeIds] = useState<number[] | null>(null);

  const { role, token, userEmail, doctorId } = useAuth() as {
    role?: string | string[];
    token?: string | null;
    userEmail?: string | null;
    doctorId?: string | null;
  };
  const rolesLower = useMemo(() => {
    const arr = Array.isArray(role) ? role : role != null ? [role] : [];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);
  const isAdminOrSuper = useMemo(() => rolesIncludeAdminBypass(rolesLower), [rolesLower]);
  const isRoutingBook = isSchedulerRoutingBookPrefill(prefill);

  useEffect(() => {
    if (!open || isRoutingBook) {
      setManualBookableTypeIds(null);
      return;
    }
    if (isAdminOrSuper) {
      setManualBookableTypeIds([]);
      return;
    }
    let cancelled = false;
    void fetchManualBookableAppointmentTypes(practiceId)
      .then(({ appointmentTypeIds }) => {
        if (!cancelled) setManualBookableTypeIds(appointmentTypeIds);
      })
      .catch(() => {
        if (!cancelled) setManualBookableTypeIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isRoutingBook, isAdminOrSuper, practiceId]);

  /** Types shown in manual-book dropdowns (role permissions); routing keeps full catalog. */
  const typesForPicker = useMemo(() => {
    let list: AppointmentType[];
    if (isRoutingBook) list = appointmentTypes;
    else if (isAdminOrSuper) list = appointmentTypes;
    else if (manualBookableTypeIds === null) list = [];
    else list = filterAppointmentTypesByIds(appointmentTypes, manualBookableTypeIds);
    return sortAppointmentTypesForPicker(list, {
      unrankedOrder: isRoutingBook ? 'alphabetical' : 'preserve',
    });
  }, [isRoutingBook, isAdminOrSuper, appointmentTypes, manualBookableTypeIds]);

  const [startLocal, setStartLocal] = useState<DateTime | null>(null);
  const [durationMin, setDurationMin] = useState(30);
  const [isAllDay, setIsAllDay] = useState(false);
  const [allDayEndDate, setAllDayEndDate] = useState('');
  const [additionalEmployeeIds, setAdditionalEmployeeIds] = useState<number[]>([]);

  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [alternateAddressText, setAlternateAddressText] = useState('');
  const [rescheduleVisitEdits, setRescheduleVisitEdits] = useState<RescheduleVisitEdit[]>([]);
  const [routingBookVisitEdits, setRoutingBookVisitEdits] = useState<RoutingBookVisitEdit[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [scheduleOverrideDraft, setScheduleOverrideDraft] = useState<ScheduleOverrideDraft | null>(
    null
  );
  const [scheduleOverrideDayOff, setScheduleOverrideDayOff] = useState(false);
  const [scheduleOverrideLoading, setScheduleOverrideLoading] = useState(false);
  const scheduleOverrideUserTouchedRef = useRef(false);
  const scheduleOverrideBaselineRef = useRef<ScheduleOverrideDraft | null>(null);
  const scheduleOverrideDayOffRef = useRef(false);

  const allDayBookSession = Boolean(prefill?.allDay) || isAllDay;

  /**
   * All-day manual book: types the user may book that also allow all-day.
   * Uses the same role permissions as timed manual book (`typesForPicker`).
   */
  const typesForActivePicker = useMemo(() => {
    if (!allDayBookSession) return typesForPicker;
    return allDayBookableTypesFromCatalog(typesForPicker);
  }, [typesForPicker, allDayBookSession]);

  const selectedType = useMemo(() => {
    if (!typeId) return undefined;
    const raw =
      appointmentTypes.find((t) => String(t.id) === typeId) ??
      typesForActivePicker.find((t) => String(t.id) === typeId);
    return raw ? normalizeAppointmentTypeFromApi(raw) : undefined;
  }, [appointmentTypes, typesForActivePicker, typeId]);

  const typeFormFlags = useMemo(() => appointmentFormFlags(selectedType), [selectedType]);
  const showClient = typeFormFlags.showClient;
  const requirePatient = typeFormFlags.requirePatient;
  const canBookAllDay = typeFormFlags.showAllDay;
  const canUseAlternateAddress = typeFormFlags.showAlternateAddress;

  const routingBookFullAppointmentTypes = useMemo(
    () =>
      sortAppointmentTypesForPicker(
        appointmentTypes
          .map((t) => normalizeAppointmentTypeFromApi(t))
          .filter((t) => t.isDeleted !== true && t.isActive !== false),
        { unrankedOrder: 'alphabetical' }
      ),
    [appointmentTypes]
  );

  /** No-patient row only — types with “Patient required” unchecked in settings. */
  const noPatientBookAppointmentTypes = useMemo(
    () => routingBookFullAppointmentTypes.filter((t) => !appointmentTypeRequiresPatient(t)),
    [routingBookFullAppointmentTypes]
  );

  const bookOverrideAnchorDate = useMemo(() => {
    if (!startLocal?.isValid) return null;
    return startLocal.setZone(practiceTz).startOf('day').toISODate();
  }, [startLocal, practiceTz]);

  const selectedProvider = useMemo(
    () => providers.find((p) => String(p.id) === providerId),
    [providers, providerId]
  );

  const isRescheduleBook = prefill?.rescheduleAppointmentId != null;

  const isRoutingPreviewBook = Boolean(prefill?.routingPreviewBook && !isRescheduleBook);
  const bookedViaRouting = isSchedulerRoutingBookPrefill(prefill);

  /** Full catalog for routing/reschedule — not limited to manual-book role permissions. */
  const usesRoutingTypeCatalog = isRoutingBook || isRescheduleBook;

  const routingBookHasPrefilledClient = Boolean(prefill?.clientId?.trim());

  const lockedRoutingBookFields = isRescheduleBook || isRoutingPreviewBook;

  const hasLinkedClient = Boolean(selectedClientId?.trim());

  const hasRoutingAlternateAddressText = Boolean(
    alternateAddressText.trim() || prefill?.routingAlternateAddress?.trim()
  );

  /** Routing / reschedule alternate stop overrides client home for drive time and visit location. */
  const showRoutingAlternateAddress = Boolean(
    (isRoutingPreviewBook || isRescheduleBook) && hasRoutingAlternateAddressText
  );

  /** Include on create/preview when routing supplied an explicit alternate stop. */
  const bookAlternateAddressText = useMemo(() => {
    const trimmed = alternateAddressText.trim();
    const prefillAlt = prefill?.routingAlternateAddress?.trim();
    if (prefillAlt) return trimmed || prefillAlt;
    if (canUseAlternateAddress && !hasLinkedClient) return trimmed;
    return '';
  }, [
    alternateAddressText,
    prefill?.routingAlternateAddress,
    canUseAlternateAddress,
    hasLinkedClient,
  ]);

  const perVisitReschedule = isRescheduleBook && rescheduleVisitEdits.length > 0;

  const rescheduleAlternateVisitAddress = isRescheduleBook ? bookAlternateAddressText || null : null;

  const perVisitRoutingBook = isRoutingPreviewBook && routingBookVisitEdits.length > 0;

  const showAllDayFields = allDayBookSession && !isRescheduleBook;
  const showAllDayToggle = !prefill?.allDay && !isRescheduleBook && canBookAllDay;

  /** Routing time-off overrides apply only to all-day bookings (vacation / OOO), not timed slots. */
  const showBookScheduleOverride =
    showAllDayFields && typeFormFlags.showSchedulingOverride;

  const bookOverrideEndDate = useMemo(() => {
    if (showAllDayFields && allDayEndDate.trim()) {
      return DateTime.fromISO(allDayEndDate, { zone: practiceTz }).startOf('day').toISODate();
    }
    return bookOverrideAnchorDate;
  }, [showAllDayFields, allDayEndDate, bookOverrideAnchorDate, practiceTz]);

  /** Manual book: alternate stop when type allows (routing preview uses its own field). */
  const showManualAlternateAddress = Boolean(
    canUseAlternateAddress && !showRoutingAlternateAddress && !hasLinkedClient
  );

  const showClientSection =
    Boolean(prefill?.lockClient && prefill?.clientId?.trim()) ||
    (isRoutingPreviewBook && routingBookHasPrefilledClient) ||
    ((showClient || requirePatient) && Boolean(selectedType));

  const patientRequiredButMissing =
    requirePatient &&
    !perVisitReschedule &&
    !perVisitRoutingBook &&
    !selectedPatientId?.trim();

  const showAdditionalEmployeesField = showAllDayFields && !perVisitRoutingBook;

  const showManualBookTypeFields = !lockedRoutingBookFields;

  const canPreviewOnCalendar = Boolean(
    onPreviewOnCalendar &&
      !lockedRoutingBookFields &&
      !perVisitReschedule &&
      !perVisitRoutingBook &&
      !allDayBookSession
  );

  const endLocal = useMemo(() => {
    if (!startLocal?.isValid) return null;
    return startLocal.plus({ minutes: durationMin });
  }, [startLocal, durationMin]);

  useEffect(() => {
    if (!showBookScheduleOverride || !providerId.trim() || !bookOverrideAnchorDate) {
      setScheduleOverrideDraft(null);
      scheduleOverrideDayOffRef.current = false;
      setScheduleOverrideDayOff(false);
      setScheduleOverrideLoading(false);
      return;
    }
    if (scheduleOverrideUserTouchedRef.current) return;

    const empId = Number(providerId);
    if (!Number.isFinite(empId) || empId <= 0) return;

    let cancelled = false;
    setScheduleOverrideLoading(true);
    void loadScheduleOverrideDraftForBook(empId, bookOverrideAnchorDate, { allDay: true })
      .then(({ draft, dayOff }) => {
        if (cancelled || scheduleOverrideUserTouchedRef.current) return;
        scheduleOverrideBaselineRef.current = draft;
        setScheduleOverrideDraft(draft);
        scheduleOverrideDayOffRef.current = dayOff;
        setScheduleOverrideDayOff(dayOff);
      })
      .catch(() => {
        if (cancelled || scheduleOverrideUserTouchedRef.current) return;
        setScheduleOverrideDraft({ workStartLocal: '', workEndLocal: '' });
        scheduleOverrideDayOffRef.current = false;
        setScheduleOverrideDayOff(false);
      })
      .finally(() => {
        if (!cancelled) setScheduleOverrideLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showBookScheduleOverride, providerId, bookOverrideAnchorDate]);

  const additionalEmployeeOptions = useMemo<ProviderAssigneeOption[]>(() => {
    return providers
      .map((p) => {
        const id = Number(p.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const label = p.name?.trim() || `Provider ${id}`;
        return { id, label };
      })
      .filter((row): row is ProviderAssigneeOption => row != null)
      .filter((row) => String(row.id) !== providerId)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [providers, providerId]);

  const additionalProviderIdSet = useMemo(
    () => new Set(additionalEmployeeOptions.map((row) => row.id)),
    [additionalEmployeeOptions]
  );

  const durationOpts = useMemo(() => {
    const o = [...DURATION_OPTIONS];
    if (!o.includes(durationMin)) o.push(durationMin);
    return [...new Set(o)].sort((a, b) => a - b);
  }, [durationMin]);

  const petChoices = useMemo(() => {
    const ex = new Set((prefill?.excludePatientIds ?? []).map((id) => String(id)));
    return clientPets.filter((p) => {
      if (p.isDeleted === true || p.isActive === false) return false;
      return !ex.has(String(p.id));
    });
  }, [clientPets, prefill?.excludePatientIds]);

  const patientAlertsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of clientPets) {
      const alerts = p.alerts?.trim();
      if (alerts) map.set(String(p.id), alerts);
    }
    return map;
  }, [clientPets]);

  const patientAlertsFor = useCallback(
    (patientId: string | null | undefined) => {
      if (!patientId?.trim()) return null;
      return patientAlertsById.get(patientId.trim()) ?? null;
    },
    [patientAlertsById]
  );

  useEffect(() => {
    if (!providerId.trim()) return;
    setAdditionalEmployeeIds((prev) =>
      prev.filter((id) => String(id) !== providerId && additionalProviderIdSet.has(id))
    );
  }, [providerId, additionalProviderIdSet]);


  useEffect(() => {
    scheduleOverrideUserTouchedRef.current = false;
  }, [allDayBookSession, showBookScheduleOverride, typeId, providerId, bookOverrideAnchorDate]);

  useEffect(() => {
    if (!allDayBookSession) return;
    setTypeId((prev) => {
      if (prev && typesForActivePicker.some((t) => String(t.id) === prev)) return prev;
      return typesForActivePicker[0] ? String(typesForActivePicker[0].id) : '';
    });
  }, [allDayBookSession, typesForActivePicker]);

  useEffect(() => {
    if (prefill?.allDay) return;
    if (isAllDay && !canBookAllDay) setIsAllDay(false);
  }, [prefill?.allDay, isAllDay, canBookAllDay]);

  useEffect(() => {
    if (prefill?.lockClient) return;
    if (showClient) return;
    setSelectedClientId(null);
    setSelectedClientLabel('');
    setSelectedClientAddress(null);
    setSelectedClientAlerts(null);
    setClientPets([]);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setCombinedQuery('');
    setCombinedClientResults([]);
    setCombinedPatientResults([]);
  }, [showClient, typeId, prefill?.lockClient]);

  useEffect(() => {
    if (canUseAlternateAddress || prefill?.routingAlternateAddress?.trim()) return;
    setAlternateAddressText('');
  }, [canUseAlternateAddress, typeId, prefill?.routingAlternateAddress]);

  const clientHasNoPetsOnFile =
    hasLinkedClient && !loadingClientPets && petChoices.length === 0;

  const resolveDefaultBookTypeId = useCallback(
    (sortedPicker: AppointmentType[]): string => {
      const id = resolveBookModalDefaultAppointmentTypeId({
        sortedPickerTypes: sortedPicker,
        allTypes: appointmentTypes,
        routingStatsTypeKey: prefill?.routingStatsTypeKey,
        pinnedAppointmentTypeId: prefill?.coVisitAddPet
          ? prefill?.appointmentTypeId
          : undefined,
      });
      return id != null ? String(id) : '';
    },
    [
      appointmentTypes,
      prefill?.routingStatsTypeKey,
      prefill?.coVisitAddPet,
      prefill?.appointmentTypeId,
    ]
  );

  const bookSessionKey = useMemo(() => {
    if (!open || !slot) return '';
    return [
      slot.start.toISO() ?? '',
      slot.end.toISO() ?? '',
      practiceTz,
      defaultProviderId ?? '',
      prefill?.clientId ?? '',
      String(prefill?.lockClient ?? false),
      prefill?.defaultDescription ?? '',
      prefill?.providerId ?? '',
      prefill?.excludePatientIds?.join(',') ?? '',
      String(prefill?.preserveDurationFromSlot ?? false),
      String(prefill?.lockProvider ?? false),
      prefill?.modalTitle ?? '',
      String(prefill?.disableClientSearch ?? false),
      String(prefill?.coVisitAddPet ?? false),
      String(prefill?.lockSlotTimes ?? false),
      String(prefill?.rescheduleAppointmentId ?? ''),
      prefill?.preferredPatientId ?? '',
      prefill?.preferredPatientIds?.join(',') ?? '',
      String(prefill?.routingPreviewBook ?? false),
      prefill?.defaultInstructions ?? '',
      prefill?.routingAlternateAddress ?? '',
      prefill?.routingStatsTypeKey ?? '',
      String(prefill?.appointmentTypeId ?? ''),
      String(prefill?.allDay ?? false),
      prefill?.additionalEmployeeIds?.join(',') ?? '',
      JSON.stringify(prefill?.rescheduleVisitPatches ?? []),
    ].join('\t');
  }, [
    open,
    slot,
    practiceTz,
    defaultProviderId,
    prefill?.clientId,
    prefill?.lockClient,
    prefill?.defaultDescription,
    prefill?.providerId,
    prefill?.excludePatientIds,
    prefill?.preserveDurationFromSlot,
    prefill?.lockProvider,
    prefill?.modalTitle,
    prefill?.disableClientSearch,
    prefill?.coVisitAddPet,
    prefill?.lockSlotTimes,
    prefill?.rescheduleAppointmentId,
    prefill?.preferredPatientId,
    prefill?.preferredPatientIds,
    prefill?.routingPreviewBook,
    prefill?.defaultInstructions,
    prefill?.routingAlternateAddress,
    prefill?.routingStatsTypeKey,
    prefill?.appointmentTypeId,
    prefill?.allDay,
    prefill?.additionalEmployeeIds,
    prefill?.rescheduleVisitPatches,
  ]);

  useEffect(() => {
    if (!bookSessionKey) return;
    setCombinedQuery('');
    setCombinedClientResults([]);
    setCombinedPatientResults([]);
    setSelectedClientId(null);
    setSelectedClientLabel('');
    setSelectedClientAddress(null);
    setSelectedClientAlerts(null);
    setClientPets([]);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    const patches = prefill?.rescheduleVisitPatches?.filter(
      (v) => Number.isFinite(Number(v.appointmentId)) && v.patientId?.trim()
    );
    if (patches?.length) {
      const statsKey = prefill?.routingStatsTypeKey?.trim();
      const calcTimeTypeId = statsKey
        ? resolveBookModalDefaultAppointmentTypeId({
            sortedPickerTypes: routingBookFullAppointmentTypes,
            allTypes: appointmentTypes,
            routingStatsTypeKey: statsKey,
          })
        : undefined;
      const calcTimeRow =
        calcTimeTypeId != null
          ? appointmentTypes.find((t) => Number(t.id) === calcTimeTypeId)
          : undefined;
      const calcTimeLabel =
        calcTimeRow?.name?.trim() || calcTimeRow?.prettyName?.trim() || null;
      setRescheduleVisitEdits(
        patches.map((p) => {
          const tid =
            p.appointmentTypeId != null && Number.isFinite(Number(p.appointmentTypeId))
              ? Number(p.appointmentTypeId)
              : undefined;
          return {
            appointmentId: Number(p.appointmentId),
            patientId: String(p.patientId).trim(),
            patientName: p.patientName?.trim() || `Pet ${p.patientId}`,
            appointmentTypeId: calcTimeTypeId ?? tid,
            appointmentTypeLabel:
              (calcTimeLabel ?? p.appointmentTypeLabel?.trim()) || '—',
            scheduledTimeLabel: p.scheduledTimeLabel?.trim() || '—',
            originalAppointmentStartIso: p.originalAppointmentStartIso?.trim() || undefined,
            description: p.description?.trim() ?? '',
            instructions: p.instructions?.trim() ?? '',
          };
        })
      );
      setDescription('');
    } else {
      setRescheduleVisitEdits([]);
      setRoutingBookVisitEdits([]);
      setDescription(prefill?.defaultDescription?.trim() ?? '');
    }
    setInstructions(prefill?.defaultInstructions?.trim() ?? '');
    setAlternateAddressText(prefill?.routingAlternateAddress?.trim() ?? '');
    setIsAllDay(Boolean(prefill?.allDay));
    setAdditionalEmployeeIds(normalizeEmployeeIds(prefill?.additionalEmployeeIds));
    setScheduleOverrideDraft(null);
    setScheduleOverrideDayOff(false);
    setScheduleOverrideLoading(false);
    scheduleOverrideUserTouchedRef.current = false;
    setFormError(null);
    setShowCombinedDd(false);

    const s = slot!.start.setZone(practiceTz);
    const e = slot!.end.setZone(practiceTz);
    setStartLocal(s);
    const rawMins = Math.max(1, Math.round(e.diff(s, 'minutes').minutes));
    setDurationMin(rawMins);
    const inclusiveAllDayEnd = e.startOf('day') > s.startOf('day') ? e.minus({ days: 1 }) : s;
    setAllDayEndDate(inclusiveAllDayEnd.toISODate() ?? (s.toISODate() ?? ''));

    const prefProv = prefill?.providerId?.trim();
    const match =
      prefProv && providers.some((p) => String(p.id) === prefProv || (p.pimsId != null && String(p.pimsId) === prefProv))
        ? providers.find((p) => String(p.id) === prefProv || (p.pimsId != null && String(p.pimsId) === prefProv))
        : providers.find(
            (p) =>
              (defaultProviderId && String(p.id) === defaultProviderId) ||
              (defaultProviderId && String(p.pimsId ?? '') === defaultProviderId)
          );
    setProviderId(
      match ? String(match.id) : providers[0] ? String(providers[0].id) : ''
    );

    const manualBookTypes = usesRoutingTypeCatalog
      ? routingBookFullAppointmentTypes
      : typesForPicker;
    const pickerTypes = prefill?.allDay
      ? allDayBookableTypesFromCatalog(manualBookTypes)
      : manualBookTypes;
    const defaultTypeId = resolveDefaultBookTypeId(pickerTypes);
    if (pickerTypes.length > 0 && defaultTypeId) {
      const t = pickerTypes.find((x) => String(x.id) === defaultTypeId);
      if (t) {
        setTypeId(defaultTypeId);
        if (!prefill?.preserveDurationFromSlot && t.defaultDuration && t.defaultDuration > 0) {
          const d = Math.round(t.defaultDuration);
          if (d >= 5) setDurationMin(DURATION_OPTIONS.includes(d) ? d : Math.min(120, Math.max(15, d)));
        }
      } else {
        setTypeId('');
      }
    } else {
      setTypeId('');
    }

    if (prefill?.preserveDurationFromSlot) {
      setDurationMin(rawMins);
    }
  }, [
    bookSessionKey,
    providers,
    typesForPicker,
    appointmentTypes,
    routingBookFullAppointmentTypes,
    usesRoutingTypeCatalog,
    resolveDefaultBookTypeId,
    prefill?.allDay,
    prefill?.preserveDurationFromSlot,
    prefill?.providerId,
    prefill?.additionalEmployeeIds,
    practiceTz,
  ]);

  /** When appointment types load after open, set type without wiping the rest of the form. */
  useEffect(() => {
    if (!open || !slot) return;
    const sortedCatalog = usesRoutingTypeCatalog
      ? routingBookFullAppointmentTypes
      : typesForActivePicker;
    if (!sortedCatalog.length) return;
    setTypeId((prev) => {
      if (prev && sortedCatalog.some((t) => String(t.id) === prev)) return prev;
      return resolveDefaultBookTypeId(sortedCatalog);
    });
  }, [
    open,
    slot,
    typesForActivePicker,
    routingBookFullAppointmentTypes,
    usesRoutingTypeCatalog,
    resolveDefaultBookTypeId,
  ]);

  useEffect(() => {
    const cid = prefill?.clientId?.trim();
    if (!bookSessionKey || !open || !slot || !cid) return;
    let cancelled = false;
    setLoadingClientPets(true);
    (async () => {
      try {
        const payload = await fetchClientByIdStaff(cid);
        if (cancelled) return;
        setSelectedClientId(cid);
        setSelectedClientLabel(prefill?.clientLabel?.trim() || `Client #${cid}`);
        applyClientPayloadDetails(payload);
        setSelectedPatientId(null);
        setSelectedPatientLabel('');
      } catch {
        if (cancelled) return;
        setSelectedClientId(cid);
        setSelectedClientLabel(prefill?.clientLabel?.trim() || `Client #${cid}`);
        setSelectedClientAddress(null);
        setClientPets([]);
        setSelectedClientAlerts(null);
        setSelectedPatientId(null);
        setSelectedPatientLabel('');
      } finally {
        if (!cancelled) setLoadingClientPets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookSessionKey, open, slot, prefill?.clientId, prefill?.clientLabel]);

  useEffect(() => {
    if (!prefill?.preferredPatientId?.trim()) return;
    const want = prefill.preferredPatientId.trim();
    const hit = petChoices.find((p) => String(p.id) === want);
    if (!hit) return;
    setSelectedPatientId(want);
    setSelectedPatientLabel(hit.name);
  }, [prefill?.preferredPatientId, petChoices]);

  useEffect(() => {
    if (!open || !prefill?.routingPreviewBook) {
      setRoutingBookVisitEdits([]);
      return;
    }
    const clientReady = Boolean(selectedClientId?.trim() || prefill?.clientId?.trim());
    if (!clientReady || loadingClientPets) {
      setRoutingBookVisitEdits([]);
      return;
    }
    const defaultType = resolveDefaultBookTypeId(routingBookFullAppointmentTypes);
    const defaultTypeForNoPatient = (() => {
      if (
        defaultType &&
        noPatientBookAppointmentTypes.some((t) => String(t.id) === defaultType)
      ) {
        return defaultType;
      }
      return resolveDefaultBookTypeId(noPatientBookAppointmentTypes);
    })();
    const defaultDesc = prefill.defaultDescription?.trim() ?? '';
    const defaultStaffNotes = prefill.defaultInstructions?.trim() ?? '';
    const preferredPatientId = prefill.preferredPatientId?.trim() ?? '';
    const preferredPatientIdSet = new Set(
      [
        ...(prefill.preferredPatientIds ?? []).map((id) => String(id).trim()),
        ...(preferredPatientId ? [preferredPatientId] : []),
      ].filter(Boolean)
    );
    const autoSelectPatient = (patientId: string): boolean => {
      if (petChoices.length === 1) return true;
      if (preferredPatientIdSet.size > 0) {
        return preferredPatientIdSet.has(patientId);
      }
      return false;
    };
    const patientRows = petChoices.map((p) => {
      const patientId = String(p.id);
      return {
        patientId,
        patientName: p.name,
        selected: autoSelectPatient(patientId),
        appointmentTypeId: defaultType,
        description: defaultDesc,
        instructions: defaultStaffNotes,
      };
    });
    const noPatientRow: RoutingBookVisitEdit = {
      patientId: '',
      patientName: 'No patient',
      isNoPatient: true,
      selected: patientRows.length === 0,
      appointmentTypeId: defaultTypeForNoPatient,
      description: defaultDesc,
      instructions: defaultStaffNotes,
    };
    setRoutingBookVisitEdits([...patientRows, noPatientRow]);
  }, [
    open,
    prefill?.routingPreviewBook,
    prefill?.clientId,
    prefill?.appointmentTypeId,
    prefill?.defaultDescription,
    prefill?.defaultInstructions,
    prefill?.preferredPatientId,
    prefill?.preferredPatientIds,
    petChoices,
    routingBookFullAppointmentTypes,
    noPatientBookAppointmentTypes,
    resolveDefaultBookTypeId,
    selectedClientId,
    loadingClientPets,
  ]);

  useEffect(() => {
    if (!open || !prefill?.routingPreviewBook) return;
    setRoutingBookVisitEdits((rows) => {
      let changed = false;
      const next = rows.map((row) => {
        if (!row.isNoPatient || !row.appointmentTypeId.trim()) return row;
        const ok = noPatientBookAppointmentTypes.some(
          (t) => String(t.id) === row.appointmentTypeId.trim()
        );
        if (ok) return row;
        changed = true;
        return { ...row, appointmentTypeId: '' };
      });
      return changed ? next : rows;
    });
  }, [open, prefill?.routingPreviewBook, noPatientBookAppointmentTypes]);

  useEffect(() => {
    if (prefill?.preserveDurationFromSlot) return;
    if (!selectedType?.defaultDuration || selectedType.defaultDuration <= 0) return;
    const d = Math.round(selectedType.defaultDuration);
    if (d >= 5) setDurationMin(DURATION_OPTIONS.includes(d) ? d : Math.min(120, Math.max(15, d)));
  }, [selectedType?.id, selectedType?.defaultDuration, prefill?.preserveDurationFromSlot]);

  useEffect(() => {
    const q = combinedQuery.trim();
    latestCombinedQ.current = q;
    if (!q) {
      setCombinedClientResults([]);
      setCombinedPatientResults([]);
      setShowCombinedDd(false);
      return;
    }
    const t = window.setTimeout(async () => {
      setCombinedSearching(true);
      try {
        const { clients, patients } = await searchPimsClientsAndPatients(q, {
          practiceId,
          activeOnly: true,
        });
        if (latestCombinedQ.current === q) {
          setCombinedClientResults(clients);
          setCombinedPatientResults(patients);
          setShowCombinedDd(clients.length > 0 || patients.length > 0);
        }
      } catch {
        if (latestCombinedQ.current === q) {
          setCombinedClientResults([]);
          setCombinedPatientResults([]);
        }
      } finally {
        setCombinedSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [combinedQuery, practiceId]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (combinedDdRef.current && !combinedDdRef.current.contains(t)) setShowCombinedDd(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pickClient = useCallback(async (c: ClientSearchRow) => {
    const id = String(c.id);
    setSelectedClientId(id);
    setSelectedClientLabel(clientDisplayName(c));
    setSelectedClientAddress(clientAddressLine(c));
    setCombinedQuery('');
    setCombinedClientResults([]);
    setCombinedPatientResults([]);
    setShowCombinedDd(false);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setClientPets([]);
    setSelectedClientAlerts(null);
    setLoadingClientPets(true);
    try {
      const payload = await fetchClientByIdStaff(id);
      applyClientPayloadDetails(payload, clientAddressLine(c));
    } catch {
      setClientPets([]);
      setSelectedClientAlerts(null);
    } finally {
      setLoadingClientPets(false);
    }
  }, []);

  const pickPatientFromSearch = useCallback((p: PimsPatientSearchHit) => {
    setSelectedPatientId(String(p.id));
    setSelectedPatientLabel(p.name);
    setCombinedQuery('');
    setCombinedClientResults([]);
    setCombinedPatientResults([]);
    setShowCombinedDd(false);
    if (p.clientId != null) {
      setSelectedClientId(String(p.clientId));
      setSelectedClientLabel(p.clientLabel ?? `Client #${p.clientId}`);
      setSelectedClientAddress(null);
      setLoadingClientPets(true);
      fetchClientByIdStaff(p.clientId)
        .then((payload) => {
          setSelectedClientAddress(extractClientAddressFromPayload(payload));
          setClientPets(extractPatientsFromClientPayload(payload));
          setSelectedClientAlerts(extractClientAlertsFromPayload(payload));
        })
        .catch(() => {
          setClientPets([]);
          setSelectedClientAlerts(null);
        })
        .finally(() => setLoadingClientPets(false));
    } else {
      setSelectedClientId(null);
      setSelectedClientLabel('');
      setSelectedClientAddress(null);
      setSelectedClientAlerts(null);
      setClientPets([]);
    }
  }, []);

  const clearSelectedClient = useCallback(() => {
    setSelectedClientId(null);
    setSelectedClientLabel('');
    setSelectedClientAddress(null);
    setSelectedClientLat(undefined);
    setSelectedClientLon(undefined);
    setSelectedClientCity(undefined);
    setSelectedClientState(undefined);
    setSelectedClientZip(undefined);
    setSelectedClientAlerts(null);
    setClientPets([]);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setCombinedQuery('');
    setCombinedClientResults([]);
    setCombinedPatientResults([]);
    setShowCombinedDd(false);
  }, []);

  function applyClientPayloadDetails(payload: unknown, fallbackAddress?: string | null) {
    setSelectedClientAddress(extractClientAddressFromPayload(payload) ?? fallbackAddress ?? null);
    setClientPets(extractPatientsFromClientPayload(payload));
    setSelectedClientAlerts(extractClientAlertsFromPayload(payload));
    const coords = coordsFromClientPayload(payload);
    setSelectedClientLat(coords.lat);
    setSelectedClientLon(coords.lon);
    const parts = clientAddressPartsFromPayload(payload);
    setSelectedClientCity(parts.city);
    setSelectedClientState(parts.state);
    setSelectedClientZip(parts.zip);
  }

  function tryPreviewOnCalendar(): boolean {
    setFormError(null);
    if (!canPreviewOnCalendar || !onPreviewOnCalendar) return false;
    if (!typeId) {
      setFormError('Select an appointment type.');
      return true;
    }
    if (!providerId) {
      setFormError('Select a provider.');
      return true;
    }
    if (!startLocal?.isValid || !endLocal?.isValid) {
      setFormError('Invalid start time.');
      return true;
    }
    const startIso = startLocal.setZone(practiceTz).toUTC().toISO();
    const endIso = endLocal.setZone(practiceTz).toUTC().toISO();
    if (!startIso || !endIso) {
      setFormError('Invalid start time.');
      return true;
    }
    const trimmedAlt = bookAlternateAddressText;
    if (trimmedAlt.length > 4000) {
      setFormError('Alternate address must be 4000 characters or fewer.');
      return true;
    }
    if (requirePatient && !selectedPatientId?.trim()) {
      setFormError('Select a patient — this appointment type requires one.');
      return true;
    }
    onPreviewOnCalendar({
      practiceId,
      primaryProviderId: Number(providerId),
      appointmentTypeId: Number(typeId),
      ...(selectedClientId ? { clientId: selectedClientId, clientLabel: selectedClientLabel || undefined } : {}),
      ...(selectedPatientId
        ? { patientId: selectedPatientId, patientLabel: selectedPatientLabel || undefined }
        : {}),
      description: description.trim() || undefined,
      instructions: instructions.trim() || undefined,
      ...(trimmedAlt ? { alternateAddressText: trimmedAlt } : {}),
      ...(showAdditionalEmployeesField && additionalEmployeeIds.length
        ? { additionalEmployeeIds }
        : {}),
      appointmentStartIso: startIso,
      appointmentEndIso: endIso,
      modalTitle: prefill?.modalTitle,
      ...(selectedClientAddress ? { clientAddress: selectedClientAddress } : {}),
      ...(selectedClientCity ? { clientCity: selectedClientCity } : {}),
      ...(selectedClientState ? { clientState: selectedClientState } : {}),
      ...(selectedClientZip ? { clientZip: selectedClientZip } : {}),
      ...(selectedClientLat != null && Number.isFinite(selectedClientLat)
        ? { clientLat: selectedClientLat }
        : {}),
      ...(selectedClientLon != null && Number.isFinite(selectedClientLon)
        ? { clientLon: selectedClientLon }
        : {}),
    });
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canPreviewOnCalendar) {
      tryPreviewOnCalendar();
      return;
    }
    setFormError(null);
    if (perVisitReschedule) {
      if (
        rescheduleVisitEdits.some(
          (v) => v.appointmentTypeId == null || !Number.isFinite(Number(v.appointmentTypeId))
        )
      ) {
        setFormError('One of the visits is missing an appointment type.');
        return;
      }
    } else if (perVisitRoutingBook) {
      const selected = routingBookVisitEdits.filter((v) => v.selected);
      if (selected.length === 0) {
        setFormError('Select at least one patient, or choose No patient.');
        return;
      }
      if (selected.some((v) => !v.appointmentTypeId.trim())) {
        setFormError('Select an appointment type for each selected visit.');
        return;
      }
      const missingPatientForType = selected.find((v) => {
        if (v.isNoPatient) return false;
        const t = appointmentTypes.find((at) => String(at.id) === v.appointmentTypeId);
        return appointmentFormFlags(t).requirePatient && !v.patientId?.trim();
      });
      if (missingPatientForType) {
        setFormError('Each selected visit with a patient-required type must have a patient.');
        return;
      }
      const noPatientInvalidType = selected.find((v) => {
        if (!v.isNoPatient) return false;
        const t = appointmentTypes.find((at) => String(at.id) === v.appointmentTypeId);
        return appointmentFormFlags(t).requirePatient;
      });
      if (noPatientInvalidType) {
        setFormError('No patient visits must use an appointment type that does not require a patient.');
        return;
      }
    } else {
      if (!typeId) {
        setFormError('Select an appointment type.');
        return;
      }
      if (allDayBookSession && !selectedType) {
        setFormError('Select an appointment type that allows all-day booking.');
        return;
      }
      if (requirePatient && !selectedPatientId?.trim()) {
        setFormError('Select a patient — this appointment type requires one.');
        return;
      }
    }
    if (!providerId) {
      setFormError('Select a provider.');
      return;
    }
    if (
      showBookScheduleOverride &&
      scheduleOverrideDraft &&
      !scheduleOverrideDayOff &&
      (!scheduleOverrideDraft.workStartLocal?.trim() || !scheduleOverrideDraft.workEndLocal?.trim())
    ) {
      // Book modal uses day-off-only override; settings-style time overrides are not shown there.
      if (!allDayBookSession) {
        setFormError('Set start and end times for the schedule override, or use Mark as day off.');
        return;
      }
    }
    if (allDayBookSession) {
      const startDate = startLocal?.setZone(practiceTz).startOf('day');
      const endDate = DateTime.fromISO(allDayEndDate, { zone: practiceTz }).startOf('day');
      if (!startDate?.isValid || !endDate.isValid) {
        setFormError('Choose a valid all-day date range.');
        return;
      }
      if (endDate < startDate) {
        setFormError('End date must be on or after the start date.');
        return;
      }
    } else if (!startLocal?.isValid || !endLocal?.isValid) {
      setFormError('Invalid start time.');
      return;
    }

    setSubmitting(true);
    try {
      const startDateLocal = startLocal?.setZone(practiceTz).startOf('day') ?? null;
      const endDateLocal = DateTime.fromISO(allDayEndDate, { zone: practiceTz }).startOf('day');
      const bookAllDay = allDayBookSession && appointmentTypeAllowsAllDay(selectedType);
      const startIso = bookAllDay
        ? startDateLocal?.toUTC().toISO()
        : startLocal?.setZone(practiceTz).toUTC().toISO();
      const endIso = bookAllDay
        ? endDateLocal.plus({ days: 1 }).toUTC().toISO()
        : endLocal?.setZone(practiceTz).toUTC().toISO();
      if (!startIso || !endIso) {
        setFormError(bookAllDay ? 'Choose a valid all-day date range.' : 'Invalid start time.');
        setSubmitting(false);
        return;
      }
      const visitPatches =
        prefill?.rescheduleVisitPatches?.filter(
          (v) => Number.isFinite(Number(v.appointmentId)) && v.patientId?.trim()
        ) ?? [];
      const rescheduleIds =
        perVisitReschedule && rescheduleVisitEdits.length > 0
          ? [...new Set(rescheduleVisitEdits.map((v) => v.appointmentId))]
          : visitPatches.length > 0
            ? [...new Set(visitPatches.map((v) => Number(v.appointmentId)))]
            : (
                prefill?.rescheduleAppointmentIds?.length
                  ? prefill.rescheduleAppointmentIds
                  : prefill?.rescheduleAppointmentId != null
                    ? [prefill.rescheduleAppointmentId]
                    : []
              ).filter((id) => Number.isFinite(Number(id)));
      const trimmedAlt = bookAlternateAddressText;
      if (trimmedAlt.length > 4000) {
        setFormError('Alternate address must be 4000 characters or fewer.');
        setSubmitting(false);
        return;
      }

      async function saveAlternateForAppointment(apptId: number) {
        if (!trimmedAlt) return;
        await putAppointmentAlternateAddress(apptId, { addressText: trimmedAlt });
      }

      const descriptionForNewBook = (raw: string) => raw.trim();

      const bookActor = resolveAppointmentChangeActorFromAuth({
        token,
        userEmail,
        doctorId,
        providers,
      });

      const staffNotesForNewBook = (raw: string) => {
        const trimmed = raw.trim();
        return appendBookedStaffNote(trimmed || null, bookActor, practiceTz).trim();
      };

      const forwardBookingToken = prefill?.forwardBookingTrackingToken?.trim();
      const forwardBookingEntryId = prefill?.forwardBookingEntryId;
      /** Stay on forward booking list until Mark complete — do not auto-close via tracking token. */
      const forwardBookingCreateExtras =
        forwardBookingToken && forwardBookingEntryId == null
          ? { forwardBookingTrackingToken: forwardBookingToken }
          : {};

      let savedAppointmentId: number | undefined;
      if (rescheduleIds.length > 0) {
        const patchBody = {
          appointmentStart: startIso,
          appointmentEnd: endIso,
          primaryProviderId: Number(providerId),
          ...(selectedClientId ? { clientId: Number(selectedClientId) } : {}),
          description: description.trim() || null,
        };
        for (const rescheduleId of rescheduleIds) {
          const edit = perVisitReschedule
            ? rescheduleVisitEdits.find((v) => v.appointmentId === rescheduleId)
            : undefined;
          const visitPatch = visitPatches.find((v) => Number(v.appointmentId) === rescheduleId);
          const patientForPatch = edit?.patientId ?? visitPatch?.patientId ?? selectedPatientId;
          const rawDescription = (edit?.description ?? description).trim();
          const rawInstructions = (edit?.instructions ?? instructions).trim();
          const originalStartIso =
            visitPatch?.originalAppointmentStartIso?.trim() ||
            edit?.originalAppointmentStartIso?.trim() ||
            undefined;
          await patchAppointment(rescheduleId, {
            ...patchBody,
            appointmentTypeId: Number(
              (typeId && Number.isFinite(Number(typeId)) ? Number(typeId) : undefined) ??
                edit?.appointmentTypeId
            ),
            description: rawDescription || null,
            instructions:
              appendRescheduledByStaffNote(
                rawInstructions || null,
                bookActor,
                practiceTz,
                originalStartIso
              ).trim() || null,
            patientId: Number(patientForPatch),
            ...(bookedViaRouting ? { bookedViaRouting: true } : {}),
          });
        }
        savedAppointmentId = rescheduleIds[0];
        if (trimmedAlt && savedAppointmentId != null) {
          for (const rescheduleId of rescheduleIds) {
            await saveAlternateForAppointment(rescheduleId);
          }
        }
      } else if (perVisitRoutingBook) {
        const selected = routingBookVisitEdits.filter((v) => v.selected);
        for (const visit of selected) {
          const created = await createAppointment({
            practiceId,
            primaryProviderId: Number(providerId),
            ...(showAdditionalEmployeesField ? { additionalEmployeeIds } : {}),
            ...(selectedClientId ? { clientId: Number(selectedClientId) } : {}),
            ...(!visit.isNoPatient && visit.patientId?.trim()
              ? { patientId: Number(visit.patientId) }
              : {}),
            appointmentTypeId: Number(visit.appointmentTypeId),
            appointmentStart: startIso,
            appointmentEnd: endIso,
            ...(bookAllDay ? { allDay: true } : {}),
            description: descriptionForNewBook(visit.description) || undefined,
            instructions: staffNotesForNewBook(visit.instructions) || undefined,
            ...(bookedViaRouting ? { bookedViaRouting: true } : {}),
            ...forwardBookingCreateExtras,
          });
          const idRaw = created?.id;
          if (idRaw != null && Number.isFinite(Number(idRaw))) {
            const apptId = Number(idRaw);
            if (savedAppointmentId == null) savedAppointmentId = apptId;
            await saveAlternateForAppointment(apptId);
          }
        }
      } else {
        const created = await createAppointment({
          practiceId,
          primaryProviderId: Number(providerId),
          ...(showAdditionalEmployeesField ? { additionalEmployeeIds } : {}),
          ...(selectedClientId ? { clientId: Number(selectedClientId) } : {}),
          ...(selectedPatientId ? { patientId: Number(selectedPatientId) } : {}),
          ...(trimmedAlt ? { alternateAddressText: trimmedAlt } : {}),
          appointmentTypeId: Number(typeId),
          appointmentStart: startIso,
          appointmentEnd: endIso,
          ...(bookAllDay ? { allDay: true } : {}),
          description: descriptionForNewBook(description) || undefined,
          instructions: staffNotesForNewBook(instructions) || undefined,
          ...(bookedViaRouting ? { bookedViaRouting: true } : {}),
          ...forwardBookingCreateExtras,
        });
        const idRaw = created?.id;
        if (idRaw != null && Number.isFinite(Number(idRaw))) {
          savedAppointmentId = Number(idRaw);
          await saveAlternateForAppointment(savedAppointmentId);
        }
      }

      let routingFeedbackWarning: string | undefined;
      if (routingLinkPreview && savedAppointmentId != null) {
        const fb = await submitRoutingAcceptedFeedbackFromPreview(
          savedAppointmentId,
          routingLinkPreview
        );
        if (!fb.submitted && fb.error) {
          routingFeedbackWarning =
            'Appointment saved, but routing could not be linked to this suggestion. ' + fb.error;
        }
      }

      let forwardBookingWarning: string | undefined;
      if (savedAppointmentId != null && forwardBookingEntryId != null) {
        const fbComplete = await completeForwardBookingFromBook(savedAppointmentId, prefill);
        if (!fbComplete.completed && fbComplete.error) {
          forwardBookingWarning =
            'Appointment saved, but the forward booking could not be marked complete. ' +
            fbComplete.error;
        }
      }

      let schedulingOverrideWarning: string | undefined;
      let schedulingOverridesApplied = false;
      const markRoutingDayOff = scheduleOverrideDayOffRef.current || scheduleOverrideDayOff;
      if (
        showBookScheduleOverride &&
        allDayBookSession &&
        markRoutingDayOff &&
        scheduleOverrideDraft &&
        bookOverrideAnchorDate &&
        bookOverrideEndDate
      ) {
        const employeeIds = normalizeEmployeeIds([Number(providerId)]);
        try {
          const { applied, failed } = await applyScheduleOverridesForBook({
            employeeIds,
            startDate: bookOverrideAnchorDate,
            endDateInclusive: bookOverrideEndDate,
            draft: scheduleOverrideDraft,
            dayOff: true,
          });
          if (failed.length === 0 && applied > 0) {
            schedulingOverridesApplied = true;
          } else if (failed.length > 0) {
            const firstError = failed[0]?.error?.trim();
            const errorSuffix = firstError ? ` ${firstError}` : '';
            schedulingOverrideWarning =
              applied > 0
                ? `Appointment saved. Schedule overrides were applied for ${applied} provider-day(s), but ${failed.length} override(s) could not be saved.${errorSuffix}`
                : `Appointment saved, but schedule overrides could not be applied for routing.${errorSuffix}`;
          } else {
            schedulingOverrideWarning =
              'Appointment saved, but schedule overrides could not be applied for routing.';
          }
        } catch {
          schedulingOverrideWarning =
            'Appointment saved, but schedule overrides could not be applied for routing.';
        }
      }

      const bookedDetail =
        routingFeedbackWarning ||
        forwardBookingWarning ||
        schedulingOverrideWarning ||
        schedulingOverridesApplied
          ? {
              routingFeedbackWarning,
              forwardBookingWarning,
              schedulingOverrideWarning,
              schedulingOverridesApplied,
            }
          : undefined;
      onBooked(
        savedAppointmentId != null
          ? {
              ...(bookedDetail ?? {}),
              savedAppointmentId,
              primaryProviderId: providerId.trim() || undefined,
              anchorDate: startLocal?.isValid ? startLocal.toISODate() ?? undefined : undefined,
            }
          : bookedDetail
      );
      onClose();
    } catch (err) {
      setFormError(formatSchedulerBookingApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !slot || !startLocal) return null;

  const timeInputValue = startLocal.toFormat('HH:mm');
  const endTimeInputValue = endLocal?.isValid ? endLocal.toFormat('HH:mm') : '';
  const dateInputValue = startLocal.toISODate() ?? '';
  const allDayStartDateValue = startLocal.setZone(practiceTz).startOf('day').toISODate() ?? '';
  const routingBookSelectedCount = routingBookVisitEdits.filter((v) => v.selected).length;
  const slotSummary = showAllDayFields
    ? (() => {
        const start = DateTime.fromISO(allDayStartDateValue, { zone: practiceTz });
        const end = DateTime.fromISO(allDayEndDate || allDayStartDateValue, { zone: practiceTz });
        if (!start.isValid || !end.isValid) return 'All day';
        const startLabel = start.toFormat('EEEE, MMM d, yyyy');
        const endLabel = end.toFormat('EEEE, MMM d, yyyy');
        return startLabel === endLabel ? `${startLabel} · All day` : `${startLabel} – ${endLabel} · All day`;
      })()
    : `${startLocal.setZone(practiceTz).toFormat('EEEE, MMM d, yyyy')} · ${startLocal.toFormat('h:mm a')} – ${endLocal?.toFormat('h:mm a')}`;

  return createPortal(
    <div className="scheduler-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="scheduler-book-modal"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-book-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="scheduler-book-modal-header">
          <div>
            <h2 id="scheduler-book-title">
              {prefill?.modalTitle?.trim() ||
                (isRescheduleBook
                  ? perVisitReschedule && rescheduleVisitEdits.length > 1
                    ? 'Reschedule appointments'
                    : 'Reschedule appointment'
                  : showAllDayFields
                    ? 'Book all-day appointment'
                    : 'Book appointment')}
            </h2>
            {showAllDayFields ? (
              <p className="scheduler-book-all-day-badge" role="status">
                All day
              </p>
            ) : null}
            <p className="scheduler-book-slot-summary">{slotSummary}</p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="scheduler-book-form" onSubmit={handleSubmit}>
          {showAllDayFields ? (
            <p className="scheduler-book-all-day-note" role="note">
              This appointment will be saved as all day and shown in the all-day row at the top of the
              calendar. Use start and end date for multi-day blocks (for example, a week out of office).
            </p>
          ) : null}

          {showRoutingAlternateAddress ? (
            <label className="scheduler-book-field scheduler-book-field--full">
              <span className="scheduler-book-field-label">Alternate address (routing)</span>
              <textarea
                className="scheduler-book-textarea"
                rows={2}
                maxLength={4000}
                value={alternateAddressText}
                onChange={(e) => setAlternateAddressText(e.target.value)}
                placeholder="Used for routing and drive time instead of the client's home address."
              />
              <p className="scheduler-book-hint muted">
                {hasLinkedClient
                  ? 'This visit will be scheduled for the client at this address (not their home).'
                  : 'Pre-filled from Get Best Route. Overrides the client home address when set.'}
              </p>
            </label>
          ) : null}

          {showManualAlternateAddress ? (
            <label className="scheduler-book-field scheduler-book-field--full">
              <span className="scheduler-book-field-label">Alternate address</span>
              <textarea
                className="scheduler-book-textarea"
                rows={2}
                maxLength={4000}
                value={alternateAddressText}
                onChange={(e) => setAlternateAddressText(e.target.value)}
                placeholder="Visit location when different from the client's home address."
              />
            </label>
          ) : null}

          {showManualBookTypeFields ? (
            <>
              <div className="scheduler-book-row2">
                <Field label="Provider">
                  <select
                    className="scheduler-book-input"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    disabled={Boolean(prefill?.lockProvider)}
                    required
                  >
                    <option value="">Select…</option>
                    {providers.map((p) => (
                      <option key={String(p.id)} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Appointment type">
                  <select
                    className="scheduler-book-input"
                    value={typeId}
                    onChange={(e) => setTypeId(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {typesForActivePicker.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name || t.prettyName}
                      </option>
                    ))}
                  </select>
                  {allDayBookSession && typesForActivePicker.length === 0 ? (
                    <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                      No all-day appointment types are available for your role. Enable &quot;Allow
                      all-day booking&quot; on a type in Settings → Appointment types, or ask an admin
                      to grant your role access under Settings → Role manual booking.
                    </p>
                  ) : null}
                  {typeFormFlags.showNotRoutedHint ? (
                    <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                      This type is excluded from drive routing.
                    </p>
                  ) : null}
                  {requirePatient ? (
                    <p className="scheduler-book-hint" style={{ marginTop: 6, marginBottom: 0 }}>
                      A patient is required for this appointment type.
                    </p>
                  ) : null}
                </Field>
              </div>

              {showAllDayToggle ? (
                <label className="scheduler-book-field scheduler-book-field--full scheduler-book-all-day-toggle">
                  <input
                    type="checkbox"
                    checked={isAllDay}
                    onChange={(e) => {
                      const next = e.target.checked;
                      scheduleOverrideUserTouchedRef.current = false;
                      setIsAllDay(next);
                      if (!next) return;
                      setTypeId((prev) => {
                        const allowed = allDayBookableTypesFromCatalog(typesForPicker);
                        if (prev && allowed.some((t) => String(t.id) === prev)) return prev;
                        return allowed[0] ? String(allowed[0].id) : '';
                      });
                    }}
                  />
                  <span>All day</span>
                </label>
              ) : null}

              {showAllDayFields ? (
                <div className="scheduler-book-row2">
                  <Field label="Start date">
                    <input
                      type="date"
                      className="scheduler-book-input"
                      value={allDayStartDateValue}
                      onChange={(e) => {
                        const iso = e.target.value;
                        if (!iso) return;
                        const next = DateTime.fromISO(iso, { zone: practiceTz }).startOf('day');
                        if (!next.isValid) return;
                        setStartLocal(next);
                        setAllDayEndDate((prev) => {
                          const prevDt = DateTime.fromISO(prev || iso, { zone: practiceTz }).startOf('day');
                          if (!prevDt.isValid || prevDt < next) return iso;
                          return prevDt.toISODate() ?? iso;
                        });
                      }}
                    />
                  </Field>
                  <Field label="End date">
                    <input
                      type="date"
                      className="scheduler-book-input"
                      value={allDayEndDate}
                      min={allDayStartDateValue}
                      onChange={(e) => setAllDayEndDate(e.target.value)}
                    />
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}

          {showClientSection ? (
            prefill?.lockClient || (prefill?.disableClientSearch && routingBookHasPrefilledClient) ? (
            <BookSelectedClientCard
              style={{ marginBottom: 12 }}
              name={
                selectedClientLabel ||
                prefill?.clientLabel?.trim() ||
                (prefill?.clientId ? `Client #${prefill.clientId}` : '…')
              }
              address={rescheduleAlternateVisitAddress ? null : selectedClientAddress}
              visitAddress={rescheduleAlternateVisitAddress}
              homeAddress={rescheduleAlternateVisitAddress ? selectedClientAddress : null}
              alerts={selectedClientAlerts}
              hint={
                prefill?.coVisitAddPet ? (
                  <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                    This adds another appointment at the same time for a different pet. Pets already scheduled in
                    this visit block (same time or back-to-back with this appointment) are not listed below.
                  </p>
                ) : prefill?.routingPreviewBook ? (
                  <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                    {routingBookHasPrefilledClient
                      ? 'Choose one or more patients for this slot. Each patient gets their own appointment at the same time with its own type and description.'
                      : 'Optionally search for a client below, then choose patients. The alternate address above is used for routing regardless of client home address.'}
                  </p>
                ) : isRescheduleBook && rescheduleAlternateVisitAddress ? (
                  <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                    This visit stays at the alternate address above (not the client&apos;s home).
                  </p>
                ) : prefill?.lockClient ? (
                  <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                    Select which patient is being booked for this visit.
                  </p>
                ) : null
              }
            />
          ) : (
            <>
              <Field label="Search client or patient">
                <div ref={combinedDdRef} style={{ position: 'relative' }}>
                  <input
                    className="scheduler-book-input"
                    value={combinedQuery}
                    onChange={(e) => setCombinedQuery(e.target.value)}
                    onFocus={() =>
                      (combinedClientResults.length > 0 || combinedPatientResults.length > 0) &&
                      setShowCombinedDd(true)
                    }
                    placeholder="Pet name, client name (e.g. Nala Wilson), phone, or address…"
                    autoComplete="off"
                  />
                  {combinedSearching && <div className="scheduler-book-hint">Searching…</div>}
                  {showCombinedDd &&
                  (combinedClientResults.length > 0 || combinedPatientResults.length > 0) ? (
                    <ul className="scheduler-book-dropdown">
                      {combinedClientResults.length > 0 ? (
                        <>
                          <li className="scheduler-book-dropdown-section">Clients</li>
                          {combinedClientResults.map((c) => (
                            <li key={`client-${String(c.id)}`}>
                              <button
                                type="button"
                                className="scheduler-book-dd-item"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  void pickClient(c);
                                }}
                              >
                                <span className="scheduler-book-dd-primary">{clientDisplayName(c)}</span>
                                <span className="scheduler-book-dd-secondary">
                                  {clientAddressLine(c) ?? 'Client'}
                                </span>
                              </button>
                            </li>
                          ))}
                        </>
                      ) : null}
                      {combinedPatientResults.length > 0 ? (
                        <>
                          <li className="scheduler-book-dropdown-section">Patients</li>
                          {combinedPatientResults.map((p) => (
                            <li key={`patient-${String(p.id)}`}>
                              <button
                                type="button"
                                className="scheduler-book-dd-item"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  pickPatientFromSearch(p);
                                }}
                              >
                                <span className="scheduler-book-dd-primary">{p.name}</span>
                                <span className="scheduler-book-dd-secondary">
                                  {p.clientLabel ??
                                    (p.clientId != null ? `Client #${p.clientId}` : 'No client on file')}
                                </span>
                              </button>
                            </li>
                          ))}
                        </>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              </Field>

              {selectedClientId ? (
                <BookSelectedClientCard
                  name={selectedClientLabel}
                  address={selectedClientAddress}
                  alerts={selectedClientAlerts}
                  onClear={clearSelectedClient}
                />
              ) : null}
            </>
          )
          ) : null}

          {!perVisitReschedule && !perVisitRoutingBook && showClientSection ? (
          <Field label="Patient" required={requirePatient}>
            {requirePatient && !selectedPatientId?.trim() ? (
              <p className="scheduler-book-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                This appointment type requires a patient before you can book.
              </p>
            ) : null}
            {isRescheduleBook ? (
              <>
                <div className="scheduler-book-selected scheduler-book-patient-name-row">
                  <span className="scheduler-book-selected-value">
                    {selectedPatientLabel || '…'}
                  </span>
                  {selectedPatientId ? (
                    <BookPatientChartButton
                      patientId={selectedPatientId}
                      patientName={selectedPatientLabel || ''}
                      practiceId={practiceId}
                      practiceTz={practiceTz}
                    />
                  ) : null}
                </div>
                <BookPatientAlerts alerts={patientAlertsFor(selectedPatientId)} />
              </>
            ) : loadingClientPets ? (
              <div className="scheduler-book-hint">Loading patients…</div>
            ) : petChoices.length > 0 ? (
              <>
                <select
                className="scheduler-book-input"
                value={selectedPatientId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedPatientId(v || null);
                  const pet = petChoices.find((x) => String(x.id) === v);
                  setSelectedPatientLabel(pet?.name ?? '');
                }}
                required={requirePatient}
              >
                <option value="">Select patient…</option>
                {petChoices.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
                {selectedPatientId ? (
                  <>
                    <div className="scheduler-book-patient-reminders-below">
                      <BookPatientChartButton
                        patientId={selectedPatientId}
                        patientName={selectedPatientLabel || ''}
                        practiceId={practiceId}
                        practiceTz={practiceTz}
                      />
                    </div>
                    <BookPatientAlerts alerts={patientAlertsFor(selectedPatientId)} />
                  </>
                ) : null}
              </>
            ) : selectedPatientId ? (
              <>
                <div className="scheduler-book-selected scheduler-book-patient-name-row">
                  <span className="scheduler-book-selected-value">{selectedPatientLabel}</span>
                  <BookPatientChartButton
                    patientId={selectedPatientId}
                    patientName={selectedPatientLabel || ''}
                    practiceId={practiceId}
                    practiceTz={practiceTz}
                  />
                </div>
                <BookPatientAlerts alerts={patientAlertsFor(selectedPatientId)} />
              </>
            ) : selectedClientId && clientPets.length > 0 ? (
              <div className="scheduler-book-hint muted">
                Every pet on file for this client is already in this visit block on the schedule.
              </div>
            ) : clientHasNoPetsOnFile ? (
              <div className="scheduler-book-hint muted">
                {requirePatient
                  ? 'No patients on file for this client. Add a patient or choose a different appointment type.'
                  : 'No patients on file for this client. You can book without selecting a patient.'}
              </div>
            ) : (
              <div className="scheduler-book-hint muted">
                {selectedClientId
                  ? 'No patients found for this client. Try patient search or update the client record.'
                  : requirePatient
                    ? 'Search for a client or patient below — a patient is required for this appointment type.'
                    : 'Select a client or search for a patient first.'}
              </div>
            )}
          </Field>
          ) : null}

          {lockedRoutingBookFields ? (
            <>
              <div className="scheduler-book-row2">
                <Field label="Provider">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {selectedProvider?.name ?? '…'}
                    </span>
                  </div>
                </Field>
                {isRescheduleBook ? (
                  <Field label="Appointment type">
                    <div className="scheduler-book-selected">
                      <span className="scheduler-book-selected-value">
                        {selectedType?.name || selectedType?.prettyName || '…'}
                      </span>
                    </div>
                  </Field>
                ) : null}
              </div>
              <div className="scheduler-book-row2">
                <Field label="Date">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {startLocal.setZone(practiceTz).toFormat('MM/dd/yyyy')}
                    </span>
                  </div>
                </Field>
                <Field label="Duration">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">{durationMin} min</span>
                  </div>
                </Field>
              </div>
              <div className="scheduler-book-row2">
                <Field label="Start time">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {startLocal.toFormat('h:mm a')}
                    </span>
                  </div>
                </Field>
                <Field label="End time">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {endLocal?.isValid ? endLocal.toFormat('h:mm a') : '…'}
                    </span>
                  </div>
                </Field>
              </div>
              {perVisitReschedule ? (
                <div className="scheduler-book-reschedule-visits">
                  {rescheduleVisitEdits.map((visit, idx) => (
                    <div
                      key={`${visit.appointmentId}-${visit.patientId}`}
                      className="scheduler-book-reschedule-visit"
                    >
                      <div className="scheduler-book-reschedule-visit-meta">
                        <div className="scheduler-book-patient-name-row">
                          <span className="scheduler-book-reschedule-visit-name">
                            {visit.patientName}
                          </span>
                          <BookPatientChartButton
                            patientId={visit.patientId}
                            patientName={visit.patientName}
                            practiceId={practiceId}
                            practiceTz={practiceTz}
                          />
                        </div>
                        <span className="scheduler-book-reschedule-visit-was muted">
                          Was {visit.scheduledTimeLabel}
                        </span>
                        <span className="scheduler-book-reschedule-visit-type muted">
                          {visit.appointmentTypeLabel}
                        </span>
                      </div>
                      <BookPatientAlerts alerts={patientAlertsFor(visit.patientId)} />
                      <label className="scheduler-book-reschedule-visit-desc">
                        <span className="scheduler-book-reschedule-visit-desc-label muted">
                          Description
                        </span>
                        <textarea
                          className="scheduler-book-textarea scheduler-book-textarea--compact"
                          value={visit.description}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRescheduleVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, description: next } : row
                              )
                            );
                          }}
                          rows={3}
                          placeholder="Notes for this visit…"
                        />
                      </label>
                      <label className="scheduler-book-reschedule-visit-desc">
                        <span className="scheduler-book-reschedule-visit-desc-label muted">
                          Staff notes
                        </span>
                        <textarea
                          className="scheduler-book-textarea scheduler-book-textarea--compact"
                          value={visit.instructions}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRescheduleVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, instructions: next } : row
                              )
                            );
                          }}
                          rows={3}
                          placeholder="Internal notes, Scout routing history…"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}
              {perVisitRoutingBook ? (
                <div className="scheduler-book-reschedule-visits">
                  {routingBookVisitEdits.map((visit, idx) => {
                    const visitTypes = routingBookTypesForVisit(
                      visit,
                      routingBookFullAppointmentTypes,
                      noPatientBookAppointmentTypes
                    );
                    const typeSelectValue = resolveRoutingVisitTypeId(
                      visit,
                      routingBookFullAppointmentTypes,
                      noPatientBookAppointmentTypes
                    );
                    return (
                    <div
                      key={visit.isNoPatient ? 'routing-no-patient' : visit.patientId}
                      className={[
                        'scheduler-book-reschedule-visit',
                        visit.isNoPatient ? 'scheduler-book-routing-visit--no-patient' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="scheduler-book-routing-patient-head">
                        <label className="scheduler-book-routing-patient-check">
                          <input
                            type="checkbox"
                            checked={visit.selected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRoutingBookVisitEdits((rows) =>
                                toggleRoutingBookVisitSelected(
                                  rows,
                                  idx,
                                  checked,
                                  routingBookFullAppointmentTypes,
                                  noPatientBookAppointmentTypes
                                )
                              );
                            }}
                          />
                          <span className="scheduler-book-reschedule-visit-name">
                            {visit.patientName}
                          </span>
                        </label>
                        {!visit.isNoPatient ? (
                          <BookPatientChartButton
                            patientId={visit.patientId}
                            patientName={visit.patientName}
                            practiceId={practiceId}
                            practiceTz={practiceTz}
                          />
                        ) : null}
                      </div>
                      {!visit.isNoPatient ? (
                        <BookPatientAlerts alerts={patientAlertsFor(visit.patientId)} />
                      ) : visit.selected ? (
                        <p className="scheduler-book-hint muted" style={{ marginTop: 0, marginBottom: 8 }}>
                          Book without linking a patient. Only appointment types that do not require a
                          patient are shown.
                        </p>
                      ) : null}
                      <Field label="Appointment type">
                        <select
                          className="scheduler-book-input"
                          value={typeSelectValue}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRoutingBookVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, appointmentTypeId: next } : row
                              )
                            );
                          }}
                          required={visit.selected}
                          disabled={!visit.selected}
                        >
                          <option value="">Select type…</option>
                          {visitTypes.map((t) => (
                            <option key={t.id} value={String(t.id)}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        {visit.isNoPatient && visit.selected && visitTypes.length === 0 ? (
                          <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                            No routing appointment types allow booking without a patient.
                          </p>
                        ) : null}
                      </Field>
                      <label className="scheduler-book-reschedule-visit-desc">
                        <span className="scheduler-book-reschedule-visit-desc-label muted">
                          Description (optional)
                        </span>
                        <textarea
                          className="scheduler-book-textarea scheduler-book-textarea--compact"
                          value={visit.description}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRoutingBookVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, description: next } : row
                              )
                            );
                          }}
                          rows={2}
                          placeholder="Notes for this visit…"
                          disabled={!visit.selected}
                        />
                      </label>
                      <label className="scheduler-book-reschedule-visit-desc">
                        <span className="scheduler-book-reschedule-visit-desc-label muted">
                          Staff notes (optional)
                        </span>
                        <textarea
                          className="scheduler-book-textarea scheduler-book-textarea--compact"
                          value={visit.instructions}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRoutingBookVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, instructions: next } : row
                              )
                            );
                          }}
                          rows={3}
                          placeholder="Internal notes — Scout adds routing history on book…"
                          disabled={!visit.selected}
                        />
                      </label>
                    </div>
                    );
                  })}
                </div>
              ) : isRoutingPreviewBook ? (
                <div className="scheduler-book-hint muted">
                  {!selectedClientId
                    ? 'Search for a client above to choose which patients to book.'
                    : loadingClientPets
                      ? 'Loading patients…'
                      : clientHasNoPetsOnFile
                        ? 'No patients on file for this client — you can book without a patient.'
                        : clientPets.length > 0
                          ? 'Every pet on file for this client is already scheduled in this time slot.'
                          : 'No patients on file for this client.'}
                </div>
              ) : null}
            </>
          ) : (
            <>
              {!showAllDayFields ? (
                <>
                  <div className="scheduler-book-row2">
                    <Field label="Date">
                      <input
                        type="date"
                        className="scheduler-book-input"
                        value={dateInputValue}
                        onChange={(e) => {
                          const iso = e.target.value;
                          if (!iso) return;
                          setStartLocal((prev) => {
                            if (!prev?.isValid) return prev;
                            const next = DateTime.fromISO(iso, { zone: practiceTz }).set({
                              hour: prev.hour,
                              minute: prev.minute,
                              second: 0,
                              millisecond: 0,
                            });
                            return next.isValid ? next : prev;
                          });
                        }}
                        disabled={Boolean(prefill?.lockSlotTimes)}
                      />
                    </Field>
                    <Field label="Duration">
                      <select
                        className="scheduler-book-input"
                        value={durationMin}
                        onChange={(e) => {
                          setFormError(null);
                          setDurationMin(Number(e.target.value));
                        }}
                        disabled={Boolean(prefill?.lockSlotTimes)}
                      >
                        {durationOpts.map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="scheduler-book-row2">
                    <Field label="Start time">
                      <input
                        type="time"
                        className="scheduler-book-input"
                        value={timeInputValue}
                        step={300}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v || !startLocal) return;
                          const [hh, mm] = v.split(':').map((x) => parseInt(x, 10));
                          if (Number.isNaN(hh) || Number.isNaN(mm)) return;
                          setStartLocal(
                            startLocal.set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
                          );
                        }}
                        disabled={Boolean(prefill?.lockSlotTimes)}
                      />
                    </Field>
                    <Field label="End time">
                      <input
                        type="time"
                        className="scheduler-book-input"
                        value={endTimeInputValue}
                        step={300}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v || !startLocal?.isValid) return;
                          const [hh, mm] = v.split(':').map((x) => parseInt(x, 10));
                          if (Number.isNaN(hh) || Number.isNaN(mm)) return;
                          const endCandidate = startLocal.set({
                            hour: hh,
                            minute: mm,
                            second: 0,
                            millisecond: 0,
                          });
                          const mins = Math.round(endCandidate.diff(startLocal, 'minutes').minutes);
                          if (mins <= 0) {
                            setFormError('End time must be after start time.');
                            return;
                          }
                          setFormError(null);
                          setDurationMin(mins);
                        }}
                        disabled={Boolean(prefill?.lockSlotTimes)}
                      />
                    </Field>
                  </div>
                </>
              ) : null}
            </>
          )}

          {showBookScheduleOverride && bookOverrideAnchorDate && scheduleOverrideDraft ? (
            <div className="scheduler-book-override-panel">
              <h3 className="scheduler-book-override-heading">
                Schedule override - Create time off for routing
              </h3>
              <ScheduleOverrideDayFields
                anchorDate={bookOverrideAnchorDate}
                endDateInclusive={bookOverrideEndDate}
                values={scheduleOverrideDraft}
                dayOffMode={scheduleOverrideDayOff}
                onValuesChange={(v) => {
                  scheduleOverrideUserTouchedRef.current = true;
                  setScheduleOverrideDraft(v);
                }}
                onDayOffModeChange={(off) => {
                  scheduleOverrideUserTouchedRef.current = true;
                  scheduleOverrideDayOffRef.current = off;
                  setScheduleOverrideDayOff(off);
                  if (!off && scheduleOverrideBaselineRef.current) {
                    setScheduleOverrideDraft({ ...scheduleOverrideBaselineRef.current });
                  }
                }}
                disabled={submitting}
                loading={scheduleOverrideLoading}
                idPrefix="scheduler-book-override"
                showDepotLocations={false}
                providerName={selectedProvider?.name}
              />
            </div>
          ) : showBookScheduleOverride && scheduleOverrideLoading ? (
            <p className="scheduler-book-hint muted">Loading schedule override…</p>
          ) : null}

          {showAdditionalEmployeesField ? (
            <Field label="Also show on provider calendars">
              <div className="scheduler-book-checklist" role="group" aria-label="Additional providers">
                {additionalEmployeeOptions.length > 0 ? (
                  additionalEmployeeOptions.map((emp) => {
                    const checked = additionalEmployeeIds.includes(emp.id);
                    return (
                      <label key={emp.id} className="scheduler-book-checklist-item">
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
                  <div className="scheduler-book-hint muted">
                    No other primary providers are available for this all-day appointment.
                  </div>
                )}
              </div>
              <p className="scheduler-book-hint muted">
                The selected provider stays the owner. Checked providers will also see this all-day appointment on
                their calendars.
              </p>
            </Field>
          ) : null}

          {!perVisitReschedule && !perVisitRoutingBook ? (
            <>
              <Field label="Description (optional)">
                <textarea
                  className="scheduler-book-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Reason for visit…"
                />
              </Field>
              <Field label="Staff notes (optional)">
                <textarea
                  className="scheduler-book-textarea"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  placeholder="Internal notes, Scout routing history…"
                />
              </Field>
            </>
          ) : null}

          {formError ? <div className="scheduler-book-error">{formError}</div> : null}
          {canPreviewOnCalendar ? (
            <p className="scheduler-book-hint muted">
              Review placement on the calendar first — the visit is not saved until you click Book on the red
              preview slot.
            </p>
          ) : null}

          <div className="scheduler-book-actions">
            <button type="button" className="scheduler-book-btn secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="scheduler-book-btn primary"
              disabled={submitting || patientRequiredButMissing}
              title={
                patientRequiredButMissing
                  ? 'Select a patient — this appointment type requires one.'
                  : undefined
              }
            >
              {submitting
                ? isRescheduleBook
                  ? 'Saving…'
                  : 'Booking…'
                : isRescheduleBook
                  ? 'Reschedule appointment'
                  : canPreviewOnCalendar
                    ? 'Preview on calendar'
                    : isRoutingPreviewBook && routingBookSelectedCount > 1
                      ? `Book ${routingBookSelectedCount} appointments`
                      : 'Book appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
