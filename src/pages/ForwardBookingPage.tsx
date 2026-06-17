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
import { sendClientSms } from '../api/clientSms';
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
import {
  buildForwardBookingSmsMessage,
  clientHasSmsPhone,
  resolveForwardBookingSmsBookedSlot,
} from '../utils/forwardBookingSmsMessage';
import {
  clearForwardBookingLocalLink,
  mergeForwardBookingsWithLocalLinks,
  writeForwardBookingLocalLink,
} from '../utils/forwardBookingLocalLinks';
import {
  clearForwardBookingReturnSession,
  readForwardBookingReturnSession,
} from '../utils/forwardBookingReturnSession';
import {
  formatForwardBookingIntervalLabel,
  forwardBookingIsHighPriority,
  groupForwardBookingListByHousehold,
  sortForwardBookingListEntries,
  resolveForwardBookingSourceStartIso,
  resolveForwardBookingTargetDueDateIso,
} from '../utils/forwardBookingFromAppointment';
import {
  buildAppointmentTypeCatalogFromTypes,
  buildBookedAppointmentMetaMap,
  forwardBookingEntryVisibleOnList,
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
  forwardBookingHasLinkedVisit,
  forwardBookingLinkedAppointmentId,
  mergeForwardBookingLinkedVisit,
} from '../utils/forwardBookingLinkedVisit';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { buildSchedulerFocusAppointmentUrl } from '../utils/schedulerFocusAppointment';
import { DateTime } from 'luxon';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type StatusFilter = ForwardBookingListTab;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Needs booking' },
  { key: 'onHold', label: 'On Hold' },
  { key: 'bookLater', label: 'Book later' },
  { key: 'booked', label: 'Booked' },
  { key: 'complete', label: 'Complete' },
  { key: 'removed', label: 'Removed' },
];

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

function formatForwardBookingDate(iso: string | null | undefined, practiceTz: string): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '—';
  return dt.toFormat('EEE, MMM d, yyyy');
}

function formatSourceVisit(
  entry: ForwardBookingEntry,
  practiceTz: string
): { label: string; iso: string | null } {
  if (entry.sourceAppointmentId == null || entry.sourceAppointmentId <= 0) {
    return { iso: null, label: 'No associated visit' };
  }
  const iso = resolveForwardBookingSourceStartIso(entry, practiceTz);
  return { iso, label: formatForwardBookingDate(iso, practiceTz) };
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

function noteForPatch(value: string): string | null {
  const t = value.trim();
  return t === '' ? null : t;
}

function linkedVisitStatusLine(
  entry: ForwardBookingEntry,
  meta: BookedAppointmentMeta | undefined,
  practiceTz: string
): string | null {
  if (!forwardBookingHasLinkedVisit(entry)) return null;
  const start = entry.bookedAppointmentStart?.trim();
  if (!start) return 'On calendar — use View appointment for details';
  const visit = formatBookedVisit(start, entry.bookedAppointmentEnd, practiceTz);
  const points = meta?.points ?? 0;
  const typeName = meta?.typeName?.trim();
  if (points <= 0) {
    const holdLabel =
      typeName && /\bhold\b/i.test(typeName) ? typeName : typeName || 'Hold';
    return `${holdLabel} placed: ${visit}`;
  }
  return `Booked: ${visit}`;
}

export default function ForwardBookingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceTz = practiceTimeZoneOrDefault(undefined);

  const resolveBookedSlotForSms = useCallback(
    async (entry: ForwardBookingEntry) => {
      return resolveForwardBookingSmsBookedSlot(entry, practiceTz, {
        practiceId: PRACTICE_ID,
      });
    },
    [practiceTz]
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ForwardBookingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualCompleteEntry, setManualCompleteEntry] = useState<ForwardBookingEntry | null>(null);
  const [smsEntry, setSmsEntry] = useState<ForwardBookingEntry | null>(null);
  const [smsPrimaryProviderId, setSmsPrimaryProviderId] = useState<number | null>(null);
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
  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const highlightScrollSig = useRef('');

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

      const pendingReturn = readForwardBookingReturnSession();
      let openSmsForReturn: typeof pendingReturn = null;
      let highlightId: number | null = null;
      if (pendingReturn) {
        clearForwardBookingReturnSession();
        writeForwardBookingLocalLink(pendingReturn.forwardBookingEntryId, {
          bookedAppointmentId: pendingReturn.bookedAppointmentId,
          bookedAppointmentStart: pendingReturn.bookedAppointmentStart,
          bookedAppointmentEnd: pendingReturn.bookedAppointmentEnd,
        });
        list = list.map((r) =>
          r.id === pendingReturn.forwardBookingEntryId
            ? mergeForwardBookingLinkedVisit(r, {
                bookedAppointmentId: pendingReturn.bookedAppointmentId,
                bookedAppointmentStart: pendingReturn.bookedAppointmentStart,
                bookedAppointmentEnd: pendingReturn.bookedAppointmentEnd,
              })
            : r
        );
        highlightId = pendingReturn.forwardBookingEntryId;
        openSmsForReturn = pendingReturn;
      }

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

      if (highlightId != null) {
        setHighlightEntryId(highlightId);
        highlightScrollSig.current = `${highlightId}-${Date.now()}`;
        const highlighted = list.find((r) => r.id === highlightId);
        if (highlighted) {
          setStatusFilter(forwardBookingListTab(highlighted, practiceTz, metaMap));
        }
      }

      if (openSmsForReturn) {
        const entry = list.find((r) => r.id === openSmsForReturn.forwardBookingEntryId);
        const points = metaMap.get(openSmsForReturn.bookedAppointmentId)?.points ?? 0;
        if (entry && points <= 0 && clientHasSmsPhone(entry)) {
          const resolved = await resolveBookedSlotForSms(entry);
          setSmsError(null);
          setSmsMessage(
            buildForwardBookingSmsMessage(
              entry,
              resolved.bookedSlot ? { bookedSlot: resolved.bookedSlot } : undefined
            )
          );
          setSmsPrimaryProviderId(resolved.primaryProviderId ?? null);
          setSmsEntry(entry);
        }
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to load forward bookings';
      setError(String(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [practiceTz, resolveBookedSlotForSms]);

  useEffect(() => {
    void load();
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
      counts[forwardBookingListTab(row, practiceTz, bookedApptMeta)] += 1;
    }
    return counts;
  }, [visibleRows, practiceTz, bookedApptMeta]);

  const filtered = useMemo(() => {
    let list = visibleRows.filter(
      (r) => forwardBookingListTab(r, practiceTz, bookedApptMeta) === statusFilter
    );
    const q = search.trim().toLowerCase();
    const sortList = (items: ForwardBookingEntry[]) => {
      if (statusFilter === 'bookLater') {
        return sortForwardBookingBookLaterListEntries(items, practiceTz, (e) => clientDisplay(e).name);
      }
      return sortForwardBookingListEntries(items, practiceTz, (e) => clientDisplay(e).name);
    };
    if (!q) return sortList(list);
    return sortList(
      list.filter((r) => {
        const c = clientDisplay(r);
        const pet = pickStr(r.patient?.name) ?? '';
        const prov = providerLabel(r).toLowerCase();
        const notes = (noteDrafts[r.id] ?? initialNote(r)).toLowerCase();
        const bookingNote = (bookingNotesDisplay(r) ?? '').toLowerCase();
        const bookedBy = employeeLabel(r.bookedBy).toLowerCase();
        const sourceVisit = formatSourceVisit(r, practiceTz);
        const hay = [
          c.name,
          c.phone ?? '',
          pet,
          sourceVisit.label,
          formatForwardBookingIntervalLabel({
            intervalAmount: r.intervalAmount,
            intervalUnit: r.intervalUnit,
            monthsOut: r.monthsOut,
          }),
          r.appointmentTypeName ?? '',
          formatForwardBookingDate(resolveForwardBookingTargetDueDateIso(r, practiceTz), practiceTz),
          formatForwardBookingBookAfterDate(forwardBookingBookAfterDateIso(r), practiceTz),
          prov,
          notes,
          bookingNote,
          bookedBy,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
    );
  }, [visibleRows, statusFilter, search, noteDrafts, practiceTz, bookedApptMeta]);

  const filteredGroups = useMemo(
    () => groupForwardBookingListByHousehold(filtered),
    [filtered]
  );

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
    if (!clientHasSmsPhone(entry)) return;
    setSmsError(null);
    const resolved = await resolveBookedSlotForSms(entry);
    setSmsMessage(
      buildForwardBookingSmsMessage(
        entry,
        resolved.bookedSlot ? { bookedSlot: resolved.bookedSlot } : undefined
      )
    );
    setSmsPrimaryProviderId(resolved.primaryProviderId ?? null);
    setSmsEntry(entry);
  };

  const closeSmsModal = () => {
    setSmsEntry(null);
    setSmsPrimaryProviderId(null);
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
        ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
        ...(smsPrimaryProviderId != null ? { primaryProviderId: smsPrimaryProviderId } : {}),
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
      navigate(
        buildSchedulerFocusAppointmentUrl(apptId, {
          date: dateKey ?? undefined,
          providerId: meta?.providerInternalId ?? undefined,
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
              setStatusFilter(forwardBookingListTab(updated, practiceTz, next));
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
        setStatusFilter(forwardBookingListTab(updated, practiceTz, bookedApptMeta));
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
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8, marginBottom: 16 }}>
        Forward booking
      </h2>

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
            {key === 'pending' ||
            key === 'onHold' ||
            key === 'bookLater' ||
            key === 'removed' ? (
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
            ) : null}
          </button>
        ))}
        <button type="button" className="btn primary" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
        <button type="button" className="btn" onClick={() => {
          setCreatePrefill(null);
          setCreateReturnTo(null);
          setCreateOpen(true);
        }}>
          + Forward booking
        </button>
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <input
          type="search"
          className="settings-input"
          placeholder="Search client, patient, provider, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search forward booking list"
          style={{ width: '100%' }}
        />
      </div>

      {error ? (
        <p className="settings-muted" style={{ color: 'var(--danger, #c62828)' }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : filteredGroups.length === 0 ? (
        <p className="settings-muted">No forward bookings in this view.</p>
      ) : (
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
            const linkedPoints = linkedMeta?.points ?? bookedApptPoints?.get(linkedApptId ?? -1) ?? 0;
            const isHoldOnCalendar = hasLinked && linkedPoints <= 0;
            const linkedStatusLine = linkedVisitStatusLine(entry, linkedMeta, practiceTz);
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

            const isComplete = entry.status === 'complete';
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
                          background: isHoldOnCalendar ? '#fef3c7' : '#dcfce7',
                          color: isHoldOnCalendar ? '#92400e' : '#166534',
                        }}
                      >
                        {isHoldOnCalendar
                          ? `${linkedMeta?.typeName?.trim() || 'Hold'} on calendar`
                          : 'Visit booked'}
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
                      <span aria-hidden>·</span>
                      <span>
                        {entry.appointmentTypeName?.trim() || 'Visit'}
                        <span> · </span>
                        {formatForwardBookingIntervalLabel(entry)}
                      </span>
                    </div>
                    <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 6 }}>
                      Original visit: {formatSourceVisit(entry, practiceTz).label}
                      <span> · Target: </span>
                      <span style={overdue && !hasLinked ? { color: 'var(--danger, #c62828)' } : undefined}>
                        {formatForwardBookingDate(resolvedTargetDueDate, practiceTz)}
                      </span>
                      <span> · Provider: {providerLabel(entry)}</span>
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
                          color: isHoldOnCalendar ? '#92400e' : 'var(--text, #1e293b)',
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
                            className={isHoldOnCalendar && !isComplete ? 'btn primary' : 'btn secondary'}
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
