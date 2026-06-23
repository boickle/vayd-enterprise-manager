import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  fetchForwardBookings,
  finishForwardBookingFollowUp,
  clearForwardBookingBookAfterDate,
  patchForwardBooking,
  removeForwardBooking,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import { ForwardBookingManualCompleteModal } from '../components/ForwardBookingManualCompleteModal';
import { ForwardBookingBookLaterModal } from '../components/ForwardBookingBookLaterModal';
import { CreateForwardBookingModal } from '../components/CreateForwardBookingModal';
import { ensureForwardBookingServerLink } from '../utils/forwardBookingBookComplete';
import {
  FORWARD_BOOKING_CREATE_APPOINTMENT_PARAM,
  FORWARD_BOOKING_CREATE_NEW_PARAM,
  FORWARD_BOOKING_CREATE_PATIENT_PARAM,
  FORWARD_BOOKING_CREATE_RETURN_TO_PARAM,
  sanitizeForwardBookingReturnTo,
  type CreateForwardBookingPrefill,
} from '../utils/forwardBookingCreateLink';
import { sendClientSms, fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import {
  buildRoutingForwardBookingIntentFromEntries,
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
import {
  forwardBookingEntryIsSameTargetGroupBookLeader,
  forwardBookingGroupBookButtonLabel,
  forwardBookingHouseholdGroupBookableEntries,
  forwardBookingSameTargetBookablePeers,
  groupForwardBookingHouseholdEntriesByTargetDate,
} from '../utils/forwardBookingHousehold';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import { buildCareOutreachSmsMessage } from '../utils/careOutreachSmsMessage';
import {
  forwardBookingEntrySourceChip,
  forwardBookingSourceChipColors,
  forwardBookingSourceChipLabel,
  parseForwardBookingSourceChipFilter,
  type ForwardBookingSourceChip,
} from '../utils/forwardBookingEntrySource';
import {
  buildForwardBookingSmsMessage,
  clientHasSmsPhone,
  resolveForwardBookingSmsBookedSlot,
} from '../utils/forwardBookingSmsMessage';
import {
  clearForwardBookingLocalLink,
  mergeForwardBookingsWithLocalLinks,
  readForwardBookingLocalLink,
  writeForwardBookingLocalLink,
} from '../utils/forwardBookingLocalLinks';
import {
  autoLinkUnlinkedForwardBookings,
  persistLocalForwardBookingLinks,
} from '../utils/forwardBookingReconcile';
import {
  clearForwardBookingReturnSession,
  forwardBookingEntryForReturnSession,
  readForwardBookingReturnSession,
  type ForwardBookingReturnSessionV1,
} from '../utils/forwardBookingReturnSession';
import {
  resolveScheduleLoaderSmsBookedSlot,
} from '../utils/scheduleLoaderSmsMessage';
import { FORWARD_BOOKING_STATUS_PARAM, onHoldListPath, workflowPathForStatusFilter } from '../scheduling-tools-nav';
import { notifySchedulingToolsNavCountsRefresh, SCHEDULING_TOOLS_PAGE_REFRESH_EVENT } from '../hooks/useSchedulingToolsNavCounts';
import {
  formatForwardBookingIntervalLabel,
  formatForwardBookingOriginalVisitTargetLine,
  forwardBookingIsHighPriority,
  forwardBookingOriginalVisitTargetParts,
  groupForwardBookingListByHousehold,
  resolveForwardBookingSourceVisitTypeName,
  sortForwardBookingListEntries,
  resolveForwardBookingSourceStartIso,
  resolveForwardBookingTargetDueDateIso,
} from '../utils/forwardBookingFromAppointment';
import {
  buildAppointmentTypeCatalogFromTypes,
  buildBookedAppointmentMetaMap,
  forwardBookingEntryVisibleOnList,
  forwardBookingLinkedAppointmentPoints,
  forwardBookingLinkedVisitIsOnHold,
  forwardBookingListTab,
  opsPointsForAppointment,
  type BookedAppointmentMeta,
  type ForwardBookingListTab,
} from '../utils/forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from '../utils/appointmentTypeSettings';
import {
  formatForwardBookingBookAfterDate,
  forwardBookingBookAfterDateIso,
  forwardBookingIsBookLater,
  sortForwardBookingBookLaterListEntries,
} from '../utils/forwardBookingBookLater';
import {
  forwardBookingOnHoldOver24Hours,
  forwardBookingOnHoldOver24ChipColors,
  forwardBookingOnHoldSinceIso,
  formatForwardBookingOnHoldBookedAt,
  formatForwardBookingOnHoldElapsedSince,
  sortForwardBookingOnHoldListEntries,
} from '../utils/forwardBookingOnHold';
import {
  forwardBookingHasLinkedVisit,
  forwardBookingLinkedAppointmentId,
  mergeForwardBookingLinkedVisit,
} from '../utils/forwardBookingLinkedVisit';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { buildSchedulerFocusAppointmentUrl, writeSchedulerFocusSession } from '../utils/schedulerFocusAppointment';
import { DateTime } from 'luxon';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type StatusFilter = ForwardBookingListTab;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Needs booking' },
  { key: 'onHold', label: 'On hold' },
  { key: 'booked', label: 'Booked' },
  { key: 'complete', label: 'Complete' },
  { key: 'bookLater', label: 'Book later' },
  { key: 'removed', label: 'Removed' },
];

const ALL_STATUS_FILTERS: StatusFilter[] = [
  'pending',
  'onHold',
  'bookLater',
  'booked',
  'complete',
  'removed',
];

function parseStatusFilterParam(raw: string | null): StatusFilter {
  return raw && (ALL_STATUS_FILTERS as string[]).includes(raw) ? (raw as StatusFilter) : 'pending';
}

const WORKFLOW_STATUS_FILTERS = new Set<StatusFilter>(['onHold', 'booked', 'complete']);

const WORKFLOW_LIST_PAGE_SIZE = 25;

const ON_HOLD_OVER24_SEARCH_PARAM = 'over24';
const ON_HOLD_SOURCE_SEARCH_PARAM = 'source';

const ON_HOLD_SOURCE_FILTERS: { key: ForwardBookingSourceChip; label: string }[] = [
  { key: 'care_outreach', label: 'Care outreach' },
  { key: 'schedule_loader', label: 'Schedule loader' },
  { key: 'end_visit', label: 'Forward booking' },
  { key: 'appointment_request', label: 'Appointments' },
];

function parseOnHoldSourceFilter(raw: string | null): ForwardBookingSourceChip | null {
  return parseForwardBookingSourceChipFilter(raw);
}

function onHoldFilterButtonStyle(active: boolean, accent?: { background: string; color: string }) {
  return {
    marginBottom: 0,
    border: active
      ? `2px solid ${accent?.color ?? 'var(--accent-strong, #4FB128)'}`
      : '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 14px',
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    background: active ? accent?.background ?? '#ecfdf5' : '#fff',
    color: active ? accent?.color ?? 'var(--accent-strong, #4FB128)' : 'var(--muted)',
  };
}


const FORWARD_BOOKING_TAB_ORDER: ForwardBookingListTab[] = [
  'pending',
  'onHold',
  'bookLater',
  'booked',
  'complete',
  'removed',
];

function forwardBookingTabLabel(tab: ForwardBookingListTab): string {
  const local = STATUS_TABS.find((t) => t.key === tab)?.label;
  if (local) return local;
  switch (tab) {
    case 'onHold':
      return 'On Hold';
    case 'booked':
      return 'Booked';
    case 'complete':
      return 'Complete';
    default:
      return tab;
  }
}

function forwardBookingTabBadgeColors(tab: ForwardBookingListTab): { background: string; color: string } {
  switch (tab) {
    case 'onHold':
      return { background: '#fef3c7', color: '#92400e' };
    case 'bookLater':
      return { background: '#e0f2fe', color: '#0369a1' };
    case 'booked':
      return { background: '#dcfce7', color: '#166534' };
    case 'complete':
      return { background: '#e0e7ff', color: '#3730a3' };
    case 'removed':
      return { background: '#f1f5f9', color: '#475569' };
    default:
      return { background: '#f1f5f9', color: '#475569' };
  }
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientDisplay(entry: ForwardBookingEntry): {
  id: number | null;
  pimsId: string | null;
  name: string;
  phone: string | null;
} {
  const c = entry.client;
  const id = c?.id ?? entry.clientId ?? null;
  const pimsId = c?.pimsId != null ? String(c.pimsId).trim() : null;
  const name =
    c &&
    ([pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() ||
      (id != null ? `Client #${id}` : 'Unknown client'));
  return {
    id: id != null && Number.isFinite(Number(id)) ? Number(id) : null,
    pimsId: pimsId || null,
    name: name || 'Unknown client',
    phone: pickStr(c?.phone1),
  };
}

async function enrichForwardBookingEntryClientPhone(
  entry: ForwardBookingEntry
): Promise<ForwardBookingEntry> {
  if (clientHasSmsPhone(entry)) return entry;
  const clientId = entry.client?.id ?? entry.clientId;
  if (clientId == null || !Number.isFinite(Number(clientId))) return entry;
  try {
    const payload = await fetchClientByIdStaff(clientId);
    const c =
      payload && typeof payload === 'object' && 'client' in payload
        ? (payload as { client?: Record<string, unknown> }).client
        : (payload as Record<string, unknown>);
    if (!c || typeof c !== 'object') return entry;
    const phone = pickStr(
      (c as { phone1?: string }).phone1 ??
        (c as { phone?: string }).phone ??
        (c as { phoneNumber?: string }).phoneNumber
    );
    if (!phone) return entry;
    return {
      ...entry,
      client: {
        id: Number(clientId),
        ...(entry.client ?? {}),
        phone1: phone,
        firstName: entry.client?.firstName ?? pickStr((c as { firstName?: string }).firstName),
        lastName: entry.client?.lastName ?? pickStr((c as { lastName?: string }).lastName),
      },
    };
  } catch {
    return entry;
  }
}

function formatForwardBookingDate(iso: string | null | undefined, practiceTz: string): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '—';
  return dt.toFormat('EEE, MMM d, yyyy');
}

async function enrichForwardBookingsSourceDates(
  entries: ForwardBookingEntry[],
  practiceId: number
): Promise<ForwardBookingEntry[]> {
  const missingIds = [
    ...new Set(
      entries
        .filter(
          (e): e is ForwardBookingEntry & { sourceAppointmentId: number } =>
            !e.sourceAppointmentStart?.trim() &&
            e.sourceAppointmentId != null &&
            e.sourceAppointmentId > 0
        )
        .map((e) => e.sourceAppointmentId)
    ),
  ];
  if (missingIds.length === 0) return entries;

  const startByApptId = new Map<number, string>();
  await Promise.all(
    missingIds.map(async (id) => {
      const appt = await fetchAppointmentById(id, { practiceId });
      const start = appt?.appointmentStart?.trim();
      if (start) startByApptId.set(id, start);
    })
  );

  if (startByApptId.size === 0) return entries;
  return entries.map((e) => {
    const sid = e.sourceAppointmentId;
    if (sid == null || sid <= 0) return e;
    const start = startByApptId.get(sid);
    if (!start || e.sourceAppointmentStart?.trim()) return e;
    return { ...e, sourceAppointmentStart: start };
  });
}

function formatBookedVisit(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  practiceTz: string
): string {
  if (!startIso) return '—';
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return '—';
  const end = endIso ? DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz) : null;
  const datePart = start.toFormat('EEE, MMM d, yyyy');
  if (end?.isValid) return `${datePart} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
  return `${datePart} · ${start.toFormat('h:mm a')}`;
}

function providerLabel(entry: ForwardBookingEntry): string {
  const p = entry.primaryProvider;
  if (!p) return '—';
  return (
    pickStr(p.name) ??
    ([pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() || '—')
  );
}

function employeeLabel(emp: ForwardBookingEntry['bookedBy']): string {
  if (!emp) return '—';
  return (
    pickStr(emp.name) ??
    ([pickStr(emp.title), pickStr(emp.firstName), pickStr(emp.lastName), pickStr(emp.designation)]
      .filter(Boolean)
      .join(' ')
      .trim() || '—')
  );
}

function bookingNotesDisplay(entry: ForwardBookingEntry): string | null {
  const t = pickStr(entry.bookingNotes);
  return t;
}

function initialNote(entry: ForwardBookingEntry): string {
  return entry.note ?? '';
}

function forwardBookingEntrySearchHaystack(
  entry: ForwardBookingEntry,
  practiceTz: string,
  noteText: string,
  catalog?: AppointmentTypeCatalog | null
): string {
  const c = clientDisplay(entry);
  const pet = pickStr(entry.patient?.name) ?? '';
  const prov = providerLabel(entry).toLowerCase();
  const bookingNote = (bookingNotesDisplay(entry) ?? '').toLowerCase();
  const bookedBy = employeeLabel(entry.bookedBy).toLowerCase();
  const sourceChip = forwardBookingEntrySourceChip(entry);
  const source = sourceChip ? forwardBookingSourceChipLabel(sourceChip).toLowerCase() : '';
  return [
    c.name,
    c.phone ?? '',
    pet,
    formatForwardBookingOriginalVisitTargetLine(entry, practiceTz, catalog),
    resolveForwardBookingSourceVisitTypeName(entry, catalog) ?? '',
    entry.appointmentTypeName ?? '',
    formatForwardBookingIntervalLabel({
      intervalAmount: entry.intervalAmount,
      intervalUnit: entry.intervalUnit,
      monthsOut: entry.monthsOut,
    }),
    formatForwardBookingDate(resolveForwardBookingTargetDueDateIso(entry, practiceTz), practiceTz),
    formatForwardBookingBookAfterDate(forwardBookingBookAfterDateIso(entry), practiceTz),
    prov,
    noteText.toLowerCase(),
    bookingNote,
    bookedBy,
    source,
  ]
    .join(' ')
    .toLowerCase();
}

function forwardBookingEntryMatchesSearch(
  entry: ForwardBookingEntry,
  query: string,
  practiceTz: string,
  noteText: string,
  catalog?: AppointmentTypeCatalog | null
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return forwardBookingEntrySearchHaystack(entry, practiceTz, noteText, catalog).includes(q);
}

function noteForPatch(value: string): string | null {
  const t = value.trim();
  return t === '' ? null : t;
}

function linkedVisitStatusLine(
  entry: ForwardBookingEntry,
  meta: BookedAppointmentMeta | undefined,
  practiceTz: string,
  catalog?: AppointmentTypeCatalog | null,
  bookedApptMeta?: Map<number, BookedAppointmentMeta> | null
): string | null {
  if (!forwardBookingHasLinkedVisit(entry)) return null;
  const start = entry.bookedAppointmentStart?.trim();
  if (!start) return 'On calendar — use View appointment for details';
  const visit = formatBookedVisit(start, entry.bookedAppointmentEnd, practiceTz);
  const points =
    forwardBookingLinkedAppointmentPoints(entry, bookedApptMeta ?? null, catalog) ??
    meta?.points ??
    1;
  const typeName = meta?.typeName?.trim() || entry.appointmentTypeName?.trim() || null;
  if (points <= 0) {
    return typeName ? `On hold — ${typeName}: ${visit}` : `On hold: ${visit}`;
  }
  return `Booked: ${visit}`;
}

export default function ForwardBookingPage({ variant = 'default' }: { variant?: 'default' | 'onHold' }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const isOnHoldView = variant === 'onHold';

  const resolveBookedSlotForSms = useCallback(
    async (entry: ForwardBookingEntry) => {
      return resolveForwardBookingSmsBookedSlot(entry, practiceTz, {
        practiceId: PRACTICE_ID,
      });
    },
    [practiceTz]
  );

  const statusFilter: StatusFilter = isOnHoldView
    ? 'onHold'
    : parseStatusFilterParam(searchParams.get(FORWARD_BOOKING_STATUS_PARAM));
  const setStatusFilter = useCallback(
    (next: StatusFilter) => {
      if (isOnHoldView) return;
      const params = new URLSearchParams(searchParams);
      if (next === 'pending') params.delete(FORWARD_BOOKING_STATUS_PARAM);
      else params.set(FORWARD_BOOKING_STATUS_PARAM, next);
      if (next !== 'onHold') {
        params.delete(ON_HOLD_OVER24_SEARCH_PARAM);
        params.delete(ON_HOLD_SOURCE_SEARCH_PARAM);
      }
      setSearchParams(params);
    },
    [isOnHoldView, searchParams, setSearchParams]
  );

  useEffect(() => {
    if (isOnHoldView || statusFilter !== 'onHold') return;
    const params = new URLSearchParams(searchParams);
    params.delete(FORWARD_BOOKING_STATUS_PARAM);
    const qs = params.toString();
    navigate(qs ? `${onHoldListPath()}?${qs}` : onHoldListPath(), { replace: true });
  }, [isOnHoldView, navigate, searchParams, statusFilter]);
  const onHoldOver24Only =
    statusFilter === 'onHold' && searchParams.get(ON_HOLD_OVER24_SEARCH_PARAM) === '1';
  const onHoldSourceFilter =
    statusFilter === 'onHold'
      ? parseOnHoldSourceFilter(searchParams.get(ON_HOLD_SOURCE_SEARCH_PARAM))
      : null;
  const toggleOnHoldOver24Filter = useCallback(() => {
    if (statusFilter !== 'onHold') return;
    const next = new URLSearchParams(searchParams);
    if (onHoldOver24Only) next.delete(ON_HOLD_OVER24_SEARCH_PARAM);
    else next.set(ON_HOLD_OVER24_SEARCH_PARAM, '1');
    setSearchParams(next, { replace: true });
  }, [statusFilter, onHoldOver24Only, searchParams, setSearchParams]);
  const toggleOnHoldSourceFilter = useCallback(
    (source: ForwardBookingSourceChip) => {
      if (statusFilter !== 'onHold') return;
      const next = new URLSearchParams(searchParams);
      if (onHoldSourceFilter === source) next.delete(ON_HOLD_SOURCE_SEARCH_PARAM);
      else next.set(ON_HOLD_SOURCE_SEARCH_PARAM, source);
      setSearchParams(next, { replace: true });
    },
    [statusFilter, onHoldSourceFilter, searchParams, setSearchParams]
  );
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ForwardBookingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualCompleteEntry, setManualCompleteEntry] = useState<ForwardBookingEntry | null>(null);
  const [smsEntry, setSmsEntry] = useState<ForwardBookingEntry | null>(null);
  const [smsFromLine, setSmsFromLine] = useState<string | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<CreateForwardBookingPrefill | null>(null);
  const [createReturnTo, setCreateReturnTo] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [noteError, setNoteError] = useState<Record<number, string | null>>({});
  const [followUpCompleting, setFollowUpCompleting] = useState<Record<number, boolean>>({});
  const [followUpCompleteError, setFollowUpCompleteError] = useState<Record<number, string | null>>(
    {}
  );
  const [removing, setRemoving] = useState<Record<number, boolean>>({});
  const [removeError, setRemoveError] = useState<Record<number, string | null>>({});
  const [bookLaterEntry, setBookLaterEntry] = useState<ForwardBookingEntry | null>(null);
  const [bookLaterUpdating, setBookLaterUpdating] = useState<Record<number, boolean>>({});
  const [bookLaterError, setBookLaterError] = useState<Record<number, string | null>>({});
  const [bookedApptPoints, setBookedApptPoints] = useState<Map<number, number> | null>(null);
  const [bookedApptMeta, setBookedApptMeta] = useState<Map<number, BookedAppointmentMeta> | null>(
    null
  );
  const typeCatalogRef = useRef<AppointmentTypeCatalog | null>(null);
  const [listPage, setListPage] = useState(1);
  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  /** After book return, show the highlighted row even if On Hold sub-filters would hide it. */
  const [returnHighlightBypassFilters, setReturnHighlightBypassFilters] = useState(false);
  const [postBookReturn, setPostBookReturn] = useState<ForwardBookingReturnSessionV1 | null>(null);
  const postBookReturnHandledRef = useRef(false);
  const postBookReturnProcessingRef = useRef(false);
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const highlightScrollSig = useRef('');

  const listTitle = isOnHoldView ? 'On hold' : 'Forward booking';
  const listDescription = isOnHoldView
    ? 'Calendar holds from care outreach, schedule loader, forward booking, and appointment requests. Convert holds to booked visits when ready.'
    : 'Visits routed from care outreach, schedule loader, and end-of-visit follow-ups. Use the status filters to move each visit from needs booking → booked → complete.';

  useEffect(() => {
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setSmsFromLine(phone);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBookedApptPoints(null);
    setBookedApptMeta(null);
    try {
      const [types, rawList] = await Promise.all([
        fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }),
        fetchForwardBookings({
          practiceId: PRACTICE_ID,
          limit: 2000,
          includeRemoved: true,
        }),
      ]);
      const catalog = buildAppointmentTypeCatalogFromTypes(types);
      typeCatalogRef.current = catalog;
      let list = mergeForwardBookingsWithLocalLinks(
        await enrichForwardBookingsSourceDates(rawList, PRACTICE_ID)
      );

      list = await persistLocalForwardBookingLinks(list);
      list = await autoLinkUnlinkedForwardBookings(list, PRACTICE_ID, practiceTz);

      const metaMap = await buildBookedAppointmentMetaMap(list, PRACTICE_ID, catalog);
      const pointsMap = new Map<number, number>();
      for (const [id, meta] of metaMap) {
        pointsMap.set(id, meta.points);
      }
      setBookedApptMeta(metaMap);
      setBookedApptPoints(pointsMap);
      setRows(list);
      const drafts: Record<number, string> = {};
      for (const r of list) {
        drafts[r.id] = initialNote(r);
      }
      setNoteDrafts(drafts);
      setNoteSaving({});
      setNoteError({});
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to load forward bookings';
      setError(String(msg));
      setRows([]);
    } finally {
      setLoading(false);
      notifySchedulingToolsNavCountsRefresh();
    }
  }, [practiceTz]);

  useEffect(() => {
    const pending = readForwardBookingReturnSession();
    if (!pending) return;
    postBookReturnHandledRef.current = false;
    setPostBookReturn(pending);
    setReturnHighlightBypassFilters(true);
  }, []);

  useEffect(() => {
    if (
      !postBookReturn ||
      loading ||
      postBookReturnHandledRef.current ||
      postBookReturnProcessingRef.current
    ) {
      return;
    }

    let cancelled = false;
    postBookReturnProcessingRef.current = true;

    void (async () => {
      if (postBookReturnHandledRef.current) return;
      const pending = postBookReturn;
      const mergeListWithReturnLink = (
        entryRows: ForwardBookingEntry[],
        entryId: number
      ): ForwardBookingEntry[] =>
        entryRows.map((r) =>
          r.id === entryId
            ? mergeForwardBookingLinkedVisit(r, {
                bookedAppointmentId: pending.bookedAppointmentId,
                bookedAppointmentStart: pending.bookedAppointmentStart,
                bookedAppointmentEnd: pending.bookedAppointmentEnd,
              })
            : r
        );

      let entry: ForwardBookingEntry | undefined;
      let nextRows = rows;

      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        entry = forwardBookingEntryForReturnSession(nextRows, pending);
        if (entry) break;
        if (attempt === 3) break;
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        if (cancelled) return;
        let refreshed = mergeForwardBookingsWithLocalLinks(
          await enrichForwardBookingsSourceDates(
            await fetchForwardBookings({
              practiceId: PRACTICE_ID,
              limit: 2000,
              includeRemoved: true,
            }),
            PRACTICE_ID
          )
        );
        refreshed = await persistLocalForwardBookingLinks(refreshed);
        refreshed = await autoLinkUnlinkedForwardBookings(refreshed, PRACTICE_ID, practiceTz);
        nextRows = refreshed;
        entry = forwardBookingEntryForReturnSession(nextRows, pending);
        if (entry) {
          setRows(refreshed);
          break;
        }
      }

      if (cancelled || !entry) return;

      const catalog = typeCatalogRef.current;
      let points =
        bookedApptMeta?.get(pending.bookedAppointmentId)?.points ??
        forwardBookingLinkedAppointmentPoints(entry, bookedApptMeta, catalog);
      if (points == null && pending.bookedAppointmentId) {
        try {
          const appt = await fetchAppointmentById(pending.bookedAppointmentId, {
            practiceId: PRACTICE_ID,
          });
          if (appt && catalog) points = opsPointsForAppointment(appt, catalog);
        } catch {
          /* optional */
        }
      }
      if (points == null) points = 0;

      const targetTab =
        pending.targetWorkflowTab ?? (points <= 0 ? 'onHold' : 'booked');
      if (statusFilter !== targetTab) {
        postBookReturnProcessingRef.current = false;
        navigate(workflowPathForStatusFilter(targetTab), { replace: true });
        return;
      }

      postBookReturnHandledRef.current = true;
      clearForwardBookingReturnSession();
      setPostBookReturn(null);

      if (!readForwardBookingLocalLink(entry.id)) {
        writeForwardBookingLocalLink(entry.id, {
          bookedAppointmentId: pending.bookedAppointmentId,
          bookedAppointmentStart: pending.bookedAppointmentStart,
          bookedAppointmentEnd: pending.bookedAppointmentEnd,
          ...(pending.careOutreachAnyPastDue ? { careOutreachAnyPastDue: true } : {}),
        });
      }
      setRows((prev) => mergeListWithReturnLink(prev.length ? prev : nextRows, entry!.id));

      setHighlightEntryId(entry.id);
      highlightScrollSig.current = `${entry.id}-${Date.now()}`;

      if (points > 0) return;

      let smsTarget = await enrichForwardBookingEntryClientPhone(entry);
      if (!clientHasSmsPhone(smsTarget)) return;

      setSmsError(null);
      const smsTemplate = pending.smsTemplate ?? 'forward_booking';

      if (smsTemplate === 'schedule_loader') {
        const bookedSlot = await resolveScheduleLoaderSmsBookedSlot(
          pending.bookedAppointmentId,
          PRACTICE_ID,
          practiceTz,
          {
            startIso: pending.bookedAppointmentStart,
            endIso: pending.bookedAppointmentEnd,
          }
        );
        const petNames =
          pending.scheduleLoaderPetNames?.length
            ? pending.scheduleLoaderPetNames
            : smsTarget.patient?.name?.trim()
              ? [smsTarget.patient.name.trim()]
              : [];
        setSmsMessage(
          buildCareOutreachSmsMessage({
            clientFirstName: smsTarget.client?.firstName,
            clientDisplayName:
              pending.scheduleLoaderClientDisplayName?.trim() ||
              [smsTarget.client?.firstName, smsTarget.client?.lastName].filter(Boolean).join(' ').trim() ||
              undefined,
            petNames,
            providerLastName:
              pending.scheduleLoaderProviderLastName ?? smsTarget.primaryProvider?.lastName,
            anyPastDue: pending.scheduleLoaderAnyPastDue !== false,
            ...(bookedSlot ? { bookedSlot } : {}),
          })
        );
      } else {
        const resolved = await resolveBookedSlotForSms(smsTarget);
        const petNames =
          smsTemplate === 'care_outreach' && pending.careOutreachPetNames?.length
            ? pending.careOutreachPetNames
            : smsTarget.patient?.name?.trim()
              ? [smsTarget.patient.name.trim()]
              : [];
        setSmsMessage(
          smsTemplate === 'care_outreach'
            ? buildCareOutreachSmsMessage({
                clientFirstName: smsTarget.client?.firstName,
                clientDisplayName: [smsTarget.client?.firstName, smsTarget.client?.lastName]
                  .filter(Boolean)
                  .join(' ')
                  .trim() || undefined,
                petNames,
                providerLastName: smsTarget.primaryProvider?.lastName,
                anyPastDue: pending.careOutreachAnyPastDue === true,
                ...(resolved.bookedSlot ? { bookedSlot: resolved.bookedSlot } : {}),
              })
            : buildForwardBookingSmsMessage(
                smsTarget,
                resolved.bookedSlot ? { bookedSlot: resolved.bookedSlot } : undefined
              )
        );
      }
      setSmsEntry(smsTarget);
    })().finally(() => {
      postBookReturnProcessingRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [
    postBookReturn,
    loading,
    bookedApptMeta,
    practiceTz,
    resolveBookedSlotForSms,
    rows,
    statusFilter,
    navigate,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onPageRefresh = () => {
      void load();
    };
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
  }, [load]);

  useEffect(() => {
    if (searchParams.get(FORWARD_BOOKING_CREATE_NEW_PARAM) !== '1') return;
    const patientId = Number(searchParams.get(FORWARD_BOOKING_CREATE_PATIENT_PARAM));
    const appointmentId = Number(searchParams.get(FORWARD_BOOKING_CREATE_APPOINTMENT_PARAM));
    setCreateOpen(true);
    if (
      Number.isFinite(patientId) &&
      patientId > 0 &&
      Number.isFinite(appointmentId) &&
      appointmentId > 0
    ) {
      setCreatePrefill({ patientId, appointmentId });
    } else {
      setCreatePrefill(null);
    }
    setCreateReturnTo(
      sanitizeForwardBookingReturnTo(searchParams.get(FORWARD_BOOKING_CREATE_RETURN_TO_PARAM))
    );
    const next = new URLSearchParams(searchParams);
    next.delete(FORWARD_BOOKING_CREATE_NEW_PARAM);
    next.delete(FORWARD_BOOKING_CREATE_PATIENT_PARAM);
    next.delete(FORWARD_BOOKING_CREATE_APPOINTMENT_PARAM);
    next.delete(FORWARD_BOOKING_CREATE_RETURN_TO_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const finishCreateForwardBooking = useCallback(
    (returnPath: string | null) => {
      setCreateOpen(false);
      setCreatePrefill(null);
      setCreateReturnTo(null);
      if (returnPath) {
        navigate(returnPath);
        return;
      }
    },
    [navigate]
  );

  useEffect(() => {
    try {
      const msg = sessionStorage.getItem('vayd:forward-booking-return-toast');
      if (!msg) return;
      sessionStorage.removeItem('vayd:forward-booking-return-toast');
      setNotice(msg);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const flushNoteSave = useCallback(async (entryId: number, value: string) => {
    setNoteSaving((s) => ({ ...s, [entryId]: true }));
    setNoteError((e) => ({ ...e, [entryId]: null }));
    try {
      const updated = await patchForwardBooking(entryId, {
        practiceId: PRACTICE_ID,
        note: noteForPatch(value),
      });
      setRows((prev) => prev.map((r) => (r.id === entryId ? { ...r, ...updated } : r)));
      setNoteDrafts((d) => ({ ...d, [entryId]: initialNote(updated) }));
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not save note';
      setNoteError((er) => ({ ...er, [entryId]: String(msg) }));
    } finally {
      setNoteSaving((s) => ({ ...s, [entryId]: false }));
    }
  }, []);

  function onNoteChange(entryId: number, value: string) {
    setNoteDrafts((d) => ({ ...d, [entryId]: value }));
    setNoteError((er) => ({ ...er, [entryId]: null }));
  }

  function noteIsDirty(entry: ForwardBookingEntry): boolean {
    const draft = noteDrafts[entry.id] ?? initialNote(entry);
    return noteForPatch(draft) !== noteForPatch(initialNote(entry));
  }

  function saveNote(entry: ForwardBookingEntry) {
    const value = noteDrafts[entry.id] ?? initialNote(entry);
    void flushNoteSave(entry.id, value);
  }

  const visibleRows = useMemo(() => rows.filter((r) => forwardBookingEntryVisibleOnList(r)), [rows]);

  const tabCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      pending: 0,
      bookLater: 0,
      onHold: 0,
      booked: 0,
      complete: 0,
      removed: 0,
    };
    for (const row of visibleRows) {
      counts[forwardBookingListTab(row, practiceTz, bookedApptMeta, typeCatalogRef.current)] += 1;
    }
    return counts;
  }, [visibleRows, practiceTz, bookedApptMeta]);

  const onHoldOver24Count = useMemo(() => {
    let count = 0;
    for (const row of visibleRows) {
      if (
        forwardBookingListTab(row, practiceTz, bookedApptMeta, typeCatalogRef.current) !== 'onHold'
      ) {
        continue;
      }
      if (forwardBookingOnHoldOver24Hours(row, bookedApptMeta)) count += 1;
    }
    return count;
  }, [visibleRows, practiceTz, bookedApptMeta]);

  const onHoldSourceCounts = useMemo(() => {
    const counts: Record<ForwardBookingSourceChip, number> = {
      care_outreach: 0,
      schedule_loader: 0,
      end_visit: 0,
      appointment_request: 0,
    };
    for (const row of visibleRows) {
      if (
        forwardBookingListTab(row, practiceTz, bookedApptMeta, typeCatalogRef.current) !== 'onHold'
      ) {
        continue;
      }
      const chip = forwardBookingEntrySourceChip(row);
      if (chip) counts[chip] += 1;
    }
    return counts;
  }, [visibleRows, practiceTz, bookedApptMeta]);

  const filtered = useMemo(() => {
    const searchQuery = search.trim().toLowerCase();
    const searchActive = searchQuery.length > 0;

    const sortList = (items: ForwardBookingEntry[], tab: ForwardBookingListTab) => {
      if (tab === 'bookLater') {
        return sortForwardBookingBookLaterListEntries(items, practiceTz, (e) => clientDisplay(e).name);
      }
      if (tab === 'onHold') {
        return sortForwardBookingOnHoldListEntries(items, (e) => clientDisplay(e).name);
      }
      return sortForwardBookingListEntries(items, practiceTz, (e) => clientDisplay(e).name);
    };

    const matchesOnHoldFilters = (r: ForwardBookingEntry) => {
      if (statusFilter !== 'onHold') return true;
      if (returnHighlightBypassFilters) return true;
      if (onHoldOver24Only && !forwardBookingOnHoldOver24Hours(r, bookedApptMeta)) return false;
      if (onHoldSourceFilter && forwardBookingEntrySourceChip(r) !== onHoldSourceFilter) {
        return false;
      }
      return true;
    };

    const matchesSearch = (r: ForwardBookingEntry) =>
      forwardBookingEntryMatchesSearch(
        r,
        searchQuery,
        practiceTz,
        noteDrafts[r.id] ?? initialNote(r),
        typeCatalogRef.current
      );

    if (searchActive) {
      const matching = visibleRows.filter(
        (r) => matchesSearch(r) && matchesOnHoldFilters(r)
      );
      const byTab = new Map<ForwardBookingListTab, ForwardBookingEntry[]>();
      for (const row of matching) {
        const tab = forwardBookingListTab(row, practiceTz, bookedApptMeta, typeCatalogRef.current);
        const bucket = byTab.get(tab) ?? [];
        bucket.push(row);
        byTab.set(tab, bucket);
      }
      const list: ForwardBookingEntry[] = [];
      for (const tab of FORWARD_BOOKING_TAB_ORDER) {
        const bucket = byTab.get(tab);
        if (bucket?.length) list.push(...sortList(bucket, tab));
      }
      return list;
    }

    const list = visibleRows.filter(
      (r) =>
        forwardBookingListTab(r, practiceTz, bookedApptMeta, typeCatalogRef.current) ===
          statusFilter && matchesOnHoldFilters(r)
    );
    return sortList(list, statusFilter);
  }, [
    visibleRows,
    statusFilter,
    search,
    noteDrafts,
    practiceTz,
    bookedApptMeta,
    onHoldOver24Only,
    onHoldSourceFilter,
    returnHighlightBypassFilters,
  ]);

  const useWorkflowListPagination =
    statusFilter === 'booked' || statusFilter === 'complete';

  const workflowListTotalPages = useMemo(() => {
    if (!useWorkflowListPagination) return 1;
    return Math.max(1, Math.ceil(filtered.length / WORKFLOW_LIST_PAGE_SIZE));
  }, [filtered.length, useWorkflowListPagination]);

  const listForDisplay = useMemo(() => {
    if (!useWorkflowListPagination) return filtered;
    const start = (listPage - 1) * WORKFLOW_LIST_PAGE_SIZE;
    return filtered.slice(start, start + WORKFLOW_LIST_PAGE_SIZE);
  }, [filtered, listPage, useWorkflowListPagination]);

  const filteredGroups = useMemo(
    () => groupForwardBookingListByHousehold(listForDisplay),
    [listForDisplay]
  );

  const searchActive = search.trim().length > 0;

  useEffect(() => {
    setListPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (!useWorkflowListPagination) return;
    if (listPage > workflowListTotalPages) {
      setListPage(workflowListTotalPages);
    }
  }, [listPage, useWorkflowListPagination, workflowListTotalPages]);

  useEffect(() => {
    if (!useWorkflowListPagination || highlightEntryId == null || loading) return;
    const idx = filtered.findIndex((entry) => entry.id === highlightEntryId);
    if (idx < 0) return;
    const page = Math.floor(idx / WORKFLOW_LIST_PAGE_SIZE) + 1;
    setListPage(page);
  }, [highlightEntryId, filtered, loading, useWorkflowListPagination]);

  useEffect(() => {
    if (highlightEntryId == null || loading) return;
    if (!highlightScrollSig.current) return;
    const id = highlightEntryId;

    if (useWorkflowListPagination) {
      const idx = filtered.findIndex((entry) => entry.id === id);
      if (idx < 0) return;
      const page = Math.floor(idx / WORKFLOW_LIST_PAGE_SIZE) + 1;
      if (listPage !== page) {
        setListPage(page);
        return;
      }
    }

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const el = rowRefs.current.get(id);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      attempts += 1;
      if (attempts < 40) {
        window.setTimeout(tryScroll, 50);
      }
    };

    const scrollT = window.setTimeout(tryScroll, 150);
    const clearT = window.setTimeout(() => {
      setHighlightEntryId(null);
      setReturnHighlightBypassFilters(false);
    }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(scrollT);
      window.clearTimeout(clearT);
    };
  }, [
    highlightEntryId,
    loading,
    listForDisplay,
    filtered,
    listPage,
    useWorkflowListPagination,
  ]);

  const onBook = (entry: ForwardBookingEntry) => {
    const intent = buildRoutingForwardBookingIntentFromEntry(entry);
    if (!intent) {
      setError('This forward booking is missing client or patient data.');
      return;
    }
    writeRoutingForwardBookingIntent({
      ...intent,
      returnToListAfterBook: true,
      workspaceActive: true,
    });
    navigate('/schedule/routing');
  };

  const onBookHousehold = (entries: ForwardBookingEntry[], anchor: ForwardBookingEntry) => {
    const bookable = forwardBookingHouseholdGroupBookableEntries(entries);
    const intent = buildRoutingForwardBookingIntentFromEntries(anchor, bookable);
    if (!intent) {
      setError('These forward bookings are missing client or patient data.');
      return;
    }
    writeRoutingForwardBookingIntent({
      ...intent,
      returnToListAfterBook: true,
      workspaceActive: true,
    });
    navigate('/schedule/routing');
  };

  const openSmsModal = async (entry: ForwardBookingEntry) => {
    const enriched = await enrichForwardBookingEntryClientPhone(entry);
    if (!clientHasSmsPhone(enriched)) return;
    setSmsError(null);
    const resolved = await resolveBookedSlotForSms(enriched);
    const localLink = readForwardBookingLocalLink(enriched.id);
    const sourceChip = forwardBookingEntrySourceChip(enriched);
    const careOutreach = sourceChip === 'care_outreach';
    const scheduleLoader = sourceChip === 'schedule_loader';
    const petNames = enriched.patient?.name?.trim() ? [enriched.patient.name.trim()] : [];
    setSmsMessage(
      careOutreach || scheduleLoader
        ? buildCareOutreachSmsMessage({
            clientFirstName: enriched.client?.firstName,
            clientDisplayName: [enriched.client?.firstName, enriched.client?.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() || undefined,
            petNames,
            providerLastName: enriched.primaryProvider?.lastName,
            anyPastDue: scheduleLoader || localLink?.careOutreachAnyPastDue === true,
            ...(resolved.bookedSlot ? { bookedSlot: resolved.bookedSlot } : {}),
          })
        : buildForwardBookingSmsMessage(
            enriched,
            resolved.bookedSlot ? { bookedSlot: resolved.bookedSlot } : undefined
          )
    );
    setSmsEntry(enriched);
  };

  const closeSmsModal = () => {
    setSmsEntry(null);
    setSmsMessage('');
    setSmsError(null);
  };

  const openMessagesHistory = (entry: ForwardBookingEntry) => {
    const c = clientDisplay(entry);
    setMessagesClientId(entry.clientId);
    setMessagesClientLabel(c.name);
  };

  const handleSendSms = async (opts: { overrideNonProd: boolean }) => {
    if (!smsEntry || !smsMessage.trim()) return;
    setSmsSending(true);
    setSmsError(null);
    try {
      await sendClientSms(smsEntry.clientId, {
        message: smsMessage.trim(),
        useRemindersFrom: true,
        ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
      });
      closeSmsModal();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setSmsError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to send text message.');
    } finally {
      setSmsSending(false);
    }
  };

  const onViewAppointment = (entry: ForwardBookingEntry) => {
    const apptId = forwardBookingLinkedAppointmentId(entry);
    const start = entry.bookedAppointmentStart?.trim();
    const dateKey = start
      ? DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz).toISODate()
      : null;

    if (apptId != null) {
      const meta = bookedApptMeta?.get(apptId);
      const providerId =
        meta?.providerInternalId ??
        (entry.primaryProvider?.id != null ? String(entry.primaryProvider.id) : undefined);
      writeSchedulerFocusSession({
        appointmentId: apptId,
        dateHint: dateKey,
        providerHint: providerId ?? null,
      });
      navigate(
        buildSchedulerFocusAppointmentUrl(apptId, {
          date: dateKey ?? undefined,
          providerId,
        })
      );
      return;
    }
    if (!start) return;
    const params = new URLSearchParams({ fromMyDay: '1' });
    if (dateKey) params.set('date', dateKey);
    navigate(`/schedule/scheduler?${params.toString()}`);
  };

  const mergeEntry = useCallback(
    (updated: ForwardBookingEntry) => {
      clearForwardBookingLocalLink(updated.id);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      setNoteDrafts((d) => ({ ...d, [updated.id]: initialNote(updated) }));
      const apptId = forwardBookingLinkedAppointmentId(updated);
      const catalog = typeCatalogRef.current;
      if (apptId != null && catalog) {
        void fetchAppointmentById(apptId, { practiceId: PRACTICE_ID }).then((appt) => {
          if (!appt) return;
          const points = opsPointsForAppointment(appt, catalog);
          const typeName =
            appt.appointmentType?.name?.trim() || appt.appointmentType?.prettyName?.trim() || null;
          const providerInternalId =
            appt.primaryProvider?.id != null ? String(appt.primaryProvider.id) : null;
          const meta: BookedAppointmentMeta = { points, typeName, providerInternalId };
          setBookedApptMeta((prev) => {
            const next = new Map(prev ?? []);
            next.set(apptId, meta);
            if (updated.status === 'booked' || forwardBookingHasLinkedVisit(updated)) {
              setStatusFilter(forwardBookingListTab(updated, practiceTz, next, catalog));
            }
            return next;
          });
          setBookedApptPoints((prev) => {
            const next = new Map(prev ?? []);
            next.set(apptId, points);
            return next;
          });
        });
      } else if (updated.status === 'booked' || forwardBookingHasLinkedVisit(updated)) {
        setStatusFilter(
          forwardBookingListTab(updated, practiceTz, bookedApptMeta, typeCatalogRef.current)
        );
      }
    },
    [practiceTz, bookedApptMeta]
  );

  const mergeBookLaterEntry = useCallback((updated: ForwardBookingEntry) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  const returnForwardBookingToQueue = useCallback(async (entry: ForwardBookingEntry) => {
    setBookLaterUpdating((s) => ({ ...s, [entry.id]: true }));
    setBookLaterError((e) => ({ ...e, [entry.id]: null }));
    try {
      const updated = await clearForwardBookingBookAfterDate(entry.id, PRACTICE_ID);
      mergeBookLaterEntry(updated);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not return to queue';
      setBookLaterError((er) => ({ ...er, [entry.id]: String(msg) }));
    } finally {
      setBookLaterUpdating((s) => ({ ...s, [entry.id]: false }));
    }
  }, [mergeBookLaterEntry]);

  const markForwardBookingRemoved = useCallback(async (entry: ForwardBookingEntry) => {
    setRemoving((s) => ({ ...s, [entry.id]: true }));
    setRemoveError((e) => ({ ...e, [entry.id]: null }));
    try {
      const updated = await removeForwardBooking(entry.id, PRACTICE_ID);
      clearForwardBookingLocalLink(updated.id);
      setRows((prev) => prev.map((r) => (r.id === entry.id ? { ...r, ...updated } : r)));
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not remove forward booking';
      setRemoveError((er) => ({ ...er, [entry.id]: String(msg) }));
    } finally {
      setRemoving((s) => ({ ...s, [entry.id]: false }));
    }
  }, []);

  const markFollowUpComplete = useCallback(async (entry: ForwardBookingEntry) => {
    setFollowUpCompleting((s) => ({ ...s, [entry.id]: true }));
    setFollowUpCompleteError((e) => ({ ...e, [entry.id]: null }));
    try {
      const linked = await ensureForwardBookingServerLink(entry);
      const updated = await finishForwardBookingFollowUp(linked.id, PRACTICE_ID);
      clearForwardBookingLocalLink(updated.id);
      setRows((prev) => prev.map((r) => (r.id === entry.id ? { ...r, ...updated } : r)));
      setNotice('Marked complete.');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not mark complete';
      setFollowUpCompleteError((er) => ({ ...er, [entry.id]: String(msg) }));
    } finally {
      setFollowUpCompleting((s) => ({ ...s, [entry.id]: false }));
    }
  }, []);

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8, marginBottom: listDescription ? 8 : 16 }}>
        {listTitle}
      </h2>
      {listDescription ? (
        <p className="settings-section-description" style={{ marginTop: 0, marginBottom: 16 }}>
          {listDescription}
        </p>
      ) : null}

      {notice ? (
        <div
          className="settings-message settings-success-message"
          style={{ marginBottom: 16, maxWidth: 800 }}
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {!isOnHoldView
          ? STATUS_TABS.filter(({ key }) => key !== 'onHold').map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`settings-tab${statusFilter === key ? ' active' : ''}`}
                style={{
                  marginBottom: 0,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onClick={() => setStatusFilter(key)}
              >
                <span>{label}</span>
                <span
                  className="settings-muted"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1,
                    opacity: statusFilter === key ? 1 : 0.85,
                  }}
                  aria-hidden
                >
                  ({tabCounts[key]})
                </span>
              </button>
            ))
          : null}
        {isOnHoldView ? (
          <span
            className="settings-muted"
            style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}
          >
            All holds ({tabCounts.onHold})
          </span>
        ) : null}
        {statusFilter === 'onHold' ? (
          <button
            type="button"
            className={`settings-tab${onHoldOver24Only ? ' active' : ''}`}
            aria-pressed={onHoldOver24Only}
            title={
              onHoldOver24Only
                ? 'Showing on hold over 24 hours only — click to show all on hold'
                : 'Show only on hold over 24 hours'
            }
            style={onHoldFilterButtonStyle(onHoldOver24Only)}
            onClick={toggleOnHoldOver24Filter}
          >
            <span>On hold &gt; 24 hours</span>
            <span
              className="settings-muted"
              style={{
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1,
                opacity: onHoldOver24Only ? 1 : 0.85,
              }}
              aria-hidden
            >
              ({onHoldOver24Count})
            </span>
          </button>
        ) : null}
        {statusFilter === 'onHold'
          ? ON_HOLD_SOURCE_FILTERS.map(({ key, label }) => {
              const active = onHoldSourceFilter === key;
              const chipColors = forwardBookingSourceChipColors(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`settings-tab${active ? ' active' : ''}`}
                  aria-pressed={active}
                  title={
                    active
                      ? `Showing ${label} only — click to show all on hold`
                      : `Show only ${label}`
                  }
                  style={onHoldFilterButtonStyle(active, chipColors)}
                  onClick={() => toggleOnHoldSourceFilter(key)}
                >
                  <span>{label}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1,
                      opacity: active ? 1 : 0.85,
                    }}
                    aria-hidden
                  >
                    ({onHoldSourceCounts[key]})
                  </span>
                </button>
              );
            })
          : null}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <input
          type="search"
          className="settings-input"
          placeholder="Search all tabs: client, patient, provider, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search forward booking list across all tabs"
          style={{ width: '100%' }}
        />
        {searchActive ? (
          <p className="settings-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            Searching across all tabs
            {filtered.length > 0
              ? ` · ${filtered.length} result${filtered.length === 1 ? '' : 's'}`
              : ''}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="settings-muted" style={{ color: 'var(--danger, #c62828)' }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="settings-muted">
          {searchActive ? 'No forward bookings match your search.' : 'No forward bookings in this view.'}
        </p>
      ) : (
        <>
        <ul className="forward-booking-household-list">
          {filteredGroups.map((group) => {
            const householdClient = clientDisplay(group.entries[0]);
            const bookableEntries = forwardBookingHouseholdGroupBookableEntries(group.entries);
            return (
              <li key={group.key} className="forward-booking-household">
                <div
                  className="forward-booking-household-header"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  {householdClient.pimsId ? (
                    <a href={evetClientLink(householdClient.pimsId)} target="_blank" rel="noreferrer">
                      {householdClient.name}
                    </a>
                  ) : (
                    householdClient.name
                  )}
                  {householdClient.phone ? (
                    <span className="settings-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                      {householdClient.phone}
                    </span>
                  ) : null}
                  </div>
                </div>
                {groupForwardBookingHouseholdEntriesByTargetDate(group.entries, practiceTz).map(
                  (targetGroup) => (
                    <div
                      key={`${group.key}-${targetGroup.targetDayKey ?? 'none'}-${targetGroup.entries[0]?.id ?? 'row'}`}
                      className={[
                        'forward-booking-target-group',
                        targetGroup.entries.length > 1 ? 'forward-booking-target-group--multi' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {targetGroup.entries.map((entry) => {
            const c = householdClient;
            const hasLinked = forwardBookingHasLinkedVisit(entry);
            const linkedApptId = forwardBookingLinkedAppointmentId(entry);
            const linkedMeta =
              linkedApptId != null ? bookedApptMeta?.get(linkedApptId) : undefined;
            const isOnHold =
              forwardBookingLinkedVisitIsOnHold(entry, bookedApptMeta, typeCatalogRef.current);
            const onHoldOver24 = isOnHold && forwardBookingOnHoldOver24Hours(entry, bookedApptMeta);
            const linkedStatusLine = linkedVisitStatusLine(
              entry,
              linkedMeta,
              practiceTz,
              typeCatalogRef.current,
              bookedApptMeta
            );
            const onHoldSinceIso = isOnHold
              ? forwardBookingOnHoldSinceIso(entry, bookedApptMeta)
              : null;
            const onHoldBookedAtLabel = isOnHold
              ? formatForwardBookingOnHoldBookedAt(onHoldSinceIso, practiceTz)
              : null;
            const onHoldElapsedLabel = isOnHold
              ? formatForwardBookingOnHoldElapsedSince(onHoldSinceIso)
              : null;
            const patientName = pickStr(entry.patient?.name) ?? `Patient #${entry.patientId}`;
            const patientPimsId = pickStr(entry.patient?.pimsId);
            const resolvedTargetDueDate = resolveForwardBookingTargetDueDateIso(entry, practiceTz);
            const overdue =
              resolvedTargetDueDate &&
              dayjs(resolvedTargetDueDate).startOf('day').isBefore(dayjs().startOf('day'));
            const isBookLater = forwardBookingIsBookLater(entry, practiceTz);
            const bookAfterIso = forwardBookingBookAfterDateIso(entry);
            const highPriority =
              forwardBookingIsHighPriority(entry, practiceTz) &&
              entry.status !== 'removed';
            const isRemoved = entry.status === 'removed';
            const sourceChip = !isRemoved ? forwardBookingEntrySourceChip(entry) : null;

            const isComplete = entry.status === 'complete';
            const entryListTab = forwardBookingListTab(
              entry,
              practiceTz,
              bookedApptMeta,
              typeCatalogRef.current
            );
            const showBookedFollowUpActions = hasLinked && !isComplete && !isRemoved;
            const showPendingQueueActions = !hasLinked && !isComplete && !isRemoved && !isBookLater;
            const showBookLaterTabActions = isBookLater;
            const sameTargetPeers = forwardBookingSameTargetBookablePeers(
              entry,
              bookableEntries,
              practiceTz
            );
            const isSameTargetGroupLeader = forwardBookingEntryIsSameTargetGroupBookLeader(
              entry,
              bookableEntries,
              practiceTz
            );
            const showSameTargetGroupBook =
              showPendingQueueActions && sameTargetPeers.length >= 2 && isSameTargetGroupLeader;
            const showSingleBook = showPendingQueueActions && sameTargetPeers.length === 1;

            const rowHighlighted = highlightEntryId === entry.id;

            return (
              <div
                key={entry.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(entry.id, el);
                  else rowRefs.current.delete(entry.id);
                }}
                className={[
                  'forward-booking-household-entry',
                  hasLinked && !rowHighlighted ? 'forward-booking-household-entry--booked' : '',
                  rowHighlighted ? 'forward-booking-household-entry--highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {searchActive ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            ...forwardBookingTabBadgeColors(entryListTab),
                          }}
                        >
                          {forwardBookingTabLabel(entryListTab)}
                        </div>
                      ) : null}
                      {isRemoved ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#f1f5f9',
                            color: '#475569',
                          }}
                        >
                          Removed
                        </div>
                      ) : null}
                      {isBookLater ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#e0f2fe',
                            color: '#0369a1',
                          }}
                        >
                          Book later
                        </div>
                      ) : null}
                      {highPriority && !isComplete ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            background: '#fecaca',
                            color: '#991b1b',
                          }}
                        >
                          HIGH PRIORITY
                        </div>
                      ) : null}
                      {onHoldOver24 ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            ...forwardBookingOnHoldOver24ChipColors(),
                          }}
                        >
                          ON HOLD &gt; 24 HOURS
                        </div>
                      ) : null}
                      {sourceChip ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            ...forwardBookingSourceChipColors(sourceChip),
                          }}
                        >
                          {forwardBookingSourceChipLabel(sourceChip)}
                        </div>
                      ) : null}
                      {isComplete ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#e0e7ff',
                            color: '#3730a3',
                          }}
                        >
                          Follow-up complete
                        </div>
                      ) : hasLinked ? (
                      <div
                        style={{
                          display: 'inline-block',
                          marginBottom: 8,
                          padding: '3px 10px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          background: isOnHold ? '#fef3c7' : '#dcfce7',
                          color: isOnHold ? '#92400e' : '#166534',
                        }}
                      >
                        {isOnHold ? 'On hold' : 'Visit booked'}
                      </div>
                      ) : null}
                    </div>
                    <div
                      className="settings-muted"
                      style={{
                        fontSize: '0.92rem',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '6px 8px',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {patientPimsId ? (
                          <a href={evetPatientLink(patientPimsId)} target="_blank" rel="noreferrer">
                            {patientName}
                          </a>
                        ) : (
                          patientName
                        )}
                        {entry.patientId ? (
                          <BookPatientChartButton
                            patientId={String(entry.patientId)}
                            patientName={patientName}
                            practiceId={PRACTICE_ID}
                            practiceTz={practiceTz}
                            label="View patient details"
                            showAlerts
                          />
                        ) : null}
                      </span>
                    </div>
                    <div
                      className="settings-muted"
                      style={{ fontSize: '0.88rem', marginTop: 6, lineHeight: 1.45 }}
                    >
                      {(() => {
                        const visit = forwardBookingOriginalVisitTargetParts(
                          entry,
                          practiceTz,
                          typeCatalogRef.current
                        );
                        const targetStyle =
                          overdue && !hasLinked
                            ? { color: 'var(--danger, #c62828)' }
                            : undefined;
                        if (!visit.hasSource) {
                          return (
                            <>
                              <div>Original Visit: No associated visit</div>
                              <div>
                                Target:{' '}
                                <span style={targetStyle}>{visit.targetDateLabel}</span>
                              </div>
                            </>
                          );
                        }
                        const originalPart = visit.typeName
                          ? `${visit.typeName} - ${visit.sourceDateLabel}`
                          : visit.sourceDateLabel;
                        return (
                          <>
                            <div>Original Visit: {originalPart}</div>
                            <div>
                              Target:{' '}
                              <span style={targetStyle}>{visit.targetDateLabel}</span>
                            </div>
                          </>
                        );
                      })()}
                      <div>Forward booking with: {providerLabel(entry)}</div>
                    </div>
                    {bookAfterIso ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Returns to Needs booking:{' '}
                        <span style={{ fontWeight: 600, color: 'var(--text, #1e293b)' }}>
                          {formatForwardBookingBookAfterDate(bookAfterIso, practiceTz)}
                        </span>
                      </div>
                    ) : null}
                    {bookingNotesDisplay(entry) ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Forward booking note: {bookingNotesDisplay(entry)}
                      </div>
                    ) : null}
                    {linkedStatusLine ? (
                      <div
                        style={{
                          fontSize: '0.88rem',
                          marginTop: 4,
                          fontWeight: 600,
                          color: isOnHold ? '#92400e' : 'var(--text, #1e293b)',
                        }}
                      >
                        {linkedStatusLine}
                        {entry.bookedBy ? (
                          <span className="settings-muted" style={{ fontWeight: 400 }}>
                            {' '}
                            · {employeeLabel(entry.bookedBy)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {isOnHold && onHoldBookedAtLabel ? (
                      <div
                        className="settings-muted"
                        style={{ fontSize: '0.88rem', marginTop: 4, lineHeight: 1.45 }}
                      >
                        Hold placed:{' '}
                        <span style={{ fontWeight: 600, color: 'var(--text, #1e293b)' }}>
                          {onHoldBookedAtLabel}
                        </span>
                        {onHoldElapsedLabel ? (
                          <>
                            {' '}
                            ·{' '}
                            <span style={{ fontWeight: 600, color: 'var(--text, #1e293b)' }}>
                              {onHoldElapsedLabel} ago
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: '0.88rem',
                        color: 'var(--text-muted, #64748b)',
                        width: 'min(100%, 480px)',
                        alignSelf: 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <label
                          htmlFor={`forward-booking-note-${entry.id}`}
                          style={{ fontWeight: 600, color: 'inherit', margin: 0 }}
                        >
                          Notes
                        </label>
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
                          disabled={
                          isRemoved || !noteIsDirty(entry) || Boolean(noteSaving[entry.id])
                        }
                          onClick={() => saveNote(entry)}
                        >
                          {noteSaving[entry.id] ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      <textarea
                        id={`forward-booking-note-${entry.id}`}
                        className="settings-input"
                        rows={2}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          fontFamily: 'inherit',
                          fontSize: 13,
                        }}
                        value={noteDrafts[entry.id] ?? initialNote(entry)}
                        onChange={(e) => onNoteChange(entry.id, e.target.value)}
                        placeholder="e.g. Call client in March"
                        aria-label={`Notes for ${c.name}, ${patientName}`}
                        disabled={isRemoved || Boolean(noteSaving[entry.id])}
                      />
                      {noteError[entry.id] ? (
                        <span style={{ color: '#b91c1c', fontSize: 12, display: 'block', marginTop: 4 }}>
                          {noteError[entry.id]}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      alignItems: 'flex-start',
                      alignSelf: 'center',
                    }}
                  >
                    {isRemoved ? (
                      hasLinked ? (
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => onViewAppointment(entry)}
                          disabled={!entry.bookedAppointmentStart?.trim()}
                        >
                          View appointment
                        </button>
                      ) : null
                    ) : showBookLaterTabActions ? (
                      <>
                        <button type="button" className="btn primary" onClick={() => onBook(entry)}>
                          Book
                        </button>
                        {clientHasSmsPhone(entry) ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => openSmsModal(entry)}
                          >
                            Text Client
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(bookLaterUpdating[entry.id])}
                          onClick={() => void returnForwardBookingToQueue(entry)}
                        >
                          {bookLaterUpdating[entry.id] ? 'Saving…' : 'Back to queue'}
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(bookLaterUpdating[entry.id])}
                          onClick={() => setBookLaterEntry(entry)}
                        >
                          Change date
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(removing[entry.id])}
                          onClick={() => void markForwardBookingRemoved(entry)}
                        >
                          {removing[entry.id] ? 'Removing…' : 'Remove'}
                        </button>
                      </>
                    ) : hasLinked || isComplete ? (
                      <>
                        {clientHasSmsPhone(entry) ? (
                          <button
                            type="button"
                            className={isOnHold && !isComplete ? 'btn primary' : 'btn secondary'}
                            onClick={() => openSmsModal(entry)}
                          >
                            Text Client
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => onViewAppointment(entry)}
                          disabled={!entry.bookedAppointmentStart?.trim()}
                        >
                          View appointment
                        </button>
                        {showBookedFollowUpActions ? (
                          <>
                            <button type="button" className="btn secondary" onClick={() => onBook(entry)}>
                              Reschedule
                            </button>
                            <button
                              type="button"
                              className="btn primary"
                              disabled={Boolean(followUpCompleting[entry.id])}
                              onClick={() => void markFollowUpComplete(entry)}
                            >
                              {followUpCompleting[entry.id] ? 'Saving…' : 'Mark Complete'}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(removing[entry.id])}
                          onClick={() => void markForwardBookingRemoved(entry)}
                        >
                          {removing[entry.id] ? 'Removing…' : 'Remove'}
                        </button>
                      </>
                    ) : showPendingQueueActions ? (
                      <>
                        {clientHasSmsPhone(entry) ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => openSmsModal(entry)}
                          >
                            Text Client
                          </button>
                        ) : null}
                        {showSameTargetGroupBook ? (
                          <button
                            type="button"
                            className="btn primary"
                            onClick={() => onBookHousehold(sameTargetPeers, entry)}
                          >
                            {forwardBookingGroupBookButtonLabel(sameTargetPeers.length)}
                          </button>
                        ) : null}
                        {showSingleBook ? (
                          <button type="button" className="btn primary" onClick={() => onBook(entry)}>
                            Book
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setBookLaterEntry(entry)}
                        >
                          Book later…
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setManualCompleteEntry(entry)}
                        >
                          Mark complete…
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(removing[entry.id])}
                          onClick={() => void markForwardBookingRemoved(entry)}
                        >
                          {removing[entry.id] ? 'Removing…' : 'Remove'}
                        </button>
                      </>
                    ) : null}
                    {bookLaterError[entry.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {bookLaterError[entry.id]}
                      </span>
                    ) : null}
                    {removeError[entry.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {removeError[entry.id]}
                      </span>
                    ) : null}
                    {followUpCompleteError[entry.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {followUpCompleteError[entry.id]}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
        {useWorkflowListPagination && filtered.length > WORKFLOW_LIST_PAGE_SIZE ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
            }}
          >
            <p className="settings-muted" style={{ margin: 0 }}>
              Showing {(listPage - 1) * WORKFLOW_LIST_PAGE_SIZE + 1}–
              {Math.min(listPage * WORKFLOW_LIST_PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn secondary"
                disabled={listPage <= 1}
                onClick={() => {
                  setListPage((page) => page - 1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Previous
              </button>
              <span className="settings-muted" style={{ fontSize: 14 }}>
                Page {listPage} of {workflowListTotalPages}
              </span>
              <button
                type="button"
                className="btn secondary"
                disabled={listPage >= workflowListTotalPages}
                onClick={() => {
                  setListPage((page) => page + 1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
        </>
      )}

      {createOpen ? (
        <CreateForwardBookingModal
          practiceId={PRACTICE_ID}
          prefill={createPrefill}
          onClose={() => finishCreateForwardBooking(createReturnTo)}
          onCreated={(entry) => {
            const returnPath = createReturnTo;
            finishCreateForwardBooking(returnPath);
            if (returnPath) return;
            setStatusFilter('pending');
            setHighlightEntryId(entry.id);
            highlightScrollSig.current = `${entry.id}-${Date.now()}`;
            void load();
          }}
        />
      ) : null}

      {manualCompleteEntry ? (
        <ForwardBookingManualCompleteModal
          entry={manualCompleteEntry}
          onClose={() => setManualCompleteEntry(null)}
          onCompleted={mergeEntry}
        />
      ) : null}

      {bookLaterEntry ? (
        <ForwardBookingBookLaterModal
          entry={bookLaterEntry}
          practiceTz={practiceTz}
          onClose={() => setBookLaterEntry(null)}
          onSaved={mergeBookLaterEntry}
        />
      ) : null}

      {smsEntry ? (
        <ClientSmsComposeModal
          open
          clientLabel={clientDisplay(smsEntry).name}
          message={smsMessage}
          onMessageChange={setSmsMessage}
          onClose={closeSmsModal}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={() => openMessagesHistory(smsEntry)}
          sending={smsSending}
          sendError={smsError}
          fromLineLabel={smsFromLine}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesClientId != null}
        clientId={messagesClientId}
        clientLabel={messagesClientLabel}
        onClose={() => {
          setMessagesClientId(null);
          setMessagesClientLabel('');
        }}
      />
    </div>
  );
}
