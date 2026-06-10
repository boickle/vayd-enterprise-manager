import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  fetchForwardBookings,
  finishForwardBookingFollowUp,
  patchForwardBooking,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import { ForwardBookingManualCompleteModal } from '../components/ForwardBookingManualCompleteModal';
import { CreateForwardBookingModal } from '../components/CreateForwardBookingModal';
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
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
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
  resolveForwardBookingSourceStartIso,
} from '../utils/forwardBookingFromAppointment';
import {
  buildAppointmentTypeCatalogFromTypes,
  buildBookedAppointmentMetaMap,
  forwardBookingEntryVisibleOnList,
  opsPointsForAppointment,
  type BookedAppointmentMeta,
} from '../utils/forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from '../utils/appointmentTypeSettings';
import {
  forwardBookingHasLinkedVisit,
  forwardBookingLinkedAppointmentId,
  mergeForwardBookingLinkedVisit,
} from '../utils/forwardBookingLinkedVisit';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { DateTime } from 'luxon';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type StatusFilter = 'pending' | 'booked' | 'complete';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Needs booking' },
  { key: 'booked', label: 'Booked' },
  { key: 'complete', label: 'Complete' },
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
        .filter((e) => !e.sourceAppointmentStart?.trim() && e.sourceAppointmentId)
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
    const start = startByApptId.get(e.sourceAppointmentId);
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

function forwardBookingListTab(entry: ForwardBookingEntry): StatusFilter {
  if (entry.status === 'complete') return 'complete';
  if (forwardBookingHasLinkedVisit(entry)) return 'booked';
  return 'pending';
}

function compareEntries(a: ForwardBookingEntry, b: ForwardBookingEntry): number {
  const ta = a.targetDueDate ? new Date(a.targetDueDate).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.targetDueDate ? new Date(b.targetDueDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return clientDisplay(a).name.localeCompare(clientDisplay(b).name, undefined, { sensitivity: 'base' });
}

export default function ForwardBookingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceTz = practiceTimeZoneOrDefault(undefined);

  const resolveBookedSlotForSms = useCallback(
    async (entry: ForwardBookingEntry) => {
      const catalog = typeCatalogRef.current;
      const entryType =
        entry.appointmentTypeId != null
          ? catalog?.byId.get(Number(entry.appointmentTypeId))
          : undefined;

      return resolveForwardBookingSmsBookedSlot(entry, practiceTz, {
        practiceId: PRACTICE_ID,
        appointmentType: entryType ?? null,
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
  const [bookedApptPoints, setBookedApptPoints] = useState<Map<number, number> | null>(null);
  const [bookedApptMeta, setBookedApptMeta] = useState<Map<number, BookedAppointmentMeta> | null>(
    null
  );
  const typeCatalogRef = useRef<AppointmentTypeCatalog | null>(null);
  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
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
            ? mergeForwardBookingLinkedVisit(r, { ...pendingReturn, status: 'booked' })
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
        setStatusFilter('booked');
      }

      if (openSmsForReturn) {
        const entry = list.find((r) => r.id === openSmsForReturn.forwardBookingEntryId);
        const points = metaMap.get(openSmsForReturn.bookedAppointmentId)?.points ?? 0;
        if (entry && points <= 0 && clientHasSmsPhone(entry)) {
          const bookedSlot = await resolveBookedSlotForSms(entry);
          setSmsError(null);
          setSmsMessage(buildForwardBookingSmsMessage(entry, bookedSlot ? { bookedSlot } : undefined));
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
    if (Number.isFinite(patientId) && Number.isFinite(appointmentId)) {
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
    const counts: Record<StatusFilter, number> = { pending: 0, booked: 0, complete: 0 };
    for (const row of visibleRows) {
      counts[forwardBookingListTab(row)] += 1;
    }
    return counts;
  }, [visibleRows]);

  const filtered = useMemo(() => {
    let list = visibleRows.filter((r) => forwardBookingListTab(r) === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return [...list].sort(compareEntries);
    return list
      .filter((r) => {
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
          formatForwardBookingDate(r.targetDueDate, practiceTz),
          prov,
          notes,
          bookingNote,
          bookedBy,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort(compareEntries);
  }, [visibleRows, statusFilter, search, noteDrafts, practiceTz]);

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

  const openSmsModal = async (entry: ForwardBookingEntry) => {
    if (!clientHasSmsPhone(entry)) return;
    setSmsError(null);
    const bookedSlot = await resolveBookedSlotForSms(entry);
    setSmsMessage(buildForwardBookingSmsMessage(entry, bookedSlot ? { bookedSlot } : undefined));
    setSmsEntry(entry);
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
    const start = entry.bookedAppointmentStart;
    if (!start) return;
    const dateKey = DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz).toISODate();
    const providerId = entry.primaryProvider?.id != null ? String(entry.primaryProvider.id) : '';
    const params = new URLSearchParams({ fromMyDay: '1' });
    if (dateKey) params.set('date', dateKey);
    if (providerId) params.set('provider', providerId);
    navigate(`/schedule/scheduler?${params.toString()}`);
  };

  const mergeEntry = useCallback((updated: ForwardBookingEntry) => {
    clearForwardBookingLocalLink(updated.id);
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setNoteDrafts((d) => ({ ...d, [updated.id]: initialNote(updated) }));
    if (updated.status === 'booked' || forwardBookingHasLinkedVisit(updated)) {
      setStatusFilter('booked');
    }
    const apptId = forwardBookingLinkedAppointmentId(updated);
    const catalog = typeCatalogRef.current;
    if (apptId != null && catalog) {
      void fetchAppointmentById(apptId, { practiceId: PRACTICE_ID }).then((appt) => {
        if (!appt) return;
        const points = opsPointsForAppointment(appt, catalog);
        const typeName =
          appt.appointmentType?.name?.trim() || appt.appointmentType?.prettyName?.trim() || null;
        const meta: BookedAppointmentMeta = { points, typeName };
        setBookedApptMeta((prev) => {
          const next = new Map(prev ?? []);
          next.set(apptId, meta);
          return next;
        });
        setBookedApptPoints((prev) => {
          const next = new Map(prev ?? []);
          next.set(apptId, points);
          return next;
        });
      });
    }
  }, []);

  const markFollowUpComplete = useCallback(async (entry: ForwardBookingEntry) => {
    setFollowUpCompleting((s) => ({ ...s, [entry.id]: true }));
    setFollowUpCompleteError((e) => ({ ...e, [entry.id]: null }));
    try {
      const updated = await finishForwardBookingFollowUp(entry.id, PRACTICE_ID);
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
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Forward booking
      </h2>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        Clients who need their next visit scheduled after a completed appointment. Staff set how far
        out to book (days, weeks, or months) when ending a visit. Use Book to open routing with client
        and patient
        details prefilled. Booking opens routing with calendar preview (like reschedule). After you
        book, you return here to text the client or mark the row complete when follow-up is
        finished. Booking notes from the visit are read-only; staff notes can be edited below.
        Placing a hold or booking from routing keeps the row on Booked until you mark it complete.
      </p>

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
            {key === 'pending' || key === 'booked' ? (
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
      ) : filtered.length === 0 ? (
        <p className="settings-muted">No forward bookings in this view.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((entry) => {
            const c = clientDisplay(entry);
            const hasLinked = forwardBookingHasLinkedVisit(entry);
            const linkedApptId = forwardBookingLinkedAppointmentId(entry);
            const linkedMeta =
              linkedApptId != null ? bookedApptMeta?.get(linkedApptId) : undefined;
            const linkedPoints = linkedMeta?.points ?? bookedApptPoints?.get(linkedApptId ?? -1) ?? 0;
            const isHoldOnCalendar = hasLinked && linkedPoints <= 0;
            const linkedStatusLine = linkedVisitStatusLine(entry, linkedMeta, practiceTz);
            const patientName = pickStr(entry.patient?.name) ?? `Patient #${entry.patientId}`;
            const patientPimsId = pickStr(entry.patient?.pimsId);
            const overdue =
              entry.targetDueDate && dayjs(entry.targetDueDate).startOf('day').isBefore(dayjs().startOf('day'));

            const isComplete = entry.status === 'complete';
            const showBookedFollowUpActions = hasLinked && !isComplete;

            const rowHighlighted = highlightEntryId === entry.id;

            return (
              <li
                key={entry.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(entry.id, el);
                  else rowRefs.current.delete(entry.id);
                }}
                style={{
                  border: rowHighlighted
                    ? '2px solid #f97316'
                    : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  opacity: hasLinked ? 0.92 : 1,
                  background: rowHighlighted
                    ? '#fff7ed'
                    : hasLinked
                      ? 'var(--surface-muted, #f8f9fa)'
                      : undefined,
                  boxShadow: rowHighlighted ? '0 0 0 2px rgba(249, 115, 22, 0.25)' : undefined,
                  transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    {isComplete ? (
                      <div
                        style={{
                          display: 'inline-block',
                          marginBottom: 8,
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
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {c.pimsId ? (
                        <a href={evetClientLink(c.pimsId)} target="_blank" rel="noreferrer">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                      {c.phone ? (
                        <span className="settings-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                          {c.phone}
                        </span>
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
                        {formatForwardBookingDate(entry.targetDueDate, practiceTz)}
                      </span>
                      <span> · Provider: {providerLabel(entry)}</span>
                    </div>
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
                          disabled={!noteIsDirty(entry) || Boolean(noteSaving[entry.id])}
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
                        disabled={Boolean(noteSaving[entry.id])}
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
                    {hasLinked || isComplete ? (
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
                      </>
                    ) : (
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
                        <button type="button" className="btn primary" onClick={() => onBook(entry)}>
                          Book
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setManualCompleteEntry(entry)}
                        >
                          Mark complete…
                        </button>
                      </>
                    )}
                    {followUpCompleteError[entry.id] ? (
                      <span style={{ color: '#b91c1c', fontSize: 12, width: '100%' }}>
                        {followUpCompleteError[entry.id]}
                      </span>
                    ) : null}
                  </div>
                </div>
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
