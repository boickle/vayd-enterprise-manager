import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  fetchAllAppointmentRequestSubmissions,
  fetchAppointmentRequestSubmission,
  fetchAppointmentRequestSubmissionsPage,
  fetchRemainingAppointmentRequestSubmissionPages,
  bookAppointmentRequestSubmission,
  patchAppointmentRequestSubmission,
  markAppointmentRequestReplies,
  sendAppointmentRequestSubmissionSms,
  type AppointmentRequestSubmission,
  type AppointmentRequestSubmissionItem,
  type VisitSinceRequest,
  type AppointmentRequestSubmissionStatus,
} from '../api/appointmentRequestSubmissions';
import {
  fetchAppointmentFormDraft,
  patchAppointmentFormDraft,
  type AppointmentFormDraftDetail,
  type AppointmentFormDraftFollowUpStatus,
} from '../api/appointmentFormDrafts';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { AppointmentRequestEmailModal } from '../components/AppointmentRequestEmailModal';
import type { AppointmentRequestEmailSentContext } from '../components/AppointmentRequestEmailModal';
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
  requestDataClientId,
  requestDataClientType,
  requestDataHowSoon,
  requestDataHowSoonUrgency,
  requestDataPetSummary,
  requestDataEmail,
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
} from '../utils/appointmentRequestLinkedEvet';
import { resolveAppointmentRequestSmsMessage } from '../utils/appointmentRequestSmsMessage';
import { resolveRequestDataClientIdStaff } from '../utils/resolveRequestDataClientId';
import { AppointmentRequestClientNameChange } from '../components/AppointmentRequestClientNameChange';
import { AppointmentRequestHandlingNeedsCallout } from '../components/AppointmentRequestHandlingNeedsCallout';
import { requestDataHasNewPatientSpecialHandlingNeeds } from '../utils/appointmentRequestHandlingNeeds';
import {
  buildRoutingAppointmentRequestIntentFromSubmission,
  writeRoutingAppointmentRequestIntent,
} from '../utils/routingAppointmentRequestIntent';
import { dismissRoutingRescheduleWorkspace } from '../utils/routingRescheduleIntent';
import { dismissRoutingForwardBookingWorkspace } from '../utils/routingForwardBookingIntent';
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
  applyApptRequestGmailOutcomeLabel,
} from '../utils/gmailAppointmentRequestLabels';
import { beginAppointmentRequestNotBookedFlow } from '../utils/appointmentRequestNotBookedFlow';
import {
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
} from '../utils/appointmentRequestNoteDrafts';
import {
  appointmentRequestSubmissionIsOnHold,
  appointmentRequestSubmissionCountsAsBooked,
  appointmentRequestOnHoldOver24Hours,
  appointmentRequestBookedVisitLabels,
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
  appointmentRequestNeedsManualBookActions,
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
  appointmentRequestBookedSummaryMatchesSubmission,
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
import { recordsPath } from '../records-nav';
import { fetchClientLiaisons, type ClientLiaisonOption } from '../api/holds';
import { LiaisonSelect } from '../components/appointmentRequests/LiaisonSelect';
import { RouteButton } from '../components/appointmentRequests/RouteButton';
import { useAuth } from '../auth/useAuth';
import { useMayWorkAppointments } from '../permissions/useMayWorkAppointments';
import { requestDataTypeNamesLabel } from '../utils/appointmentRequestDetailDisplay';
import { RequestConversationPanel } from '../components/appointmentRequests/RequestConversationPanel';
import { RequestDetailsPanel } from '../components/appointmentRequests/RequestDetailsPanel';
import { SoapRecordModal, type SoapRecordRef } from '../components/soap/SoapHeaderRecords';
import { SchedulerRecordsRequestModal } from './SchedulerRecordsRequestModal';
import { requestDataPetRowSummaries } from '../utils/appointmentRequestDetailDisplay';
import {
  clientPatientsFromSearchRows,
  enrichPetRowSummariesFromLinkedAppointment,
  requestPetsNeedClientPatients,
  type LinkedClientPatient,
} from '../utils/appointmentRequestLinkedEvet';
import { searchPatients, extractPatientListFromSearchResponse } from '../api/patients';
import { MoreActionsMenu } from '../components/appointmentRequests/MoreActionsMenu';
import { rememberAppointmentTabCounts } from '../components/appointmentRequests/appointmentTabCounts';
import { ReplyBadges } from '../components/appointmentRequests/ReplyBadges';
import { notifyAppointmentRepliesChanged, useAppointmentReplyCounts } from '../hooks/useAppointmentReplyCounts';
import {
  StatusPillMenu,
  type StatusMenuItem,
} from '../components/appointmentRequests/StatusPillMenu';
import '../components/appointmentRequests/requestPanels.css';
import '../components/appointmentRequests/apptTable.css';
import {
  appointmentRequestClientTypeBadge,
  appointmentRequestBookingPill,
  appointmentRequestCommunicationPill,
  appointmentRequestRecordsPill,
  COMMUNICATION_OPTIONS,
  type CommunicationStatus,
  requestCommunicationStatus,
  requestWorkIsFinished,
  receivedDateLabel,
  matchesLiaisonFilter,
  parseLiaisonFilter,
  type LiaisonFilter,
  requestIsQuiet,
  replyTimeLabel,
  visitSinceLabel,
  requestDataTown,
  visitDateShortLabel,
} from '../utils/appointmentRequestTableRow';
import {
  appointmentRequestsListPathMatches,
  resolveAppointmentsListEntryTab,
  writeAppointmentRequestListReturnTab,
} from '../utils/appointmentRequestListReturnTab';
import './Settings.css';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const PRACTICE_ID = currentPracticeId();
const LIAISON_FILTER_KEY = 'vayd-appt-requests-liaison-filter';

type BookedApptSummary = AppointmentRequestBookedApptSummary;

type StatusFilter = AppointmentRequestListTab;

type AppointmentRequestsPageProps = {
  /** @deprecated Tab is read from the URL (`?tab=` or `/on-hold`). */
  initialTab?: StatusFilter;
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'to_confirm', label: 'Auto-Booked' },
  // Contacted requests, and booked ones whose communication or records are not done yet.
  { key: 'contacted', label: 'In progress' },
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
  'new',
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
  /** Techs and doctors see the list read-only (owner, Nov 13, 2026). */
  const mayWork = useMayWorkAppointments();
  const navigate = useNavigate();
  const location = useLocation();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const { allowed: canAccessGmailInbox } = useGmailInboxAccess();
  const { employeeId: authEmployeeId } = useAuth() as { employeeId?: string | null };

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

  const [statusUpdating, setStatusUpdating] = useState<Record<number, boolean>>({});
  const [statusError, setStatusError] = useState<Record<number, string | null>>({});

  const [smsItem, setSmsItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsMessageLoading, setSmsMessageLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [messagesFromLine, setMessagesFromLine] = useState<string | null>(null);

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
  /** Client or pet record open in a pop-up over the list (owner, Nov 12, 2026). */
  const [recordOpen, setRecordOpen] = useState<SoapRecordRef | null>(null);
  /** "Request records for <pet>" from the Records menu. */
  const [recordsRequestFor, setRecordsRequestFor] = useState<{
    patientId: number;
    patientName: string;
    clientId: number | null;
  } | null>(null);
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

  /** Compact table: rows whose full request card is open under the summary line. */
  const [openRowIds, setOpenRowIds] = useState<Set<number>>(() => new Set());
  const [liaisons, setLiaisons] = useState<ClientLiaisonOption[]>([]);
  const [liaisonSaving, setLiaisonSaving] = useState<Record<number, boolean>>({});
  /** Which status pill is saving on a row (Communication or Records). */
  const [pillSaving, setPillSaving] = useState<Record<number, 'comm' | 'records' | undefined>>({});
  const [listPage, setListPage] = useState(1);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const noteDraftsRef = useRef(noteDrafts);
  noteDraftsRef.current = noteDrafts;
  /** Booked visit's client id → that client's patients (for multi-pet requests). */
  const [clientPatientsByClient, setClientPatientsByClient] = useState<
    Map<string, LinkedClientPatient[]>
  >(new Map());
  const clientPatientsAskedRef = useRef<Set<string>>(new Set());
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

  const openRowIdsRef = useRef(openRowIds);
  openRowIdsRef.current = openRowIds;
  const toggleRowOpen = (id: number) => {
    setOpenRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    void fetchClientLiaisons()
      .then((list) => {
        if (!cancelled) setLiaisons(list);
      })
      .catch(() => {
        /* Liaison dropdown still shows the current owner. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      let listReturn = pendingReturn;
      // HOLD books return to the Holds board — don't animate the row out of New as "booked".
      if (pendingReturn?.isHold) {
        navigate(
          holdsPathWithHighlight(pendingReturn.appointmentRequestSubmissionId),
          { replace: true },
        );
        listReturn = null;
      } else if (pendingReturn) {
        clearAppointmentRequestReturnSession();
        highlightId = pendingReturn.appointmentRequestSubmissionId;
        setPendingBookedExitId(highlightId);
        openSmsOnHighlight = pendingReturn.openSms !== false;
      } else if (pendingStaffConfirmReturn) {
        clearAppointmentRequestStaffConfirmReturnSession();
        highlightId = pendingStaffConfirmReturn.submissionId;
        setPendingBookedExitId(highlightId);
      }

      const seedMeta =
        listReturn != null
          ? new Map<number, BookedApptSummary>([
              [
                listReturn.bookedAppointmentId,
                {
                  start: listReturn.bookedAppointmentStart,
                  end: listReturn.bookedAppointmentEnd,
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
        conversions: {
          converted: number;
          totalRequests: number;
          convertedToHold?: number;
        } | null,
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
        }

        knownSubmissionIdsRef.current = new Set(items.map((r) => r.id));

        if (conversions && conversions.totalRequests > 0) {
          const rate = ((conversions.converted / conversions.totalRequests) * 100).toFixed(1);
          const holds = conversions.convertedToHold ?? 0;
          const holdNote =
            holds > 0
              ? ` ${holds} ${holds === 1 ? 'is still a hold' : 'are still holds'}.`
              : '';
          setConversionsBanner(
            `${conversions.converted} of ${conversions.totalRequests} requests converted to appointments (${rate}%).${holdNote}`,
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
            includeAbandoned: true,
            // Without this the API sends placeholder counts and the banner always read
            // "0 of N requests converted" (training review B8, Nov 7, 2026).
            includeConversions: true,
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
            { practiceId: PRACTICE_ID, includeAbandoned: true },
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
        fetchAllAppointmentRequestSubmissions({
          practiceId: PRACTICE_ID,
          includeAbandoned: true,
          includeConversions: true,
        }),
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
  }, [hydrateBookedApptMeta, navigate, practiceTz]);

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

  // SCH-R7: a booked request with a new pet that has no Scout id yet: load the booked visit's
  // client's patients once, so every pet on the request can be matched by name.
  useEffect(() => {
    for (const item of submissions) {
      if (item.bookedAppointmentId == null) continue;
      const clientId = bookedApptMeta.get(Number(item.bookedAppointmentId))?.clientInternalId;
      if (!clientId || clientPatientsAskedRef.current.has(clientId)) continue;
      const summary = bookedApptMeta.get(Number(item.bookedAppointmentId));
      const pets = enrichPetRowSummariesFromLinkedAppointment(
        requestDataPetRowSummaries(item.requestData ?? {}),
        linkedEvetIdsFromBookedApptSummary(summary),
      );
      if (pets.length < 2 || !requestPetsNeedClientPatients(pets)) continue;
      clientPatientsAskedRef.current.add(clientId);
      void searchPatients({ clientId, activeOnly: false })
        .then((res) => {
          const list = clientPatientsFromSearchRows(extractPatientListFromSearchResponse(res.data));
          setClientPatientsByClient((prev) => new Map(prev).set(clientId, list));
        })
        .catch(() => clientPatientsAskedRef.current.delete(clientId));
    }
  }, [submissions, bookedApptMeta]);
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
      // Booked stays In progress until communication is complete and records are done.
      if (status === 'booked' && !requestWorkIsFinished(row)) {
        counts.contacted += 1;
        continue;
      }
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

  const filteredByTab = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortNewestFirst = (a: AppointmentRequestSubmissionItem, b: AppointmentRequestSubmissionItem) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();

    if (statusFilter === 'on_hold') {
      return submissions
        .filter((item) => {
          if (exitingRows.has(item.id) || openRowIds.has(item.id)) return true;
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
            exitingRows.has(item.id) ||
            openRowIds.has(item.id) ||
            appointmentRequestNeedsStaffConfirmation(item),
        )
        .sort(sortNewestFirst);
    }

    return submissions
      .filter((item) => {
        // An open row stays put while staff work it, even after its status moves on.
        if (exitingRows.has(item.id) || openRowIds.has(item.id)) return true;
        const itemStatus = submissionStatus(item);
        if (statusFilter === 'contacted') {
          if (itemStatus === 'contacted') return true;
          // Booked, but communication or records still open.
          return (
            itemStatus === 'booked' &&
            !appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog) &&
            !appointmentRequestNeedsStaffConfirmation(item) &&
            !requestWorkIsFinished(item)
          );
        }
        if (itemStatus !== statusFilter) return false;
        if (appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog)) {
          return false;
        }
        if (
          statusFilter === 'booked' &&
          (appointmentRequestNeedsStaffConfirmation(item) || !requestWorkIsFinished(item))
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
    openRowIds,
    bookedApptMeta,
    typeCatalog,
  ]);

  /** Liaison filter (Everyone / Mine / Unassigned / one person), remembered on this computer. */
  const [liaisonFilter, setLiaisonFilter] = useState<LiaisonFilter>(() => {
    try {
      return parseLiaisonFilter(localStorage.getItem(LIAISON_FILTER_KEY));
    } catch {
      return 'all';
    }
  });
  const chooseLiaisonFilter = (next: LiaisonFilter) => {
    setLiaisonFilter(next);
    try {
      localStorage.setItem(LIAISON_FILTER_KEY, String(next));
    } catch {
      /* not remembered */
    }
  };
  const myEmployeeId = useMemo(() => {
    const n = Number(authEmployeeId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [authEmployeeId]);
  /** Red when the request is mine or nobody's; blue when it is someone else's. */
  const replyIsMine = useCallback(
    (item: AppointmentRequestSubmissionItem) =>
      item.liaisonEmployeeId == null || (myEmployeeId != null && item.liaisonEmployeeId === myEmployeeId),
    [myEmployeeId],
  );
  /** Rows read by opening them keep their place at the top until they are closed. */
  const [readWhileOpen, setReadWhileOpen] = useState<Set<number>>(() => new Set());
  const filtered = useMemo(() => {
    const base =
      liaisonFilter === 'all'
        ? filteredByTab
        : filteredByTab.filter(
            (item) =>
              // An open row stays while staff work it, even after its liaison changes.
              openRowIds.has(item.id) ||
              (!isAbandonedItem(item) && matchesLiaisonFilter(item, liaisonFilter, myEmployeeId)),
          );
    // Requests with unread client replies come first (the order is otherwise unchanged).
    const unreadFirst = (item: AppointmentRequestSubmissionItem) =>
      !isAbandonedItem(item) && ((item.unreadReplies?.count ?? 0) > 0 || readWhileOpen.has(item.id))
        ? 1
        : 0;
    return [...base].sort((a, b) => unreadFirst(b) - unreadFirst(a));
  }, [filteredByTab, liaisonFilter, myEmployeeId, openRowIds, readWhileOpen]);

  // SCH-R10: unread client texts on holds that did not come from a request, shown on the Hold tab.
  const holdReplyCounts = useAppointmentReplyCounts(true);

  /** Unread replies per tab, red (mine) and blue (others). */
  const tabReplyCounts = useMemo(() => {
    const counts = new Map<StatusFilter, { mine: number; others: number }>();
    for (const row of submissions) {
      if ((row.unreadReplies?.count ?? 0) <= 0) continue;
      const tab = appointmentRequestListTabForSubmission(row, bookedApptMeta, typeCatalog);
      const c = counts.get(tab) ?? { mine: 0, others: 0 };
      if (replyIsMine(row)) c.mine += 1;
      else c.others += 1;
      counts.set(tab, c);
    }
    return counts;
  }, [submissions, bookedApptMeta, typeCatalog, replyIsMine]);

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

  /** Hand the tab counts and reply badges to the Hold tab's strip (it doesn't load requests). */
  useEffect(() => {
    if (loading) return;
    const out: Record<string, { count?: number; mine: number; others: number }> = {};
    for (const { key } of STATUS_TABS) {
      out[key] = {
        count: tabShowsCount(key) ? (key === 'new' ? newTabVisibleCount : tabCounts[key]) : undefined,
        mine: tabReplyCounts.get(key)?.mine ?? 0,
        others: tabReplyCounts.get(key)?.others ?? 0,
      };
    }
    rememberAppointmentTabCounts(out);
  }, [loading, tabCounts, newTabVisibleCount, tabReplyCounts]);


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

  /**
   * After a request is booked: it moves to Booked only when communication and records are done
   * too (a hold goes to On hold as before); otherwise it moves to, or stays in, In progress.
   */
  const exitAfterBooking = useCallback(
    (updated: AppointmentRequestSubmissionItem) => {
      const finished = updated.linkedVisitIsHold === true || requestWorkIsFinished(updated);
      if (finished) beginRowExit(updated.id, 'booked');
      else if (statusFilterRef.current !== 'contacted') beginRowExit(updated.id, 'contacted');
    },
    [beginRowExit],
  );

  const handleLinkedAppointment = useCallback(
    (updated: AppointmentRequestSubmissionItem) => {
      mergeSubmission({ ...updated, kind: 'submission' });
      exitAfterBooking(updated);
      notifySchedulingToolsNavCountsRefresh();
    },
    [mergeSubmission, exitAfterBooking],
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
          exitAfterBooking({ ...item, ...updated });
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
    [mergeSubmission, beginRowExit, exitAfterBooking]
  );

  /**
   * Communication and Records columns. A booked request whose last open part is finished
   * leaves for Booked; a New request with a communication step moves to In progress.
   */
  const changeRequestProgress = useCallback(
    async (
      item: AppointmentRequestSubmissionItem,
      body: {
        communicationStatus?: CommunicationStatus;
        recordsStatus?: 'not_needed' | 'waiting' | 'complete' | null;
      },
      column: 'comm' | 'records',
    ) => {
      setPillSaving((s) => ({ ...s, [item.id]: column }));
      setStatusUpdating((s) => ({ ...s, [item.id]: true }));
      setStatusError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await patchAppointmentRequestSubmission(item.id, body);
        const merged = { ...item, ...updated, kind: 'submission' as const };
        mergeSubmission(merged);
        const before = submissionStatus(item);
        const after = submissionStatus(merged);
        if (before === 'new' && after === 'contacted' && statusFilterRef.current === 'new') {
          beginRowExit(item.id, 'contacted');
        } else if (
          after === 'booked' &&
          merged.linkedVisitIsHold !== true &&
          !appointmentRequestNeedsStaffConfirmation(merged) &&
          !requestWorkIsFinished(item) &&
          requestWorkIsFinished(merged)
        ) {
          beginRowExit(item.id, 'booked');
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not save';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
      } finally {
        setPillSaving((s) => ({ ...s, [item.id]: undefined }));
        setStatusUpdating((s) => ({ ...s, [item.id]: false }));
      }
    },
    [mergeSubmission, beginRowExit],
  );

  /** Opening a request reads its client replies (anyone who works the list); closing lets it settle back. */
  const toggleRowAndReadReplies = useCallback(
    (item: AppointmentRequestSubmissionItem) => {
      const opening = !openRowIdsRef.current.has(item.id);
      toggleRowOpen(item.id);
      if (!opening) {
        setReadWhileOpen((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        return;
      }
      if ((item.unreadReplies?.count ?? 0) <= 0 || isAbandonedItem(item)) return;
      // A read-only viewer opening it doesn't clear the badge for the people working it.
      if (!mayWork) return;
      setReadWhileOpen((prev) => new Set(prev).add(item.id));
      void markAppointmentRequestReplies(item.id, true)
        .then((updated) => {
          mergeSubmission({ ...updated, kind: 'submission' });
          notifyAppointmentRepliesChanged();
        })
        .catch(() => {
          /* still unread; the badge stays */
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleRowOpen only sets state
    [mergeSubmission, mayWork],
  );

  /** "Mark as unread": the latest reply is unread again, and the request closes. */
  const markRepliesUnread = useCallback(
    async (item: AppointmentRequestSubmissionItem) => {
      setStatusError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await markAppointmentRequestReplies(item.id, false);
        mergeSubmission({ ...updated, kind: 'submission' });
        notifyAppointmentRepliesChanged();
        setOpenRowIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setReadWhileOpen((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not mark as unread';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
      }
    },
    [mergeSubmission],
  );

  /** Liaison column: anyone can hand a request to anyone, or clear it. */
  const changeLiaison = useCallback(
    async (item: AppointmentRequestSubmissionItem, employeeId: number | null) => {
      setLiaisonSaving((s) => ({ ...s, [item.id]: true }));
      setStatusError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await patchAppointmentRequestSubmission(item.id, {
          liaisonEmployeeId: employeeId,
        });
        mergeSubmission({ ...updated, kind: 'submission' });
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not change the liaison';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
      } finally {
        setLiaisonSaving((s) => ({ ...s, [item.id]: false }));
      }
    },
    [mergeSubmission],
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

  const onBook = (item: AppointmentRequestSubmissionItem) => {
    const rd = item.requestData ?? {};
    writeAppointmentRequestListReturnTab(statusFilter);
    // Book must open a new discrete visit. Leftover reschedule / forward-booking
    // session state would make Routing PATCH an existing household appointment.
    dismissRoutingRescheduleWorkspace();
    dismissRoutingForwardBookingWorkspace();
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

  /** Re-Route → Explore alternatives: keep the current visit until a new time is picked. */
  const onExploreAlternatives = (item: AppointmentRequestSubmissionItem) => {
    writeAppointmentRequestListReturnTab(statusFilter);
    void startRescheduleFromBookedAppointmentRequest({
      submission: item,
      practiceTz,
      navigate,
      exploreAlternatives: true,
    }).then((result) => {
      if (result.error) setError(result.error);
    });
  };

  const closeSmsModal = () => {
    setSmsItem(null);
    setSmsMessage('');
    setSmsMessageLoading(false);
    setSmsError(null);
  };

  const openMessagesHistoryFromSms = () => {
    if (!smsItem) return;
    const rd = (smsItem.requestData ?? {}) as Record<string, unknown>;
    const label = clientDisplayNameFromRequestData(rd);
    const phone = requestDataPhone(rd);
    const syncId = requestDataClientId(rd);
    if (syncId) {
      setMessagesClientId(Number(syncId));
      setMessagesClientLabel(label);
      setMessagesFromLine(phone);
      return;
    }
    void resolveRequestDataClientIdStaff(rd, PRACTICE_ID).then((id) => {
      if (!id) {
        setSmsError('Could not find this client in the system to load message history.');
        return;
      }
      setMessagesClientId(Number(id));
      setMessagesClientLabel(label);
      setMessagesFromLine(phone);
    });
  };

  /** "Seen since this request": link that visit to the request (Booked, or On hold for a hold). */
  const linkVisitSince = useCallback(
    async (item: AppointmentRequestSubmissionItem, appointmentId: number) => {
      setStatusUpdating((s) => ({ ...s, [item.id]: true }));
      setStatusError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await bookAppointmentRequestSubmission(item.id, { appointmentId });
        mergeSubmission({ ...updated, kind: 'submission', visitSinceRequest: null });
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not link the visit';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
      } finally {
        setStatusUpdating((s) => ({ ...s, [item.id]: false }));
      }
    },
    [mergeSubmission],
  );

  /** Contact from the conversation panel: mark a New request Contacted without moving the row away. */
  const markContactedInPlace = useCallback(
    async (item: AppointmentRequestSubmissionItem) => {
      const isNew = submissionStatus(item) === 'new';
      // Booked or contacted rows: a first email or text still moves Not contacted on.
      if (!isNew && requestCommunicationStatus(item) !== 'not_contacted') return;
      if (submissionStatus(item) === 'dismissed') return;
      try {
        const updated = await patchAppointmentRequestSubmission(
          item.id,
          isNew ? { status: 'contacted' } : { communicationStatus: 'contacted' },
        );
        mergeSubmission({ ...updated, kind: 'submission' });
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not mark contacted';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
      }
    },
    [mergeSubmission],
  );

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

  /** Booking column menu: the next booking step for this request. */
  const bookingMenuItems = (args: {
    item: AppointmentRequestSubmissionItem;
    visitSince: VisitSinceRequest | null;
    isDismissed: boolean;
    needsStaffConfirmation: boolean;
    needsManualBook: boolean;
    hasLinkedAppointment: boolean;
    isOnHoldVisit: boolean;
  }): StatusMenuItem[] => {
    const { item, visitSince } = args;
    const items: StatusMenuItem[] = [];
    if (args.isDismissed) {
      items.push({ label: 'Reopen', hint: 'Back to New', onClick: () => void updateStatus(item, 'new') });
      return items;
    }
    if (visitSince) {
      items.push({
        label: `Link this visit (${visitSinceLabel(visitSince, practiceTz)})`,
        hint: visitSince.isHold ? 'Puts the request on that hold' : 'Marks the request booked',
        onClick: () => void linkVisitSince(item, visitSince.appointmentId),
      });
    }
    if (args.needsStaffConfirmation) {
      items.push({ label: 'Confirm appointment', onClick: () => openConfirmPreview(item) });
    }
    if (args.needsManualBook) {
      items.push({ label: 'Route to book…', onClick: () => onBook(item) });
      items.push({
        label: 'Link existing appointment…',
        onClick: () => setManualBookModal({ item, relink: false }),
      });
    }
    if (args.hasLinkedAppointment && !args.needsStaffConfirmation) {
      items.push({
        label: args.isOnHoldVisit ? 'Open hold' : 'View appointment',
        onClick: () => onViewAppointment(item),
      });
      items.push({
        label: 'Re-link appointment…',
        onClick: () => setManualBookModal({ item, relink: true }),
      });
    }
    if (items.length > 0) items.push({ divider: true });
    items.push({ label: 'Not booked…', hint: 'Choose a reason', onClick: () => openNotBookedModal(item) });
    return items;
  };

  /** Records column menu: follow the records requests, or say what staff know. */
  const recordsMenuItems = (
    item: AppointmentRequestSubmissionItem,
    clientName: string,
    pets: Array<{ name: string; patientId: string | null }>,
    clientId: string | null,
  ): StatusMenuItem[] => {
    const choice = item.recordsStatus ?? null;
    const set = (next: 'not_needed' | 'waiting' | 'complete' | null) => {
      if (next !== choice) void changeRequestProgress(item, { recordsStatus: next }, 'records');
    };
    const sent = (item.records?.total ?? 0) > 0;
    const items: StatusMenuItem[] = [];
    // Ask the previous hospital for records (owner, Nov 12, 2026). Needs the pet in Scout.
    for (const pet of pets) {
      const pid = Number(pet.patientId);
      const inScout = Number.isFinite(pid) && pid > 0;
      items.push({
        label: `Request records for ${pet.name}…`,
        hint: inScout ? 'Email the previous hospital' : `${pet.name} isn't in Scout yet. Request after booking`,
        disabled: !inScout,
        onClick: () =>
          setRecordsRequestFor({
            patientId: pid,
            patientName: pet.name,
            clientId: clientId && /^\d+$/.test(clientId) ? Number(clientId) : null,
          }),
      });
    }
    if (items.length > 0) items.push({ divider: true });
    items.push(
      {
        label: sent ? 'Records requested' : 'Nothing requested yet',
        hint: sent
          ? 'Done when every request is in and summarized in the chart'
          : 'Shows Requested once a records request is sent',
        selected: choice == null,
        onClick: () => set(null),
      },
      {
        label: 'Waiting on client',
        hint: 'The client is sending records',
        selected: choice === 'waiting',
        onClick: () => set('waiting'),
      },
      {
        label: 'Records complete',
        hint: 'Done, even if a request is still out',
        selected: choice === 'complete',
        onClick: () => set('complete'),
      },
      { label: 'Not needed', selected: choice === 'not_needed', onClick: () => set('not_needed') },
    );
    if ((item.records?.total ?? 0) > 0) {
      items.push({ divider: true });
      items.push({
        label: 'Open records requests',
        hint: item.records?.toSummarize ? 'Summarize and close out there' : undefined,
        onClick: () =>
          navigate(recordsPath(clientName)),
      });
    }
    return items;
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
    <div className="container appt-requests-container">
      <div className="settings-page appt-requests-page">
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
              <ReplyBadges
                mine={tabReplyCounts.get(key)?.mine ?? 0}
                others={tabReplyCounts.get(key)?.others ?? 0}
              />
              {tabShowsCount(key) ? (
                <span className="appt-request-status-tab-count" aria-hidden>
                  ({key === 'new' ? newTabVisibleCount : tabCounts[key]})
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          className="appt-request-status-tab"
          onClick={() => navigate(HOLDS_PATH)}
        >
          <span>Hold</span>
          <ReplyBadges
            mine={(tabReplyCounts.get('on_hold')?.mine ?? 0) + holdReplyCounts.holdMine}
            others={(tabReplyCounts.get('on_hold')?.others ?? 0) + holdReplyCounts.holdOthers}
          />
        </button>
        {mayWork ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => navigate(`${APPOINTMENT_REQUESTS_LIST_PATH}/cleanup`)}
            title="Close out open requests older than 10 days"
          >
            Clean up old requests
          </button>
        ) : null}
        <button type="button" className="btn primary appt-request-status-tabs-refresh" onClick={() => void load({ awaitHydration: true })} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="appt-list-filters">
      <label className="appt-liaison-filter">
        <span>Liaison</span>
        <select
          value={String(liaisonFilter)}
          onChange={(e) => chooseLiaisonFilter(parseLiaisonFilter(e.target.value))}
          aria-label="Filter by liaison"
        >
          <option value="all">Everyone</option>
          <option value="mine" disabled={myEmployeeId == null}>
            Mine
          </option>
          <option value="unassigned">Unassigned</option>
          {liaisons.map((l) => (
            <option key={l.id} value={String(l.id)}>
              {[l.firstName, l.lastName].filter(Boolean).join(' ')}
            </option>
          ))}
        </select>
      </label>
      <div style={{ marginBottom: 16, maxWidth: 420, flex: '1 1 320px' }}>
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
        <div className="appt-table-head appt-table--with-records" role="presentation">
          <span>Request received</span>
          <span />
          <span>Client / Patient</span>
          <span>Request</span>
          <span>Location</span>
          <span>Liaison</span>
          <span>Route visit</span>
          <span>Booking status</span>
          <span>Communication status</span>
          <span>Records</span>
        </div>
        <ul className="appt-request-list appt-request-list--table">
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
            const clientTypeBadge = appointmentRequestClientTypeBadge(
              clientType,
              requestDataPetRowSummaries(rd)
            );
            const isEuth = isEuthanasiaRequestData(rd);
            const status = submissionStatus(item);
            const isDismissed = status === 'dismissed';
            // When Gmail is connected, the Gmail labels row is the single source of truth
            // for status/category labels (Booked / Not booked / Contacted / On hold /
            // Emergent / client type / Euthanasia — all mirrored or applied as Gmail
            // labels). Hide the duplicative Scout chips; keep only cues with no Gmail
            // equivalent (search-tab aid, text consent, auto-booked, convert-hold action).
            const bookedApptId = item.bookedAppointmentId;
            const bookedSummary =
              bookedApptId != null ? bookedApptMeta.get(Number(bookedApptId)) : undefined;
            const hasLinkedAppointment =
              bookedApptId != null &&
              appointmentRequestBookedSummaryMatchesSubmission(item, bookedSummary);
            const isOnHoldVisit =
              hasLinkedAppointment &&
              appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, typeCatalog);
            const isBooked =
              hasLinkedAppointment &&
              appointmentRequestSubmissionCountsAsBooked(
                item,
                bookedApptMeta,
                typeCatalog,
              );
            // Only true when the client self-scheduled a slot and it was auto-booked online —
            // not for ordinary appointment requests that staff book later.
            const autoBookedOnline = appointmentRequestAutoBookedOnline(item);
            // Confirm from submission fields immediately — do not wait for bookedApptMeta.
            // Gating on hasLinkedAppointment flashed Book / Link appointment while meta loaded.
            const needsStaffConfirmation = appointmentRequestNeedsStaffConfirmation(item);
            const showHandlingNeedsPendingConfirmation =
              needsStaffConfirmation &&
              requestDataHasNewPatientSpecialHandlingNeeds(rd);
            const needsManualBook = appointmentRequestNeedsManualBookActions({
              item,
              isDismissed,
              isBooked,
              hasLinkedAppointment,
            });
            const linkedAppointment = linkedEvetIdsFromBookedApptSummary(
              bookedSummary,
              bookedSummary?.clientInternalId
                ? clientPatientsByClient.get(bookedSummary.clientInternalId)
                : undefined,
            );
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
            const howSoon = requestDataHowSoon(rd);
            const visitAddress = formatRequestDataAddress(rd);
            const usesAlternateVisitAddress = requestDataUsesAlternateVisitAddress(rd);
            // Scout client: from the form (signed-in client) or the booked visit. Not the login's
            // user id, which is a different number (SCH-R6).
            const formClientId = requestDataClientId({ ...rd, userId: undefined });
            const scoutClientId =
              (formClientId && /^\d+$/.test(formClientId) ? formClientId : null) ??
              bookedSummary?.clientInternalId ??
              null;
            const howSoonUrgency = requestDataHowSoonUrgency(rd);
            const rowHighlighted = highlightEntryId === item.id;
            const exitKind = exitingRows.get(item.id);
            const rowExiting = exitKind != null;
            const rowOpen = openRowIds.has(item.id) || rowHighlighted;
            const petNames = requestDataPetSummary(rd)
              .split(',')
              .map((p) => p.trim())
              .filter((p) => p && p !== '—');
            const primaryDoctor = requestDataPrimaryProviderSummary(rd);
            const bookingPill = appointmentRequestBookingPill({
              status,
              isOnHold: isOnHoldVisit,
              isBooked,
              needsStaffConfirmation,
              visitDateLabel: visitDateShortLabel(displayBookedSummary?.start, practiceTz),
              notBookedReason: item.notBookedReason,
            });
            const communication = requestCommunicationStatus(item);
            const commPill = appointmentRequestCommunicationPill(communication);
            const recordsPill = appointmentRequestRecordsPill(item.records);
            const quiet = requestIsQuiet(item);
            const unread = (item.unreadReplies?.count ?? 0) > 0 ? item.unreadReplies! : null;
            const unreadMine = replyIsMine(item);
            // A pet on this open request was already seen (or has a visit coming) since it came in.
            const visitSince =
              (status === 'new' || status === 'contacted') && !hasLinkedAppointment
                ? (item.visitSinceRequest ?? null)
                : null;
            const hasVisitForRoute = hasLinkedAppointment || autoBookedOnline;

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
                        ? 'In progress'
                        : 'Not Booked'}
                  </div>
                ) : null}
                <div
                  className={`appt-table-row appt-table--with-records${howSoonUrgency ? ' appt-table-row--urgent' : ''}${rowOpen ? ' appt-table-row--open' : ''}${unread ? (unreadMine ? ' appt-table-row--unread' : ' appt-table-row--unread-others') : ''}`}
                >
                  <div className="appt-table-cell appt-table-received">
                    <button
                      type="button"
                      className="appt-table-chevron"
                      aria-expanded={rowOpen}
                      aria-label={rowOpen ? 'Close request' : 'Open request'}
                      onClick={() => toggleRowAndReadReplies(item)}
                    >
                      {rowOpen ? '▾' : '▸'}
                    </button>
                    <span>
                      {receivedDateLabel(item.submittedAt, practiceTz)}
                      {howSoonUrgency ? (
                        <span className="appt-table-urgent" title={howSoon ?? undefined}>
                          Urgent
                        </span>
                      ) : null}
                      {quiet ? (
                        <span className="appt-table-quiet" title="Nobody has worked this request in 10 days">
                          No activity 10+ days
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="appt-table-cell appt-table-client-type">
                    {clientTypeBadge === 'existing' ? (
                      'Existing'
                    ) : clientTypeBadge === 'new_client' ? (
                      <span className="appt-table-new-pill" title="New client: not in Scout yet">
                        New
                        <br />
                        Client
                      </span>
                    ) : clientTypeBadge === 'new_patient' ? (
                      <span
                        className="appt-table-new-pill"
                        title="Existing client with a new pet: the pet isn't in Scout yet"
                      >
                        New
                        <br />
                        Patient
                      </span>
                    ) : (
                      ''
                    )}
                  </div>
                  <div className="appt-table-cell">
                    <button
                      type="button"
                      className="appt-table-client"
                      aria-expanded={rowOpen}
                      title={rowOpen ? 'Close request' : 'Open request'}
                      onClick={() => toggleRowAndReadReplies(item)}
                    >
                      <span className="appt-table-client-name">
                        {name}
                        {unread ? (
                          <ReplyBadges
                            mine={unreadMine ? unread.count : 0}
                            others={unreadMine ? 0 : unread.count}
                          />
                        ) : null}
                      </span>
                      {unread ? (
                        <span
                          className={`appt-table-reply${unreadMine ? '' : ' appt-table-reply--others'}`}
                          title={unread.lastPreview ?? undefined}
                        >
                          ↩ {unread.lastChannel === 'text' ? 'Texted' : 'Emailed'}{' '}
                          {replyTimeLabel(unread.lastAt, practiceTz)}
                          {unread.lastPreview ? `: ${unread.lastPreview}` : ''}
                        </span>
                      ) : null}
                      {petNames.length > 0 ? (
                        <span className="appt-table-pets">
                          {petNames.map((p) => (
                            <span key={p} className="appt-table-pet">
                              {p}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {primaryDoctor ? (
                        <span className="appt-table-primary">Primary: {primaryDoctor}</span>
                      ) : null}
                    </button>
                  </div>
                  <div className="appt-table-cell appt-table-strong">
                    {requestDataTypeNamesLabel(rd) ?? (isEuth ? 'Euthanasia' : '—')}
                  </div>
                  <div className="appt-table-cell appt-table-location">
                    <span className="appt-table-strong">{requestDataTown(rd) ?? '—'}</span>
                    {item.zoneName ? (
                      <span className="appt-table-zone" title="Service zone">
                        {item.zoneName}
                      </span>
                    ) : null}
                  </div>
                  <div className="appt-table-cell">
                    <LiaisonSelect
                      value={item.liaison ?? null}
                      liaisons={liaisons}
                      saving={Boolean(liaisonSaving[item.id])}
                      onChange={(employeeId) => void changeLiaison(item, employeeId)}
                      ariaLabel={`Liaison for ${name}`}
                      disabled={!mayWork}
                    />
                  </div>
                  <div className="appt-table-cell">
                    {mayWork ? (
                    <RouteButton
                      hasVisit={hasVisitForRoute}
                      disabled={isDismissed}
                      onRoute={() => onBook(item)}
                      onReschedule={hasLinkedAppointment ? () => onReschedule(item) : undefined}
                      onExploreAlternatives={
                        hasLinkedAppointment ? () => onExploreAlternatives(item) : undefined
                      }
                    />
                    ) : null}
                  </div>
                  <div className="appt-table-cell">
                    <StatusPillMenu
                      ariaLabel={`Booking for ${name}`}
                      tone={visitSince ? 'seen' : bookingPill.tone}
                      label={
                        visitSince
                          ? visitSince.isHold
                            ? 'Hold since request'
                            : visitSince.past
                              ? 'Seen since request'
                              : 'Visit since request'
                          : bookingPill.label
                      }
                      detail={visitSince ? visitSinceLabel(visitSince, practiceTz) : bookingPill.detail}
                      title={
                        visitSince
                          ? `${visitSince.typeName ?? 'Visit'} since this request`
                          : undefined
                      }
                      saving={Boolean(statusUpdating[item.id]) && pillSaving[item.id] == null}
                      items={!mayWork ? [] : bookingMenuItems({
                        item,
                        visitSince,
                        isDismissed,
                        needsStaffConfirmation,
                        needsManualBook,
                        hasLinkedAppointment,
                        isOnHoldVisit,
                      })}
                    />
                  </div>
                  <div className="appt-table-cell">
                    <StatusPillMenu
                      ariaLabel={`Communication for ${name}`}
                      tone={`comm-${commPill.tone}`}
                      label={commPill.label}
                      saving={pillSaving[item.id] === 'comm'}
                      items={!mayWork ? [] : COMMUNICATION_OPTIONS.map((o) => ({
                        label: o.label,
                        selected: o.value === communication,
                        onClick: () => {
                          if (o.value !== communication) {
                            void changeRequestProgress(item, { communicationStatus: o.value }, 'comm');
                          }
                        },
                      }))}
                    />
                  </div>
                  <div className="appt-table-cell">
                    {isDismissed ? (
                      <span className="settings-muted">—</span>
                    ) : (
                      <StatusPillMenu
                        ariaLabel={`Records for ${name}`}
                        tone={`records-${recordsPill.tone}`}
                        label={recordsPill.label}
                        detail={recordsPill.detail}
                        saving={pillSaving[item.id] === 'records'}
                        items={!mayWork ? [] : recordsMenuItems(
                          item,
                          name,
                          enrichPetRowSummariesFromLinkedAppointment(
                            requestDataPetRowSummaries(rd),
                            linkedAppointment,
                          ),
                          scoutClientId,
                        )}
                      />
                    )}
                  </div>
                </div>
                {rowOpen ? (
                  <div className="appt-table-open">
                    <RequestDetailsPanel
                      clientName={
                        <AppointmentRequestClientNameChange
                          requestClientLabel={name}
                          linkedClientLabel={bookedSummary?.linkedClientLabel}
                          isNewClient={clientType === 'new'}
                          linkedNameWrapper={
                            scoutClientId
                              ? (currentName) => (
                                  <button
                                    type="button"
                                    className="req-record-link"
                                    aria-haspopup="dialog"
                                    title="Open the client record"
                                    onClick={() =>
                                      setRecordOpen({ kind: 'client', id: scoutClientId, name: currentName })
                                    }
                                  >
                                    {currentName}
                                  </button>
                                )
                              : undefined
                          }
                        />
                      }
                      clientType={clientType}
                      phone={phone}
                      email={requestDataEmail(rd)}
                      address={visitAddress}
                      alternateAddress={usesAlternateVisitAddress}
                      howSoon={howSoon}
                      visitLine={
                        autoBookedOnline && autoBookedVisit.bookedLabel
                          ? [autoBookedVisit.bookedLabel, autoBookedVisit.providerLabel].filter(Boolean).join(' · ')
                          : linkedVisitLine
                      }
                      notBookedReason={isDismissed ? item.notBookedReason ?? null : null}
                      callout={
                        showHandlingNeedsPendingConfirmation ? (
                          <AppointmentRequestHandlingNeedsCallout compact />
                        ) : null
                      }
                      pets={
                        <AppointmentRequestPetSummaryList
                          requestData={rd}
                          practiceId={PRACTICE_ID}
                          practiceTz={practiceTz}
                          linkedAppointment={linkedAppointment}
                          onOpenPatient={(id, petName) =>
                            setRecordOpen({ kind: 'patient', id, name: petName })
                          }
                        />
                      }
                      notes={item.notes ?? ''}
                      notesDisabled={!mayWork}
                      onSaveNotes={async (text) => {
                        const updated = await patchAppointmentRequestSubmission(item.id, { notes: text });
                        mergeSubmission({ ...updated, kind: 'submission' });
                      }}
                      fullRequest={
                        <AppointmentRequestDetailPanel
                          requestData={rd}
                          practiceId={PRACTICE_ID}
                          practiceTz={practiceTz}
                          linkedAppointment={linkedAppointment}
                          submissionId={item.id}
                          showHandlingNeedsPendingConfirmation={showHandlingNeedsPendingConfirmation}
                        />
                      }
                      pdfLink={
                        isCompletedSubmission(item) ? (
                          <AppointmentRequestPdfDownloadLink submissionId={item.id} clientLabel={name} />
                        ) : null
                      }
                    />
                    <RequestConversationPanel
                      item={item}
                      practiceId={PRACTICE_ID}
                      practiceTz={practiceTz}
                      onContacted={(contacted) => void markContactedInPlace(contacted)}
                      onSubmissionUpdated={(updated) => mergeSubmission({ ...updated, kind: 'submission' })}
                      onGmailLinked={(patch) => handleGmailLinkResolved(item.id, {
                        gmailThreadId: patch.gmailThreadId,
                        gmailMailbox: patch.gmailMailbox,
                      })}
                      readOnly={!mayWork}
                      actions={
                        !mayWork ? (
                          hasLinkedAppointment ? (
                            <button type="button" className="req-action" onClick={() => onViewAppointment(item)}>
                              {isOnHoldVisit ? 'Open hold' : 'View appointment'}
                            </button>
                          ) : null
                        ) : (
                        <>
                          {needsStaffConfirmation ? (
                            <button
                              type="button"
                              className="req-action req-action--primary"
                              disabled={Boolean(statusUpdating[item.id])}
                              onClick={() => openConfirmPreview(item)}
                            >
                              {statusUpdating[item.id] ? 'Saving…' : 'Confirm appointment'}
                            </button>
                          ) : null}
                          {visitSince ? (
                            <button
                              type="button"
                              className="req-action req-action--primary"
                              disabled={Boolean(statusUpdating[item.id])}
                              onClick={() => void linkVisitSince(item, visitSince.appointmentId)}
                            >
                              Link this visit ({visitSinceLabel(visitSince, practiceTz)})
                            </button>
                          ) : null}
                          {needsManualBook ? (
                            <button
                              type="button"
                              className={`req-action${visitSince ? '' : ' req-action--primary'}`}
                              onClick={() => onBook(item)}
                            >
                              Route
                            </button>
                          ) : null}
                          {hasLinkedAppointment && !needsStaffConfirmation ? (
                            <button type="button" className="req-action" onClick={() => onViewAppointment(item)}>
                              {isOnHoldVisit ? 'Open hold' : 'View appointment'}
                            </button>
                          ) : null}
                          {hasLinkedAppointment && !isDismissed ? (
                            <RouteButton
                              hasVisit
                              inline
                              onReschedule={() => onReschedule(item)}
                              onExploreAlternatives={() => onExploreAlternatives(item)}
                            />
                          ) : null}
                          {isDismissed ? (
                            <button
                              type="button"
                              className="req-action"
                              disabled={Boolean(statusUpdating[item.id])}
                              onClick={() => void updateStatus(item, 'new')}
                            >
                              Reopen
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="req-action req-action--quiet"
                              disabled={Boolean(statusUpdating[item.id])}
                              onClick={() => openNotBookedModal(item)}
                            >
                              Not booked…
                            </button>
                          )}
                          <MoreActionsMenu
                            items={[
                              ...(!isDismissed
                                ? [
                                    {
                                      label: hasLinkedAppointment ? 'Re-link appointment…' : 'Link existing appointment…',
                                      onClick: () => setManualBookModal({ item, relink: hasLinkedAppointment }),
                                    },
                                  ]
                                : []),
                              ...(status === 'contacted'
                                ? [{ label: 'Move back to New', onClick: () => void updateStatus(item, 'new') }]
                                : []),
                              { label: 'Mark as unread', onClick: () => void markRepliesUnread(item) },
                            ]}
                          />
                          {statusError[item.id] ? (
                            <span className="req-action-error">{statusError[item.id]}</span>
                          ) : null}
                        </>
                        )
                      }
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

      {recordsRequestFor ? (
        <SchedulerRecordsRequestModal
          patientId={recordsRequestFor.patientId}
          patientName={recordsRequestFor.patientName}
          clientId={recordsRequestFor.clientId}
          onClose={() => {
            setRecordsRequestFor(null);
            void load({ silent: true });
          }}
        />
      ) : null}
      {recordOpen ? (
        <SoapRecordModal
          key={`${recordOpen.kind}-${recordOpen.id}`}
          record={recordOpen}
          onClose={() => setRecordOpen(null)}
          hint="The Appointments list stays open underneath. Links that leave this record open in a new tab ↗"
        />
      ) : null}
      {smsItem ? (
        <ClientSmsComposeModal
          open
          clientId={requestDataClientId(smsItem.requestData ?? {}) ? Number(requestDataClientId(smsItem.requestData ?? {})) : null}
          clientLabel={clientDisplayNameFromRequestData(smsItem.requestData ?? {})}
          message={smsMessageLoading ? 'Loading message…' : smsMessage}
          onMessageChange={setSmsMessage}
          onClose={closeSmsModal}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={openMessagesHistoryFromSms}
          sending={smsSending || smsMessageLoading}
          sendError={smsError}
          title="Text requester"
          subtitle={`Message goes to the phone on the request${requestDataCanText(smsItem.requestData ?? {}) === 'Yes' ? ' (client consented to texts)' : ''}.`}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesClientId != null}
        clientId={messagesClientId}
        clientLabel={messagesClientLabel}
        openPhoneLine={messagesFromLine}
        onClose={() => {
          setMessagesClientId(null);
          setMessagesClientLabel('');
          setMessagesFromLine(null);
        }}
      />

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
