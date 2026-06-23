import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import {
  fetchAllAppointmentRequestSubmissions,
  patchAppointmentRequestSubmission,
  sendAppointmentRequestSubmissionSms,
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
import {
  AppointmentRequestManualBookModal,
  appointmentRequestHasSmsPhone,
} from '../components/AppointmentRequestManualBookModal';
import {
  clientDisplayNameFromRequestData,
  doctorLastNameFromLabel,
  formatRequestDataAddress,
  isEuthanasiaRequestData,
  requestDataAnythingElse,
  requestDataCanText,
  requestDataClientType,
  requestDataHowSoon,
  requestDataPetSummary,
  requestDataPhone,
  requestDataPreferredDoctor,
  requestDataSelfScheduledSlot,
} from '../utils/appointmentRequestDisplay';
import {
  buildRoutingAppointmentRequestIntentFromSubmission,
  writeRoutingAppointmentRequestIntent,
} from '../utils/routingAppointmentRequestIntent';
import {
  clearAppointmentRequestReturnSession,
  readAppointmentRequestReturnSession,
} from '../utils/appointmentRequestReturnSession';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type StatusFilter = AppointmentRequestSubmissionStatus | 'incomplete';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'booked', label: 'Booked' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'incomplete', label: 'Incomplete' },
];

const FOLLOW_UP_OPTIONS: { value: AppointmentFormDraftFollowUpStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'dismissed', label: 'Dismissed' },
];

function isCompletedSubmission(item: AppointmentRequestSubmissionItem): boolean {
  return item.kind == null || item.kind === 'submission';
}

function isAbandonedItem(item: AppointmentRequestSubmissionItem): boolean {
  return item.kind === 'abandoned';
}

function submissionStatus(item: AppointmentRequestSubmissionItem): AppointmentRequestSubmissionStatus {
  return item.status ?? 'new';
}

function initialNotes(item: AppointmentRequestSubmissionItem): string {
  return item.notes ?? '';
}

function noteForPatch(value: string): string | null {
  const t = value.trim();
  return t === '' ? null : t;
}

function statusTabLabel(status: AppointmentRequestSubmissionStatus): string {
  return STATUS_TABS.find((tab) => tab.key === status)?.label ?? status;
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
    requestDataHowSoon(rd) ?? '',
    formatRequestDataAddress(rd) ?? '',
    requestDataAnythingElse(rd) ?? '',
    rd.email,
    notes,
    statusTabLabel(submissionStatus(item)),
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
    'incomplete',
  ]
    .join(' ')
    .toLowerCase();
}

function matchesSearchQuery(haystack: string, query: string): boolean {
  return haystack.includes(query);
}

function formatSubmittedAt(iso: string, practiceTz: string): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '—';
  return dt.toFormat('EEE, MMM d, yyyy · h:mm a');
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

function formatSlotWindowForSms(
  slot: { windowStartIso: string | null; windowEndIso: string | null; windowDisplay: string | null },
  practiceTz: string
): string | null {
  if (slot.windowStartIso && slot.windowEndIso) {
    const start = DateTime.fromISO(slot.windowStartIso, { zone: 'utc' }).setZone(practiceTz);
    const end = DateTime.fromISO(slot.windowEndIso, { zone: 'utc' }).setZone(practiceTz);
    if (start.isValid && end.isValid) {
      return `${start.toFormat('h:mm a')}–${end.toFormat('h:mm a')}`;
    }
  }
  // Fall back to the client-facing copy captured at booking time (strip leading lead-in).
  if (slot.windowDisplay) {
    return slot.windowDisplay.replace(/^we will come\s*/i, '').trim() || null;
  }
  return null;
}

function defaultSmsMessage(
  item: AppointmentRequestSubmissionItem,
  practiceTz: string
): string {
  const rd = item.requestData ?? {};
  const name = clientDisplayNameFromRequestData(rd).split(' ')[0] || 'there';

  const slot = requestDataSelfScheduledSlot(rd);
  const doctorLast = doctorLastNameFromLabel(
    slot?.doctorName ?? requestDataPreferredDoctor(rd)
  );
  const dateStr = slot?.appointmentStart
    ? (() => {
        const dt = DateTime.fromISO(slot.appointmentStart!, { zone: 'utc' }).setZone(practiceTz);
        return dt.isValid ? dt.toFormat('EEEE, MMMM d') : null;
      })()
    : null;
  const windowStr = slot ? formatSlotWindowForSms(slot, practiceTz) : null;

  if (doctorLast && dateStr && windowStr) {
    return (
      `Hi ${name}! We got your appointment request and reserved a spot with Dr. ${doctorLast} ` +
      `on ${dateStr}, arrival window ${windowStr}. Reply to confirm within two hours and it's yours ` +
      `— or let us know if you need a different time and we'll find another option.`
    );
  }

  return `Hi ${name}, this is Vet At Your Door. We received your appointment request and will follow up shortly.`;
}

export default function AppointmentRequestsPage() {
  const navigate = useNavigate();
  const practiceTz = practiceTimeZoneOrDefault(undefined);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
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

  const [smsItem, setSmsItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  const [manualBookItem, setManualBookItem] = useState<AppointmentRequestSubmissionItem | null>(null);
  const [bookedApptStarts, setBookedApptStarts] = useState<
    Map<number, { start: string; end?: string | null }>
  >(new Map());

  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  const [exitingRows, setExitingRows] = useState<Map<number, 'booked' | 'dismissed'>>(() => new Map());
  const [pendingBookedExitId, setPendingBookedExitId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const highlightScrollSig = useRef('');
  const exitRowTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const [draftDetailOpen, setDraftDetailOpen] = useState(false);
  const [draftDetailLoading, setDraftDetailLoading] = useState(false);
  const [draftDetail, setDraftDetail] = useState<AppointmentFormDraftDetail | null>(null);
  const [draftFollowUpStatus, setDraftFollowUpStatus] =
    useState<AppointmentFormDraftFollowUpStatus>('pending');
  const [draftFollowUpNotes, setDraftFollowUpNotes] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBookedApptStarts(new Map());
    try {
      const { items, conversions } = await fetchAllAppointmentRequestSubmissions({
        practiceId: PRACTICE_ID,
      });

      const pendingReturn = readAppointmentRequestReturnSession();
      let highlightId: number | null = null;
      if (pendingReturn) {
        clearAppointmentRequestReturnSession();
        highlightId = pendingReturn.appointmentRequestSubmissionId;
        setPendingBookedExitId(highlightId);
        const startMap = new Map<number, { start: string; end?: string | null }>();
        startMap.set(pendingReturn.bookedAppointmentId, {
          start: pendingReturn.bookedAppointmentStart,
          end: pendingReturn.bookedAppointmentEnd,
        });
        setBookedApptStarts(startMap);
      }

      setRows(items);
      const drafts: Record<number, string> = {};
      for (const r of items) {
        if (isCompletedSubmission(r)) drafts[r.id] = initialNotes(r);
      }
      setNoteDrafts(drafts);
      setNoteSaving({});
      setNoteError({});

      if (conversions && conversions.totalRequests > 0) {
        const rate = ((conversions.converted / conversions.totalRequests) * 100).toFixed(1);
        setConversionsBanner(
          `${conversions.converted} of ${conversions.totalRequests} requests converted to appointments (${rate}%).`
        );
      } else {
        setConversionsBanner(null);
      }

      if (highlightId != null) {
        setHighlightEntryId(highlightId);
        highlightScrollSig.current = `${highlightId}-${Date.now()}`;
        const entry = items.find((r) => r.id === highlightId);
        if (entry && appointmentRequestHasSmsPhone(entry)) {
          setSmsError(null);
          setSmsMessage(defaultSmsMessage(entry, practiceTz));
          setSmsItem(entry);
        }
      }

      const bookedIds = items
        .filter((r) => isCompletedSubmission(r) && r.bookedAppointmentId != null)
        .map((r) => Number(r.bookedAppointmentId));
      const uniqueBooked = [...new Set(bookedIds.filter((id) => Number.isFinite(id)))];
      if (uniqueBooked.length > 0) {
        const startMap = pendingReturn
          ? new Map([
              [
                pendingReturn.bookedAppointmentId,
                {
                  start: pendingReturn.bookedAppointmentStart,
                  end: pendingReturn.bookedAppointmentEnd,
                },
              ],
            ])
          : new Map<number, { start: string; end?: string | null }>();
        await Promise.all(
          uniqueBooked.map(async (id) => {
            if (startMap.has(id)) return;
            const appt = await fetchAppointmentById(id, { practiceId: PRACTICE_ID });
            if (appt?.appointmentStart) {
              startMap.set(id, {
                start: appt.appointmentStart,
                end: appt.appointmentEnd ?? null,
              });
            }
          })
        );
        setBookedApptStarts(startMap);
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to load appointment requests';
      setError(String(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      incomplete: abandoned.length,
    };
    for (const row of submissions) {
      counts[submissionStatus(row)] += 1;
    }
    return counts;
  }, [submissions, abandoned.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortNewestFirst = (a: AppointmentRequestSubmissionItem, b: AppointmentRequestSubmissionItem) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();

    if (q) {
      const submissionMatches = submissions.filter((item) =>
        matchesSearchQuery(submissionSearchHaystack(item, noteDrafts), q),
      );
      const abandonedMatches = abandoned.filter((item) =>
        matchesSearchQuery(abandonedSearchHaystack(item), q),
      );
      return [...submissionMatches, ...abandonedMatches].sort(sortNewestFirst);
    }

    if (statusFilter === 'incomplete') {
      return [...abandoned].sort(sortNewestFirst);
    }

    return submissions
      .filter(
        (item) =>
          submissionStatus(item) === statusFilter || exitingRows.has(item.id),
      )
      .sort(sortNewestFirst);
  }, [statusFilter, submissions, abandoned, search, noteDrafts, exitingRows]);

  useEffect(() => {
    if (highlightEntryId == null || loading) return;
    if (!highlightScrollSig.current) return;
    const id = highlightEntryId;
    const scrollT = window.setTimeout(() => {
      rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 100);
    const clearT = window.setTimeout(() => setHighlightEntryId(null), 3200);
    return () => {
      window.clearTimeout(scrollT);
      window.clearTimeout(clearT);
    };
  }, [highlightEntryId, loading, filtered]);

  useEffect(() => {
    return () => {
      for (const t of exitRowTimers.current.values()) window.clearTimeout(t);
      exitRowTimers.current.clear();
    };
  }, []);

  const beginRowExit = useCallback((entryId: number, kind: 'booked' | 'dismissed') => {
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

  const mergeSubmission = useCallback((updated: AppointmentRequestSubmissionItem) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setNoteDrafts((d) => ({ ...d, [updated.id]: initialNotes(updated) }));
  }, []);

  const handleLinkedAppointment = useCallback(
    (updated: AppointmentRequestSubmissionItem) => {
      mergeSubmission({ ...updated, kind: 'submission' });
      beginRowExit(updated.id, 'booked');
    },
    [mergeSubmission, beginRowExit],
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
    async (item: AppointmentRequestSubmissionItem, status: AppointmentRequestSubmissionStatus) => {
      setStatusUpdating((s) => ({ ...s, [item.id]: true }));
      setStatusError((e) => ({ ...e, [item.id]: null }));
      try {
        const updated = await patchAppointmentRequestSubmission(item.id, { status });
        mergeSubmission({ ...updated, kind: 'submission' });
        if (status === 'dismissed') {
          beginRowExit(item.id, 'dismissed');
        } else if (status === 'booked') {
          beginRowExit(item.id, 'booked');
        } else if (status !== submissionStatus(item)) {
          setStatusFilter(status);
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not update status';
        setStatusError((er) => ({ ...er, [item.id]: String(msg) }));
      } finally {
        setStatusUpdating((s) => ({ ...s, [item.id]: false }));
      }
    },
    [mergeSubmission, beginRowExit]
  );

  function onNoteChange(entryId: number, value: string) {
    setNoteDrafts((d) => ({ ...d, [entryId]: value }));
    setNoteError((er) => ({ ...er, [entryId]: null }));
  }

  function noteIsDirty(item: AppointmentRequestSubmissionItem): boolean {
    const draft = noteDrafts[item.id] ?? initialNotes(item);
    return noteForPatch(draft) !== noteForPatch(initialNotes(item));
  }

  function saveNote(item: AppointmentRequestSubmissionItem) {
    const value = noteDrafts[item.id] ?? initialNotes(item);
    void flushNoteSave(item.id, value);
  }

  const onBook = (item: AppointmentRequestSubmissionItem) => {
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(item);
    writeRoutingAppointmentRequestIntent({
      ...intent,
      returnToListAfterBook: true,
      workspaceActive: true,
    });
    navigate('/schedule/routing');
  };

  const openSmsModal = (item: AppointmentRequestSubmissionItem) => {
    if (!appointmentRequestHasSmsPhone(item)) return;
    setSmsError(null);
    setSmsMessage(defaultSmsMessage(item, practiceTz));
    setSmsItem(item);
  };

  const closeSmsModal = () => {
    setSmsItem(null);
    setSmsMessage('');
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
    const cached = bookedApptStarts.get(apptId);
    const start = cached?.start;
    if (!start) return;
    const dateKey = DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz).toISODate();
    const params = new URLSearchParams({ fromMyDay: '1' });
    if (dateKey) params.set('date', dateKey);
    navigate(`/schedule/scheduler?${params.toString()}`);
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

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Appointments
      </h2>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        Triage incoming appointment requests from the client portal. Online bookings with a picked
        time appear in Booked automatically. Use Book for requests that still need scheduling, then
        link the appointment or book from routing. Text clients directly from the request phone
        number — including new clients who are not in the system yet.
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

      <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {STATUS_TABS.map(({ key, label }) => (
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
        ))}
        <button type="button" className="btn primary" onClick={() => void load()} disabled={loading}>
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
      ) : filtered.length === 0 ? (
        <p className="settings-muted">
          {isSearchActive
            ? 'No appointment requests match your search.'
            : 'No appointment requests in this view.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((item) => {
            if (isAbandonedItem(item)) {
              const rd = item.requestData ?? {};
              const name = clientDisplayNameFromRequestData(rd);
              const phone = requestDataPhone(rd);
              return (
                <li
                  key={`abandoned-${item.id}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
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
            const isBooked = status === 'booked';
            const bookedApptId = item.bookedAppointmentId;
            const hasLinkedAppointment = bookedApptId != null;
            const bookedOnline = isBooked && hasLinkedAppointment && !!item.bookedAt;
            const needsManualBook = !isDismissed && !isBooked && !hasLinkedAppointment;
            const bookedTimes =
              bookedApptId != null ? bookedApptStarts.get(Number(bookedApptId)) : undefined;
            const canText = requestDataCanText(rd);
            const rowHighlighted = highlightEntryId === item.id;
            const exitKind = exitingRows.get(item.id);
            const rowExiting = exitKind != null;

            return (
              <li
                key={item.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(item.id, el);
                  else rowRefs.current.delete(item.id);
                }}
                className={
                  rowExiting
                    ? `appt-request-row--exiting appt-request-row--exiting-${exitKind}`
                    : undefined
                }
                style={{
                  position: 'relative',
                  border: rowHighlighted
                    ? exitKind === 'booked'
                      ? '2px solid #10b981'
                      : exitKind === 'dismissed'
                        ? '2px solid #9ca3af'
                        : '2px solid #f97316'
                    : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  opacity: isBooked && !rowExiting ? 0.92 : 1,
                  background: rowHighlighted
                    ? exitKind === 'booked'
                      ? '#ecfdf5'
                      : exitKind === 'dismissed'
                        ? '#f3f4f6'
                        : '#fff7ed'
                    : isBooked && !rowExiting
                      ? 'var(--surface-muted, #f8f9fa)'
                      : undefined,
                  boxShadow: rowHighlighted
                    ? exitKind === 'booked'
                      ? '0 0 0 2px rgba(16, 185, 129, 0.3)'
                      : exitKind === 'dismissed'
                        ? '0 0 0 2px rgba(156, 163, 175, 0.35)'
                        : '0 0 0 2px rgba(249, 115, 22, 0.25)'
                    : undefined,
                }}
              >
                {rowExiting ? (
                  <div className="appt-request-row-exit-badge" aria-live="polite">
                    Moved to {exitKind === 'booked' ? 'Booked' : 'Dismissed'}
                  </div>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
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
                          {statusTabLabel(status)}
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
                      {bookedOnline ? (
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
                          Booked online
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
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {name}
                      {phone ? (
                        <span className="settings-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                          {phone}
                        </span>
                      ) : null}
                    </div>
                    <div className="settings-muted" style={{ fontSize: '0.92rem' }}>
                      {requestDataPetSummary(rd)}
                      {requestDataHowSoon(rd) ? (
                        <>
                          <span> · </span>
                          {requestDataHowSoon(rd)}
                        </>
                      ) : null}
                    </div>
                    <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 6 }}>
                      Submitted {formatSubmittedAt(item.submittedAt, practiceTz)}
                      {requestDataPreferredDoctor(rd) ? (
                        <>
                          <span> · Doctor: </span>
                          {requestDataPreferredDoctor(rd)}
                        </>
                      ) : null}
                    </div>
                    {formatRequestDataAddress(rd) ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        {formatRequestDataAddress(rd)}
                      </div>
                    ) : null}
                    {requestDataAnythingElse(rd) ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Client note: {requestDataAnythingElse(rd)}
                      </div>
                    ) : null}
                    {isBooked && bookedTimes ? (
                      <div style={{ fontSize: '0.88rem', marginTop: 4, fontWeight: 600 }}>
                        Booked: {formatBookedVisit(bookedTimes.start, bookedTimes.end, practiceTz)}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 10, fontSize: '0.88rem', width: 'min(100%, 480px)' }}>
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
                          htmlFor={`appt-request-note-${item.id}`}
                          style={{ fontWeight: 600, color: 'inherit', margin: 0 }}
                        >
                          Notes
                        </label>
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
                        className="settings-input"
                        rows={2}
                        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
                        value={noteDrafts[item.id] ?? initialNotes(item)}
                        onChange={(e) => onNoteChange(item.id, e.target.value)}
                        placeholder="e.g. Left voicemail; will try again tomorrow."
                        disabled={isDismissed || Boolean(noteSaving[item.id])}
                      />
                      {noteError[item.id] ? (
                        <span style={{ color: '#b91c1c', fontSize: 12, display: 'block', marginTop: 4 }}>
                          {noteError[item.id]}
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
                          onClick={() => setManualBookItem(item)}
                        >
                          Link appointment…
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(statusUpdating[item.id])}
                          onClick={() => void updateStatus(item, 'dismissed')}
                        >
                          {statusUpdating[item.id] ? 'Saving…' : 'Dismiss'}
                        </button>
                      </>
                    ) : isBooked || hasLinkedAppointment ? (
                      <>
                        {appointmentRequestHasSmsPhone(item) ? (
                          <button type="button" className="btn secondary" onClick={() => openSmsModal(item)}>
                            Text client
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => onViewAppointment(item)}
                          disabled={!bookedTimes?.start}
                        >
                          View appointment
                        </button>
                        {isBooked ? (
                          <button type="button" className="btn secondary" onClick={() => onBook(item)}>
                            Reschedule
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={Boolean(statusUpdating[item.id])}
                          onClick={() => void updateStatus(item, 'dismissed')}
                        >
                          Dismiss
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
                    {statusError[item.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {statusError[item.id]}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {manualBookItem ? (
        <AppointmentRequestManualBookModal
          item={manualBookItem}
          onClose={() => setManualBookItem(null)}
          onLinked={handleLinkedAppointment}
        />
      ) : null}

      {smsItem ? (
        <ClientSmsComposeModal
          open
          clientLabel={clientDisplayNameFromRequestData(smsItem.requestData ?? {})}
          message={smsMessage}
          onMessageChange={setSmsMessage}
          onClose={closeSmsModal}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={() => {}}
          sending={smsSending}
          sendError={smsError}
          title="Text requester"
          subtitle={`Message goes to the phone on the request${requestDataCanText(smsItem.requestData ?? {}) === 'Yes' ? ' (client consented to texts)' : ''}.`}
        />
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
  );
}
