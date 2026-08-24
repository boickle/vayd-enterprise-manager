import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DateTime } from 'luxon';
import {
  CircularProgress,
  Divider,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  assignHoldOwner,
  fetchClientLiaisons,
  fetchHolds,
  HOLD_SOURCE_LABELS,
  type ClientLiaisonOption,
  type HoldListItem,
  type HoldOwnerFilter,
} from '../api/holds';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { fetchSchedulingOutreachSmsFrom, sendClientSms } from '../api/clientSms';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { ClientEmailComposeModal } from '../components/ClientEmailComposeModal';
import { ClientEmailHistoryModal } from '../components/ClientEmailHistoryModal';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { ClientContactLogEditor } from '../components/ClientContactLogEditor';
import { AppointmentRequestGmailThreadLabels } from '../components/AppointmentRequestGmailThreadLabels';
import { HoldPatientSummaryList } from '../components/HoldPatientSummaryList';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import { useHoldsAppointmentRequestGmailLabels } from '../hooks/useHoldsAppointmentRequestGmailLabels';
import {
  buildHoldGroupContactLogMeta,
  useHoldsContactLogIndex,
} from '../hooks/useHoldsContactLog';
import { forwardBookingSourceBookingNotesLabel } from '../utils/forwardBookingEntrySource';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { persistClientContactLog } from '../utils/persistClientContactLog';
import {
  DEFAULT_HOLDS_OWNER_FILTER,
  HOLDS_HIGHLIGHT_PARAM,
  HOLDS_OWNER_PARAM,
  holdsPathForOwner,
  holdsPathWithHighlight,
  parseHoldsHighlightFromSearch,
  parseHoldsOwnerParam,
} from '../holds-nav';
import {
  beginHoldOpenInScheduler,
  beginHoldRemoveInScheduler,
  beginHoldReschedule,
  resolveHoldSubmissionId,
} from '../utils/holdsOpenInScheduler';
import { beginAppointmentRequestNotBookedFlow } from '../utils/appointmentRequestNotBookedFlow';
import { beginAppointmentRequestOnHoldReleaseFlow } from '../utils/appointmentRequestOnHoldReleaseFlow';
import {
  APPOINTMENT_REQUEST_MAILBOX,
  isApptRequestOnHoldLabelId,
  resolveApptRequestLabelIds,
} from '../utils/gmailAppointmentRequestLabels';
import {
  buildHoldExitSnapshotGroup,
  filterHoldHouseholdGroupsByOwner,
  groupHoldsByClientHousehold,
  holdHouseholdAnyStale,
  holdHouseholdEarliestPlacedAt,
  holdHouseholdOwnerIsCurrentUser,
  holdHouseholdPatientNames,
  holdHouseholdSharedOwnerLabel,
  holdHouseholdSharedSource,
  holdHouseholdWithin3BusinessDays,
  holdIsWithin3BusinessDays,
  sortHoldHouseholdGroupsByAppointmentStart,
  type HoldHouseholdGroup,
  type HoldVisitSlotGroup,
} from '../utils/holdsHousehold';
import {
  resolveHoldClientLabel,
} from '../utils/holdsDisplay';
import { holdHouseholdGroupMatchesSearch } from '../utils/holdsSearch';
import {
  buildHoldSmsMessage,
  holdGroupHasSmsPhone,
} from '../utils/holdsSmsMessage';
import {
  clientHasEffectiveEmail,
  holdSmsToEmail,
} from '../utils/clientOutreachEmailMessage';
import {
  clearHoldsBoardDepartSession,
  readHoldsBoardDepartSession,
} from '../utils/holdsBoardDepartSession';
import {
  clearHoldsBoardReturnSession,
  readHoldsBoardReturnSession,
  type HoldsBoardReturnExitKind,
} from '../utils/holdsBoardReturnSession';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TZ as string | undefined)?.trim() ||
  'America/New_York';

const OWNER_FILTERS: Array<{ value: HoldOwnerFilter; label: string }> = [
  { value: 'me_unassigned', label: 'Me + unassigned' },
  { value: 'me', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'all', label: 'All' },
];

function employeeName(
  e: { firstName: string | null; lastName: string | null } | null
): string {
  if (!e) return '';
  return `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();
}

function clientName(c: HoldListItem['client']): string {
  if (!c) return 'No client';
  const n = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return n || `Client #${c.id}`;
}

function formatWhen(iso: string | null, allDay: boolean): string {
  if (!iso) return 'No date';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  if (!dt.isValid) return 'No date';
  return allDay ? dt.toFormat('EEE MMM d') : dt.toFormat('EEE MMM d, h:mm a');
}

function formatPlacedAt(iso: string | null): string {
  if (!iso) return 'Unknown';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  if (!dt.isValid) return 'Unknown';
  return dt.toFormat('EEE MMM d, h:mm a');
}

function formatSincePlacement(iso: string | null): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) return null;
  const diff = DateTime.utc().diff(dt, ['days', 'hours', 'minutes']);
  const days = Math.floor(diff.days);
  const hours = Math.floor(diff.hours);
  const minutes = Math.floor(diff.minutes);
  if (days >= 1) return `${days}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  if (minutes >= 1) return `${minutes}m`;
  return 'Just now';
}

function appointmentTypeLabel(hold: HoldListItem): string {
  return (
    hold.appointmentType?.prettyName?.trim() ||
    hold.appointmentType?.name?.trim() ||
    'Hold'
  );
}

function sourceLabel(holds: HoldListItem[]): string {
  const shared = holdHouseholdSharedSource(holds);
  if (shared === 'mixed') return 'Multiple sources';
  return HOLD_SOURCE_LABELS[shared];
}

function providerLabel(hold: HoldListItem): string {
  const name = employeeName(hold.primaryProvider);
  if (name) return name;
  return 'No provider';
}

function ownerChip(hold: HoldListItem): {
  label: string;
  color: 'success' | 'warning' | 'default';
} {
  if (hold.ownerBucket === 'owned') {
    const name = employeeName(hold.holdOwner ?? hold.createdByEmployee);
    return {
      label: hold.ownerIsCurrentUser ? 'Mine' : name ? `Owner: ${name}` : 'Owned',
      color: 'success',
    };
  }
  if (hold.ownerBucket === 'non_cl_unassigned') {
    return { label: 'Unassigned (field)', color: 'warning' };
  }
  return { label: 'Unassigned', color: 'default' };
}

function holdContextLabel(hold: HoldListItem): string {
  if (hold.forwardBooking?.createdVia) {
    return forwardBookingSourceBookingNotesLabel({
      createdVia: hold.forwardBooking.createdVia as ForwardBookingEntry['createdVia'],
    });
  }
  if (hold.source === 'appointment_request') return 'Appointment request note';
  return 'Visit context';
}

function noteForPatch(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export default function HoldsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const owner = useMemo(
    () => parseHoldsOwnerParam(searchParams.get(HOLDS_OWNER_PARAM)),
    [searchParams]
  );
  const setOwner = useCallback(
    (next: HoldOwnerFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === DEFAULT_HOLDS_OWNER_FILTER) {
            params.delete(HOLDS_OWNER_PARAM);
          } else {
            params.set(HOLDS_OWNER_PARAM, String(next));
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [holds, setHolds] = useState<HoldListItem[]>([]);
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clOptions, setClOptions] = useState<ClientLiaisonOption[]>([]);
  const [busyGroupKey, setBusyGroupKey] = useState<string | null>(null);

  const [assignMenu, setAssignMenu] = useState<{
    anchor: HTMLElement;
    group: HoldHouseholdGroup;
  } | null>(null);
  const [search, setSearch] = useState('');

  const searchQuery = search.trim();
  const searchActive = searchQuery.length > 0;
  /**
   * Always load the full holds list, then filter groups client-side so sibling
   * holds for the same client/patient stay attached even when ownership differs
   * (e.g. Mine + an unassigned autobook hold after Explore alternatives).
   */
  const fetchOwner: HoldOwnerFilter = 'all';

  const [smsGroup, setSmsGroup] = useState<HoldHouseholdGroup | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsFromLine, setSmsFromLine] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [emailGroup, setEmailGroup] = useState<HoldHouseholdGroup | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBodyText, setEmailBodyText] = useState('');
  const [emailHistoryClientId, setEmailHistoryClientId] = useState<number | null>(null);
  const [emailHistoryClientLabel, setEmailHistoryClientLabel] = useState('');

  const loadGenRef = useRef(0);
  const pendingHoldsReturnRef = useRef<ReturnType<typeof readHoldsBoardReturnSession>>(null);
  const pendingDepartGroupKeyRef = useRef<string | null>(null);
  const restoredDepartScrollRef = useRef(false);
  const [pendingHoldsBoardExit, setPendingHoldsBoardExit] = useState<{
    group: HoldHouseholdGroup;
    exitKind: HoldsBoardReturnExitKind;
  } | null>(null);
  const [highlightGroupKey, setHighlightGroupKey] = useState<string | null>(null);
  const [ownerHighlightGroupKey, setOwnerHighlightGroupKey] = useState<string | null>(null);
  const pendingAssignAnchorRef = useRef<{ groupKey: string; scrollY: number } | null>(null);
  const exitGroupTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [exitingGroups, setExitingGroups] = useState<Map<string, HoldsBoardReturnExitKind>>(
    () => new Map()
  );
  const [exitSnapshots, setExitSnapshots] = useState<Map<string, HoldHouseholdGroup>>(
    () => new Map()
  );
  const notBookedGmailLabelFlowRef = useRef(new Set<number>());
  const onHoldGmailLabelFlowRef = useRef(new Set<number>());

  const { allowed: canAccessGmailInbox } = useGmailInboxAccess();
  const holdsReturnPath = holdsPathForOwner(owner);
  const {
    bySubmissionId: gmailThreadLabelsBySubmission,
    userLabels: gmailUserLabels,
    labelById: gmailLabelById,
    patchSubmission: patchGmailThreadLabels,
    submissionById,
    gmailLabelsLoadingIds,
    groupSubmissionIds,
    typeCatalog,
    bookedApptMeta,
  } = useHoldsAppointmentRequestGmailLabels({
    holds,
    enabled: canAccessGmailInbox,
  });
  const { patientReminderOutreachIndex } = useHoldsContactLogIndex(true);
  const submissionNotesById = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const [id, submission] of submissionById) {
      map.set(id, submission.notes ?? null);
    }
    return map;
  }, [submissionById]);
  const [contactLogDrafts, setContactLogDrafts] = useState<Record<string, string>>({});
  const [contactLogSaving, setContactLogSaving] = useState<Record<string, boolean>>({});
  const [contactLogError, setContactLogError] = useState<Record<string, string | null>>({});

  const contactLogMetaForGroup = useCallback(
    (group: HoldHouseholdGroup) =>
      buildHoldGroupContactLogMeta({
        group,
        patientReminderOutreachIndex,
        submissionNotesById,
      }),
    [patientReminderOutreachIndex, submissionNotesById],
  );

  useEffect(() => {
    return () => {
      for (const timer of exitGroupTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      exitGroupTimersRef.current.clear();
    };
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const gen = ++loadGenRef.current;

    if (!silent) {
      const pendingReturn = readHoldsBoardReturnSession();
      if (pendingReturn) {
        clearHoldsBoardReturnSession();
        pendingHoldsReturnRef.current = pendingReturn;
      }

      const pendingDepart = readHoldsBoardDepartSession();
      if (pendingDepart) {
        clearHoldsBoardDepartSession();
        pendingDepartGroupKeyRef.current = pendingDepart.groupKey ?? null;
        restoredDepartScrollRef.current = true;
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: pendingDepart.scrollY, behavior: 'auto' });
        }
      } else {
        pendingDepartGroupKeyRef.current = null;
        restoredDepartScrollRef.current = false;
      }

      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetchHolds(PRACTICE_ID, fetchOwner);
      if (gen !== loadGenRef.current) return;
      setHolds(res.holds);
      setCurrentUserEmployeeId(res.currentUserEmployeeId);

      if (!silent) {
        const pending = pendingHoldsReturnRef.current;
        if (pending) {
          pendingHoldsReturnRef.current = null;
          const idSet = new Set(pending.appointmentIds);
          const exitGroupKey =
            pending.groupKey?.trim() || pendingDepartGroupKeyRef.current?.trim() || null;
          const freshGrouped = sortHoldHouseholdGroupsByAppointmentStart(
            filterHoldHouseholdGroupsByOwner(
              groupHoldsByClientHousehold(res.holds, PRACTICE_TZ),
              owner,
            ),
          );
          const remaining =
            (exitGroupKey ? freshGrouped.find((g) => g.key === exitGroupKey) : undefined) ??
            freshGrouped.find((g) => g.holds.some((h) => idSet.has(h.id)));
          if (remaining) {
            // Sibling hold(s) for this client/patient still on the board — keep the
            // card visible and highlight it instead of animating a full-row exit.
            setHighlightGroupKey(remaining.key);
            pendingDepartGroupKeyRef.current = remaining.key;
          } else {
            const match = buildHoldExitSnapshotGroup(
              pending.appointmentIds,
              pending.clientLabel ?? null,
              exitGroupKey,
              {
                appointmentStart: pending.snapshotAppointmentStart ?? null,
              },
            );
            setPendingHoldsBoardExit({ group: match, exitKind: pending.exitKind });
          }
        }
      }
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load holds');
    } finally {
      if (gen === loadGenRef.current && !silent) setLoading(false);
    }
  }, [fetchOwner, owner]);

  const beginGroupExit = useCallback(
    (group: HoldHouseholdGroup, exitKind: HoldsBoardReturnExitKind) => {
      setExitSnapshots((prev) => new Map(prev).set(group.key, group));
      setExitingGroups((prev) => new Map(prev).set(group.key, exitKind));
      const existing = exitGroupTimersRef.current.get(group.key);
      if (existing) window.clearTimeout(existing);
      const timer = setTimeout(() => {
        exitGroupTimersRef.current.delete(group.key);
        setExitingGroups((prev) => {
          const next = new Map(prev);
          next.delete(group.key);
          return next;
        });
        setExitSnapshots((prev) => {
          const next = new Map(prev);
          next.delete(group.key);
          return next;
        });
        setHighlightGroupKey((cur) => (cur === group.key ? null : cur));
        void load();
      }, 1100);
      exitGroupTimersRef.current.set(group.key, timer);
    },
    [load]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void fetchClientLiaisons()
      .then((opts) => {
        if (alive) setClOptions(opts);
      })
      .catch(() => {
        /* dropdown stays empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      setSmsFromLine(phone);
    });
  }, []);

  const openSmsModal = useCallback((group: HoldHouseholdGroup) => {
    if (!holdGroupHasSmsPhone(group)) return;
    setSmsError(null);
    setSmsMessage(buildHoldSmsMessage(group, PRACTICE_TZ));
    setSmsGroup(group);
  }, []);

  const closeSmsModal = useCallback(() => {
    setSmsGroup(null);
    setSmsMessage('');
    setSmsError(null);
  }, []);

  const openEmailModal = useCallback((group: HoldHouseholdGroup) => {
    const clientId = group.anchor.client?.id;
    if (clientId == null || !clientHasEffectiveEmail(group.anchor.client?.email)) return;
    const sms = buildHoldSmsMessage(group, PRACTICE_TZ);
    const email = holdSmsToEmail(sms, group.anchor.primaryProvider?.lastName);
    setEmailSubject(email.subject);
    setEmailBodyText(email.bodyText);
    setEmailGroup(group);
  }, []);

  const openMessagesHistoryForGroup = useCallback((group: HoldHouseholdGroup) => {
    const id = group.anchor.client?.id;
    if (id == null) return;
    setMessagesClientId(id);
    setMessagesClientLabel(clientName(group.anchor.client));
  }, []);

  const openEmailHistoryForGroup = useCallback((group: HoldHouseholdGroup) => {
    const id = group.anchor.client?.id;
    if (id == null) return;
    setEmailHistoryClientId(id);
    setEmailHistoryClientLabel(clientName(group.anchor.client));
  }, []);

  const closeEmailModal = useCallback(() => {
    setEmailGroup(null);
    setEmailSubject('');
    setEmailBodyText('');
  }, []);

  const handleSendSms = useCallback(
    async (opts: { overrideNonProd: boolean }) => {
      const clientId = smsGroup?.anchor.client?.id;
      if (clientId == null || !smsMessage.trim() || !smsGroup) return;
      setSmsSending(true);
      setSmsError(null);
      try {
        const providerId = smsGroup.anchor.primaryProvider?.id;
        await sendClientSms(clientId, {
          message: smsMessage.trim(),
          useRemindersFrom: true,
          source: 'holds',
          ...(providerId != null ? { primaryProviderId: providerId } : {}),
          ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
        });
        closeSmsModal();
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { message?: string } }; message?: string };
        setSmsError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to send text message.');
      } finally {
        setSmsSending(false);
      }
    },
    [smsGroup, smsMessage, closeSmsModal]
  );

  const doAssignGroup = useCallback(
    async (group: HoldHouseholdGroup, ownerEmployeeId: number | null) => {
      setBusyGroupKey(group.key);
      setAssignMenu(null);
      if (typeof window !== 'undefined') {
        pendingAssignAnchorRef.current = { groupKey: group.key, scrollY: window.scrollY };
      }
      try {
        for (const hold of group.holds) {
          await assignHoldOwner(hold.id, ownerEmployeeId);
        }
        await load({ silent: true });
      } catch (e) {
        pendingAssignAnchorRef.current = null;
        setError(e instanceof Error ? e.message : 'Failed to assign hold');
      } finally {
        setBusyGroupKey(null);
      }
    },
    [load]
  );

  const assignGroupToMe = useCallback(
    (group: HoldHouseholdGroup) => {
      if (currentUserEmployeeId == null) {
        setError('Could not resolve your employee record to assign.');
        return;
      }
      void doAssignGroup(group, currentUserEmployeeId);
    },
    [currentUserEmployeeId, doAssignGroup]
  );

  const openInScheduler = useCallback(
    (hold: HoldListItem, groupKey: string) => {
      void beginHoldOpenInScheduler({
        hold,
        navigate,
        practiceTz: PRACTICE_TZ,
        returnPath: holdsPathForOwner(owner),
        groupKey,
      });
    },
    [navigate, owner]
  );

  const openRequest = useCallback(
    (hold: HoldListItem) => {
      const submissionId = resolveHoldSubmissionId(hold);
      if (submissionId == null) return;
      navigate(holdsPathWithHighlight(submissionId, { owner }));
    },
    [navigate, owner]
  );

  const openReschedule = useCallback(
    (hold: HoldListItem, groupKey: string) => {
      setError(null);
      setNotice(null);
      setBusyGroupKey(groupKey);
      void beginHoldReschedule({
        hold,
        navigate,
        practiceTz: PRACTICE_TZ,
        practiceId: PRACTICE_ID,
        returnPath: holdsPathForOwner(owner),
      })
        .then((result) => {
          if (!result.ok) setNotice(result.reason);
        })
        .catch(() => {
          setError('Could not start the reschedule flow for this hold.');
        })
        .finally(() => {
          setBusyGroupKey(null);
        });
    },
    [navigate, owner]
  );

  const handleGmailThreadLabelsUpdated = useCallback(
    (submissionId: number, entry: Parameters<typeof patchGmailThreadLabels>[1]) => {
      patchGmailThreadLabels(submissionId, entry);
    },
    [patchGmailThreadLabels]
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
        returnPath: holdsReturnPath,
        practiceTz: PRACTICE_TZ,
        navigate,
        mailbox: thread?.mailbox ?? APPOINTMENT_REQUEST_MAILBOX,
        threadId: thread?.threadId,
        bookedApptSummary: bookedSummary ?? null,
      })
        .then((result) => {
          if (result.kind === 'scheduler_remove') {
            setNotice(
              'Remove this visit from the calendar, then mark the request as not booked.',
            );
            return;
          }
          if (result.kind === 'needs_reason') {
            navigate(holdsPathWithHighlight(item.id, { owner }));
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
      holdsReturnPath,
      navigate,
      owner,
    ]
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
            returnPath: holdsReturnPath,
            practiceTz: PRACTICE_TZ,
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
      holdsReturnPath,
      navigate,
      typeCatalog,
    ]
  );

  const saveGroupContactLog = useCallback(
    async (group: HoldHouseholdGroup) => {
      const meta = contactLogMetaForGroup(group);
      if (!meta?.writeTarget) return;
      const value = contactLogDrafts[group.key] ?? meta.contactLog ?? '';
      setContactLogSaving((s) => ({ ...s, [group.key]: true }));
      setContactLogError((e) => ({ ...e, [group.key]: null }));
      try {
        await persistClientContactLog({
          target: meta.writeTarget,
          text: value,
          reminderIds: meta.reminderIds,
          forwardBookingId: meta.forwardBookingId ?? undefined,
          syncForwardBookingId:
            meta.writeTarget === 'reminder_outreach'
              ? meta.forwardBookingId ?? undefined
              : undefined,
          submissionId: meta.submissionId ?? undefined,
        });
        await load();
      } catch (e) {
        setContactLogError((er) => ({
          ...er,
          [group.key]: e instanceof Error ? e.message : 'Could not save contact log',
        }));
      } finally {
        setContactLogSaving((s) => ({ ...s, [group.key]: false }));
      }
    },
    [contactLogMetaForGroup, contactLogDrafts, load],
  );

  const openRemoveSlot = useCallback(
    (slot: HoldVisitSlotGroup, groupKey: string) => {
      void beginHoldRemoveInScheduler({
        slot,
        navigate,
        practiceTz: PRACTICE_TZ,
        returnPath: holdsPathForOwner(owner),
        groupKey,
      });
    },
    [navigate, owner],
  );

  const grouped = useMemo(
    () =>
      sortHoldHouseholdGroupsByAppointmentStart(
        filterHoldHouseholdGroupsByOwner(
          groupHoldsByClientHousehold(holds, PRACTICE_TZ),
          searchActive ? 'all' : owner,
        ),
      ),
    [holds, owner, searchActive]
  );

  const filteredGroups = useMemo(() => {
    if (!searchActive) return grouped;
    return grouped.filter((group) =>
      holdHouseholdGroupMatchesSearch(
        group,
        searchQuery,
        contactLogDrafts[group.key],
      ),
    );
  }, [grouped, searchActive, searchQuery, contactLogDrafts]);

  useEffect(() => {
    if (loading) return;
    const drafts: Record<string, string> = {};
    for (const group of grouped) {
      const meta = buildHoldGroupContactLogMeta({
        group,
        patientReminderOutreachIndex,
        submissionNotesById,
      });
      if (meta) drafts[group.key] = meta.contactLog ?? '';
    }
    setContactLogDrafts(drafts);
    setContactLogSaving({});
    setContactLogError({});
  }, [loading, grouped, patientReminderOutreachIndex, submissionNotesById]);

  useEffect(() => {
    if (!pendingHoldsBoardExit || loading) return;
    const { group, exitKind } = pendingHoldsBoardExit;

    let cancelled = false;
    let scrollAttempts = 0;

    const startExit = () => {
      if (cancelled) return;
      setPendingHoldsBoardExit(null);
      setHighlightGroupKey(group.key);
      beginGroupExit(group, exitKind);
    };

    const tryScrollThenExit = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-hold-group-key="${group.key}"]`);
      if (el) {
        if (!restoredDepartScrollRef.current) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          window.setTimeout(startExit, 250);
        } else {
          startExit();
        }
        return;
      }
      scrollAttempts += 1;
      if (scrollAttempts < 40) {
        window.setTimeout(tryScrollThenExit, 50);
        return;
      }
      startExit();
    };

    const timer = window.setTimeout(tryScrollThenExit, restoredDepartScrollRef.current ? 50 : 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingHoldsBoardExit, loading, beginGroupExit]);

  const displayGroups = useMemo(() => {
    const keys = new Set(filteredGroups.map((g) => g.key));
    const extras = [...exitSnapshots.values()].filter(
      (snapshot) => !keys.has(snapshot.key) && exitingGroups.has(snapshot.key),
    );
    const pending = pendingHoldsBoardExit?.group;
    if (pending && !keys.has(pending.key) && !extras.some((g) => g.key === pending.key)) {
      extras.push(pending);
    }
    if (extras.length === 0) return filteredGroups;
    return sortHoldHouseholdGroupsByAppointmentStart([...filteredGroups, ...extras]);
  }, [filteredGroups, exitSnapshots, exitingGroups, pendingHoldsBoardExit]);

  const highlightSubmissionId = useMemo(
    () => parseHoldsHighlightFromSearch(searchParams.toString() ? `?${searchParams.toString()}` : ''),
    [searchParams],
  );
  const highlightScrollSigRef = useRef('');

  useEffect(() => {
    if (highlightSubmissionId == null || loading) return;
    const sig = `${highlightSubmissionId}-${displayGroups.length}`;
    if (highlightScrollSigRef.current === sig) return;

    const match = displayGroups.find((group) =>
      groupSubmissionIds(group.holds).includes(highlightSubmissionId),
    );
    if (!match) return;

    highlightScrollSigRef.current = sig;
    setHighlightGroupKey(match.key);

    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete(HOLDS_HIGHLIGHT_PARAM);
        return params;
      },
      { replace: true },
    );

    const timer = window.setTimeout(() => setHighlightGroupKey(null), 4000);
    return () => window.clearTimeout(timer);
  }, [
    displayGroups,
    groupSubmissionIds,
    highlightSubmissionId,
    loading,
    setSearchParams,
  ]);

  useEffect(() => {
    const anchor = pendingAssignAnchorRef.current;
    if (!anchor || loading) return;
    pendingAssignAnchorRef.current = null;
    window.scrollTo({ top: anchor.scrollY, behavior: 'auto' });
    setOwnerHighlightGroupKey(anchor.groupKey);
    const timer = window.setTimeout(() => setOwnerHighlightGroupKey(null), 2600);
    return () => window.clearTimeout(timer);
  }, [holds, loading]);

  useEffect(() => {
    if (highlightGroupKey == null || loading) return;

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-hold-group-key="${highlightGroupKey}"]`);
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
    return () => {
      cancelled = true;
      window.clearTimeout(scrollT);
    };
  }, [highlightGroupKey, loading, displayGroups.length]);

  return (
    <div className="container">
      <div className="settings-page" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <div>
            <h1 className="settings-title" style={{ marginBottom: 6 }}>
              Holds
            </h1>
            <p className="settings-muted" style={{ margin: 0, maxWidth: 720 }}>
              Calendar holds scheduled today (Eastern time) and later — appointment
              requests, care outreach, schedule loader, forward booking, and manual
              holds.
            </p>
          </div>
        </div>

        <div className="appt-request-status-tabs">
          {OWNER_FILTERS.map((f) => (
            <button
              key={String(f.value)}
              type="button"
              className={`appt-request-status-tab${owner === f.value ? ' active' : ''}`}
              aria-current={owner === f.value ? 'page' : undefined}
              onClick={() => setOwner(f.value)}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            className="btn secondary appt-request-status-tabs-refresh"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        <div style={{ marginBottom: 16, maxWidth: 480 }}>
          <input
            type="search"
            className="settings-input"
            placeholder="Search holds: client, pet, owner, provider, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search holds"
            style={{ width: '100%' }}
          />
          {searchActive ? (
            <p className="settings-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Searching all holds
              {displayGroups.length > 0
                ? ` · ${displayGroups.length} result${displayGroups.length === 1 ? '' : 's'}`
                : ''}
            </p>
          ) : null}
        </div>

        {error ? (
          <p style={{ color: '#b91c1c', marginBottom: 16 }}>{error}</p>
        ) : null}
        {notice ? (
          <p style={{ color: '#0369a1', marginBottom: 16 }}>{notice}</p>
        ) : null}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <CircularProgress size={28} />
          </div>
        ) : displayGroups.length === 0 ? (
          <p className="settings-muted" style={{ padding: '48px 0', textAlign: 'center' }}>
            {searchActive
              ? 'No holds match your search.'
              : 'No holds scheduled for today or later match this filter.'}
          </p>
        ) : (
          <ul className="appt-request-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {displayGroups.map((group) => {
              const hold = group.anchor;
              const holdsInGroup = group.holds;
              const visitSlots = group.visitSlots;
              const multiVisit = visitSlots.length > 1;
              const multiHold = holdsInGroup.length > 1;
              const exitKind = exitingGroups.get(group.key);
              const rowExiting = exitKind != null;
              const oc = holdHouseholdSharedOwnerLabel(holdsInGroup, ownerChip);
              const urgent = holdHouseholdWithin3BusinessDays(holdsInGroup, PRACTICE_TZ);
              const stale = holdHouseholdAnyStale(holdsInGroup);
              const phone = hold.client?.phone1?.trim() || '';
              const hasEmail = clientHasEffectiveEmail(hold.client?.email);
              const clientId = hold.client?.id ?? null;
              const canSms = holdGroupHasSmsPhone(group);
              const ownerIsMine = holdHouseholdOwnerIsCurrentUser(holdsInGroup);
              const busy = busyGroupKey === group.key;
              const createdByNames = [
                ...new Set(
                  holdsInGroup
                    .map((h) => employeeName(h.createdByEmployee))
                    .filter(Boolean)
                ),
              ];
              const headerBadge = multiVisit
                ? `${holdsInGroup.length} holds · ${visitSlots.length} visits`
                : multiHold
                  ? `${holdsInGroup.length} pets`
                  : null;
              return (
                <li
                  key={group.key}
                  data-hold-group-key={group.key}
                  className={[
                    'appt-request-row',
                    highlightGroupKey === group.key ? 'appt-request-row--highlight' : '',
                    ownerHighlightGroupKey === group.key ? 'appt-request-row--owner-updated' : '',
                    rowExiting
                      ? `appt-request-row--exiting appt-request-row--exiting-${
                          exitKind === 'removed' ? 'dismissed' : 'booked'
                        }`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {rowExiting ? (
                    <div className="appt-request-row-exit-badge" aria-live="polite">
                      {exitKind === 'removed' ? 'Hold removed' : 'Booked'}
                    </div>
                  ) : null}
                  <div className="appt-request-row-main">
                    <div className="appt-request-row-body">
                      <div className="holds-client-panel">
                        <div className="holds-client-panel__top">
                          <div className="holds-client-panel__identity">
                            <div className="holds-client-panel__name">
                              {resolveHoldClientLabel(hold)}
                              {headerBadge ? (
                                <span className="holds-client-panel__badge settings-muted">
                                  {headerBadge}
                                </span>
                              ) : null}
                            </div>
                            {phone ? (
                              <a className="holds-client-panel__phone" href={`tel:${phone}`}>
                                {phone}
                              </a>
                            ) : (
                              <span className="settings-muted holds-client-panel__phone-missing">
                                No phone on file
                              </span>
                            )}
                          </div>
                          {clientId != null ? (
                            <div className="holds-client-panel__history">
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() => openEmailHistoryForGroup(group)}
                              >
                                Email history
                              </button>
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() => openMessagesHistoryForGroup(group)}
                              >
                                Messages history
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {rowExiting ? null : (
                          <div className="holds-client-panel__contact">
                            <button
                              type="button"
                              className="btn secondary"
                              disabled={!phone}
                              title={phone || 'No phone on file'}
                              onClick={() => {
                                if (!phone) return;
                                window.location.href = `tel:${phone}`;
                              }}
                            >
                              Call
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              disabled={!canSms}
                              onClick={() => openSmsModal(group)}
                            >
                              Text client
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              disabled={!canAccessGmailInbox || !hasEmail}
                              onClick={() => openEmailModal(group)}
                            >
                              Email client
                            </button>
                          </div>
                        )}
                      </div>
                      {canAccessGmailInbox
                        ? groupSubmissionIds(holdsInGroup).map((submissionId) => {
                            const submission = submissionById.get(submissionId);
                            if (!submission) return null;
                            return (
                              <AppointmentRequestGmailThreadLabels
                                key={submissionId}
                                thread={gmailThreadLabelsBySubmission.get(submissionId)}
                                userLabels={gmailUserLabels}
                                labelById={gmailLabelById}
                                loading={gmailLabelsLoadingIds.has(submissionId)}
                                onLabelsUpdated={(entry) =>
                                  handleGmailThreadLabelsUpdated(submissionId, entry)
                                }
                                onLabelsAdded={(added) =>
                                  handleGmailLabelsAdded(submission, added)
                                }
                                beforeRemoveLabel={makeOnHoldGmailLabelRemoveGuard(submission)}
                                onError={(message) => setError(message)}
                              />
                            );
                          })
                        : null}
                      {(() => {
                        const contactMeta = contactLogMetaForGroup(group);
                        if (!contactMeta?.writeTarget) return null;
                        const draft =
                          contactLogDrafts[group.key] ?? contactMeta.contactLog ?? '';
                        const saved = contactMeta.contactLog ?? '';
                        return (
                          <div style={{ marginTop: 10 }}>
                            <ClientContactLogEditor
                              id={`hold-contact-log-${group.key}`}
                              contextNote={contactMeta.contextNote}
                              contextLabel={holdContextLabel(hold)}
                              value={draft}
                              onChange={(value) =>
                                setContactLogDrafts((d) => ({ ...d, [group.key]: value }))
                              }
                              onSave={() => void saveGroupContactLog(group)}
                              saving={Boolean(contactLogSaving[group.key])}
                              saveDisabled={noteForPatch(draft) === noteForPatch(saved)}
                              error={contactLogError[group.key]}
                            />
                          </div>
                        );
                      })()}
                      {visitSlots.map((slot, slotIdx) => {
                        const slotHold = slot.anchor;
                        const slotPlaced = holdHouseholdEarliestPlacedAt(slot.holds);
                        const slotSince = formatSincePlacement(slotPlaced);
                        const slotTypeLabels = [
                          ...new Set(slot.holds.map((h) => appointmentTypeLabel(h))),
                        ];
                        return (
                          <div
                            key={slot.key}
                            style={{
                              marginTop: slotIdx > 0 ? 14 : 8,
                              paddingTop: slotIdx > 0 ? 14 : 0,
                              borderTop:
                                slotIdx > 0 ? '1px solid #e2e8f0' : undefined,
                            }}
                          >
                            <div className="settings-muted" style={{ fontSize: '0.92rem' }}>
                              {formatWhen(slotHold.appointmentStart, slotHold.allDay)}
                              {slotTypeLabels.length === 1 ? ` · ${slotTypeLabels[0]}` : ''}
                              {multiVisit && holdIsWithin3BusinessDays(slotHold, PRACTICE_TZ) ? (
                                <span
                                  style={{
                                    color: '#b91c1c',
                                    fontWeight: 700,
                                    marginLeft: 6,
                                  }}
                                >
                                  · Within 3 business days
                                </span>
                              ) : null}
                            </div>
                            <div style={{ fontSize: '0.92rem', marginTop: 8 }}>
                              <div>
                                <span className="settings-muted">Provider: </span>
                                {providerLabel(slotHold)}
                              </div>
                              <HoldPatientSummaryList
                                holds={slot.holds}
                                practiceId={PRACTICE_ID}
                                practiceTz={PRACTICE_TZ}
                                appointmentTypeLabel={appointmentTypeLabel}
                                showTypeWhenMixed
                              />
                              <div>
                                <span className="settings-muted">Placed: </span>
                                {formatPlacedAt(slotPlaced)}
                                {slotSince ? ` (${slotSince} ago)` : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <span
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
                          {sourceLabel(holdsInGroup)}
                        </span>
                        <span
                          className={[
                            'holds-owner-chip',
                            ownerHighlightGroupKey === group.key ? 'holds-owner-chip--updated' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background:
                              oc.color === 'success'
                                ? '#dcfce7'
                                : oc.color === 'warning'
                                  ? '#fef3c7'
                                  : '#f1f5f9',
                            color:
                              oc.color === 'success'
                                ? '#166534'
                                : oc.color === 'warning'
                                  ? '#92400e'
                                  : '#475569',
                          }}
                        >
                          {oc.label}
                        </span>
                        {urgent ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: '#fef2f2',
                              color: '#b91c1c',
                              border: '1px solid #fecaca',
                            }}
                          >
                            Within 3 business days
                          </span>
                        ) : null}
                        {stale ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              background: '#fef2f2',
                              color: '#b91c1c',
                              border: '1px solid #fecaca',
                            }}
                          >
                            &gt;24h
                          </span>
                        ) : null}
                        {createdByNames.length === 1 ? (
                          <span
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
                            By {createdByNames[0]}
                          </span>
                        ) : createdByNames.length > 1 ? (
                          <span
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
                            Multiple creators
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="appt-request-row-actions">
                      {rowExiting ? null : (
                        <>
                      {ownerIsMine ? (
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={busy}
                          onClick={() => void doAssignGroup(group, null)}
                        >
                          Unassign me
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busy}
                          onClick={() => assignGroupToMe(group)}
                        >
                          Assign to me
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={(e) => setAssignMenu({ anchor: e.currentTarget, group })}
                      >
                        Assign to…
                      </button>
                      <div
                        style={{
                          width: '100%',
                          borderTop: '1px solid #e2e8f0',
                          marginTop: 4,
                          marginBottom: 4,
                        }}
                      />
                      {visitSlots.map((slot, slotIdx) => {
                        const slotHold = slot.anchor;
                        const slotMulti = slot.holds.length > 1;
                        return (
                          <div
                            key={slot.key}
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 8,
                              width: '100%',
                              alignItems: 'flex-start',
                              ...(slotIdx > 0
                                ? {
                                    paddingTop: 8,
                                    marginTop: 4,
                                    borderTop: '1px solid #e2e8f0',
                                  }
                                : {}),
                            }}
                          >
                            {multiVisit ? (
                              <span
                                className="settings-muted"
                                style={{
                                  width: '100%',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  lineHeight: 1.3,
                                }}
                              >
                                {formatWhen(slotHold.appointmentStart, slotHold.allDay)}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => openInScheduler(slotHold, group.key)}
                            >
                              Open / convert
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              disabled={busy}
                              onClick={() => openReschedule(slotHold, group.key)}
                            >
                              Reschedule
                            </button>
                            {slot.holds.some((h) => resolveHoldSubmissionId(h) != null) ? (
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() => {
                                  const withRequest = slot.holds.find(
                                    (h) => resolveHoldSubmissionId(h) != null
                                  );
                                  if (withRequest) openRequest(withRequest);
                                }}
                              >
                                View request
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ color: '#b91c1c', borderColor: '#fecaca' }}
                              onClick={() => openRemoveSlot(slot, group.key)}
                            >
                              Remove hold{slotMulti ? 's' : ''}
                            </button>
                          </div>
                        );
                      })}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

      <Menu
        anchorEl={assignMenu?.anchor ?? null}
        open={Boolean(assignMenu)}
        onClose={() => setAssignMenu(null)}
      >
        {clOptions.length === 0 ? (
          <MenuItem disabled>No client liaisons found</MenuItem>
        ) : (
          clOptions.map((cl) => (
            <MenuItem
              key={cl.id}
              onClick={() => assignMenu && void doAssignGroup(assignMenu.group, cl.id)}
            >
              {employeeName(cl) || `Employee #${cl.id}`}
            </MenuItem>
          ))
        )}
        <Divider />
        <MenuItem onClick={() => assignMenu && void doAssignGroup(assignMenu.group, null)}>
          Clear assignment
        </MenuItem>
      </Menu>

      {smsGroup ? (
        <ClientSmsComposeModal
          open
          clientLabel={clientName(smsGroup.anchor.client)}
          message={smsMessage}
          onMessageChange={setSmsMessage}
          onClose={closeSmsModal}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={() => {
            const id = smsGroup.anchor.client?.id;
            if (id == null) return;
            setMessagesClientId(id);
            setMessagesClientLabel(clientName(smsGroup.anchor.client));
          }}
          sending={smsSending}
          sendError={smsError}
          fromLineLabel={smsFromLine}
        />
      ) : null}

      {emailGroup ? (
        <ClientEmailComposeModal
          open
          clientId={emailGroup.anchor.client?.id ?? null}
          clientLabel={clientName(emailGroup.anchor.client)}
          initialSubject={emailSubject}
          initialBodyText={emailBodyText}
          onClose={closeEmailModal}
          onOpenEmailHistory={() => {
            const id = emailGroup.anchor.client?.id;
            if (id == null) return;
            setEmailHistoryClientId(id);
            setEmailHistoryClientLabel(clientName(emailGroup.anchor.client));
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
    </div>
  );
}
