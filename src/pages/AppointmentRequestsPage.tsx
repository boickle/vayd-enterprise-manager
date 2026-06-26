import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  fetchAllAppointmentRequestSubmissions,
  fetchAppointmentRequestSubmission,
  fetchAppointmentRequestSubmissionsPage,
  fetchRemainingAppointmentRequestSubmissionPages,
  patchAppointmentRequestSubmission,
  sendAppointmentRequestSubmissionSms,
  type AppointmentRequestSubmission,
  type AppointmentRequestSubmissionItem,
  type AppointmentRequestSubmissionStatus,
} from '../api/appointmentRequestSubmissions';
import {
  fetchAppointmentFormDraft,
  patchAppointmentFormDraft,
  type AppointmentFormDraftDetail,
  type AppointmentFormDraftFollowUpStatus,
} from '../api/appointmentFormDrafts';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { AppointmentRequestDetailPanel } from '../components/AppointmentRequestDetailPanel';
import { AppointmentRequestPdfDownloadLink } from '../components/AppointmentRequestPdfDownloadLink';
import { AppointmentRequestPetSummaryList } from '../components/AppointmentRequestPetSummaryList';
import {
  AppointmentRequestManualBookModal,
  appointmentRequestHasSmsPhone,
} from '../components/AppointmentRequestManualBookModal';
import {
  clientDisplayNameFromRequestData,
  formatRequestDataAddress,
  isEuthanasiaRequestData,
  requestDataAnythingElse,
  requestDataAppointmentTypeLabel,
  requestDataCanText,
  requestDataClientType,
  requestDataHadVetCareElsewhere,
  requestDataHowSoon,
  requestDataHowSoonUrgency,
  requestDataMayWeAskForRecords,
  requestDataPetSummary,
  requestDataPhone,
  requestDataPreferredDoctor,
  requestDataPreviousVeterinaryHospitals,
  requestDataPreviousVeterinaryPractices,
  requestDataPrimaryProviderSummary,
  requestDataSelfScheduledSlot,
  requestDataUsesAlternateVisitAddress,
  fetchClientPimsIdLookup,
  resolveClientPimsIdForRequest,
} from '../utils/appointmentRequestDisplay';
import {
  linkedEvetIdsFromBookedApptSummary,
  resolveClientPimsIdForRequestCard,
} from '../utils/appointmentRequestLinkedEvet';
import { resolveAppointmentRequestSmsMessage } from '../utils/appointmentRequestSmsMessage';
import { evetClientLink } from '../utils/evet';
import { AppointmentRequestClientNameChange } from '../components/AppointmentRequestClientNameChange';
import { AppointmentRequestAlternateAddressCallout } from '../components/AppointmentRequestAlternateAddressCallout';
import { EvetNameLink } from '../components/EvetNameLink';
import {
  buildRoutingAppointmentRequestIntentFromSubmission,
  writeRoutingAppointmentRequestIntent,
} from '../utils/routingAppointmentRequestIntent';
import {
  clearAppointmentRequestReturnSession,
  readAppointmentRequestReturnSession,
} from '../utils/appointmentRequestReturnSession';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import {
  buildAppointmentTypeCatalogFromTypes,
} from '../utils/forwardBookingListVisibility';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
} from '../utils/schedulerFocusAppointment';
import { notifySchedulingToolsNavCountsRefresh } from '../hooks/useSchedulingToolsNavCounts';
import {
  subscribePracticeCalendar,
  type AppointmentCalendarPayload,
  type AppointmentRequestSubmissionPayload,
} from '../utils/calendarRealtime';
import {
  initialNotesFromItem,
  isNoteDraftDirty,
  mergeNoteDraftsAfterListRefresh,
  noteForPatch,
} from '../utils/appointmentRequestNoteDrafts';
import {
  appointmentRequestSubmissionIsOnHold,
  appointmentRequestSubmissionCountsAsBooked,
  appointmentRequestOnHoldOver24Hours,
  formatAppointmentRequestOnHoldBookedAt,
  formatAppointmentRequestOnHoldElapsedSince,
  type AppointmentRequestBookedApptSummary,
} from '../utils/appointmentRequestOnHold';
import {
  buildAppointmentRequestBookedMetaByAppointmentIds,
  calendarChangeAffectsAppointmentRequestHolds,
  patchBookedApptMetaForAppointmentIds,
} from '../utils/appointmentRequestHouseholdHold';
import {
  appointmentRequestAutoBookedOnline,
  appointmentRequestNeedsStaffConfirmation,
} from '../utils/appointmentRequestStaffConfirm';
import {
  clearAppointmentRequestStaffConfirmReturnSession,
  readAppointmentRequestStaffConfirmReturnSession,
  writeAppointmentRequestStaffConfirmSession,
} from '../utils/appointmentRequestStaffConfirmSession';
import {
  clearOnHoldVisitEditReturnSession,
  readOnHoldVisitEditReturnSession,
  writeOnHoldVisitEditSession,
  type OnHoldVisitEditReturnV1,
} from '../utils/onHoldVisitEditSession';
import {
  APPOINTMENT_REQUESTS_LIST_PATH,
  appointmentRequestsOnHoldOver24FromSearch,
  appointmentRequestsPathForTab,
  parseAppointmentRequestsTabFromLocation,
  type AppointmentRequestListTab,
} from '../appointments-nav';
import {
  appointmentRequestsListPathMatches,
  resolveAppointmentsListEntryTab,
  writeAppointmentRequestListReturnTab,
} from '../utils/appointmentRequestListReturnTab';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type BookedApptSummary = AppointmentRequestBookedApptSummary;

type StatusFilter = AppointmentRequestListTab;

type AppointmentRequestsPageProps = {
  /** @deprecated Tab is read from the URL (`?tab=` or `/on-hold`). */
  initialTab?: StatusFilter;
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'to_confirm', label: 'Auto-Booked' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'need_records', label: 'Need Records' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'booked', label: 'Booked' },
  { key: 'dismissed', label: 'Not Booked' },
];

const NOT_BOOKED_REASON_OPTIONS = [
  'Aggression concerns',
  'Client Never Wrote back',
  'Found Another Practice',
  'Not appropriate for house call',
  'Not needed anymore',
  'Not ready to schedule',
  'Out of Area',
  'No availability during desired timeframe',
  'Test/Fake Request',
  'Too Expensive',
  'Wanted outside of Business hours',
] as const;

const NOT_BOOKED_REASON_OTHER = 'other';

/** Booked / Not Booked lists can grow large — paginate and hide tab counts. */
const ARCHIVE_LIST_TABS = new Set<StatusFilter>(['booked', 'dismissed']);
const ARCHIVE_LIST_PAGE_SIZE = 25;

function tabShowsCount(tab: StatusFilter): boolean {
  return !ARCHIVE_LIST_TABS.has(tab);
}

const FOLLOW_UP_OPTIONS: { value: AppointmentFormDraftFollowUpStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'dismissed', label: 'Dismissed' },
];

function applyLinkedVisitPointsFromMeta(
  row: AppointmentRequestSubmissionItem,
  meta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
): AppointmentRequestSubmissionItem {
  const apptId = row.bookedAppointmentId;
  if (apptId == null) return row;
  if (row.linkedVisitPoints != null && Number.isFinite(row.linkedVisitPoints)) {
    return row;
  }
  const summary = meta.get(Number(apptId));
  if (!summary || summary.appointmentCancelled) return row;
  return { ...row, linkedVisitPoints: summary.points };
}

function submissionDetailToListItem(row: AppointmentRequestSubmission): AppointmentRequestSubmissionItem {
  return { ...row, kind: 'submission' };
}

function isCompletedSubmission(item: AppointmentRequestSubmissionItem): boolean {
  return item.kind == null || item.kind === 'submission';
}

function isAbandonedItem(item: AppointmentRequestSubmissionItem): boolean {
  return item.kind === 'abandoned';
}

function submissionStatus(item: AppointmentRequestSubmissionItem): AppointmentRequestSubmissionStatus {
  return item.status ?? 'new';
}

function submissionNeedsRecords(item: AppointmentRequestSubmissionItem): boolean {
  return item.needsRecords === true;
}

function initialNotes(item: AppointmentRequestSubmissionItem): string {
  return initialNotesFromItem(item);
}

function statusTabLabel(
  item: AppointmentRequestSubmissionItem,
  status: AppointmentRequestSubmissionStatus,
  opts?: { isOnHold?: boolean },
): string {
  if (opts?.isOnHold) return 'On hold';
  const linkedPoints = item.linkedVisitPoints;
  if (
    item.bookedAppointmentId != null &&
    linkedPoints != null &&
    Number.isFinite(linkedPoints) &&
    linkedPoints <= 0
  ) {
    return 'On hold';
  }
  if (appointmentRequestNeedsStaffConfirmation(item)) return 'Auto-Booked';
  const tab = STATUS_TABS.find((t) => t.key === status);
  return tab?.label ?? status;
}

function submissionSearchHaystack(
  item: AppointmentRequestSubmissionItem,
  noteDrafts: Record<number, string>,
): string {
  const rd = item.requestData ?? {};
  const notes = (noteDrafts[item.id] ?? initialNotes(item)).toLowerCase();
  return [
    clientDisplayNameFromRequestData(rd),
    requestDataPhone(rd) ?? '',
    requestDataPetSummary(rd),
    requestDataPreferredDoctor(rd) ?? '',
    requestDataPrimaryProviderSummary(rd) ?? '',
    requestDataHowSoon(rd) ?? '',
    requestDataHowSoonUrgency(rd) ?? '',
    formatRequestDataAddress(rd) ?? '',
    requestDataAnythingElse(rd) ?? '',
    requestDataPreviousVeterinaryPractices(rd) ?? '',
    requestDataPreviousVeterinaryHospitals(rd) ?? '',
    rd.email,
    notes,
    item.notBookedReason ?? '',
    submissionNeedsRecords(item) ? 'need records' : '',
    statusTabLabel(item, submissionStatus(item)),
  ]
    .join(' ')
    .toLowerCase();
}

function abandonedSearchHaystack(item: AppointmentRequestSubmissionItem): string {
  const rd = item.requestData ?? {};
  return [
    clientDisplayNameFromRequestData(rd),
    requestDataPhone(rd) ?? '',
    requestDataPetSummary(rd),
    item.currentStepName ?? '',
    item.abandonReason ?? '',
    'abandoned form',
  ]
    .join(' ')
    .toLowerCase();
}

function matchesSearchQuery(haystack: string, query: string): boolean {
  return haystack.includes(query);
}

function apptRequestRowClassName(opts: {
  rowExiting: boolean;
  exitKind?: 'booked' | 'dismissed' | 'contacted';
  rowHighlighted: boolean;
  isBooked: boolean;
}): string {
  const parts = ['appt-request-row'];
  if (opts.isBooked && !opts.rowExiting) parts.push('appt-request-row--booked');
  if (opts.rowHighlighted) {
    if (opts.exitKind === 'booked') parts.push('appt-request-row--highlight-booked');
    else if (opts.exitKind === 'dismissed') parts.push('appt-request-row--highlight-dismissed');
    else if (opts.exitKind === 'contacted') parts.push('appt-request-row--highlight-contacted');
    else parts.push('appt-request-row--highlight');
  }
  if (opts.rowExiting && opts.exitKind) {
    parts.push(`appt-request-row--exiting appt-request-row--exiting-${opts.exitKind}`);
  }
  return parts.join(' ');
}

function formatSubmittedAt(iso: string, practiceTz: string): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '—';
  return dt.toFormat('EEE, MMM d, yyyy · h:mm a');
}

function appointmentRequestViewHints(
  item: AppointmentRequestSubmissionItem,
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
  practiceTz: string,
): { dateKey: string | null; providerId: string | undefined } {
  const apptId = item.bookedAppointmentId;
  const cached = apptId != null ? bookedApptMeta.get(Number(apptId)) : undefined;
  const rd = item.requestData ?? {};
  const start =
    cached?.start?.trim() ||
    requestDataSelfScheduledSlot(rd)?.appointmentStart?.trim() ||
    null;
  const dateKey = start
    ? DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz).toISODate()
    : null;
  const providerId = cached?.providerInternalId?.trim() || undefined;
  return { dateKey, providerId };
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

function formatLinkedVisitLine(
  summary: BookedApptSummary,
  practiceTz: string,
  requestTypeName?: string | null,
): string {
  const visit = formatBookedVisit(summary.start, summary.end, practiceTz);
  const typeName = summary.typeName?.trim() || requestTypeName?.trim() || null;
  const provider = summary.providerName?.trim() || null;
  const providerPart = provider ? ` with ${provider}` : '';
  const isOnHold = summary.points <= 0;
  if (isOnHold) {
    return typeName
      ? `On hold${providerPart} — ${typeName}: ${visit}`
      : `On hold${providerPart}: ${visit}`;
  }
  return typeName
    ? `Booked${providerPart} — ${typeName}: ${visit}`
    : `Booked${providerPart}: ${visit}`;
}

export default function AppointmentRequestsPage(_props: AppointmentRequestsPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const practiceTz = practiceTimeZoneOrDefault(undefined);

  const statusFilter = useMemo(
    () => parseAppointmentRequestsTabFromLocation(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const onHoldOver24Only = useMemo(
    () => statusFilter === 'on_hold' && appointmentRequestsOnHoldOver24FromSearch(location.search),
    [statusFilter, location.search],
  );

  const goToTab = useCallback(
    (tab: StatusFilter, opts?: { onHoldOver24Only?: boolean; replace?: boolean }) => {
      navigate(
        appointmentRequestsPathForTab(tab, {
          onHoldOver24Only: tab === 'on_hold' ? (opts?.onHoldOver24Only ?? onHoldOver24Only) : false,
        }),
        {
          replace: opts?.replace,
          state: { appointmentsTab: tab },
        },
      );
    },
    [navigate, onHoldOver24Only],
  );

  useEffect(() => {
    const resolved = resolveAppointmentsListEntryTab(
      location.pathname,
      location.search,
      location.state,
    );
    if (resolved === 'default_new') {
      navigate(APPOINTMENT_REQUESTS_LIST_PATH, { replace: true });
      return;
    }
    if (resolved == null) return;

    const onHoldOver24 =
      resolved === 'on_hold' && appointmentRequestsOnHoldOver24FromSearch(location.search);
    if (
      !appointmentRequestsListPathMatches(location.pathname, location.search, resolved, {
        onHoldOver24Only: onHoldOver24,
      })
    ) {
      navigate(appointmentRequestsPathForTab(resolved, { onHoldOver24Only: onHoldOver24 }), {
        replace: true,
      });
    }
  }, [location.pathname, location.search, location.key, location.state, navigate]);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AppointmentRequestSubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversionsBanner, setConversionsBanner] = useState<string | null>(null);

  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [noteError, setNoteError] = useState<Record<number, string | null>>({});

  const [statusUpdating, setStatusUpdating] = useState<Record<number, boolean>>({});
  const [statusError, setStatusError] = useState<Record<number, string | null>>({});
  const [needsRecordsUpdating, setNeedsRecordsUpdating] = useState<Record<number, boolean>>({});
  const [needsRecordsError, setNeedsRecordsError] = useState<Record<number, string | null>>({});

  const [smsItem, setSmsItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsMessageLoading, setSmsMessageLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  const [manualBookModal, setManualBookModal] = useState<{
    item: AppointmentRequestSubmissionItem;
    relink: boolean;
  } | null>(null);
  const [notBookedItem, setNotBookedItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [notBookedReasonChoice, setNotBookedReasonChoice] = useState('');
  const [notBookedReasonOther, setNotBookedReasonOther] = useState('');
  const [notBookedSaving, setNotBookedSaving] = useState(false);
  const [notBookedError, setNotBookedError] = useState<string | null>(null);
  const [bookedApptMeta, setBookedApptMeta] = useState<Map<number, BookedApptSummary>>(new Map());
  const [clientPimsIdByInternalId, setClientPimsIdByInternalId] = useState<Map<string, string>>(
    () => new Map(),
  );

  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  const [exitingRows, setExitingRows] = useState<Map<number, 'booked' | 'dismissed' | 'contacted'>>(
    () => new Map(),
  );
  const [pendingBookedExitId, setPendingBookedExitId] = useState<number | null>(null);
  const [pendingOnHoldExit, setPendingOnHoldExit] = useState<{
    entryId: number;
    kind: 'booked' | 'dismissed';
  } | null>(null);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const highlightScrollSig = useRef('');
  const exitRowTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const pendingOnHoldEditReturnRef = useRef<OnHoldVisitEditReturnV1 | null>(null);

  const [expandedRowIds, setExpandedRowIds] = useState<Set<number>>(() => new Set());
  const [listPage, setListPage] = useState(1);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const noteDraftsRef = useRef(noteDrafts);
  noteDraftsRef.current = noteDrafts;
  const bookedApptMetaRef = useRef(bookedApptMeta);
  bookedApptMetaRef.current = bookedApptMeta;
  const typeCatalogRef = useRef<ReturnType<typeof buildAppointmentTypeCatalogFromTypes> | null>(null);
  const [typeCatalog, setTypeCatalog] = useState<ReturnType<
    typeof buildAppointmentTypeCatalogFromTypes
  > | null>(null);
  const deferredRealtimeRefreshRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const knownSubmissionIdsRef = useRef<Set<number>>(new Set());
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const hydrateGenerationRef = useRef(0);
  const submissionBackfillGenRef = useRef(0);

  const toggleRowExpanded = (id: number) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [draftDetailOpen, setDraftDetailOpen] = useState(false);
  const [draftDetailLoading, setDraftDetailLoading] = useState(false);
  const [draftDetail, setDraftDetail] = useState<AppointmentFormDraftDetail | null>(null);
  const [draftFollowUpStatus, setDraftFollowUpStatus] =
    useState<AppointmentFormDraftFollowUpStatus>('pending');
  const [draftFollowUpNotes, setDraftFollowUpNotes] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);

  const hydrateBookedApptMeta = useCallback(
    async (
      items: AppointmentRequestSubmissionItem[],
      typeCatalog: ReturnType<typeof buildAppointmentTypeCatalogFromTypes>,
      opts?: { seedMeta?: Map<number, BookedApptSummary>; merge?: boolean },
    ) => {
      const bookedIds = items
        .filter((r) => isCompletedSubmission(r) && r.bookedAppointmentId != null)
        .map((r) => Number(r.bookedAppointmentId));
      const uniqueBooked = [...new Set(bookedIds.filter((id) => Number.isFinite(id)))];
      if (uniqueBooked.length === 0) {
        if (!opts?.merge) {
          setBookedApptMeta(new Map());
        }
        return new Map();
      }

      const generation = ++hydrateGenerationRef.current;

      const meta = await buildAppointmentRequestBookedMetaByAppointmentIds({
        appointmentIds: uniqueBooked,
        practiceId: PRACTICE_ID,
        typeCatalog,
        seedMeta: opts?.seedMeta,
      });

      if (generation !== hydrateGenerationRef.current) return new Map();

      setBookedApptMeta((prev) => {
        if (meta.size === 0 && prev.size > 0) return prev;
        const next = new Map(meta);
        for (const [id, summary] of prev) {
          if (!next.has(id)) next.set(id, summary);
        }
        return next;
      });
      return meta;
    },
    [practiceTz],
  );

  const load = useCallback(async (opts?: { silent?: boolean; awaitHydration?: boolean }) => {
    const silent = opts?.silent ?? false;
    const awaitHydration = opts?.awaitHydration ?? false;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;

    const isOnHoldTab = statusFilterRef.current === 'on_hold';
    if (isOnHoldTab && !silent) {
      const pendingOnHoldReturn = readOnHoldVisitEditReturnSession();
      if (pendingOnHoldReturn?.listKind === 'appointment_request') {
        clearOnHoldVisitEditReturnSession();
        pendingOnHoldEditReturnRef.current = pendingOnHoldReturn;
      }
    }

    if (!silent) {
      setLoading(true);
      setError(null);
      setClientPimsIdByInternalId(new Map());
    }

    try {
      const pendingReturn = silent ? null : readAppointmentRequestReturnSession();
      const pendingStaffConfirmReturn = silent
        ? null
        : readAppointmentRequestStaffConfirmReturnSession();
      let highlightId: number | null = null;
      let openSmsOnHighlight = false;
      if (pendingReturn) {
        clearAppointmentRequestReturnSession();
        highlightId = pendingReturn.appointmentRequestSubmissionId;
        setPendingBookedExitId(highlightId);
        openSmsOnHighlight = true;
      } else if (pendingStaffConfirmReturn) {
        clearAppointmentRequestStaffConfirmReturnSession();
        highlightId = pendingStaffConfirmReturn.submissionId;
        setPendingBookedExitId(highlightId);
      }

      const seedMeta =
        pendingReturn != null
          ? new Map<number, BookedApptSummary>([
              [
                pendingReturn.bookedAppointmentId,
                {
                  start: pendingReturn.bookedAppointmentStart,
                  end: pendingReturn.bookedAppointmentEnd,
                  typeName: null,
                  providerName: null,
                  providerInternalId: null,
                  points: 1,
                  description: null,
                  instructions: null,
                },
              ],
            ])
          : undefined;

      const applySubmissionRows = (
        items: AppointmentRequestSubmissionItem[],
        conversions: { converted: number; totalRequests: number } | null,
        opts: { isPartialBackfill?: boolean },
      ) => {
        const previousRows = rowsRef.current;
        const previousIds = knownSubmissionIdsRef.current;
        const newSubmissionCount = silent
          ? items.filter((r) => isCompletedSubmission(r) && !previousIds.has(r.id)).length
          : 0;

        setRows(items);
        setNoteDrafts((drafts) =>
          silent || opts.isPartialBackfill
            ? mergeNoteDraftsAfterListRefresh(drafts, previousRows, items, isCompletedSubmission)
            : (() => {
                const next: Record<number, string> = {};
                for (const r of items) {
                  if (isCompletedSubmission(r)) next[r.id] = initialNotes(r);
                }
                return next;
              })(),
        );
        if (!silent && !opts.isPartialBackfill) {
          setNoteSaving({});
          setNoteError({});
        }

        knownSubmissionIdsRef.current = new Set(items.map((r) => r.id));

        if (conversions && conversions.totalRequests > 0) {
          const rate = ((conversions.converted / conversions.totalRequests) * 100).toFixed(1);
          setConversionsBanner(
            `${conversions.converted} of ${conversions.totalRequests} requests converted to appointments (${rate}%).`,
          );
        } else if (!silent && !opts.isPartialBackfill) {
          setConversionsBanner(null);
        }

        if (highlightId != null) {
          const entry = items.find((r) => r.id === highlightId);
          if (entry) {
            setHighlightEntryId(highlightId);
            highlightScrollSig.current = `${highlightId}-${Date.now()}`;
            if (openSmsOnHighlight && appointmentRequestHasSmsPhone(entry)) {
              setSmsError(null);
              setSmsItem(entry);
              setSmsMessage('');
              setSmsMessageLoading(true);
              void resolveAppointmentRequestSmsMessage(entry, practiceTz, { practiceId: PRACTICE_ID })
                .then(setSmsMessage)
                .finally(() => setSmsMessageLoading(false));
            }
          }
        }

        if (silent && newSubmissionCount > 0) {
          setNotice(
            newSubmissionCount === 1
              ? '1 new appointment request arrived.'
              : `${newSubmissionCount} new appointment requests arrived.`,
          );
        }
      };

      const finishInitialLoadUi = () => {
        if (!silent) {
          const pendingOnHoldReturn = pendingOnHoldEditReturnRef.current;
          if (pendingOnHoldReturn) {
            pendingOnHoldEditReturnRef.current = null;
            if (
              pendingOnHoldReturn.exitKind === 'booked' ||
              pendingOnHoldReturn.exitKind === 'removed'
            ) {
              setPendingOnHoldExit({
                entryId: pendingOnHoldReturn.listEntryId,
                kind: pendingOnHoldReturn.exitKind === 'booked' ? 'booked' : 'dismissed',
              });
            } else {
              setHighlightEntryId(pendingOnHoldReturn.listEntryId);
              highlightScrollSig.current = `${pendingOnHoldReturn.listEntryId}-${Date.now()}`;
            }
          }
        }
      };

      const runHouseholdHydration = async (items: AppointmentRequestSubmissionItem[]) => {
        const meta = await hydrateBookedApptMeta(items, typeCatalog, {
          seedMeta,
          merge: silent,
        });
        if (meta && meta.size > 0) {
          setRows((prev) => prev.map((row) => applyLinkedVisitPointsFromMeta(row, meta)));
        }
        void fetchClientPimsIdLookup(items.map((r) => r.requestData ?? {})).then((lookup) => {
          setClientPimsIdByInternalId((prev) => (silent ? new Map([...prev, ...lookup]) : lookup));
        });
      };

      if (!silent) {
        const [types, firstPage] = await Promise.all([
          fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }),
          fetchAppointmentRequestSubmissionsPage({
            practiceId: PRACTICE_ID,
            page: 1,
            limit: 200,
          }),
        ]);
        const typeCatalog = buildAppointmentTypeCatalogFromTypes(types);
        typeCatalogRef.current = typeCatalog;
        setTypeCatalog(typeCatalog);

        const initialItems = firstPage.items ?? [];
        applySubmissionRows(initialItems, firstPage.conversions ?? null, {});
        finishInitialLoadUi();

        const runBackfillAndHydrate = async (backfillGen: number) => {
          const allItems = await fetchRemainingAppointmentRequestSubmissionPages(
            { practiceId: PRACTICE_ID },
            firstPage,
          );
          if (backfillGen !== submissionBackfillGenRef.current) return;
          if (allItems.length !== initialItems.length) {
            applySubmissionRows(allItems, firstPage.conversions ?? null, {
              isPartialBackfill: true,
            });
          }
          await runHouseholdHydration(allItems);
        };

        if (awaitHydration) {
          await runBackfillAndHydrate(++submissionBackfillGenRef.current);
          return;
        }

        const backfillGen = ++submissionBackfillGenRef.current;
        void (async () => {
          try {
            await runBackfillAndHydrate(backfillGen);
          } catch (e) {
            console.error('appointment request household hydrate failed', e);
          }
        })();
        return;
      }

      const [{ items, conversions }, types] = await Promise.all([
        fetchAllAppointmentRequestSubmissions({ practiceId: PRACTICE_ID }),
        fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }),
      ]);
      const typeCatalog = buildAppointmentTypeCatalogFromTypes(types);
      typeCatalogRef.current = typeCatalog;
      setTypeCatalog(typeCatalog);
      applySubmissionRows(items, conversions, {});
      await runHouseholdHydration(items);
      finishInitialLoadUi();
    } catch (e: unknown) {
      if (!silent) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Failed to load appointment requests';
        setError(String(msg));
        setRows([]);
      }
    } finally {
      loadInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [hydrateBookedApptMeta, practiceTz]);

  useEffect(() => {
    void load();
  }, [load]);

  const isRefreshBusy = useCallback(() => {
    if (loading) return true;
    if (smsItem) return true;
    if (manualBookModal) return true;
    if (notBookedItem) return true;
    if (draftDetailOpen) return true;
    if (notBookedSaving) return true;
    if (smsSending) return true;
    if (draftSaving) return true;
    if (Object.values(noteSaving).some(Boolean)) return true;
    if (Object.values(statusUpdating).some(Boolean)) return true;
    if (Object.values(needsRecordsUpdating).some(Boolean)) return true;
    return false;
  }, [
    loading,
    smsItem,
    manualBookModal,
    notBookedItem,
    draftDetailOpen,
    notBookedSaving,
    smsSending,
    draftSaving,
    noteSaving,
    statusUpdating,
    needsRecordsUpdating,
  ]);

  const isRefreshBusyRef = useRef(isRefreshBusy);
  isRefreshBusyRef.current = isRefreshBusy;

  const flushDeferredRealtimeRefresh = useCallback(() => {
    if (!deferredRealtimeRefreshRef.current) return;
    if (isRefreshBusyRef.current()) return;
    deferredRealtimeRefreshRef.current = false;
    void load({ silent: true });
  }, [load]);

  const applySubmissionRealtimeBatch = useCallback(
    async (payloads: AppointmentRequestSubmissionPayload[]) => {
      if (isRefreshBusyRef.current()) {
        deferredRealtimeRefreshRef.current = true;
        return;
      }
      const catalog = typeCatalogRef.current;
      if (!catalog) {
        deferredRealtimeRefreshRef.current = true;
        return;
      }

      const previousIds = knownSubmissionIdsRef.current;
      const ids = [...new Set(payloads.map((p) => p.submissionId))];
      const fetched = await Promise.all(
        ids.map((id) => fetchAppointmentRequestSubmission(id).catch(() => null)),
      );

      let mergedRows = rowsRef.current;
      let newCount = 0;
      for (const row of fetched) {
        if (!row) continue;
        const item = submissionDetailToListItem(row);
        const idx = mergedRows.findIndex((r) => r.id === row.id);
        if (idx >= 0) {
          mergedRows = [...mergedRows];
          mergedRows[idx] = { ...mergedRows[idx], ...item };
        } else {
          mergedRows = [item, ...mergedRows];
          if (!previousIds.has(row.id)) newCount += 1;
        }
        knownSubmissionIdsRef.current.add(row.id);
      }

      setRows(mergedRows);
      setNoteDrafts((drafts) => {
        const next = { ...drafts };
        for (const row of fetched) {
          if (!row) continue;
          if (!(row.id in next)) next[row.id] = initialNotes(submissionDetailToListItem(row));
        }
        return next;
      });

      if (newCount > 0) {
        setNotice(
          newCount === 1
            ? '1 new appointment request arrived.'
            : `${newCount} new appointment requests arrived.`,
        );
      }

      await hydrateBookedApptMeta(mergedRows, catalog, { seedMeta: undefined });
    },
    [hydrateBookedApptMeta],
  );

  const applyCalendarRealtimeBatch = useCallback(
    async (payloads: AppointmentCalendarPayload[]) => {
      if (isRefreshBusyRef.current()) {
        deferredRealtimeRefreshRef.current = true;
        return;
      }
      const catalog = typeCatalogRef.current;
      if (!catalog) return;

      const changedApptIds = new Set(payloads.map((p) => p.appointmentId));
      const currentRows = rowsRef.current;
      if (
        !calendarChangeAffectsAppointmentRequestHolds(
          changedApptIds,
          currentRows,
          bookedApptMetaRef.current,
        )
      ) {
        return;
      }

      const patches = await patchBookedApptMetaForAppointmentIds({
        appointmentIds: [...changedApptIds],
        practiceId: PRACTICE_ID,
        typeCatalog: catalog,
      });
      if (patches.size > 0) {
        setBookedApptMeta((prev) => {
          const next = new Map(prev);
          for (const [id, summary] of patches) next.set(id, summary);
          return next;
        });
        setRows((prev) =>
          prev.map((row) => {
            const apptId = row.bookedAppointmentId;
            if (apptId == null) return row;
            const patch = patches.get(Number(apptId));
            if (!patch || patch.appointmentCancelled) return row;
            return { ...row, linkedVisitPoints: patch.points };
          }),
        );
      }

      void hydrateBookedApptMeta(currentRows, catalog);
    },
    [hydrateBookedApptMeta],
  );

  useEffect(() => {
    return subscribePracticeCalendar({
      practiceId: PRACTICE_ID,
      visibleProviderId: '',
      onBatch: (payloads) => {
        void applyCalendarRealtimeBatch(payloads).finally(flushDeferredRealtimeRefresh);
      },
      onRequestSubmissionBatch: (payloads) => {
        void applySubmissionRealtimeBatch(payloads).finally(flushDeferredRealtimeRefresh);
      },
      onReconnect: () => {
        if (isRefreshBusyRef.current()) {
          deferredRealtimeRefreshRef.current = true;
          return;
        }
        void load({ silent: true });
      },
    });
  }, [applyCalendarRealtimeBatch, applySubmissionRealtimeBatch, flushDeferredRealtimeRefresh, load]);

  useEffect(() => {
    flushDeferredRealtimeRefresh();
  }, [
    flushDeferredRealtimeRefresh,
    loading,
    smsItem,
    manualBookModal,
    notBookedItem,
    draftDetailOpen,
    notBookedSaving,
    smsSending,
    draftSaving,
    noteSaving,
    statusUpdating,
    needsRecordsUpdating,
  ]);

  useEffect(() => {
    try {
      const msg = sessionStorage.getItem('vayd:appointment-request-return-toast');
      if (!msg) return;
      sessionStorage.removeItem('vayd:appointment-request-return-toast');
      setNotice(msg);
    } catch {
      /* ignore */
    }
  }, []);

  const submissions = useMemo(() => rows.filter(isCompletedSubmission), [rows]);
  const abandoned = useMemo(() => rows.filter(isAbandonedItem), [rows]);
  const isSearchActive = search.trim().length > 0;

  const tabCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      new: 0,
      contacted: 0,
      booked: 0,
      dismissed: 0,
      need_records: 0,
      on_hold: 0,
      to_confirm: 0,
    };
    for (const row of submissions) {
      const status = submissionStatus(row);
      if (appointmentRequestSubmissionIsOnHold(row, bookedApptMeta, typeCatalog)) {
        counts.on_hold += 1;
        if (submissionNeedsRecords(row)) counts.need_records += 1;
        continue;
      }
      if (appointmentRequestNeedsStaffConfirmation(row)) {
        counts.to_confirm += 1;
        if (submissionNeedsRecords(row)) counts.need_records += 1;
        continue;
      }
      counts[status] += 1;
      if (submissionNeedsRecords(row)) counts.need_records += 1;
    }
    return counts;
  }, [submissions, bookedApptMeta, typeCatalog]);

  const onHoldOver24Count = useMemo(() => {
    let count = 0;
    for (const row of submissions) {
      if (!appointmentRequestSubmissionIsOnHold(row, bookedApptMeta, typeCatalog)) continue;
      const summary =
        row.bookedAppointmentId != null
          ? bookedApptMeta.get(Number(row.bookedAppointmentId))
          : undefined;
      if (appointmentRequestOnHoldOver24Hours(summary)) count += 1;
    }
    return count;
  }, [submissions, bookedApptMeta, typeCatalog]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortNewestFirst = (a: AppointmentRequestSubmissionItem, b: AppointmentRequestSubmissionItem) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();

    if (statusFilter === 'on_hold') {
      return submissions
        .filter((item) => {
          if (exitingRows.has(item.id)) return true;
          if (!appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog))
            return false;
          if (onHoldOver24Only) {
            const summary =
              item.bookedAppointmentId != null
                ? bookedApptMeta.get(Number(item.bookedAppointmentId))
                : undefined;
            return appointmentRequestOnHoldOver24Hours(summary);
          }
          return true;
        })
        .filter((item) => !q || matchesSearchQuery(submissionSearchHaystack(item, noteDrafts), q))
        .sort(sortNewestFirst);
    }

    if (q) {
      const submissionMatches = submissions.filter((item) =>
        matchesSearchQuery(submissionSearchHaystack(item, noteDrafts), q),
      );
      const abandonedMatches = abandoned.filter((item) =>
        matchesSearchQuery(abandonedSearchHaystack(item), q),
      );
      return [...submissionMatches, ...abandonedMatches].sort(sortNewestFirst);
    }

    if (statusFilter === 'need_records') {
      return submissions
        .filter((item) => submissionNeedsRecords(item) || exitingRows.has(item.id))
        .sort(sortNewestFirst);
    }

    if (statusFilter === 'to_confirm') {
      return submissions
        .filter(
          (item) =>
            exitingRows.has(item.id) ||
            (appointmentRequestNeedsStaffConfirmation(item) &&
              !appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog)),
        )
        .sort(sortNewestFirst);
    }

    return submissions
      .filter((item) => {
        if (exitingRows.has(item.id)) return true;
        if (submissionStatus(item) !== statusFilter) return false;
        if (appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog)) {
          return false;
        }
        if (
          statusFilter === 'booked' &&
          appointmentRequestNeedsStaffConfirmation(item)
        ) {
          return false;
        }
        return true;
      })
      .sort(sortNewestFirst);
  }, [
    onHoldOver24Only,
    statusFilter,
    submissions,
    abandoned,
    search,
    noteDrafts,
    exitingRows,
    bookedApptMeta,
    typeCatalog,
  ]);

  const useArchiveListPagination =
    !isSearchActive && ARCHIVE_LIST_TABS.has(statusFilter);

  const archiveListTotalPages = useMemo(() => {
    if (!useArchiveListPagination) return 1;
    return Math.max(1, Math.ceil(filtered.length / ARCHIVE_LIST_PAGE_SIZE));
  }, [filtered.length, useArchiveListPagination]);

  const listForDisplay = useMemo(() => {
    if (!useArchiveListPagination) return filtered;
    const start = (listPage - 1) * ARCHIVE_LIST_PAGE_SIZE;
    return filtered.slice(start, start + ARCHIVE_LIST_PAGE_SIZE);
  }, [filtered, listPage, useArchiveListPagination]);

  useEffect(() => {
    setListPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (!useArchiveListPagination) return;
    if (listPage > archiveListTotalPages) {
      setListPage(archiveListTotalPages);
    }
  }, [listPage, useArchiveListPagination, archiveListTotalPages]);

  useEffect(() => {
    if (!useArchiveListPagination || highlightEntryId == null || loading) return;
    const idx = filtered.findIndex((item) => item.id === highlightEntryId);
    if (idx < 0) return;
    const page = Math.floor(idx / ARCHIVE_LIST_PAGE_SIZE) + 1;
    setListPage(page);
  }, [highlightEntryId, filtered, loading, useArchiveListPagination]);

  useEffect(() => {
    if (highlightEntryId == null || loading) return;
    if (!highlightScrollSig.current) return;
    const id = highlightEntryId;

    if (useArchiveListPagination) {
      const idx = filtered.findIndex((item) => item.id === id);
      if (idx < 0) return;
      const page = Math.floor(idx / ARCHIVE_LIST_PAGE_SIZE) + 1;
      if (listPage !== page) {
        setListPage(page);
        return;
      }
    }

    const scrollT = window.setTimeout(() => {
      rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 100);
    const clearT = window.setTimeout(() => setHighlightEntryId(null), 3200);
    return () => {
      window.clearTimeout(scrollT);
      window.clearTimeout(clearT);
    };
  }, [highlightEntryId, loading, filtered, useArchiveListPagination, listPage]);

  useEffect(() => {
    return () => {
      for (const t of exitRowTimers.current.values()) window.clearTimeout(t);
      exitRowTimers.current.clear();
    };
  }, []);

  const beginRowExit = useCallback((entryId: number, kind: 'booked' | 'dismissed' | 'contacted') => {
    setExitingRows((prev) => new Map(prev).set(entryId, kind));
    setHighlightEntryId(entryId);
    const existing = exitRowTimers.current.get(entryId);
    if (existing) window.clearTimeout(existing);
    const timer = setTimeout(() => {
      exitRowTimers.current.delete(entryId);
      setExitingRows((prev) => {
        const next = new Map(prev);
        next.delete(entryId);
        return next;
      });
      setHighlightEntryId((cur) => (cur === entryId ? null : cur));
    }, 1100);
    exitRowTimers.current.set(entryId, timer);
  }, []);

  useEffect(() => {
    if (pendingBookedExitId == null) return;
    const id = pendingBookedExitId;
    setPendingBookedExitId(null);
    beginRowExit(id, 'booked');
  }, [pendingBookedExitId, beginRowExit]);

  useEffect(() => {
    if (!pendingOnHoldExit) return;
    const { entryId, kind } = pendingOnHoldExit;
    setPendingOnHoldExit(null);
    beginRowExit(entryId, kind);
  }, [pendingOnHoldExit, beginRowExit]);

  const mergeSubmission = useCallback((updated: AppointmentRequestSubmissionItem) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setNoteDrafts((drafts) => {
      const old = rowsRef.current.find((r) => r.id === updated.id);
      if (old && isNoteDraftDirty(updated.id, old.notes, drafts)) return drafts;
      return { ...drafts, [updated.id]: initialNotes(updated) };
    });
  }, []);

  const handleLinkedAppointment = useCallback(
    (updated: AppointmentRequestSubmissionItem) => {
      mergeSubmission({ ...updated, kind: 'submission' });
      beginRowExit(updated.id, 'booked');
      notifySchedulingToolsNavCountsRefresh();
    },
    [mergeSubmission, beginRowExit],
  );

  const handleRelinkedAppointment = useCallback(
    (updated: AppointmentRequestSubmissionItem) => {
      mergeSubmission({ ...updated, kind: 'submission' });
      setNotice('Linked appointment updated.');
      setHighlightEntryId(updated.id);
      highlightScrollSig.current = `${updated.id}-${Date.now()}`;
      notifySchedulingToolsNavCountsRefresh();
      const catalog = typeCatalogRef.current;
      if (catalog) {
        void hydrateBookedApptMeta([updated], catalog, { merge: true });
      }
    },
    [mergeSubmission, hydrateBookedApptMeta],
  );

  const flushNoteSave = useCallback(async (entryId: number, value: string) => {
    setNoteSaving((s) => ({ ...s, [entryId]: true }));
    setNoteError((e) => ({ ...e, [entryId]: null }));
    try {
      const updated = await patchAppointmentRequestSubmission(entryId, { notes: noteForPatch(value) });
      mergeSubmission({ ...updated, kind: 'submission' });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not save note';
      setNoteError((er) => ({ ...er, [entryId]: String(msg) }));
    } finally {
      setNoteSaving((s) => ({ ...s, [entryId]: false }));
    }
  }, [mergeSubmission]);

  const updateStatus = useCallback(
    async (
      item: AppointmentRequestSubmissionItem,
      status: AppointmentRequestSubmissionStatus,
      notBookedReason?: string,
    ) => {
      setStatusUpdating((s) => ({ ...s, [item.id]: true }));
      setStatusError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await patchAppointmentRequestSubmission(item.id, {
          status,
          ...(status === 'dismissed' && notBookedReason
            ? { notBookedReason }
            : {}),
        });
        mergeSubmission({ ...updated, kind: 'submission' });
        if (status === 'dismissed') {
          beginRowExit(item.id, 'dismissed');
        } else if (status === 'booked') {
          beginRowExit(item.id, 'booked');
        } else if (status === 'contacted') {
          beginRowExit(item.id, 'contacted');
        } else if (status !== submissionStatus(item)) {
          goToTab(status);
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not update status';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
        throw e;
      } finally {
        setStatusUpdating((s) => ({ ...s, [item.id]: false }));
      }
    },
    [mergeSubmission, beginRowExit]
  );

  const openConfirmPreview = (item: AppointmentRequestSubmissionItem) => {
    const apptId = item.bookedAppointmentId;
    if (apptId == null) return;
    setStatusError((e) => ({ ...e, [item.id]: null }));
    const { dateKey, providerId } = appointmentRequestViewHints(item, bookedApptMeta, practiceTz);

    writeAppointmentRequestListReturnTab(statusFilter);
    writeAppointmentRequestStaffConfirmSession({
      submissionId: item.id,
      bookedAppointmentId: Number(apptId),
      clientLabel: clientDisplayNameFromRequestData(item.requestData ?? {}),
      isNewClient: requestDataClientType(item.requestData ?? {}) === 'new',
    });
    writeSchedulerFocusSession({
      appointmentId: Number(apptId),
      dateHint: dateKey,
      providerHint: providerId ?? null,
    });
    navigate(
      buildSchedulerFocusAppointmentUrl(Number(apptId), {
        date: dateKey ?? undefined,
        providerId,
      }),
    );
  };

  const openNotBookedModal = (item: AppointmentRequestSubmissionItem) => {
    setNotBookedItem(item);
    setNotBookedReasonChoice('');
    setNotBookedReasonOther('');
    setNotBookedError(null);
  };

  const closeNotBookedModal = () => {
    if (notBookedSaving) return;
    setNotBookedItem(null);
    setNotBookedReasonChoice('');
    setNotBookedReasonOther('');
    setNotBookedError(null);
  };

  const confirmNotBooked = async () => {
    if (!notBookedItem) return;
    const reason =
      notBookedReasonChoice === NOT_BOOKED_REASON_OTHER
        ? notBookedReasonOther.trim()
        : notBookedReasonChoice.trim();
    if (!reason) {
      setNotBookedError('Please select or enter a reason.');
      return;
    }
    setNotBookedSaving(true);
    setNotBookedError(null);
    try {
      await updateStatus(notBookedItem, 'dismissed', reason);
      setNotBookedItem(null);
      setNotBookedReasonChoice('');
      setNotBookedReasonOther('');
      setNotBookedError(null);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not mark as not booked';
      setNotBookedError(String(msg));
    } finally {
      setNotBookedSaving(false);
    }
  };

  const toggleNeedsRecords = useCallback(
    async (item: AppointmentRequestSubmissionItem) => {
      const next = !submissionNeedsRecords(item);
      setNeedsRecordsUpdating((s) => ({ ...s, [item.id]: true }));
      setNeedsRecordsError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await patchAppointmentRequestSubmission(item.id, { needsRecords: next });
        mergeSubmission({ ...updated, kind: 'submission' });
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not update records flag';
        setNeedsRecordsError((er) => ({ ...er, [item.id]: String(msg) }));
      } finally {
        setNeedsRecordsUpdating((s) => ({ ...s, [item.id]: false }));
      }
    },
    [mergeSubmission],
  );

  function onNoteChange(entryId: number, value: string) {
    setNoteDrafts((d) => ({ ...d, [entryId]: value }));
    setNoteError((er) => ({ ...er, [entryId]: null }));
  }

  function noteIsDirty(item: AppointmentRequestSubmissionItem): boolean {
    return isNoteDraftDirty(item.id, item.notes, noteDraftsRef.current);
  }

  function saveNote(item: AppointmentRequestSubmissionItem) {
    const value = noteDrafts[item.id] ?? initialNotes(item);
    void flushNoteSave(item.id, value);
  }

  const onBook = (item: AppointmentRequestSubmissionItem) => {
    const rd = item.requestData ?? {};
    writeAppointmentRequestListReturnTab(statusFilter);
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(item);
    writeRoutingAppointmentRequestIntent({
      ...intent,
      clientPimsId:
        intent.clientPimsId ??
        resolveClientPimsIdForRequest(rd, clientPimsIdByInternalId) ??
        undefined,
      returnToListAfterBook: true,
      returnListTab: statusFilter,
      workspaceActive: true,
    });
    navigate('/schedule/routing');
  };

  const openSmsModal = (item: AppointmentRequestSubmissionItem) => {
    if (!appointmentRequestHasSmsPhone(item)) return;
    setSmsError(null);
    setSmsItem(item);
    setSmsMessage('');
    setSmsMessageLoading(true);
    void resolveAppointmentRequestSmsMessage(item, practiceTz, { practiceId: PRACTICE_ID })
      .then(setSmsMessage)
      .finally(() => setSmsMessageLoading(false));
  };

  const closeSmsModal = () => {
    setSmsItem(null);
    setSmsMessage('');
    setSmsMessageLoading(false);
    setSmsError(null);
  };

  const handleSendSms = async (opts: { overrideNonProd: boolean }) => {
    if (!smsItem || !smsMessage.trim()) return;
    setSmsSending(true);
    setSmsError(null);
    try {
      await sendAppointmentRequestSubmissionSms(smsItem.id, {
        message: smsMessage.trim(),
        ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
      });
      closeSmsModal();
      setNotice('Text message sent.');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setSmsError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to send text message.');
    } finally {
      setSmsSending(false);
    }
  };

  const onViewAppointment = (item: AppointmentRequestSubmissionItem) => {
    const apptId = item.bookedAppointmentId;
    if (apptId == null) return;
    const { dateKey, providerId } = appointmentRequestViewHints(item, bookedApptMeta, practiceTz);

    if (statusFilter === 'on_hold') {
      writeOnHoldVisitEditSession({
        listEntryId: item.id,
        listKind: 'appointment_request',
        bookedAppointmentId: Number(apptId),
        clientLabel: clientDisplayNameFromRequestData(item.requestData ?? {}),
        returnPath: appointmentRequestsPathForTab('on_hold', { onHoldOver24Only }),
      });
    }

    writeSchedulerFocusSession({
      appointmentId: Number(apptId),
      dateHint: dateKey,
      providerHint: providerId ?? null,
    });
    navigate(
      buildSchedulerFocusAppointmentUrl(Number(apptId), {
        date: dateKey ?? undefined,
        providerId,
      }),
    );
  };

  const openAbandonedDetail = async (item: AppointmentRequestSubmissionItem) => {
    setDraftDetailOpen(true);
    setDraftDetailLoading(true);
    setDraftDetail(null);
    try {
      const d = await fetchAppointmentFormDraft(item.id, PRACTICE_ID);
      setDraftDetail(d);
      setDraftFollowUpStatus(d.followUpStatus);
      setDraftFollowUpNotes(d.followUpNotes ?? '');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || 'Failed to load incomplete form');
      setDraftDetailOpen(false);
    } finally {
      setDraftDetailLoading(false);
    }
  };

  const saveDraftFollowUp = async () => {
    if (!draftDetail) return;
    setDraftSaving(true);
    try {
      const updated = await patchAppointmentFormDraft(draftDetail.id, PRACTICE_ID, {
        followUpStatus: draftFollowUpStatus,
        followUpNotes: draftFollowUpNotes.trim() || undefined,
      });
      setDraftDetail(updated);
      setNotice('Incomplete form follow-up saved.');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || 'Failed to save follow-up');
    } finally {
      setDraftSaving(false);
    }
  };

  const isOnHoldView = statusFilter === 'on_hold';
  const isToConfirmView = statusFilter === 'to_confirm';

  return (
    <div className="container">
      <div className="settings-page">
      <h1 className="settings-title">Appointments</h1>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        {isOnHoldView
          ? 'Calendar holds placed from appointment requests. Convert each hold to a booked visit when ready — holds older than 24 hours are flagged.'
          : isToConfirmView
            ? 'Clients who self-scheduled online land here until a Client Liaison verifies the visit on the calendar. Click Confirm to open the visit on the calendar and review it, then confirm to move to Booked, or Not booked if the visit should be cancelled.'
          : 'Triage incoming appointment requests from the client portal. Auto-booked online requests appear in Auto-Booked until reviewed. Use Book for requests that still need scheduling, then link the appointment. Text clients directly from the request phone number — including new clients who are not in the system yet.'}
      </p>

      {conversionsBanner ? (
        <p className="settings-muted" style={{ marginBottom: 12, maxWidth: 800 }} role="status">
          {conversionsBanner}
        </p>
      ) : null}

      {notice ? (
        <p className="settings-muted" style={{ marginBottom: 12, maxWidth: 800 }} role="status">
          {notice}
        </p>
      ) : null}

      <div className="appt-request-status-tabs">
        {STATUS_TABS.map(({ key, label }) => {
          const active = statusFilter === key;
          const isHoldTab = key === 'on_hold';
          return (
            <button
              key={key}
              type="button"
              className={`appt-request-status-tab${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                goToTab(key, { onHoldOver24Only: false });
              }}
            >
              <span>{label}</span>
              {tabShowsCount(key) ? (
                <span className="appt-request-status-tab-count" aria-hidden>
                  ({tabCounts[key]})
                </span>
              ) : null}
              {isHoldTab && onHoldOver24Count > 0 ? (
                <span
                  className="appt-request-status-tab-over24"
                  title={`${onHoldOver24Count} on hold over 24 hours`}
                >
                  {onHoldOver24Count} &gt; 24h
                </span>
              ) : null}
            </button>
          );
        })}
        <button type="button" className="btn primary appt-request-status-tabs-refresh" onClick={() => void load({ awaitHydration: true })} disabled={loading}>
          Refresh
        </button>
      </div>

      {isOnHoldView && tabCounts.on_hold > 0 ? (
        <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className={`settings-tab${!onHoldOver24Only ? ' active' : ''}`}
            style={{
              marginBottom: 0,
              border: !onHoldOver24Only ? '2px solid var(--accent-strong, #4FB128)' : '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 13,
            }}
            aria-pressed={!onHoldOver24Only}
            onClick={() => goToTab('on_hold', { onHoldOver24Only: false, replace: true })}
          >
            All holds ({tabCounts.on_hold})
          </button>
          <button
            type="button"
            className={`settings-tab${onHoldOver24Only ? ' active' : ''}`}
            style={{
              marginBottom: 0,
              border: onHoldOver24Only ? '2px solid #991b1b' : '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 13,
              background: onHoldOver24Only ? '#fecaca' : '#fff',
              color: onHoldOver24Only ? '#991b1b' : 'var(--muted)',
            }}
            aria-pressed={onHoldOver24Only}
            onClick={() => goToTab('on_hold', { onHoldOver24Only: true, replace: true })}
          >
            Over 24 hours ({onHoldOver24Count})
          </button>
        </div>
      ) : null}

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <input
          type="search"
          className="settings-input"
          placeholder="Search client, pet, phone, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search appointment requests"
          style={{ width: '100%' }}
        />
        {isSearchActive ? (
          <p className="settings-muted" style={{ marginTop: 6, marginBottom: 0, fontSize: '0.88rem' }}>
            Searching all tabs ({filtered.length} match{filtered.length === 1 ? '' : 'es'})
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
          {isSearchActive
            ? 'No appointment requests match your search.'
            : 'No appointment requests in this view.'}
        </p>
      ) : (
        <div className="appt-request-list-wrap">
        <ul className="appt-request-list">
          {listForDisplay.map((item) => {
            if (isAbandonedItem(item)) {
              const rd = item.requestData ?? {};
              const name = clientDisplayNameFromRequestData(rd);
              const phone = requestDataPhone(rd);
              return (
                <li key={`abandoned-${item.id}`} className="appt-request-row appt-request-row--incomplete">
                  <div className="appt-request-row-main">
                    <div className="appt-request-row-body">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        {isSearchActive ? (
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
                            Incomplete
                          </div>
                        ) : null}
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          Incomplete form
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {name}
                        {phone ? (
                          <span className="settings-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                            {phone}
                          </span>
                        ) : null}
                      </div>
                      <div className="settings-muted" style={{ fontSize: '0.92rem' }}>
                        {requestDataPetSummary(rd)} · Left at: {item.currentStepName ?? item.currentStep ?? '—'}
                      </div>
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 6 }}>
                        Abandoned {formatSubmittedAt(item.submittedAt, practiceTz)}
                        {item.abandonReason ? ` · ${item.abandonReason}` : ''}
                      </div>
                    </div>
                    <div className="appt-request-row-actions">
                      <button type="button" className="btn secondary" onClick={() => void openAbandonedDetail(item)}>
                        Follow up…
                      </button>
                    </div>
                  </div>
                </li>
              );
            }

            const rd = item.requestData ?? {};
            const name = clientDisplayNameFromRequestData(rd);
            const phone = requestDataPhone(rd);
            const clientType = requestDataClientType(rd);
            const isEuth = isEuthanasiaRequestData(rd);
            const status = submissionStatus(item);
            const isDismissed = status === 'dismissed';
            const isOnHoldVisit = appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog);
            const isBooked = appointmentRequestSubmissionCountsAsBooked(
              item,
              bookedApptMeta,
              typeCatalog,
            );
            const bookedApptId = item.bookedAppointmentId;
            const hasLinkedAppointment = bookedApptId != null;
            // Only true when the client self-scheduled a slot and it was auto-booked online —
            // not for ordinary appointment requests that staff book later.
            const autoBookedOnline = appointmentRequestAutoBookedOnline(item);
            const needsStaffConfirmation =
              appointmentRequestNeedsStaffConfirmation(item) && !isOnHoldVisit;
            const needsManualBook = !isDismissed && !isBooked && !hasLinkedAppointment;
            const bookedSummary =
              bookedApptId != null ? bookedApptMeta.get(Number(bookedApptId)) : undefined;
            const linkedAppointment = linkedEvetIdsFromBookedApptSummary(bookedSummary);
            const requestTypeName = requestDataAppointmentTypeLabel(rd);
            const linkedVisitLine =
              bookedSummary != null
                ? formatLinkedVisitLine(bookedSummary, practiceTz, requestTypeName)
                : null;
            const onHoldSinceIso = isOnHoldVisit ? bookedSummary?.appointmentBookedAtIso : null;
            const onHoldBookedAtLabel = formatAppointmentRequestOnHoldBookedAt(onHoldSinceIso, practiceTz);
            const onHoldElapsedLabel = formatAppointmentRequestOnHoldElapsedSince(onHoldSinceIso);
            const onHoldOver24 =
              isOnHoldVisit && appointmentRequestOnHoldOver24Hours(bookedSummary);
            const clientNote = requestDataAnythingElse(rd);
            const canText = requestDataCanText(rd);
            const howSoon = requestDataHowSoon(rd);
            const preferredDoctor = requestDataPreferredDoctor(rd);
            const hadVetCareElsewhere =
              clientType === 'existing' ? requestDataHadVetCareElsewhere(rd) : null;
            const mayWeAskForRecords = requestDataMayWeAskForRecords(rd);
            const previousVeterinaryPractices = requestDataPreviousVeterinaryPractices(rd);
            const previousVeterinaryHospitals = requestDataPreviousVeterinaryHospitals(rd);
            const visitAddress = formatRequestDataAddress(rd);
            const usesAlternateVisitAddress = requestDataUsesAlternateVisitAddress(rd);
            const clientPimsId = resolveClientPimsIdForRequestCard(
              rd,
              clientPimsIdByInternalId,
              linkedAppointment,
            );
            const howSoonUrgency = requestDataHowSoonUrgency(rd);
            const rowHighlighted = highlightEntryId === item.id;
            const exitKind = exitingRows.get(item.id);
            const rowExiting = exitKind != null;
            const rowExpanded = expandedRowIds.has(item.id);

            return (
              <li
                key={item.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(item.id, el);
                  else rowRefs.current.delete(item.id);
                }}
                className={apptRequestRowClassName({
                  rowExiting,
                  exitKind,
                  rowHighlighted,
                  isBooked,
                })}
              >
                {rowExiting ? (
                  <div className="appt-request-row-exit-badge" aria-live="polite">
                    Moved to{' '}
                    {exitKind === 'booked'
                      ? 'Booked'
                      : exitKind === 'contacted'
                        ? 'Contacted'
                        : 'Not Booked'}
                  </div>
                ) : null}
                <div className="appt-request-row-main">
                  <div className="appt-request-row-body">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {isSearchActive ? (
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
                          {statusTabLabel(item, status, { isOnHold: isOnHoldVisit })}
                        </div>
                      ) : null}
                      {howSoonUrgency === 'emergent' ? (
                        <span className="appt-request-urgency-chip appt-request-urgency-chip--emergent">
                          Emergent
                        </span>
                      ) : howSoonUrgency === 'urgent' ? (
                        <span className="appt-request-urgency-chip appt-request-urgency-chip--urgent">
                          Urgent
                        </span>
                      ) : null}
                      {submissionNeedsRecords(item) ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          Need records
                        </div>
                      ) : null}
                      {clientType !== 'unknown' ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: clientType === 'existing' ? '#e0e7ff' : '#dcfce7',
                            color: clientType === 'existing' ? '#3730a3' : '#166534',
                          }}
                        >
                          {clientType === 'existing' ? 'Existing client' : 'New client'}
                        </div>
                      ) : null}
                      {isEuth ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#fce7f3',
                            color: '#9d174d',
                          }}
                        >
                          Euthanasia / end-of-life
                        </div>
                      ) : null}
                      {canText === 'Yes' ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#ecfdf5',
                            color: '#047857',
                          }}
                        >
                          OK to text
                        </div>
                      ) : canText === 'No' ? (
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
                          No text consent
                        </div>
                      ) : null}
                      {autoBookedOnline && !isOnHoldVisit ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#dbeafe',
                            color: '#1d4ed8',
                          }}
                        >
                          Auto-booked online
                        </div>
                      ) : null}
                      {isOnHoldVisit ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          On hold
                        </div>
                      ) : null}
                      {isBooked && clientType === 'new' && hasLinkedAppointment ? (
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          New client — convert HOLD in scheduler
                        </div>
                      ) : null}
                    </div>
                    <div className="appt-request-client-block">
                      <div className="appt-request-client-name">
                        <AppointmentRequestClientNameChange
                          requestClientLabel={name}
                          linkedClientLabel={bookedSummary?.linkedClientLabel}
                          isNewClient={clientType === 'new'}
                          linkedNameWrapper={
                            clientPimsId
                              ? (currentName) => (
                                  <EvetNameLink
                                    href={evetClientLink(clientPimsId)}
                                    className="appt-request-evet-link"
                                    title="Open client in eVet"
                                  >
                                    {currentName}
                                  </EvetNameLink>
                                )
                              : undefined
                          }
                        />
                        {phone ? <span className="appt-request-client-phone">{phone}</span> : null}
                      </div>
                      {usesAlternateVisitAddress && visitAddress ? (
                        <AppointmentRequestAlternateAddressCallout address={visitAddress} compact />
                      ) : visitAddress ? (
                        <div className="appt-request-client-address">
                          <span className="appt-request-client-address-label">Address</span>
                          <span>{visitAddress}</span>
                        </div>
                      ) : null}
                    </div>
                    <AppointmentRequestPetSummaryList
                      requestData={rd}
                      practiceId={PRACTICE_ID}
                      practiceTz={practiceTz}
                      linkedAppointment={linkedAppointment}
                    />
                    <dl className="appt-request-meta-list">
                      <div className="appt-request-meta-line">
                        <dt className="appt-request-meta-label">Submitted</dt>
                        <dd className="appt-request-meta-value">
                          {formatSubmittedAt(item.submittedAt, practiceTz)}
                        </dd>
                      </div>
                      {howSoon ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">Timing</dt>
                          <dd className="appt-request-meta-value">{howSoon}</dd>
                        </div>
                      ) : null}
                      {preferredDoctor ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">Preferred doctor</dt>
                          <dd className="appt-request-meta-value">{preferredDoctor}</dd>
                        </div>
                      ) : null}
                      {hadVetCareElsewhere ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">Care elsewhere since last visit</dt>
                          <dd className="appt-request-meta-value">{hadVetCareElsewhere}</dd>
                        </div>
                      ) : null}
                      {mayWeAskForRecords ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">May ask for records</dt>
                          <dd className="appt-request-meta-value">{mayWeAskForRecords}</dd>
                        </div>
                      ) : null}
                      {isCompletedSubmission(item) ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">Request PDF</dt>
                          <dd className="appt-request-meta-value">
                            <AppointmentRequestPdfDownloadLink submissionId={item.id} clientLabel={name} />
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {previousVeterinaryPractices ? (
                      <div className="appt-request-client-note">
                        <span className="appt-request-client-note-label">Previous vet practices</span>
                        <span className="appt-request-client-note-value">
                          {previousVeterinaryPractices}
                        </span>
                      </div>
                    ) : null}
                    {previousVeterinaryHospitals ? (
                      <div className="appt-request-client-note">
                        <span className="appt-request-client-note-label">Other hospitals since last visit</span>
                        <span className="appt-request-client-note-value">
                          {previousVeterinaryHospitals}
                        </span>
                      </div>
                    ) : null}
                    {clientNote ? (
                      <div className="appt-request-client-note">
                        <span className="appt-request-client-note-label">Client note</span>
                        <span className="appt-request-client-note-value">{clientNote}</span>
                      </div>
                    ) : null}
                    {linkedVisitLine ? (
                      <div
                        style={{
                          fontSize: '0.88rem',
                          marginTop: 4,
                          fontWeight: 600,
                          color: isOnHoldVisit ? '#92400e' : 'var(--text, #1e293b)',
                        }}
                      >
                        {linkedVisitLine}
                      </div>
                    ) : null}
                    {isOnHoldVisit && onHoldBookedAtLabel ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Hold placed {onHoldBookedAtLabel}
                        {onHoldElapsedLabel ? ` · ${onHoldElapsedLabel} ago` : ''}
                        {onHoldOver24 ? (
                          <span style={{ color: '#991b1b', fontWeight: 600, marginLeft: 6 }}>
                            Over 24 hours
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {isDismissed && item.notBookedReason ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Not booked: {item.notBookedReason}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="appt-request-expand-btn"
                      aria-expanded={rowExpanded}
                      onClick={() => toggleRowExpanded(item.id)}
                    >
                      <span
                        className={
                          rowExpanded
                            ? 'appt-request-expand-chevron appt-request-expand-chevron--open'
                            : 'appt-request-expand-chevron'
                        }
                        aria-hidden
                      >
                        ▼
                      </span>
                      {rowExpanded ? 'Hide full request' : 'View full request'}
                    </button>
                  </div>

                  <div className="appt-request-row-actions">
                    {needsManualBook ? (
                      <>
                        {appointmentRequestHasSmsPhone(item) ? (
                          <button type="button" className="btn secondary" onClick={() => openSmsModal(item)}>
                            Text client
                          </button>
                        ) : null}
                        <button type="button" className="btn primary" onClick={() => onBook(item)}>
                          Book
                        </button>
                        {status === 'new' ? (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={Boolean(statusUpdating[item.id])}
                            onClick={() => void updateStatus(item, 'contacted')}
                          >
                            {statusUpdating[item.id] ? 'Saving…' : 'Mark contacted'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setManualBookModal({ item, relink: false })}
                        >
                          Link appointment…
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(statusUpdating[item.id])}
                          onClick={() => openNotBookedModal(item)}
                        >
                          {statusUpdating[item.id] ? 'Saving…' : 'Not booked'}
                        </button>
                      </>
                    ) : isOnHoldVisit ? (
                      <>
                        {needsStaffConfirmation ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={Boolean(statusUpdating[item.id])}
                            onClick={() => openConfirmPreview(item)}
                          >
                            {statusUpdating[item.id] ? 'Saving…' : 'Confirm'}
                          </button>
                        ) : null}
                        {appointmentRequestHasSmsPhone(item) ? (
                          <button type="button" className="btn secondary" onClick={() => openSmsModal(item)}>
                            Text client
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => onViewAppointment(item)}
                        >
                          View appointment
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(statusUpdating[item.id])}
                          onClick={() => openNotBookedModal(item)}
                        >
                          Not booked
                        </button>
                      </>
                    ) : isBooked || hasLinkedAppointment ? (
                      <>
                        {needsStaffConfirmation ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={Boolean(statusUpdating[item.id])}
                            onClick={() => openConfirmPreview(item)}
                          >
                            {statusUpdating[item.id] ? 'Saving…' : 'Confirm'}
                          </button>
                        ) : null}
                        {appointmentRequestHasSmsPhone(item) ? (
                          <button type="button" className="btn secondary" onClick={() => openSmsModal(item)}>
                            Text client
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => onViewAppointment(item)}
                        >
                          View appointment
                        </button>
                        {isBooked ? (
                          <button type="button" className="btn secondary" onClick={() => onBook(item)}>
                            Reschedule
                          </button>
                        ) : null}
                        {statusFilter === 'booked' && isBooked && hasLinkedAppointment ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setManualBookModal({ item, relink: true })}
                          >
                            Re-link appointment…
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(statusUpdating[item.id])}
                          onClick={() => openNotBookedModal(item)}
                        >
                          Not booked
                        </button>
                      </>
                    ) : (
                      <>
                        {appointmentRequestHasSmsPhone(item) ? (
                          <button type="button" className="btn secondary" onClick={() => openSmsModal(item)}>
                            Text client
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(statusUpdating[item.id])}
                          onClick={() => void updateStatus(item, 'new')}
                        >
                          Reopen
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={submissionNeedsRecords(item) ? 'btn primary' : 'btn secondary'}
                      disabled={Boolean(needsRecordsUpdating[item.id])}
                      onClick={() => void toggleNeedsRecords(item)}
                    >
                      {needsRecordsUpdating[item.id]
                        ? 'Saving…'
                        : submissionNeedsRecords(item)
                          ? 'Records received'
                          : 'Need records'}
                    </button>
                    {statusError[item.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {statusError[item.id]}
                      </span>
                    ) : null}
                    {needsRecordsError[item.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {needsRecordsError[item.id]}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="appt-request-row-footer">
                  <div className="appt-request-row-notes">
                    <div className="appt-request-row-notes-head">
                      <label htmlFor={`appt-request-note-${item.id}`}>Notes</label>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ fontSize: 12, padding: '4px 12px' }}
                        disabled={isDismissed || !noteIsDirty(item) || Boolean(noteSaving[item.id])}
                        onClick={() => saveNote(item)}
                      >
                        {noteSaving[item.id] ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <textarea
                      id={`appt-request-note-${item.id}`}
                      className="settings-input appt-request-row-notes-input"
                      rows={2}
                      value={noteDrafts[item.id] ?? initialNotes(item)}
                      onChange={(e) => onNoteChange(item.id, e.target.value)}
                      placeholder="e.g. Left voicemail; will try again tomorrow."
                      disabled={isDismissed || Boolean(noteSaving[item.id])}
                    />
                    {noteError[item.id] ? (
                      <span className="appt-request-row-notes-error">{noteError[item.id]}</span>
                    ) : null}
                  </div>
                </div>

                {rowExpanded ? (
                  <div className="appt-request-row-detail">
                    <AppointmentRequestDetailPanel
                      requestData={rd}
                      practiceId={PRACTICE_ID}
                      practiceTz={practiceTz}
                      clientPimsId={clientPimsId}
                      linkedAppointment={linkedAppointment}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {useArchiveListPagination && filtered.length > ARCHIVE_LIST_PAGE_SIZE ? (
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
              Showing {(listPage - 1) * ARCHIVE_LIST_PAGE_SIZE + 1}–
              {Math.min(listPage * ARCHIVE_LIST_PAGE_SIZE, filtered.length)} of {filtered.length}
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
                Page {listPage} of {archiveListTotalPages}
              </span>
              <button
                type="button"
                className="btn secondary"
                disabled={listPage >= archiveListTotalPages}
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
        </div>
      )}

      {manualBookModal ? (
        <AppointmentRequestManualBookModal
          item={manualBookModal.item}
          mode={manualBookModal.relink ? 'relink' : 'link'}
          onClose={() => setManualBookModal(null)}
          onLinked={
            manualBookModal.relink ? handleRelinkedAppointment : handleLinkedAppointment
          }
        />
      ) : null}

      {smsItem ? (
        <ClientSmsComposeModal
          open
          clientLabel={clientDisplayNameFromRequestData(smsItem.requestData ?? {})}
          message={smsMessageLoading ? 'Loading message…' : smsMessage}
          onMessageChange={setSmsMessage}
          onClose={closeSmsModal}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={() => {}}
          sending={smsSending || smsMessageLoading}
          sendError={smsError}
          title="Text requester"
          subtitle={`Message goes to the phone on the request${requestDataCanText(smsItem.requestData ?? {}) === 'Yes' ? ' (client consented to texts)' : ''}.`}
        />
      ) : null}

      {notBookedItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="appt-request-not-booked-title"
          onClick={() => closeNotBookedModal()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(480px, 90vw)',
              padding: 24,
              borderRadius: 12,
              background: '#fff',
            }}
          >
            <h3 id="appt-request-not-booked-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
              Mark as not booked
            </h3>
            <p className="settings-muted" style={{ marginTop: 0, marginBottom: 16 }}>
              {clientDisplayNameFromRequestData(notBookedItem.requestData ?? {})}
            </p>
            <label htmlFor="appt-request-not-booked-reason" style={{ display: 'block', marginBottom: 6 }}>
              Reason <span style={{ color: '#b91c1c' }}>*</span>
            </label>
            <select
              id="appt-request-not-booked-reason"
              className="settings-input"
              value={notBookedReasonChoice}
              onChange={(e) => {
                setNotBookedReasonChoice(e.target.value);
                setNotBookedError(null);
              }}
              style={{ width: '100%', marginBottom: 12 }}
            >
              <option value="">Select a reason…</option>
              {NOT_BOOKED_REASON_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={NOT_BOOKED_REASON_OTHER}>Other…</option>
            </select>
            {notBookedReasonChoice === NOT_BOOKED_REASON_OTHER ? (
              <textarea
                className="settings-input"
                rows={3}
                value={notBookedReasonOther}
                onChange={(e) => {
                  setNotBookedReasonOther(e.target.value);
                  setNotBookedError(null);
                }}
                placeholder="Describe why this request was not booked"
                style={{ width: '100%', marginBottom: 12 }}
              />
            ) : null}
            {notBookedError ? (
              <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>{notBookedError}</p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn secondary"
                disabled={notBookedSaving}
                onClick={() => closeNotBookedModal()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={notBookedSaving}
                onClick={() => void confirmNotBooked()}
              >
                {notBookedSaving ? 'Saving…' : 'Mark not booked'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draftDetailOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="appt-request-draft-title"
          onClick={() => setDraftDetailOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 90vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 24,
              borderRadius: 12,
              background: '#fff',
            }}
          >
            <h3 id="appt-request-draft-title" style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 600 }}>
              Incomplete form follow-up
            </h3>
            {draftDetailLoading ? (
              <p className="settings-muted">Loading…</p>
            ) : draftDetail ? (
              <>
                <p className="settings-muted" style={{ marginTop: 0 }}>
                  {draftDetail.clientDisplayName ?? 'Unknown'} · step {draftDetail.currentStepName ?? draftDetail.currentStep}
                </p>
                <label htmlFor="draft-follow-up-status" style={{ display: 'block', marginBottom: 6 }}>
                  Follow-up status
                </label>
                <select
                  id="draft-follow-up-status"
                  className="settings-input"
                  value={draftFollowUpStatus}
                  onChange={(e) =>
                    setDraftFollowUpStatus(e.target.value as AppointmentFormDraftFollowUpStatus)
                  }
                  style={{ width: '100%', marginBottom: 12 }}
                >
                  {FOLLOW_UP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="draft-follow-up-notes" style={{ display: 'block', marginBottom: 6 }}>
                  Notes
                </label>
                <textarea
                  id="draft-follow-up-notes"
                  className="settings-input"
                  rows={3}
                  value={draftFollowUpNotes}
                  onChange={(e) => setDraftFollowUpNotes(e.target.value)}
                  style={{ width: '100%', marginBottom: 16 }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn secondary" onClick={() => setDraftDetailOpen(false)}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={draftSaving}
                    onClick={() => void saveDraftFollowUp()}
                  >
                    {draftSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
