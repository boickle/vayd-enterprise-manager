import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import {
  fetchUnscheduledReminders,
  patchReminder,
  patchReminderOutreachNotes,
  type CareOutreachClientRef,
  type CareOutreachPatientRef,
  type UnscheduledReminder,
} from '../api/careOutreach';
import {
  CareOutreachHouseholdProvider,
  CareOutreachOtherHouseholdPets,
  clearCareOutreachHouseholdCache,
} from '../components/CareOutreachClientHousehold';
import { ClientContactComposeModal } from '../components/ClientContactComposeModal';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { ClientEmailHistoryModal } from '../components/ClientEmailHistoryModal';
import { fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import {
  CareOutreachPetDetailsButton,
  PatientMembershipHeart,
  type CareOutreachPetDetailsReminderLine,
} from '../components/CareOutreachPetDetailsButton';
import {
  buildRoutingForwardBookingIntentFromEntries,
  buildRoutingForwardBookingIntentFromEntry,
  forwardBookingIdsFromRoutingIntent,
  readRoutingForwardBookingIntent,
  writeRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
import { workingNotesFromReminders } from '../utils/reminderWorkingNotes';
import {
  careOutreachClientBookTargetFromBucket,
  careOutreachClientBookTargetWithAdditionalPatients,
  careOutreachRoutingSearchDateRange,
  createForwardBookingsFromCareOutreach,
  careOutreachTargetHasPastDueReminders,
  petNamesFromCareOutreachTarget,
} from '../utils/careOutreachForwardBooking';
import {
  calendarDayDiffFromToday,
  careOutreachChipCountFetchRange,
  careOutreachReminderClientKey,
  careOutreachReminderInPastDue30DayBucket,
  countCareOutreachPriorityChipClients,
  dayDiffsForDueIn21DayBucket,
  type CareOutreachPriorityChipCounts,
} from '../utils/careOutreachPriorityFilters';
import { careOutreachReminderIsHidden } from '../utils/careOutreachReminderVisibility';
import { fetchForwardBookings } from '../api/forwardBooking';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import SchedulingToolsListPagination, {
  paginateSchedulingToolsList,
  schedulingToolsListTotalPages,
  SCHEDULING_TOOLS_LIST_PAGE_SIZE,
} from '../components/SchedulingToolsListPagination';
import {
  cleanupOrphanedListOriginatedForwardBookings,
  filterCareOutreachRemindersForForwardBooking,
  forwardBookingPatientIdsActiveInQueue,
} from '../utils/careOutreachForwardBookingExclude';
import {
  buildAppointmentTypeCatalogFromTypes,
  buildBookedAppointmentMetaMap,
  forwardBookingEntryVisibleOnList,
} from '../utils/forwardBookingListVisibility';
import {
  notifySchedulingToolsNavCountsRefresh,
  SCHEDULING_TOOLS_PAGE_REFRESH_EVENT,
} from '../hooks/useSchedulingToolsNavCounts';
import {
  careOutreachListCacheKey,
  clearCareOutreachListCache,
  readCareOutreachListCache,
  writeCareOutreachListCache,
} from '../utils/careOutreachListCache';
import {
  readCareOutreachFilterSession,
  writeCareOutreachFilterSession,
} from '../utils/careOutreachFilterSession';
import {
  clearCareOutreachFocusClient,
  readCareOutreachFocusClient,
} from '../utils/careOutreachFocusSession';
import {
  clearForwardBookingReturnSession,
  readForwardBookingReturnSession,
  type ForwardBookingReturnSessionV1,
} from '../utils/forwardBookingReturnSession';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import { buildPhoneDialHref, resolveQuoFromLine } from '../utils/quoContact';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import {
  buildCareOutreachSmsMessage,
  careOutreachClientHasSmsPhone,
} from '../utils/careOutreachSmsMessage';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { resolveScheduleLoaderSmsBookedSlot } from '../utils/scheduleLoaderSmsMessage';
import { holdReleaseOptsForAppointment } from '../utils/forwardBookingSmsMessage';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ = practiceTimeZoneOrDefault(undefined);

const NOTES_DEBOUNCE_MS = 750;

type PriorityFilter = 'range' | 'overdue_today' | 'past_due_30' | 'due_21';

const PRIORITY_TABS: { key: PriorityFilter; label: string; title?: string }[] = [
  { key: 'overdue_today', label: 'Newly overdue today' },
  {
    key: 'due_21',
    label: 'Due in 21 days',
    title:
      'Reminders due 21 calendar days from today. If that day is a Friday, Saturday and Sunday are included (21–23 days out).',
  },
  {
    key: 'past_due_30',
    label: 'Past due last 30 days',
    title: 'Unhidden reminders with due dates from the last 30 days through yesterday.',
  },
  { key: 'range', label: 'Choose Date Range', title: 'Choose a custom due date range.' },
];

function formatEmployeeName(emp: UnscheduledReminder['employee']): string {
  if (!emp) return '—';
  const parts: string[] = [];
  if (emp.title) parts.push(String(emp.title));
  if (emp.firstName) parts.push(String(emp.firstName));
  if (emp.lastName) parts.push(String(emp.lastName));
  if (emp.designation) parts.push(String(emp.designation));
  const s = parts.join(' ').trim();
  return s || '—';
}

function extractClient(r: UnscheduledReminder) {
  const p = r.patient;
  const raw = p?.clients?.[0] ?? p?.client ?? null;
  const name =
    raw && (`${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim() || `Client #${raw.id}`);
  const isMember = Boolean(p?.isMember || raw?.isMember);
  const clientPimsId =
    raw?.pimsId != null && String(raw.pimsId).trim() !== '' ? String(raw.pimsId).trim() : null;
  return {
    id: raw?.id ?? null,
    displayName: name || 'Unknown client',
    firstName: raw?.firstName?.trim() || null,
    phone: raw?.phone1?.trim() || null,
    isMember,
    clientPimsId,
  };
}

const evetLinkStyle: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none',
  fontWeight: 'inherit',
};

function EvetInlineLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={evetLinkStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = 'underline';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = 'none';
      }}
    >
      {children}
    </a>
  );
}

function dueSortTime(dueIso: string | null | undefined): number {
  if (!dueIso) return Number.MAX_SAFE_INTEGER;
  const t = new Date(dueIso).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function initialNotes(r: UnscheduledReminder): string {
  const any = r as Record<string, unknown>;
  const snake = typeof any.outreach_notes === 'string' ? any.outreach_notes : null;
  return (r.outreachNotes ?? snake ?? r.notes ?? '') || '';
}

function reminderIsHidden(r: UnscheduledReminder): boolean {
  return careOutreachReminderIsHidden(r);
}

function patientHasListableId(p: UnscheduledReminder['patient']): p is NonNullable<
  UnscheduledReminder['patient']
> & { id: number } {
  if (!p || typeof p !== 'object') return false;
  const id = (p as { id?: unknown }).id;
  return id != null && id !== '' && Number.isFinite(Number(id));
}

function employeeIsPresent(
  e: UnscheduledReminder['employee']
): e is NonNullable<UnscheduledReminder['employee']> {
  if (e == null || typeof e !== 'object') return false;
  return (
    (e as { id?: unknown }).id != null ||
    Boolean((e as { firstName?: string }).firstName) ||
    Boolean((e as { lastName?: string }).lastName)
  );
}

function clientPayloadHasIdentity(c: CareOutreachClientRef | null | undefined): boolean {
  if (!c || typeof c !== 'object') return false;
  if (c.id != null && Number.isFinite(Number(c.id))) return true;
  return Boolean(String(c.firstName ?? '').trim() || String(c.lastName ?? '').trim());
}

/** PIMS PATCH payloads often omit `employee` but include the assigned vet on `patient.primaryProvider`. */
function employeeFromPatientPrimary(
  patient: UnscheduledReminder['patient']
): UnscheduledReminder['employee'] {
  if (!patient || typeof patient !== 'object') return null;
  const raw = (patient as Record<string, unknown>).primaryProvider;
  if (!raw || typeof raw !== 'object') return null;
  if (!employeeIsPresent(raw as UnscheduledReminder['employee'])) return null;
  return raw as UnscheduledReminder['employee'];
}

function reminderAssignedProvider(r: UnscheduledReminder): UnscheduledReminder['employee'] {
  if (employeeIsPresent(r.employee)) return r.employee;
  return employeeFromPatientPrimary(r.patient);
}

function reminderProviderFilterId(r: UnscheduledReminder): string | null {
  const provider = reminderAssignedProvider(r);
  const id = provider?.id;
  if (id != null && Number.isFinite(Number(id))) return String(Number(id));
  return null;
}

type CareOutreachProviderOption = {
  id: string;
  label: string;
};

function buildCareOutreachProviderOptions(
  reminders: readonly UnscheduledReminder[]
): CareOutreachProviderOption[] {
  const byId = new Map<string, string>();
  let hasUnassigned = false;
  for (const r of reminders) {
    const pid = reminderProviderFilterId(r);
    if (pid == null) {
      hasUnassigned = true;
      continue;
    }
    if (!byId.has(pid)) {
      byId.set(pid, formatEmployeeName(reminderAssignedProvider(r)));
    }
  }
  const options = [...byId.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  if (hasUnassigned) {
    options.push({ id: 'unassigned', label: 'Unassigned provider' });
  }
  return options;
}

type CareOutreachClientBucket = {
  clientKey: string;
  clientId: number | null;
  clientPimsId: string | null;
  displayName: string;
  clientFirstName: string | null;
  phone: string | null;
  isMember: boolean;
  patients: Map<
    number,
    {
      patientName: string;
      isMember: boolean;
      membershipName: string | null;
      patientPimsId: string | null;
      reminders: UnscheduledReminder[];
    }
  >;
};

function clientBucketPrimaryProviderId(client: CareOutreachClientBucket): number | undefined {
  for (const pg of client.patients.values()) {
    for (const r of pg.reminders) {
      if (reminderIsHidden(r)) continue;
      const provider = reminderAssignedProvider(r);
      const id = provider?.id;
      if (id != null && Number.isFinite(Number(id))) return Number(id);
    }
  }
  return undefined;
}

function clientBucketQuoFromLine(client: CareOutreachClientBucket): string | null {
  for (const pg of client.patients.values()) {
    for (const r of pg.reminders) {
      const provider = reminderAssignedProvider(r);
      const fromLine = resolveQuoFromLine({ appointmentPrimaryProvider: provider });
      if (fromLine) return fromLine;
    }
  }
  return null;
}

/** Earliest due first (most overdue first), then provider, then service name. */
function compareRemindersForDisplay(a: UnscheduledReminder, b: UnscheduledReminder): number {
  const td = dueSortTime(a.dueDate) - dueSortTime(b.dueDate);
  if (td !== 0) return td;
  const pa = formatEmployeeName(reminderAssignedProvider(a));
  const pb = formatEmployeeName(reminderAssignedProvider(b));
  const pe = pa.localeCompare(pb, undefined, { sensitivity: 'base' });
  if (pe !== 0) return pe;
  return String(a.description ?? '').localeCompare(String(b.description ?? ''), undefined, {
    sensitivity: 'base',
  });
}

function buildOutreachReminderDetailLines(
  reminders: readonly UnscheduledReminder[],
  showHidden: boolean
): CareOutreachPetDetailsReminderLine[] {
  return reminders
    .filter((r) => showHidden || !reminderIsHidden(r))
    .map((r) => {
      const diff = calendarDayDiffFromToday(r.dueDate ?? null);
      return {
        id: r.id,
        description: r.description?.trim() || 'Reminder',
        providerLabel: formatEmployeeName(reminderAssignedProvider(r)),
        dueLabel: formatDisplayDate(r.dueDate ?? undefined),
        overdue: diff !== null && diff < 0,
        hidden: reminderIsHidden(r),
      };
    });
}

/**
 * PATCH often returns patient `{ id, name }` only. The list needs `clients` / `client` for
 * grouping, sort key, and phone — otherwise we show "Unknown client" and the card jumps to Z.
 */
function mergePatientForReminder(
  row: UnscheduledReminder,
  updated: UnscheduledReminder
): CareOutreachPatientRef | null {
  const rp = row.patient;
  const up = updated.patient;

  if (!patientHasListableId(up) && patientHasListableId(rp)) return rp;
  if (!patientHasListableId(up)) return (up ?? rp ?? null) as CareOutreachPatientRef | null;

  if (!patientHasListableId(rp) || Number(rp.id) !== Number(up.id)) {
    return up;
  }

  const mergedClients =
    Array.isArray(up.clients) && up.clients.length > 0 ? up.clients : rp.clients;
  const mergedClient = clientPayloadHasIdentity(up.client) ? up.client : (rp.client ?? null);

  return {
    ...rp,
    ...up,
    clients: mergedClients,
    client: mergedClient,
    isMember: up.isMember ?? rp?.isMember,
    membershipName: up.membershipName ?? rp?.membershipName,
  };
}

/** PATCH responses are often partial; avoid clobbering list/navigation fields with nulls. */
function mergeReminderAfterPatch(
  row: UnscheduledReminder,
  updated: UnscheduledReminder
): UnscheduledReminder {
  const merged: UnscheduledReminder = { ...row, ...updated };
  merged.patient = mergePatientForReminder(row, updated);
  if (employeeIsPresent(updated.employee)) merged.employee = updated.employee;
  else if (employeeIsPresent(row.employee)) merged.employee = row.employee;
  else merged.employee = updated.employee ?? row.employee ?? null;
  if (!employeeIsPresent(merged.employee)) {
    merged.employee =
      employeeFromPatientPrimary(merged.patient) ??
      employeeFromPatientPrimary(row.patient) ??
      employeeFromPatientPrimary(updated.patient) ??
      merged.employee;
  }

  if (updated.dueDate == null && row.dueDate != null) merged.dueDate = row.dueDate;
  if (
    (updated.description == null || String(updated.description).trim() === '') &&
    row.description
  ) {
    merged.description = row.description;
  }
  if (updated.practice == null && row.practice != null) merged.practice = row.practice;

  const uAny = updated as Record<string, unknown>;
  const hiddenFromPatch =
    typeof uAny.is_hidden === 'boolean' ? (uAny.is_hidden as boolean) : undefined;
  const hiddenFromPatch2 = typeof updated.isHidden === 'boolean' ? updated.isHidden : undefined;
  if (hiddenFromPatch !== undefined) merged.isHidden = hiddenFromPatch;
  else if (hiddenFromPatch2 !== undefined) merged.isHidden = hiddenFromPatch2;
  else if (typeof row.isHidden === 'boolean') merged.isHidden = row.isHidden;
  else {
    const rAny = row as Record<string, unknown>;
    if (typeof rAny.is_hidden === 'boolean') merged.isHidden = rAny.is_hidden as boolean;
  }

  return merged;
}

export default function CareOutreachPage() {
  const navigate = useNavigate();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const persistedFilter = useRef(readCareOutreachFilterSession()).current;
  const [dueDateFrom, setDueDateFrom] = useState(
    () => persistedFilter?.dueDateFrom ?? dayjs().format('YYYY-MM-DD'),
  );
  const [dueDateTo, setDueDateTo] = useState(
    () => persistedFilter?.dueDateTo ?? dayjs().add(1, 'month').format('YYYY-MM-DD'),
  );
  const [priority, setPriority] = useState<PriorityFilter>(
    () => persistedFilter?.priority ?? 'overdue_today',
  );
  const [listPage, setListPage] = useState(1);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UnscheduledReminder[]>([]);
  const [priorityChipCounts, setPriorityChipCounts] = useState<CareOutreachPriorityChipCounts>({
    overdue_today: 0,
    due_21: 0,
    past_due_30: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [noteError, setNoteError] = useState<Record<number, string | null>>({});
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const [showHiddenReminders, setShowHiddenReminders] = useState(false);
  const [providerFilterId, setProviderFilterId] = useState<string>(
    () => persistedFilter?.providerFilterId ?? 'all',
  );
  const [bookIncludeOtherPets, setBookIncludeOtherPets] = useState<
    Record<string, Map<number, string>>
  >({});
  const [reminderHiddenSaving, setReminderHiddenSaving] = useState<Record<number, boolean>>({});
  const [reminderHiddenError, setReminderHiddenError] = useState<Record<number, string | null>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [bookingClientKey, setBookingClientKey] = useState<string | null>(null);
  const [postHoldReturn, setPostHoldReturn] = useState<ForwardBookingReturnSessionV1 | null>(null);
  const postHoldReturnHandledRef = useRef(false);
  const [exitingClientKeys, setExitingClientKeys] = useState<Set<string>>(() => new Set());
  const [holdExitSnapshot, setHoldExitSnapshot] = useState<CareOutreachClientBucket | null>(null);
  const exitClientTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [contactOpen, setContactOpen] = useState(false);
  const [contactClientId, setContactClientId] = useState<number | null>(null);
  const [contactClientLabel, setContactClientLabel] = useState('');
  const [contactSmsMessage, setContactSmsMessage] = useState('');
  const [contactProviderLastName, setContactProviderLastName] = useState<string | null>(null);
  const [contactCanText, setContactCanText] = useState(false);
  const [smsFromLine, setSmsFromLine] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [emailHistoryClientId, setEmailHistoryClientId] = useState<number | null>(null);
  const [emailHistoryClientLabel, setEmailHistoryClientLabel] = useState('');
  const { allowed: canAccessGmailInbox } = useGmailInboxAccess();
  const [focusClientKey, setFocusClientKey] = useState<string | null>(() =>
    readCareOutreachFocusClient(),
  );
  const [highlightClientKey, setHighlightClientKey] = useState<string | null>(null);
  const clientSectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** API fetch window. Priority tabs filter client-side; use the same wide span as chip counts so list and badges stay aligned. */
  const effectiveDueRange = useMemo(() => {
    if (priority === 'range') {
      return { from: dueDateFrom, to: dueDateTo };
    }
    return careOutreachChipCountFetchRange();
  }, [priority, dueDateFrom, dueDateTo]);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const cacheKey = careOutreachListCacheKey(priority, effectiveDueRange.from, effectiveDueRange.to);
    const cached = opts?.force ? null : readCareOutreachListCache(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setPriorityChipCounts(cached.priorityChipCounts);
      const drafts: Record<number, string> = {};
      for (const r of cached.rows) {
        drafts[r.id] = initialNotes(r);
      }
      setNoteDrafts(drafts);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const chipCountRange = careOutreachChipCountFetchRange();
      const [types, forwardBookings, rawList, chipCountRawList] = await Promise.all([
        fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }),
        fetchForwardBookings({ practiceId: PRACTICE_ID, limit: 2000, includeRemoved: true }),
        fetchUnscheduledReminders({
          dueDateFrom: effectiveDueRange.from,
          dueDateTo: effectiveDueRange.to,
          practiceId: PRACTICE_ID,
          limit: 2000,
        }),
        priority === 'range'
          ? fetchUnscheduledReminders({
              dueDateFrom: chipCountRange.from,
              dueDateTo: chipCountRange.to,
              practiceId: PRACTICE_ID,
              limit: 2000,
            })
          : Promise.resolve(null),
      ]);
      const catalog = buildAppointmentTypeCatalogFromTypes(types);
      const visibleForwardBookings = forwardBookings.filter((r) => forwardBookingEntryVisibleOnList(r));
      const routingIntent = readRoutingForwardBookingIntent();
      const activeRoutingForwardBookingIds =
        routingIntent?.workspaceActive &&
        (routingIntent.origin === 'care_outreach' ||
          routingIntent.origin === 'schedule_loader' ||
          routingIntent.origin === 'waitlist')
          ? new Set(forwardBookingIdsFromRoutingIntent(routingIntent))
          : undefined;
      void cleanupOrphanedListOriginatedForwardBookings(
        visibleForwardBookings,
        PRACTICE_ID,
        activeRoutingForwardBookingIds,
      );
      const metaMap = await buildBookedAppointmentMetaMap(visibleForwardBookings, PRACTICE_ID, catalog);
      const blockedPatientIds = forwardBookingPatientIdsActiveInQueue(
        visibleForwardBookings,
        practiceTz,
        metaMap,
        catalog,
        { activeRoutingForwardBookingIds },
      );
      const afterForwardBookingFilter = filterCareOutreachRemindersForForwardBooking(
        rawList,
        blockedPatientIds,
      );
      const list = afterForwardBookingFilter;
      const chipCountSource = chipCountRawList
        ? filterCareOutreachRemindersForForwardBooking(chipCountRawList, blockedPatientIds)
        : list;
      const nextChipCounts = countCareOutreachPriorityChipClients(chipCountSource);
      setRows(list);
      setPriorityChipCounts(nextChipCounts);
      writeCareOutreachListCache({
        rows: list,
        priorityChipCounts: nextChipCounts,
        cacheKey,
        cachedAt: Date.now(),
      });
      const drafts: Record<number, string> = {};
      for (const r of list) {
        drafts[r.id] = initialNotes(r);
      }
      setNoteDrafts(drafts);
      setReminderHiddenSaving({});
      setReminderHiddenError({});
      setBookIncludeOtherPets({});
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to load unscheduled reminders';
      setError(String(msg));
      if (!cached) setRows([]);
    } finally {
      setLoading(false);
      clearCareOutreachHouseholdCache();
    }
  }, [effectiveDueRange.from, effectiveDueRange.to, priority, practiceTz]);

  useEffect(() => {
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setSmsFromLine(phone);
    });
  }, []);

  const beginClientExit = useCallback((clientKey: string) => {
    setExitingClientKeys((prev) => new Set(prev).add(clientKey));
    const existing = exitClientTimers.current.get(clientKey);
    if (existing) window.clearTimeout(existing);
    const timer = setTimeout(() => {
      exitClientTimers.current.delete(clientKey);
      setExitingClientKeys((prev) => {
        const next = new Set(prev);
        next.delete(clientKey);
        return next;
      });
      setHoldExitSnapshot((snap) => (snap?.clientKey === clientKey ? null : snap));
    }, 1100);
    exitClientTimers.current.set(clientKey, timer);
  }, []);

  useEffect(() => {
    return () => {
      for (const t of exitClientTimers.current.values()) window.clearTimeout(t);
      exitClientTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    const pending = readForwardBookingReturnSession();
    if (!pending || pending.returnOrigin !== 'care_outreach') return;
    postHoldReturnHandledRef.current = false;
    setPostHoldReturn(pending);
  }, []);

  useEffect(() => {
    writeCareOutreachFilterSession({ priority, dueDateFrom, dueDateTo, providerFilterId });
  }, [priority, dueDateFrom, dueDateTo, providerFilterId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onPageRefresh = () => {
      void load({ force: true });
    };
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
  }, [load]);

  const filteredByPriority = useMemo(() => {
    const todayStart = dayjs().startOf('day');
    const due21Allowed = dayDiffsForDueIn21DayBucket(todayStart);
    return rows.filter((r) => {
      if (priority === 'range') return true;
      const diff = calendarDayDiffFromToday(r.dueDate ?? null);
      if (diff === null) return false;
      if (priority === 'overdue_today') return diff === -1;
      if (priority === 'past_due_30') return careOutreachReminderInPastDue30DayBucket(r, todayStart);
      if (priority === 'due_21') return due21Allowed.has(diff);
      return true;
    });
  }, [rows, priority]);

  const filteredByHidden = useMemo(
    () => filteredByPriority.filter((r) => showHiddenReminders || !reminderIsHidden(r)),
    [filteredByPriority, showHiddenReminders]
  );

  const providerOptions = useMemo(
    () => buildCareOutreachProviderOptions(filteredByHidden),
    [filteredByHidden]
  );

  useEffect(() => {
    if (providerFilterId === 'all') return;
    // Don't clear a (possibly restored) provider until the list has loaded and options exist,
    // otherwise the empty initial render would wipe the remembered selection.
    if (loading || providerOptions.length === 0) return;
    const valid =
      providerFilterId === 'unassigned'
        ? providerOptions.some((o) => o.id === 'unassigned')
        : providerOptions.some((o) => o.id === providerFilterId);
    if (!valid) setProviderFilterId('all');
  }, [providerFilterId, providerOptions, loading]);

  const filteredByProvider = useMemo(() => {
    if (providerFilterId === 'all') return filteredByHidden;
    return filteredByHidden.filter((r) => {
      const pid = reminderProviderFilterId(r);
      if (providerFilterId === 'unassigned') return pid == null;
      return pid === providerFilterId;
    });
  }, [filteredByHidden, providerFilterId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByProvider;
    return filteredByProvider.filter((r) => {
      const c = extractClient(r);
      const pet = r.patient?.name ?? '';
      const desc = r.description ?? '';
      const prov = formatEmployeeName(reminderAssignedProvider(r)).toLowerCase();
      const notes = (noteDrafts[r.id] ?? '').toLowerCase();
      const hay = [c.displayName, c.phone ?? '', pet, desc, prov, notes].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [filteredByProvider, search, noteDrafts]);

  const sortedForDisplay = useMemo(() => {
    return [...filtered].sort(compareRemindersForDisplay);
  }, [filtered]);

  const grouped = useMemo(() => {
    const clients = new Map<string, CareOutreachClientBucket>();
    for (const r of sortedForDisplay) {
      const c = extractClient(r);
      const clientKey = careOutreachReminderClientKey(r);
      let bucket = clients.get(clientKey);
      if (!bucket) {
        bucket = {
          clientKey,
          clientId: c.id,
          clientPimsId: c.clientPimsId,
          displayName: c.displayName,
          clientFirstName: c.firstName,
          phone: c.phone,
          isMember: c.isMember,
          patients: new Map(),
        };
        clients.set(clientKey, bucket);
      }
      if (bucket.clientPimsId == null && c.clientPimsId) {
        bucket.clientPimsId = c.clientPimsId;
      }
      const pid = r.patient?.id;
      if (pid == null) continue;
      let pg = bucket.patients.get(pid);
      if (!pg) {
        const patientPimsId =
          r.patient?.pimsId != null && String(r.patient.pimsId).trim() !== ''
            ? String(r.patient.pimsId).trim()
            : null;
        pg = {
          patientName: r.patient?.name?.trim() || `Patient #${pid}`,
          isMember: Boolean(r.patient?.isMember || bucket.isMember),
          membershipName: r.patient?.membershipName?.trim() || null,
          patientPimsId,
          reminders: [],
        };
        bucket.patients.set(pid, pg);
      }
      if (pg.patientPimsId == null) {
        const nextPims =
          r.patient?.pimsId != null && String(r.patient.pimsId).trim() !== ''
            ? String(r.patient.pimsId).trim()
            : null;
        if (nextPims) pg.patientPimsId = nextPims;
      }
      if (!pg.membershipName && r.patient?.membershipName?.trim()) {
        pg.membershipName = r.patient.membershipName.trim();
      }
      if (!pg.isMember && r.patient?.isMember) {
        pg.isMember = true;
      }
      pg.reminders.push(r);
    }
    for (const b of clients.values()) {
      for (const pg of b.patients.values()) {
        pg.reminders.sort((a, b) => dueSortTime(a.dueDate) - dueSortTime(b.dueDate));
      }
    }
    const list = Array.from(clients.values());
    list.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );
    for (const b of list) {
      const parr = Array.from(b.patients.entries()).sort(([, pa], [, pb]) =>
        pa.patientName.localeCompare(pb.patientName, undefined, { sensitivity: 'base' })
      );
      b.patients = new Map(parr);
    }
    if (
      holdExitSnapshot &&
      exitingClientKeys.has(holdExitSnapshot.clientKey) &&
      !clients.has(holdExitSnapshot.clientKey)
    ) {
      list.push(holdExitSnapshot);
      list.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
      );
    }
    return list;
  }, [sortedForDisplay, holdExitSnapshot, exitingClientKeys]);

  useEffect(() => {
    if (!postHoldReturn || loading || postHoldReturnHandledRef.current) return;

    const pending = postHoldReturn;
    const clientKey = pending.careOutreachClientKey?.trim();
    const isHold = pending.targetWorkflowTab === 'onHold';

    postHoldReturnHandledRef.current = true;
    clearForwardBookingReturnSession();
    setPostHoldReturn(null);

    if (!clientKey || !isHold) return;

    if (pending.careOutreachClientDisplayName?.trim()) {
      setHoldExitSnapshot({
        clientKey,
        clientId: pending.careOutreachClientId ?? null,
        clientPimsId: null,
        displayName: pending.careOutreachClientDisplayName.trim(),
        clientFirstName: null,
        phone: null,
        isMember: false,
        patients: new Map(),
      });
    }

    beginClientExit(clientKey);

    void (async () => {
      const clientId = pending.careOutreachClientId;
      if (clientId == null) return;

      const phone = pending.careOutreachClientPhone;
      const canText = careOutreachClientHasSmsPhone(phone);
      if (!canText && !canAccessGmailInbox) return;

      const bookedSlot = await resolveScheduleLoaderSmsBookedSlot(
        pending.bookedAppointmentId,
        PRACTICE_ID,
        practiceTz,
        {
          startIso: pending.bookedAppointmentStart,
          endIso: pending.bookedAppointmentEnd ?? pending.bookedAppointmentStart,
        },
      );

      const petNames =
        pending.careOutreachPetNames?.map((name) => name.trim()).filter(Boolean) ?? [];

      setContactCanText(canText);
      setContactProviderLastName(pending.careOutreachProviderLastName ?? null);
      setContactSmsMessage(
        buildCareOutreachSmsMessage({
          clientFirstName: pending.careOutreachClientFirstName,
          clientDisplayName: pending.careOutreachClientDisplayName,
          petNames,
          providerLastName: pending.careOutreachProviderLastName,
          anyPastDue: pending.careOutreachAnyPastDue === true,
          ...(bookedSlot ? { bookedSlot } : {}),
          holdRelease: holdReleaseOptsForAppointment(
            pending.bookedAppointmentStart,
            practiceTz,
          ),
        }),
      );
      setContactClientId(clientId);
      setContactClientLabel(pending.careOutreachClientDisplayName?.trim() || 'Client');
      setContactOpen(true);
    })();
  }, [postHoldReturn, loading, beginClientExit, practiceTz, canAccessGmailInbox]);

  const listTotalPages = useMemo(
    () => schedulingToolsListTotalPages(grouped.length),
    [grouped.length],
  );

  const groupedForDisplay = useMemo(
    () => paginateSchedulingToolsList(grouped, listPage),
    [grouped, listPage],
  );

  useEffect(() => {
    setListPage(1);
  }, [search, providerFilterId, priority]);

  useEffect(() => {
    if (listPage > listTotalPages) {
      setListPage(listTotalPages);
    }
  }, [listPage, listTotalPages]);

  useEffect(() => {
    clearCareOutreachFocusClient();
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // After returning from a routed/offered client, scroll that client back into view (and
  // briefly highlight it) instead of leaving the user at the top of the list.
  useEffect(() => {
    if (!focusClientKey || loading) return;
    const index = grouped.findIndex((c) => c.clientKey === focusClientKey);
    if (index < 0) {
      setFocusClientKey(null);
      return;
    }
    const targetPage = Math.floor(index / SCHEDULING_TOOLS_LIST_PAGE_SIZE) + 1;
    if (listPage !== targetPage) {
      setListPage(targetPage);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const el = clientSectionRefs.current.get(focusClientKey);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightClientKey(focusClientKey);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightClientKey(null), 2600);
      }
      setFocusClientKey(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [focusClientKey, loading, grouped, listPage]);

  const changeListPage = useCallback((page: number) => {
    setListPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const closeContactModal = useCallback(() => {
    setContactOpen(false);
    setContactClientId(null);
    setContactClientLabel('');
    setContactSmsMessage('');
    setContactProviderLastName(null);
    setContactCanText(false);
  }, []);

  const listPaginationBar = (
    <SchedulingToolsListPagination
      listPage={listPage}
      totalItems={grouped.length}
      onPageChange={changeListPage}
      itemLabel="clients"
    />
  );

  const flushSave = useCallback(async (reminderId: number, value: string) => {
    setNoteSaving((s) => ({ ...s, [reminderId]: true }));
    setNoteError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminderOutreachNotes(reminderId, value);
      let mergedForDraft: UnscheduledReminder | null = null;
      setRows((prev) => {
        const row = prev.find(
          (r) => Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
        );
        if (!row) return prev;
        mergedForDraft = mergeReminderAfterPatch(row, updated);
        return prev.map((r) =>
          Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
            ? mergedForDraft!
            : r
        );
      });
      if (mergedForDraft) {
        const draftSource = mergedForDraft;
        setNoteDrafts((d) => ({ ...d, [reminderId]: initialNotes(draftSource) }));
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not save notes';
      setNoteError((er) => ({ ...er, [reminderId]: String(msg) }));
    } finally {
      setNoteSaving((s) => ({ ...s, [reminderId]: false }));
    }
  }, []);

  const scheduleSave = useCallback(
    (reminderId: number, value: string) => {
      const prevTimer = debounceTimers.current.get(reminderId);
      if (prevTimer) clearTimeout(prevTimer);
      const t = setTimeout(() => {
        debounceTimers.current.delete(reminderId);
        void flushSave(reminderId, value);
      }, NOTES_DEBOUNCE_MS);
      debounceTimers.current.set(reminderId, t);
    },
    [flushSave]
  );

  useEffect(() => {
    const timerMap = debounceTimers.current;
    return () => {
      for (const t of timerMap.values()) {
        clearTimeout(t);
      }
      timerMap.clear();
    };
  }, []);

  function onNotesChange(reminderId: number, value: string) {
    setNoteDrafts((d) => ({ ...d, [reminderId]: value }));
    scheduleSave(reminderId, value);
  }

  async function onNotesBlur(reminderId: number, valueFromDom: string) {
    const t = debounceTimers.current.get(reminderId);
    if (t) {
      clearTimeout(t);
      debounceTimers.current.delete(reminderId);
    }
    const value = valueFromDom;
    setNoteDrafts((d) => ({ ...d, [reminderId]: value }));
    const server = rows.find(
      (r) => Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
    );
    const serverVal = server ? initialNotes(server) : '';
    if (value !== serverVal) {
      await flushSave(reminderId, value);
    }
  }

  const setReminderHidden = useCallback(async (reminderId: number, isHidden: boolean) => {
    setReminderHiddenSaving((s) => ({ ...s, [reminderId]: true }));
    setReminderHiddenError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminder(reminderId, { isHidden });
      setRows((prev) => {
        const row = prev.find(
          (r) => Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
        );
        if (!row) return prev;
        const mergedRow = mergeReminderAfterPatch(row, updated);
        setNoteDrafts((d) => ({ ...d, [reminderId]: initialNotes(mergedRow) }));
        return prev.map((r) =>
          Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId) ? mergedRow : r
        );
      });
      notifySchedulingToolsNavCountsRefresh();
      clearCareOutreachListCache();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not update reminder';
      setReminderHiddenError((er) => ({ ...er, [reminderId]: String(msg) }));
    } finally {
      setReminderHiddenSaving((s) => ({ ...s, [reminderId]: false }));
    }
  }, []);

  const toggleBookIncludeOtherPet = useCallback(
    (clientKey: string, patientId: number, patientName: string, included: boolean) => {
      setBookIncludeOtherPets((prev) => {
        const next = { ...prev };
        const map = new Map(next[clientKey] ?? []);
        if (included) map.set(patientId, patientName);
        else map.delete(patientId);
        if (map.size === 0) delete next[clientKey];
        else next[clientKey] = map;
        return next;
      });
    },
    []
  );

  const bookTargetForClient = useCallback(
    (client: CareOutreachClientBucket) => {
      const providerId = clientBucketPrimaryProviderId(client);
      const base = careOutreachClientBookTargetFromBucket(
        client.clientId,
        client.displayName,
        client.phone,
        client.patients,
        providerId
      );
      const extrasMap = bookIncludeOtherPets[client.clientKey];
      if (!extrasMap?.size || client.clientId == null) return base;
      const additional = [...extrasMap.entries()].map(([patientId, patientName]) => ({
        patientId,
        patientName,
      }));
      return careOutreachClientBookTargetWithAdditionalPatients(
        base,
        client.clientId,
        client.displayName,
        client.phone,
        providerId,
        additional
      );
    },
    [bookIncludeOtherPets]
  );

  const onBookClient = useCallback(
    async (client: CareOutreachClientBucket) => {
      setActionError(null);
      const target = bookTargetForClient(client);
      if (!target) {
        setActionError('No pets selected to route for this client.');
        return;
      }
      setBookingClientKey(client.clientKey);
      try {
        const entries = await createForwardBookingsFromCareOutreach(target, PRACTICE_ID);
        const anchor = entries[0];
        if (!anchor) throw new Error('Could not create forward booking rows.');
        const petNames = petNamesFromCareOutreachTarget(target);
        const intent =
          entries.length > 1
            ? buildRoutingForwardBookingIntentFromEntries(anchor, entries)
            : buildRoutingForwardBookingIntentFromEntry(anchor);
        if (!intent) throw new Error('This client is missing data needed for routing.');
        const routingSearch = careOutreachRoutingSearchDateRange(PRACTICE_TZ);
        const outreachNotes = workingNotesFromReminders(
          target.patients.flatMap((p) => p.reminders),
        );
        writeRoutingForwardBookingIntent({
          ...intent,
          reminderOutreachNotes: outreachNotes,
          returnToListAfterBook: true,
          workspaceActive: true,
          origin: 'care_outreach',
          careOutreachPetNames: petNames,
          careOutreachAnyPastDue: careOutreachTargetHasPastDueReminders(target),
          careOutreachClientKey: client.clientKey,
          careOutreachClientDisplayName: client.displayName,
          careOutreachClientId: client.clientId ?? null,
          careOutreachClientPhone: client.phone,
          careOutreachClientFirstName: client.clientFirstName,
          routingSearch,
        });
        navigate('/schedule/routing');
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not start routing.';
        setActionError(String(msg));
      } finally {
        setBookingClientKey(null);
      }
    },
    [bookTargetForClient, navigate]
  );

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Care outreach
      </h2>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        Clients and patients who still need preventive or recommended care scheduled with their
        assigned provider. A pet is removed once they have a visit on the calendar today or
        later (even if reminders are still past due). Other pets in the same household stay on
        the list. Use Route to send a visit (hold or booked) into forward booking.
      </p>

      {actionError ? (
        <p className="settings-muted" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {actionError}
        </p>
      ) : null}

      <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span className="settings-muted" style={{ alignSelf: 'center', marginRight: 4 }}>
          Daily priorities
        </span>
        {PRIORITY_TABS.map(({ key, label, title }) => (
          <button
            key={key}
            type="button"
            className={`settings-tab${priority === key ? ' active' : ''}`}
            style={{
              marginBottom: 0,
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
            title={title}
            onClick={() => setPriority(key)}
          >
            <span>{label}</span>
            {key !== 'range' ? (
              <span
                className="settings-muted"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1,
                  opacity: priority === key ? 1 : 0.85,
                }}
                aria-hidden
              >
                ({priorityChipCounts[key]})
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {priority === 'range' ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <span className="settings-muted" style={{ marginRight: 4 }}>
            Due between
          </span>
          <input
            type="date"
            value={dueDateFrom}
            onChange={(e) => setDueDateFrom(e.target.value)}
            className="settings-input"
            style={{ maxWidth: 160 }}
          />
          <span className="settings-muted">and</span>
          <input
            type="date"
            value={dueDateTo}
            onChange={(e) => setDueDateTo(e.target.value)}
            className="settings-input"
            style={{ maxWidth: 160 }}
          />
          <button
            type="button"
            className="btn primary"
            onClick={() => void load({ force: true })}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      ) : null}

      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: '0 1 220px', minWidth: 180 }}>
          <label
            htmlFor="care-outreach-provider-filter"
            className="settings-muted"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
          >
            Provider
          </label>
          <select
            id="care-outreach-provider-filter"
            className="settings-input"
            value={providerFilterId}
            onChange={(e) => setProviderFilterId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="all">All</option>
            {providerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <label
            htmlFor="care-outreach-search"
            className="settings-muted"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
          >
            Search
          </label>
          <input
            id="care-outreach-search"
            type="search"
            className="settings-input"
            placeholder="Client, patient, phone, service, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search outreach list"
            style={{ width: '100%' }}
          />
        </div>
        <label
          className="settings-muted"
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <input
            type="checkbox"
            checked={showHiddenReminders}
            onChange={(e) => setShowHiddenReminders(e.target.checked)}
          />
          <span>Show hidden reminders</span>
        </label>
      </div>

      {error && (
        <p className="settings-muted" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </p>
      )}

      {loading && rows.length === 0 ? (
        <div className="settings-loading">
          <span className="settings-spinner" aria-hidden />
          Loading reminders…
        </div>
      ) : grouped.length === 0 ? (
        <p className="settings-muted">No reminders match the current filters.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {listPaginationBar}
          {groupedForDisplay.map((client) => {
            const rowExiting = exitingClientKeys.has(client.clientKey);
            return (
            <CareOutreachHouseholdProvider
              key={client.clientKey}
              clientId={client.clientId}
              practiceTz={practiceTz}
              outreachPatientIds={Array.from(client.patients.keys())}
            >
            <section
              ref={(el) => {
                if (el) clientSectionRefs.current.set(client.clientKey, el);
                else clientSectionRefs.current.delete(client.clientKey);
              }}
              className={
                rowExiting
                  ? 'appt-request-row--exiting appt-request-row--exiting-onHold'
                  : undefined
              }
              style={{
                border:
                  client.clientKey === highlightClientKey
                    ? '2px solid var(--accent-strong, #2563eb)'
                    : '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--panel, #fff)',
                position: rowExiting ? 'relative' : undefined,
                boxShadow:
                  client.clientKey === highlightClientKey
                    ? '0 0 0 3px rgba(37, 99, 235, 0.15)'
                    : undefined,
                transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
              }}
            >
              {rowExiting ? (
                <div className="appt-request-row-exit-badge" aria-live="polite">
                  Moved to hold
                </div>
              ) : null}
              <header
                style={{
                  padding: '12px 16px',
                  background: 'var(--subtle-bg, #f4f6f8)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
                <strong style={{ fontSize: '1.05rem' }}>
                  {client.clientPimsId ? (
                    <EvetInlineLink href={evetClientLink(client.clientPimsId)}>
                      {client.displayName}
                    </EvetInlineLink>
                  ) : (
                    client.displayName
                  )}
                </strong>
                {client.phone ? (
                  <a
                    href={buildPhoneDialHref(client.phone, {
                      fromLine: clientBucketQuoFromLine(client),
                    })}
                    style={{ fontWeight: 600, color: 'var(--accent-strong, #2563eb)' }}
                  >
                    {client.phone}
                  </a>
                ) : (
                  <span className="settings-muted">No phone on file</span>
                )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={client.clientId == null}
                    onClick={() => {
                      if (client.clientId == null) return;
                      setEmailHistoryClientId(client.clientId);
                      setEmailHistoryClientLabel(client.displayName);
                    }}
                  >
                    Email history
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={client.clientId == null}
                    onClick={() => {
                      if (client.clientId == null) return;
                      setMessagesClientId(client.clientId);
                      setMessagesClientLabel(client.displayName);
                    }}
                  >
                    Messages history
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={bookingClientKey === client.clientKey || !bookTargetForClient(client)}
                    onClick={() => void onBookClient(client)}
                  >
                    {bookingClientKey === client.clientKey ? 'Routing…' : 'Route'}
                  </button>
                </div>
              </header>
              <div style={{ padding: '8px 0' }}>
                {Array.from(client.patients.entries()).map(([patientId, pg]) => (
                  <div key={patientId} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        padding: '8px 16px 4px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '8px 12px',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {pg.patientPimsId ? (
                          <EvetInlineLink href={evetPatientLink(pg.patientPimsId)}>
                            {pg.patientName}
                          </EvetInlineLink>
                        ) : (
                          pg.patientName
                        )}
                        {pg.isMember ? (
                          <PatientMembershipHeart membershipName={pg.membershipName} />
                        ) : null}
                      </span>
                      <CareOutreachPetDetailsButton
                        patientId={patientId}
                        patientName={pg.patientName}
                        practiceTz={practiceTz}
                        isMember={pg.isMember}
                        membershipName={pg.membershipName}
                        outreachReminders={buildOutreachReminderDetailLines(
                          pg.reminders,
                          showHiddenReminders
                        )}
                      />
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: 14,
                        }}
                      >
                        <thead>
                          <tr className="settings-muted" style={{ textAlign: 'left' }}>
                            <th style={{ padding: '6px 16px', fontWeight: 600 }}>Service</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Provider</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Due</th>
                            <th style={{ padding: '6px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Visibility
                            </th>
                            <th style={{ padding: '6px 16px', fontWeight: 600, minWidth: 220 }}>
                              Contact log
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pg.reminders.map((r) => {
                            const diff = calendarDayDiffFromToday(r.dueDate ?? null);
                            const overdue = diff !== null && diff < 0;
                            const hidden = reminderIsHidden(r);
                            return (
                              <tr
                                key={r.id}
                                style={{
                                  borderTop: '1px solid var(--border)',
                                  background: overdue ? '#fff5f5' : undefined,
                                }}
                              >
                                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                    <span>{r.description}</span>
                                    {hidden && showHiddenReminders && (
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          color: '#92400e',
                                          background: '#fef3c7',
                                          border: '1px solid #fbbf24',
                                          borderRadius: 4,
                                          padding: '2px 6px',
                                        }}
                                      >
                                        Hidden
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td
                                  style={{
                                    padding: '10px 8px',
                                    verticalAlign: 'top',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatEmployeeName(reminderAssignedProvider(r))}
                                </td>
                                <td
                                  style={{
                                    padding: '10px 8px',
                                    verticalAlign: 'top',
                                    fontWeight: overdue ? 700 : 400,
                                    color: overdue ? '#b91c1c' : undefined,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatDisplayDate(r.dueDate ?? undefined)}
                                </td>
                                <td style={{ padding: '10px 12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={Boolean(reminderHiddenSaving[r.id])}
                                    onClick={() => void setReminderHidden(r.id, !hidden)}
                                    style={{
                                      fontSize: 13,
                                      padding: '6px 12px',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {reminderHiddenSaving[r.id]
                                      ? 'Saving…'
                                      : hidden
                                        ? 'Unhide'
                                        : 'Hide'}
                                  </button>
                                  {reminderHiddenError[r.id] && (
                                    <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 6, maxWidth: 160 }}>
                                      {reminderHiddenError[r.id]}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                                  <textarea
                                    className="settings-input"
                                    rows={2}
                                    style={{
                                      width: '100%',
                                      minWidth: 200,
                                      resize: 'vertical',
                                      fontFamily: 'inherit',
                                      fontSize: 13,
                                    }}
                                    value={noteDrafts[r.id] ?? initialNotes(r)}
                                    onChange={(e) => onNotesChange(r.id, e.target.value)}
                                    onBlur={(e) => void onNotesBlur(r.id, e.currentTarget.value)}
                                    placeholder="e.g. 11/14/2026 DF – LMOM"
                                    aria-label={`Contact log for ${r.description}`}
                                  />
                                  {noteSaving[r.id] && (
                                    <span className="settings-muted" style={{ fontSize: 12 }}>
                                      Saving…
                                    </span>
                                  )}
                                  {noteError[r.id] && (
                                    <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>
                                      {noteError[r.id]}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <CareOutreachOtherHouseholdPets
                  outreachPatientIds={Array.from(client.patients.keys())}
                  selectedPatientIds={
                    new Set(bookIncludeOtherPets[client.clientKey]?.keys() ?? [])
                  }
                  onToggleIncludeInBook={(patientId, patientName, included) =>
                    toggleBookIncludeOtherPet(client.clientKey, patientId, patientName, included)
                  }
                  practiceTz={practiceTz}
                />
              </div>
            </section>
            </CareOutreachHouseholdProvider>
          );
          })}
          {listPaginationBar}
        </div>
      )}

      {contactOpen && contactClientId != null ? (
        <ClientContactComposeModal
          open
          clientId={contactClientId}
          clientLabel={contactClientLabel}
          initialSmsMessage={contactSmsMessage}
          providerLastName={contactProviderLastName}
          canText={contactCanText}
          onClose={closeContactModal}
          smsFromLine={smsFromLine}
          smsSource="care_outreach"
          onOpenMessagesHistory={() => {
            setMessagesClientId(contactClientId);
            setMessagesClientLabel(contactClientLabel);
          }}
          onOpenEmailHistory={() => {
            setEmailHistoryClientId(contactClientId);
            setEmailHistoryClientLabel(contactClientLabel);
          }}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesClientId != null}
        clientId={messagesClientId}
        clientLabel={messagesClientLabel}
        openPhoneLine={smsFromLine}
        onClose={() => {
          setMessagesClientId(null);
          setMessagesClientLabel('');
        }}
      />

      <ClientEmailHistoryModal
        open={emailHistoryClientId != null}
        clientId={emailHistoryClientId}
        clientLabel={emailHistoryClientLabel}
        onClose={() => {
          setEmailHistoryClientId(null);
          setEmailHistoryClientLabel('');
        }}
      />
    </div>
  );
}
