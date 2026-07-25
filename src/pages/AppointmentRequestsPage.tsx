import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  fetchAllAppointmentRequestSubmissions,
  fetchAppointmentRequestGmailLink,
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
import { AppointmentRequestEmailModal } from '../components/AppointmentRequestEmailModal';
import type { AppointmentRequestEmailSentContext } from '../components/AppointmentRequestEmailModal';
import { AppointmentRequestDetailPanel } from '../components/AppointmentRequestDetailPanel';
import { AppointmentRequestPdfDownloadLink } from '../components/AppointmentRequestPdfDownloadLink';
import { AppointmentRequestPetSummaryList } from '../components/AppointmentRequestPetSummaryList';
import { AppointmentRequestGmailThreadLabels } from '../components/AppointmentRequestGmailThreadLabels';
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
  appointmentRequestListTabForSubmission,
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
import { startRescheduleFromBookedAppointmentRequest } from '../utils/appointmentRequestReschedule';
import { appointmentRequestSchedulerViewHints } from '../utils/appointmentRequestSchedulerFocus';
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
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { useAppointmentRequestGmailThreadLabels } from '../hooks/useAppointmentRequestGmailThreadLabels';
import { getMessageLabelsForAppointmentList } from '../api/gmail';
import {
  APPOINTMENT_REQUEST_MAILBOX,
  applyApptRequestGmailOutcomeLabel,
  isApptRequestOnHoldLabelId,
  resolveApptRequestLabelIds,
} from '../utils/gmailAppointmentRequestLabels';
import { beginAppointmentRequestNotBookedFlow } from '../utils/appointmentRequestNotBookedFlow';
import { beginAppointmentRequestOnHoldReleaseFlow } from '../utils/appointmentRequestOnHoldReleaseFlow';
import {
  buildGmailInboxReturnPath,
} from '../utils/routingAppointmentRequestIntent';
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
  appointmentRequestBookedVisitLabels,
  formatAppointmentRequestOnHoldBookedAt,
  formatAppointmentRequestOnHoldElapsedSince,
  resolveAppointmentRequestBookedVisitSummary,
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
import { beginAppointmentRequestStaffConfirmFlow } from '../utils/appointmentRequestStaffConfirmFlow';
import {
  clearAppointmentRequestStaffConfirmReturnSession,
  readAppointmentRequestStaffConfirmReturnSession,
} from '../utils/appointmentRequestStaffConfirmSession';
import {
  clearOnHoldVisitEditReturnSession,
  readOnHoldVisitEditReturnSession,
  writeOnHoldVisitEditSession,
  type OnHoldVisitEditReturnV1,
} from '../utils/onHoldVisitEditSession';
import {
  appointmentRecordHasActiveLinkedVisit,
} from '../utils/appointmentRequestLinkedCalendarVisit';
import {
  clearNotBookedRemoveReturnSession,
  readNotBookedRemoveReturnSession,
} from '../utils/appointmentRequestNotBookedRemoveSession';
import {
  APPOINTMENT_REQUESTS_LIST_PATH,
  appointmentRequestsOnHoldOver24FromSearch,
  appointmentRequestsPathForTab,
  parseAppointmentRequestsHighlightFromSearch,
  parseAppointmentRequestsTabFromLocation,
  APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM,
  type AppointmentRequestListTab,
} from '../appointments-nav';
import { HOLDS_PATH, holdsPathWithHighlight } from '../holds-nav';
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

/** Booked / Not Booked tab badges are hidden — the lists are long. */
const HIDE_TAB_COUNT_TABS = new Set<StatusFilter>(['booked', 'dismissed']);
/** Paginate large tabs so the list and Gmail label fetches stay bounded. */
const PAGINATED_LIST_TABS = new Set<StatusFilter>([
  'booked',
  'dismissed',
  'contacted',
  'to_confirm',
]);
const LIST_PAGE_SIZE = 25;
/** Max Gmail label fetches while searching — avoids storms on partial matches. */
const SEARCH_GMAIL_LABEL_MAX = 25;
const SEARCH_GMAIL_DEBOUNCE_MS = 350;

function tabShowsCount(tab: StatusFilter): boolean {
  return !HIDE_TAB_COUNT_TABS.has(tab);
}

/**
 * Gmail go-live cutoff for the New tab. Pre-launch requests that are already
 * handled (archived out of the Gmail inbox) are hidden from New so staff start
 * clean; a pre-launch request still shows in New only while its Gmail thread is
 * in the inbox. Anything submitted after this instant always shows in New and
 * flows normally. Set VITE_APPT_REQUEST_NEW_TAB_LAUNCH_ISO to the actual go-live
 * time; when unset/invalid the filter is disabled (New shows everything).
 */
const APPT_REQUEST_NEW_TAB_LAUNCH_ISO =
  (import.meta.env.VITE_APPT_REQUEST_NEW_TAB_LAUNCH_ISO as string | undefined) ??
  '2026-07-07T17:20:00-04:00';
const APPT_REQUEST_NEW_TAB_LAUNCH_MS = Date.parse(APPT_REQUEST_NEW_TAB_LAUNCH_ISO);

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

/** Outreach done, not yet categorized booked or not booked — cleared when status becomes either. */
function submissionShowsContactedChip(item: AppointmentRequestSubmissionItem): boolean {
  return submissionStatus(item) === 'contacted';
}

function ApptRequestStatusChip({
  variant,
  children,
}: {
  variant: 'booked' | 'not-booked' | 'contacted';
  children: React.ReactNode;
}) {
  return (
    <span className={`appt-request-status-chip appt-request-status-chip--${variant}`}>
      {children}
    </span>
  );
}

function initialNotes(item: AppointmentRequestSubmissionItem): string {
  return initialNotesFromItem(item);
}

function statusTabLabel(
  item: AppointmentRequestSubmissionItem,
  status: AppointmentRequestSubmissionStatus,
  opts?: { isOnHold?: boolean },
): string {
  const needsAutoBooked = appointmentRequestNeedsStaffConfirmation(item);
  if (opts?.isOnHold && needsAutoBooked) return 'Auto-Booked · On hold';
  if (opts?.isOnHold) return 'On hold';
  const linkedPoints = item.linkedVisitPoints;
  if (
    item.bookedAppointmentId != null &&
    linkedPoints != null &&
    Number.isFinite(linkedPoints) &&
    linkedPoints <= 0
  ) {
    return needsAutoBooked ? 'Auto-Booked · On hold' : 'On hold';
  }
  if (needsAutoBooked) return 'Auto-Booked';
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
  return appointmentRequestSchedulerViewHints(item, cached, practiceTz);
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
  requestData?: Record<string, unknown>,
  typeCatalog?: ReturnType<typeof buildAppointmentTypeCatalogFromTypes> | null,
  opts?: { requestedOnly?: boolean },
): string {
  const requestedOnly = opts?.requestedOnly === true;
  const isOnHold = summary.points <= 0;
  if (isOnHold && requestData) {
    const { bookedLabel, providerLabel } = appointmentRequestBookedVisitLabels({
      requestData,
      bookedSummary: summary,
      practiceTz,
      typeCatalog,
      isOnHold: true,
    });
    if (bookedLabel) {
      const provider = providerLabel?.trim() || summary.providerName?.trim() || null;
      return provider ? `${bookedLabel} · ${provider}` : bookedLabel;
    }
  }

  const visit = formatBookedVisit(summary.start, summary.end, practiceTz);
  const typeName = summary.typeName?.trim() || requestTypeName?.trim() || null;
  const provider = summary.providerName?.trim() || null;
  const providerPart = provider ? ` with ${provider}` : '';
  const bookedPrefix = requestedOnly ? 'Requested slot' : isOnHold ? 'On hold' : 'Booked';
  if (isOnHold && !requestedOnly) {
    return typeName
      ? `${bookedPrefix}${providerPart} — ${typeName}: ${visit}`
      : `${bookedPrefix}${providerPart}: ${visit}`;
  }
  return typeName
    ? `${bookedPrefix}${providerPart} — ${typeName}: ${visit}`
    : `${bookedPrefix}${providerPart}: ${visit}`;
}

export default function AppointmentRequestsPage(_props: AppointmentRequestsPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const { allowed: canAccessGmailInbox } = useGmailInboxAccess();

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
          onHoldOver24Only: false,
        }),
        {
          replace: opts?.replace,
          state: { appointmentsTab: tab },
        },
      );
    },
    [navigate],
  );

  useEffect(() => {
    if (statusFilter !== 'on_hold') return;
    const highlightId = parseAppointmentRequestsHighlightFromSearch(location.search);
    navigate(
      highlightId != null ? holdsPathWithHighlight(highlightId) : HOLDS_PATH,
      { replace: true },
    );
  }, [statusFilter, location.search, navigate]);

  useEffect(() => {
    const resolved = resolveAppointmentsListEntryTab(
      location.pathname,
      location.search,
      location.state,
    );
    if (resolved == null) return;

    const onHoldOver24 =
      resolved === 'on_hold' && appointmentRequestsOnHoldOver24FromSearch(location.search);
    if (
      !appointmentRequestsListPathMatches(location.pathname, location.search, resolved, {
        onHoldOver24Only: onHoldOver24,
      })
    ) {
      const highlightId = parseAppointmentRequestsHighlightFromSearch(location.search);
      navigate(
        appointmentRequestsPathForTab(resolved, {
          onHoldOver24Only: onHoldOver24,
          highlightId: highlightId ?? undefined,
        }),
        { replace: true, state: { appointmentsTab: resolved } },
      );
    }
  }, [location.pathname, location.search, location.key, location.state, navigate]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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

  const [smsItem, setSmsItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsMessageLoading, setSmsMessageLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  const [emailItem, setEmailItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [emailSentToast, setEmailSentToast] = useState(false);

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
  const pendingNotBookedModalRef = useRef<number | null>(null);
  const notBookedGmailLabelFlowRef = useRef(new Set<number>());
  const onHoldGmailLabelFlowRef = useRef(new Set<number>());

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

      const requestedIds = new Set(uniqueBooked);
      setBookedApptMeta((prev) => {
        // Total fetch miss with prior cache — keep prev (likely transient API failure).
        if (meta.size === 0 && prev.size > 0 && uniqueBooked.length > 0) return prev;
        const next = new Map(meta);
        for (const [id, summary] of prev) {
          if (next.has(id)) continue;
          if (requestedIds.has(id)) {
            // Re-fetched and gone (soft-deleted) — do not keep a stale "active" hold.
            next.set(id, { ...summary, appointmentCancelled: true });
            continue;
          }
          next.set(id, summary);
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
      const pendingNotBookedReturn = readNotBookedRemoveReturnSession();
      if (pendingNotBookedReturn) {
        clearNotBookedRemoveReturnSession();
        pendingNotBookedModalRef.current = pendingNotBookedReturn.submissionId;
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
        const catalog = typeCatalogRef.current;
        if (!catalog) return;
        const meta = await hydrateBookedApptMeta(items, catalog, {
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
  /** Gmail waits until debounce catches up — avoids fetching for stale partial queries. */
  const searchGmailFetchReady = isSearchActive && debouncedSearch === search.trim();

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_GMAIL_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const tabCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      new: 0,
      contacted: 0,
      booked: 0,
      dismissed: 0,
      on_hold: 0,
      to_confirm: 0,
    };
    for (const row of submissions) {
      const status = submissionStatus(row);
      const isOnHold = appointmentRequestSubmissionIsOnHold(row, bookedApptMeta, typeCatalog);
      const needsAutoBooked = appointmentRequestNeedsStaffConfirmation(row);
      if (isOnHold) counts.on_hold += 1;
      if (needsAutoBooked) counts.to_confirm += 1;
      if (submissionShowsContactedChip(row)) counts.contacted += 1;
      if (status === 'contacted') continue;
      if (isOnHold || needsAutoBooked) continue;
      counts[status] += 1;
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

    if (statusFilter === 'to_confirm') {
      return submissions
        .filter(
          (item) =>
            exitingRows.has(item.id) || appointmentRequestNeedsStaffConfirmation(item),
        )
        .sort(sortNewestFirst);
    }

    return submissions
      .filter((item) => {
        if (exitingRows.has(item.id)) return true;
        if (submissionStatus(item) !== statusFilter) return false;
        if (
          statusFilter !== 'contacted' &&
          appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog)
        ) {
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

  /** While searching across tabs, highlight the result tab when unambiguous; otherwise none. */
  const highlightedStatusTab = useMemo((): StatusFilter | null => {
    if (!isSearchActive) return statusFilter;
    const tabs = new Set<StatusFilter>();
    for (const item of filtered) {
      if (isAbandonedItem(item)) continue;
      tabs.add(appointmentRequestListTabForSubmission(item, bookedApptMeta, typeCatalog));
    }
    if (tabs.size === 1) return [...tabs][0]!;
    return null;
  }, [isSearchActive, filtered, statusFilter, bookedApptMeta, typeCatalog]);

  const useListPagination = !isSearchActive && PAGINATED_LIST_TABS.has(statusFilter);

  const listTotalPages = useMemo(() => {
    if (!useListPagination) return 1;
    return Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  }, [filtered.length, useListPagination]);

  const listForDisplay = useMemo(() => {
    if (!useListPagination) return filtered;
    const start = (listPage - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, listPage, useListPagination]);

  const applyNewTabLaunchFilter =
    !isSearchActive &&
    statusFilter === 'new' &&
    canAccessGmailInbox &&
    Number.isFinite(APPT_REQUEST_NEW_TAB_LAUNCH_MS);

  /**
   * Gmail fetches only for settled search matches or the normal tab slice. Never use
   * live keystrokes or lagging debounced prefixes (e.g. "brian" while typing
   * "brian bennett") — that was hundreds of thread fetches per search.
   */
  const gmailThreadLinkItems = useMemo(() => {
    if (isSearchActive) {
      if (!searchGmailFetchReady) return [];
      const q = debouncedSearch.toLowerCase();
      return submissions
        .filter((item) =>
          matchesSearchQuery(submissionSearchHaystack(item, noteDrafts), q),
        )
        .slice(0, SEARCH_GMAIL_LABEL_MAX);
    }
    if (applyNewTabLaunchFilter) {
      return listForDisplay.filter((item) => {
        if (exitingRows.has(item.id)) return true;
        const submittedMs = Date.parse(item.submittedAt);
        return Number.isFinite(submittedMs) && submittedMs > APPT_REQUEST_NEW_TAB_LAUNCH_MS;
      });
    }
    return listForDisplay;
  }, [
    isSearchActive,
    searchGmailFetchReady,
    debouncedSearch,
    submissions,
    noteDrafts,
    applyNewTabLaunchFilter,
    listForDisplay,
    exitingRows,
  ]);

  const handleGmailLinkResolved = useCallback(
    (submissionId: number, patch: { gmailThreadId: string; gmailMailbox: string }) => {
      setRows((prev) =>
        prev.map((row) => (row.id === submissionId ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const gmailLabelContext = useMemo(
    () => ({ typeCatalog, bookedApptMeta }),
    [typeCatalog, bookedApptMeta],
  );

  const {
    bySubmissionId: gmailThreadLabelsBySubmission,
    userLabels: gmailUserLabels,
    labelById: gmailLabelById,
    patchSubmission: patchGmailThreadLabels,
  } = useAppointmentRequestGmailThreadLabels(
    gmailThreadLinkItems,
    canAccessGmailInbox,
    handleGmailLinkResolved,
    gmailLabelContext,
  );

  const gmailLabelsLoadingIds = useMemo(() => {
    if (!canAccessGmailInbox) return new Set<number>();
    const pending = new Set<number>();
    for (const item of gmailThreadLinkItems) {
      if (item.kind === 'abandoned') continue;
      if (!gmailThreadLabelsBySubmission.has(item.id)) pending.add(item.id);
    }
    return pending;
  }, [canAccessGmailInbox, gmailThreadLinkItems, gmailThreadLabelsBySubmission]);

  /** True when a New-tab row should show given the Gmail go-live cutoff. */
  const newTabRowVisibleAtLaunch = useCallback(
    (item: AppointmentRequestSubmissionItem): boolean => {
      if (exitingRows.has(item.id)) return true;
      const submittedMs = Date.parse(item.submittedAt);
      if (Number.isFinite(submittedMs) && submittedMs > APPT_REQUEST_NEW_TAB_LAUNCH_MS) {
        return true;
      }
      // Pre-launch request: keep only while its Gmail thread is still in the inbox.
      const thread = gmailThreadLabelsBySubmission.get(item.id);
      return thread ? thread.labelIds.includes('INBOX') : false;
    },
    [exitingRows, gmailThreadLabelsBySubmission],
  );

  const displayList = useMemo(() => {
    if (!applyNewTabLaunchFilter) return listForDisplay;
    return listForDisplay.filter(newTabRowVisibleAtLaunch);
  }, [applyNewTabLaunchFilter, listForDisplay, newTabRowVisibleAtLaunch]);

  const newTabVisibleCount = useMemo(() => {
    if (!canAccessGmailInbox || !Number.isFinite(APPT_REQUEST_NEW_TAB_LAUNCH_MS)) {
      return tabCounts.new;
    }
    let count = 0;
    for (const row of submissions) {
      if (submissionStatus(row) !== 'new') continue;
      if (appointmentRequestSubmissionIsOnHold(row, bookedApptMeta, typeCatalog)) continue;
      if (appointmentRequestNeedsStaffConfirmation(row)) continue;
      if (newTabRowVisibleAtLaunch(row)) count += 1;
    }
    return count;
  }, [
    canAccessGmailInbox,
    tabCounts.new,
    submissions,
    bookedApptMeta,
    typeCatalog,
    newTabRowVisibleAtLaunch,
  ]);

  const handleGmailThreadLabelsUpdated = useCallback(
    (submissionId: number, entry: Parameters<typeof patchGmailThreadLabels>[1]) => {
      patchGmailThreadLabels(submissionId, entry);
    },
    [patchGmailThreadLabels],
  );

  const handleGmailLabelsAdded = useCallback(
    (item: AppointmentRequestSubmissionItem, addedLabelIds: string[]) => {
      const notBookedLabelId = resolveApptRequestLabelIds(gmailUserLabels).notBooked;
      if (!notBookedLabelId || !addedLabelIds.includes(notBookedLabelId)) return;
      if ((item.status ?? 'new') === 'dismissed') return;
      if (notBookedGmailLabelFlowRef.current.has(item.id)) return;

      const thread = gmailThreadLabelsBySubmission.get(item.id);
      const bookedSummary =
        item.bookedAppointmentId != null
          ? bookedApptMeta.get(Number(item.bookedAppointmentId))
          : undefined;

      notBookedGmailLabelFlowRef.current.add(item.id);
      void beginAppointmentRequestNotBookedFlow({
        submission: item,
        returnPath: appointmentRequestsPathForTab(statusFilter, { onHoldOver24Only }),
        practiceTz,
        navigate,
        mailbox: thread?.mailbox ?? APPOINTMENT_REQUEST_MAILBOX,
        threadId: thread?.threadId,
        bookedApptSummary: bookedSummary ?? null,
      })
        .then((result) => {
          if (result.kind === 'scheduler_remove') {
            setNotice('Remove this visit from the calendar, then mark the request as not booked.');
            return;
          }
          if (result.kind === 'needs_reason') {
            setNotBookedItem(item);
            setNotBookedReasonChoice('');
            setNotBookedReasonOther('');
            setNotBookedError(null);
          }
        })
        .catch(() => {
          setError('Could not start the not booked flow for this appointment request.');
        })
        .finally(() => {
          notBookedGmailLabelFlowRef.current.delete(item.id);
        });
    },
    [
      gmailUserLabels,
      gmailThreadLabelsBySubmission,
      bookedApptMeta,
      statusFilter,
      onHoldOver24Only,
      practiceTz,
      navigate,
    ],
  );

  const makeOnHoldGmailLabelRemoveGuard = useCallback(
    (item: AppointmentRequestSubmissionItem) =>
      async (labelId: string): Promise<boolean> => {
        if (!isApptRequestOnHoldLabelId(labelId, gmailUserLabels)) return true;
        if (onHoldGmailLabelFlowRef.current.has(item.id)) return false;

        onHoldGmailLabelFlowRef.current.add(item.id);
        try {
          const thread = gmailThreadLabelsBySubmission.get(item.id);
          const bookedSummary =
            item.bookedAppointmentId != null
              ? bookedApptMeta.get(Number(item.bookedAppointmentId))
              : undefined;
          const result = await beginAppointmentRequestOnHoldReleaseFlow({
            submission: item,
            returnPath: appointmentRequestsPathForTab(statusFilter, { onHoldOver24Only }),
            practiceTz,
            navigate,
            mailbox: thread?.mailbox ?? APPOINTMENT_REQUEST_MAILBOX,
            threadId: thread?.threadId,
            bookedApptSummary: bookedSummary ?? null,
            bookedApptMeta,
            typeCatalog,
          });
          if (result.kind === 'scheduler_edit') {
            setNotice(
              'Remove or convert this hold on the calendar before removing the On hold label.',
            );
            return false;
          }
          return true;
        } catch {
          setError('Could not verify the linked calendar hold. Try again.');
          return false;
        } finally {
          onHoldGmailLabelFlowRef.current.delete(item.id);
        }
      },
    [
      gmailUserLabels,
      gmailThreadLabelsBySubmission,
      bookedApptMeta,
      typeCatalog,
      statusFilter,
      onHoldOver24Only,
      practiceTz,
      navigate,
    ],
  );

  const [gmailThreadOpeningId, setGmailThreadOpeningId] = useState<number | null>(null);

  useEffect(() => {
    setListPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (!useListPagination) return;
    if (listPage > listTotalPages) {
      setListPage(listTotalPages);
    }
  }, [listPage, useListPagination, listTotalPages]);

  useEffect(() => {
    if (!useListPagination || highlightEntryId == null || loading) return;
    const idx = filtered.findIndex((item) => item.id === highlightEntryId);
    if (idx < 0) return;
    const page = Math.floor(idx / LIST_PAGE_SIZE) + 1;
    setListPage(page);
  }, [highlightEntryId, filtered, loading, useListPagination]);

  useEffect(() => {
    if (highlightEntryId == null || loading) return;
    if (!highlightScrollSig.current) return;
    const id = highlightEntryId;

    if (useListPagination) {
      const idx = filtered.findIndex((item) => item.id === id);
      if (idx < 0) return;
      const page = Math.floor(idx / LIST_PAGE_SIZE) + 1;
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
  }, [highlightEntryId, loading, filtered, useListPagination, listPage]);

  const highlightFromUrl = useMemo(
    () => parseAppointmentRequestsHighlightFromSearch(location.search),
    [location.search],
  );

  /** Deep link from Gmail (or elsewhere): scroll to the submission row once the list has loaded. */
  useEffect(() => {
    if (highlightFromUrl == null || loading) return;
    const id = highlightFromUrl;
    if (!rows.some((row) => row.id === id)) return;

    setHighlightEntryId(id);
    highlightScrollSig.current = `${id}-${Date.now()}`;

    const params = new URLSearchParams(location.search);
    params.delete(APPOINTMENT_REQUESTS_HIGHLIGHT_PARAM);
    const qs = params.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, {
      replace: true,
      state: location.state,
    });
  }, [highlightFromUrl, loading, rows, location.pathname, location.search, location.state, navigate]);

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

  useEffect(() => {
    const submissionId = pendingNotBookedModalRef.current;
    if (submissionId == null) return;
    const item = rows.find((row) => row.id === submissionId);
    if (!item) return;
    pendingNotBookedModalRef.current = null;
    setNotBookedItem(item);
    setNotBookedReasonChoice('');
    setNotBookedReasonOther('');
    setNotBookedError(null);
  }, [rows]);

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
    if (!appointmentRequestNeedsStaffConfirmation(item)) return;
    setStatusError((e) => ({ ...e, [item.id]: null }));
    writeAppointmentRequestListReturnTab(statusFilter);
    const bookedSummary =
      item.bookedAppointmentId != null
        ? bookedApptMeta.get(Number(item.bookedAppointmentId))
        : undefined;
    setStatusUpdating((s) => ({ ...s, [item.id]: true }));
    void beginAppointmentRequestStaffConfirmFlow({
      submission: item,
      practiceTz,
      navigate,
      typeCatalog,
      bookedApptSummary: bookedSummary ?? null,
      returnPath: appointmentRequestsPathForTab(statusFilter, { onHoldOver24Only }),
    })
      .then((result) => {
        if (result.kind === 'scheduler_review') return;
        if (result.kind === 'needs_relink') {
          setManualBookModal({ item, relink: true });
          setNotice(
            'The linked calendar visit changed. Pick the correct appointment to track, then confirm.',
          );
          return;
        }
        if (result.kind === 'needs_not_booked') {
          setNotBookedItem(item);
          setNotBookedReasonChoice('');
          setNotBookedReasonOther('');
          setNotBookedError(null);
          setNotice(
            'No calendar visit found for this request. Mark it Not booked if it was cancelled or never booked.',
          );
          return;
        }
        if (result.kind === 'error') {
          setStatusError((e) => ({ ...e, [item.id]: result.message }));
          return;
        }
        // already_confirmed — nothing pending; just clear it from Auto-Booked.
        mergeSubmission({
          ...item,
          staffConfirmedAt: item.staffConfirmedAt?.trim() || new Date().toISOString(),
        });
        beginRowExit(item.id, 'booked');
        notifySchedulingToolsNavCountsRefresh();
        setNotice('This request was already confirmed.');
      })
      .catch(() => {
        setStatusError((e) => ({
          ...e,
          [item.id]: 'Could not confirm this appointment request.',
        }));
      })
      .finally(() => {
        setStatusUpdating((s) => ({ ...s, [item.id]: false }));
      });
  };

  const openNotBookedModal = (item: AppointmentRequestSubmissionItem) => {
    if ((item.status ?? 'new') === 'dismissed') return;
    setStatusError((e) => ({ ...e, [item.id]: null }));
    const bookedSummary =
      item.bookedAppointmentId != null
        ? bookedApptMeta.get(Number(item.bookedAppointmentId))
        : undefined;
    writeAppointmentRequestListReturnTab(statusFilter);
    void beginAppointmentRequestNotBookedFlow({
      submission: item,
      returnPath: appointmentRequestsPathForTab(statusFilter, { onHoldOver24Only }),
      practiceTz,
      navigate,
      bookedApptSummary: bookedSummary ?? null,
    })
      .then((result) => {
        if (result.kind === 'scheduler_remove') {
          setNotice('Remove this visit from the calendar, then mark the request as not booked.');
          return;
        }
        if (result.kind === 'already_dismissed') return;
        // needs_reason: linked visit missing/cancelled — reason modal only.
        setNotBookedItem(item);
        setNotBookedReasonChoice('');
        setNotBookedReasonOther('');
        setNotBookedError(null);
      })
      .catch(() => {
        setError('Could not start the not booked flow for this appointment request.');
      });
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
    const apptId = notBookedItem.bookedAppointmentId;
    if (apptId != null) {
      try {
        const appt = await fetchAppointmentById(Number(apptId), { practiceId: PRACTICE_ID });
        if (appointmentRecordHasActiveLinkedVisit(appt)) {
          setNotBookedError(
            'This visit is still on the calendar. Remove it before marking the request as not booked.',
          );
          return;
        }
      } catch {
        setNotBookedError('Could not verify the linked calendar visit. Try again.');
        return;
      }
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

  const onReschedule = (item: AppointmentRequestSubmissionItem) => {
    void startRescheduleFromBookedAppointmentRequest({
      submission: item,
      practiceTz,
      navigate,
    }).then((result) => {
      if (result.error) setError(result.error);
    });
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

  const openEmailClient = (item: AppointmentRequestSubmissionItem) => {
    setEmailItem(item);
  };

  const markContactedAfterSuccessfulOutreach = useCallback(
    async (
      item: AppointmentRequestSubmissionItem,
      gmailContext?: AppointmentRequestEmailSentContext | null,
    ) => {
      if (submissionStatus(item) === 'new') {
        try {
          await updateStatus(item, 'contacted');
        } catch {
          /* updateStatus surfaces errors on the row */
        }
      }

      if (!canAccessGmailInbox || gmailUserLabels.length === 0) return;

      try {
        let mailbox = gmailContext?.mailbox;
        let threadId = gmailContext?.threadId;
        let messageId = gmailContext?.messageId;
        let labelIds = gmailContext?.labelIds ?? [];

        if (!threadId || !messageId) {
          const cached = gmailThreadLabelsBySubmission.get(item.id);
          if (cached?.threadId && cached.messageId) {
            mailbox = cached.mailbox;
            threadId = cached.threadId;
            messageId = cached.messageId;
            labelIds = cached.labelIds;
          } else {
            return;
          }
        }

        if (!mailbox?.trim() || !threadId?.trim() || !messageId?.trim()) return;

        const result = await applyApptRequestGmailOutcomeLabel({
          mailbox: mailbox.trim(),
          message: { id: messageId, threadId, labelIds },
          outcome: 'contacted',
          userLabels: gmailUserLabels,
        });

        if (result.labelIds) {
          patchGmailThreadLabels(item.id, {
            mailbox: mailbox.trim(),
            threadId,
            messageId,
            labelIds: result.labelIds,
            labels: getMessageLabelsForAppointmentList(result.labelIds, gmailLabelById),
          });
        }
      } catch {
        /* non-blocking: outreach already succeeded */
      }
    },
    [
      updateStatus,
      canAccessGmailInbox,
      gmailUserLabels,
      gmailLabelById,
      gmailThreadLabelsBySubmission,
      patchGmailThreadLabels,
    ],
  );

  const closeEmailModal = () => {
    setEmailItem(null);
  };

  const renderEmailClientButton = (item: AppointmentRequestSubmissionItem) =>
    canAccessGmailInbox ? (
      <button
        type="button"
        className="btn secondary"
        onClick={() => openEmailClient(item)}
      >
        Email client
      </button>
    ) : null;

  const openGmailThread = useCallback(
    async (item: AppointmentRequestSubmissionItem) => {
      const cached = gmailThreadLabelsBySubmission.get(item.id);
      setGmailThreadOpeningId(item.id);
      try {
        let threadId = cached?.threadId ?? item.gmailThreadId?.trim() ?? null;
        let mailbox =
          cached?.mailbox ?? item.gmailMailbox?.trim() ?? APPOINTMENT_REQUEST_MAILBOX;
        if (!threadId) {
          const link = await fetchAppointmentRequestGmailLink(item.id);
          threadId = link.threadId?.trim() ?? null;
          mailbox = link.mailbox?.trim() || mailbox;
          if (threadId) {
            handleGmailLinkResolved(item.id, { gmailThreadId: threadId, gmailMailbox: mailbox });
          }
        }
        if (!threadId) {
          setNotice('No Gmail thread found for this request yet.');
          return;
        }
        navigate(buildGmailInboxReturnPath(mailbox, threadId));
      } catch {
        setNotice('Could not open the Gmail thread.');
      } finally {
        setGmailThreadOpeningId(null);
      }
    },
    [gmailThreadLabelsBySubmission, navigate, handleGmailLinkResolved],
  );

  const renderGoToGmailThreadButton = (item: AppointmentRequestSubmissionItem) =>
    canAccessGmailInbox ? (
      <button
        type="button"
        className="btn secondary"
        disabled={gmailThreadOpeningId === item.id}
        onClick={() => void openGmailThread(item)}
      >
        {gmailThreadOpeningId === item.id ? 'Opening…' : 'Go to Gmail thread'}
      </button>
    ) : null;

  const handleSendSms = async (opts: { overrideNonProd: boolean }) => {
    if (!smsItem || !smsMessage.trim()) return;
    const outreachItem = smsItem;
    setSmsSending(true);
    setSmsError(null);
    try {
      await sendAppointmentRequestSubmissionSms(outreachItem.id, {
        message: smsMessage.trim(),
        ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
      });
      closeSmsModal();
      setNotice('Text message sent.');
      void markContactedAfterSuccessfulOutreach(outreachItem);
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

  const isToConfirmView = statusFilter === 'to_confirm';

  if (statusFilter === 'on_hold') {
    return null;
  }

  return (
    <div className="container">
      <div className="settings-page">
      <h1 className="settings-title">Appointments</h1>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        {isToConfirmView
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
          const active = highlightedStatusTab === key;
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
                  ({key === 'new' ? newTabVisibleCount : tabCounts[key]})
                </span>
              ) : null}
            </button>
          );
        })}
        <button type="button" className="btn primary appt-request-status-tabs-refresh" onClick={() => void load({ awaitHydration: true })} disabled={loading}>
          Refresh
        </button>
      </div>

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
      ) : displayList.length === 0 ? (
        <p className="settings-muted">
          {isSearchActive
            ? 'No appointment requests match your search.'
            : 'No appointment requests in this view.'}
        </p>
      ) : (
        <div className="appt-request-list-wrap">
        <ul className="appt-request-list">
          {displayList.map((item) => {
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
            // When Gmail is connected, the Gmail labels row is the single source of truth
            // for status/category labels (Booked / Not booked / Contacted / On hold /
            // Emergent / client type / Euthanasia — all mirrored or applied as Gmail
            // labels). Hide the duplicative Scout chips; keep only cues with no Gmail
            // equivalent (search-tab aid, text consent, auto-booked, convert-hold action).
            const showScoutLabelChips = !canAccessGmailInbox;
            const bookedApptId = item.bookedAppointmentId;
            const hasLinkedAppointment = bookedApptId != null;
            // Only true when the client self-scheduled a slot and it was auto-booked online —
            // not for ordinary appointment requests that staff book later.
            const autoBookedOnline = appointmentRequestAutoBookedOnline(item);
            const needsStaffConfirmation = appointmentRequestNeedsStaffConfirmation(item);
            const needsManualBook = !isDismissed && !isBooked && !hasLinkedAppointment;
            const bookedSummary =
              bookedApptId != null ? bookedApptMeta.get(Number(bookedApptId)) : undefined;
            const linkedAppointment = linkedEvetIdsFromBookedApptSummary(bookedSummary);
            const requestTypeName = requestDataAppointmentTypeLabel(rd);
            const displayBookedSummary =
              bookedApptId != null
                ? resolveAppointmentRequestBookedVisitSummary(
                    item,
                    bookedSummary,
                    typeCatalog,
                  )
                : null;
            const requestedSlotSummary =
              !hasLinkedAppointment && !autoBookedOnline
                ? resolveAppointmentRequestBookedVisitSummary(item, undefined, typeCatalog)
                : null;
            const linkedVisitLine =
              displayBookedSummary != null && !autoBookedOnline
                ? formatLinkedVisitLine(
                    displayBookedSummary,
                    practiceTz,
                    requestTypeName,
                    rd,
                    typeCatalog,
                  )
                : requestedSlotSummary != null
                  ? formatLinkedVisitLine(
                      requestedSlotSummary,
                      practiceTz,
                      requestTypeName,
                      rd,
                      typeCatalog,
                      { requestedOnly: true },
                    )
                  : null;
            const autoBookedVisit =
              autoBookedOnline
                ? appointmentRequestBookedVisitLabels({
                    requestData: rd,
                    bookedSummary: displayBookedSummary,
                    practiceTz,
                    typeCatalog,
                    isOnHold: isOnHoldVisit,
                  })
                : { bookedLabel: null, providerLabel: null };
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
                      {showScoutLabelChips && isBooked ? <ApptRequestStatusChip variant="booked">Booked</ApptRequestStatusChip> : null}
                      {showScoutLabelChips && status === 'dismissed' ? (
                        <ApptRequestStatusChip variant="not-booked">Not booked</ApptRequestStatusChip>
                      ) : null}
                      {showScoutLabelChips && submissionShowsContactedChip(item) ? (
                        <ApptRequestStatusChip variant="contacted">Contacted</ApptRequestStatusChip>
                      ) : null}
                      {showScoutLabelChips && howSoonUrgency === 'emergent' ? (
                        <span className="appt-request-urgency-chip appt-request-urgency-chip--emergent">
                          Emergent
                        </span>
                      ) : showScoutLabelChips && howSoonUrgency === 'urgent' ? (
                        <span className="appt-request-urgency-chip appt-request-urgency-chip--urgent">
                          Urgent
                        </span>
                      ) : null}
                      {showScoutLabelChips && clientType !== 'unknown' ? (
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
                      {showScoutLabelChips && isEuth ? (
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
                      {autoBookedOnline ? (
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
                      {showScoutLabelChips && isOnHoldVisit ? (
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
                      {clientType === 'new' && hasLinkedAppointment && isOnHoldVisit ? (
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
                    {canAccessGmailInbox ? (
                      <AppointmentRequestGmailThreadLabels
                        thread={gmailThreadLabelsBySubmission.get(item.id)}
                        userLabels={gmailUserLabels}
                        labelById={gmailLabelById}
                        loading={gmailLabelsLoadingIds.has(item.id)}
                        onLabelsUpdated={(entry) => handleGmailThreadLabelsUpdated(item.id, entry)}
                        onLabelsAdded={(added) => handleGmailLabelsAdded(item, added)}
                        beforeRemoveLabel={makeOnHoldGmailLabelRemoveGuard(item)}
                        onError={(message) => setError(message)}
                      />
                    ) : null}
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
                      {autoBookedOnline && autoBookedVisit.bookedLabel ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">Booked</dt>
                          <dd className="appt-request-meta-value">{autoBookedVisit.bookedLabel}</dd>
                        </div>
                      ) : null}
                      {autoBookedOnline && autoBookedVisit.providerLabel ? (
                        <div className="appt-request-meta-line">
                          <dt className="appt-request-meta-label">With</dt>
                          <dd className="appt-request-meta-value">{autoBookedVisit.providerLabel}</dd>
                        </div>
                      ) : null}
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
                        {renderEmailClientButton(item)}
                        {renderGoToGmailThreadButton(item)}
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
                        {renderEmailClientButton(item)}
                        {renderGoToGmailThreadButton(item)}
                        {!needsStaffConfirmation ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => onViewAppointment(item)}
                          >
                            View appointment
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
                        {renderEmailClientButton(item)}
                        {renderGoToGmailThreadButton(item)}
                        {!needsStaffConfirmation ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => onViewAppointment(item)}
                          >
                            View appointment
                          </button>
                        ) : null}
                        {isBooked ? (
                          <button type="button" className="btn secondary" onClick={() => onReschedule(item)}>
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
                        {renderEmailClientButton(item)}
                        {renderGoToGmailThreadButton(item)}
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
                    {statusError[item.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {statusError[item.id]}
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
        {useListPagination && filtered.length > LIST_PAGE_SIZE ? (
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
              Showing {(listPage - 1) * LIST_PAGE_SIZE + 1}–
              {Math.min(listPage * LIST_PAGE_SIZE, filtered.length)} of {filtered.length}
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
                Page {listPage} of {listTotalPages}
              </span>
              <button
                type="button"
                className="btn secondary"
                disabled={listPage >= listTotalPages}
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

      {emailSentToast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 11000,
            background: '#065f46',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span aria-hidden style={{ fontSize: 16 }}>✓</span>
          Email sent
        </div>
      ) : null}

      {emailItem ? (
        <AppointmentRequestEmailModal
          item={emailItem}
          practiceId={PRACTICE_ID}
          practiceTz={practiceTz}
          onClose={closeEmailModal}
          onSent={(context) => {
            setEmailSentToast(true);
            window.setTimeout(() => setEmailSentToast(false), 3500);
            void markContactedAfterSuccessfulOutreach(emailItem, context);
          }}
          onGmailLinked={(patch) => {
            setRows((prev) =>
              prev.map((row) => (row.id === emailItem.id ? { ...row, ...patch } : row)),
            );
          }}
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
