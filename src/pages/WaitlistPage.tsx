import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useNavigate, useSearchParams } from 'react-router';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchWaitlist,
  patchWaitlistEntry,
  type WaitlistEntry,
  type WaitlistStatus,
} from '../api/waitlist';
import { fetchSchedulingOutreachSmsFrom, sendClientSms } from '../api/clientSms';
import { WaitlistAddModal } from '../components/WaitlistAddModal';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import SchedulingToolsListPagination, {
  paginateSchedulingToolsList,
} from '../components/SchedulingToolsListPagination';
import {
  notifySchedulingToolsNavCountsRefresh,
  SCHEDULING_TOOLS_PAGE_REFRESH_EVENT,
} from '../hooks/useSchedulingToolsNavCounts';
import { appPrompt } from '../utils/appDialog';
import {
  buildRoutingForwardBookingIntentFromEntries,
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
import {
  createForwardBookingsFromWaitlist,
  waitlistRoutingSearchDateRange,
} from '../utils/waitlistForwardBooking';
import {
  waitlistAddressLine,
  waitlistClientDisplayName,
  waitlistClientFirstName,
  waitlistDaysWaiting,
  waitlistEntryMatchesTargetDate,
  waitlistPetNames,
  waitlistSortForCancellation,
  waitlistWindowLabel,
} from '../utils/waitlistMatch';
import {
  buildWaitlistBookedSmsMessage,
  buildWaitlistOpeningSmsMessage,
  resolveWaitlistSmsBookedSlot,
} from '../utils/waitlistSmsMessage';
import {
  clearWaitlistReturnSession,
  readWaitlistReturnSession,
} from '../utils/waitlistReturnSession';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import { careOutreachClientHasSmsPhone } from '../utils/careOutreachSmsMessage';
import { holdReleaseOptsForAppointment } from '../utils/forwardBookingSmsMessage';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import './WaitlistPage.css';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ = practiceTimeZoneOrDefault(undefined);
const NOTES_DEBOUNCE_MS = 750;

type StatusTab = WaitlistStatus;

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'booked', label: 'Booked' },
  { key: 'removed', label: 'Removed' },
];

function fillDoctorIdForProvider(provider: Provider): string {
  return provider.pimsId ? String(provider.pimsId) : String(provider.id);
}

function providerInternalId(provider: Provider | undefined): number | null {
  if (provider?.id == null) return null;
  const n = Number(provider.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatDaysWaiting(days: number): string {
  if (days <= 0) return 'Added today';
  if (days === 1) return '1 day waiting';
  return `${days} days waiting`;
}

function formatRelativeContact(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return null;
  return `Last texted ${dt.setZone(PRACTICE_TZ).toRelative({ style: 'short' }) ?? dt.toFormat('MMM d')}`;
}

export default function WaitlistPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusTab>('waiting');
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const notesTimers = useRef<Record<number, number>>({});
  const [notesSaving, setNotesSaving] = useState<Record<number, boolean>>({});
  const [routingId, setRoutingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [doctorQuery, setDoctorQuery] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState<Provider | null>(null);
  const [showDoctorMenu, setShowDoctorMenu] = useState(false);
  const [targetDate, setTargetDate] = useState('');
  const doctorBoxRef = useRef<HTMLDivElement>(null);

  const [smsEntry, setSmsEntry] = useState<WaitlistEntry | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [fromLine, setFromLine] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesLabel, setMessagesLabel] = useState('');
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const load = useCallback(async (nextStatus: StatusTab) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchWaitlist({
        practiceId: PRACTICE_ID,
        status: nextStatus,
        limit: 2000,
      });
      setEntries(rows);
      const draft: Record<number, string> = {};
      for (const row of rows) draft[row.id] = row.notes ?? '';
      setNotesDraft(draft);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not load waitlist.';
      setError(String(msg));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  useEffect(() => {
    const onRefresh = () => void load(status);
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onRefresh);
  }, [load, status]);

  useEffect(() => {
    void fetchPrimaryProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
    void fetchSchedulingOutreachSmsFrom().then(setFromLine);
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!doctorBoxRef.current?.contains(e.target as Node)) setShowDoctorMenu(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const pending = readWaitlistReturnSession();
    if (!pending?.openSms) return;
    clearWaitlistReturnSession();
    void (async () => {
      try {
        await patchWaitlistEntry(pending.waitlistEntryId, {
          practiceId: PRACTICE_ID,
          status: 'booked',
          bookedAppointmentId: pending.bookedAppointmentId,
        });
      } catch {
        /* list refresh still useful */
      }
      setStatus('waiting');
      await load('waiting');
      notifySchedulingToolsNavCountsRefresh();
      const bookedSlot = await resolveWaitlistSmsBookedSlot(
        pending.bookedAppointmentId,
        PRACTICE_ID,
        PRACTICE_TZ,
        {
          startIso: pending.bookedAppointmentStart,
          endIso: pending.bookedAppointmentEnd,
        },
      );
      const holdRelease = pending.isHold
        ? holdReleaseOptsForAppointment(pending.bookedAppointmentStart, PRACTICE_TZ)
        : undefined;
      setSmsMessage(
        buildWaitlistBookedSmsMessage({
          petNames: pending.petNames,
          clientFirstName: pending.clientFirstName,
          clientDisplayName: pending.clientDisplayName,
          bookedSlot,
          providerLastName: pending.providerLastName,
          holdRelease,
        }),
      );
      setSmsEntry({
        id: pending.waitlistEntryId,
        practiceId: PRACTICE_ID,
        status: 'booked',
        clientId: pending.clientId,
        patientIds: [],
        appointmentTypeId: null,
        appointmentTypeName: null,
        preferredProviderId: null,
        preferredWindow: 'asap',
        preferredStartDate: null,
        preferredEndDate: null,
        serviceMinutes: null,
        notes: null,
        lastContactedAt: null,
        bookedAppointmentId: pending.bookedAppointmentId,
        bookedAppointmentStart: pending.bookedAppointmentStart,
        bookedAt: null,
        removedAt: null,
        removedReason: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        patients: pending.petNames.map((name, i) => ({ id: i + 1, name })),
        client: {
          id: pending.clientId,
          firstName: pending.clientFirstName,
        },
      });
      setHighlightId(pending.waitlistEntryId);
    })();
  }, [load]);

  const doctorResults = useMemo(() => {
    const q = doctorQuery.trim().toLowerCase();
    if (!q) return providers.slice(0, 12);
    return providers.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12);
  }, [doctorQuery, providers]);

  const selectedDoctorInternalId = providerInternalId(selectedDoctor ?? undefined);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...entries];
    if (q) {
      rows = rows.filter((e) => {
        const hay = [
          waitlistClientDisplayName(e),
          waitlistAddressLine(e),
          waitlistPetNames(e).join(' '),
          e.notes ?? '',
          e.appointmentTypeName ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    rows.sort((a, b) =>
      waitlistSortForCancellation(a, b, {
        doctorInternalId: selectedDoctorInternalId,
        targetDateYmd: targetDate.trim() || null,
        practiceTz: PRACTICE_TZ,
      }),
    );
    return rows;
  }, [entries, search, selectedDoctorInternalId, targetDate]);

  useEffect(() => {
    setListPage(1);
  }, [status, search, targetDate, selectedDoctorInternalId]);

  const pageRows = useMemo(
    () => paginateSchedulingToolsList(filtered, listPage),
    [filtered, listPage],
  );

  function scheduleNotesSave(id: number, value: string) {
    setNotesDraft((prev) => ({ ...prev, [id]: value }));
    if (notesTimers.current[id]) window.clearTimeout(notesTimers.current[id]);
    notesTimers.current[id] = window.setTimeout(() => {
      void persistNotes(id, value);
    }, NOTES_DEBOUNCE_MS);
  }

  async function persistNotes(id: number, value: string) {
    setNotesSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const updated = await patchWaitlistEntry(id, {
        practiceId: PRACTICE_ID,
        notes: value,
      });
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated } : e)));
    } catch {
      setError('Could not save notes.');
    } finally {
      setNotesSaving((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function handleRecommendSlot(entry: WaitlistEntry) {
    setRoutingId(entry.id);
    setError(null);
    try {
      const forwardBookingEntries = await createForwardBookingsFromWaitlist(entry, PRACTICE_ID, {
        primaryProviderId: selectedDoctorInternalId,
        targetDateYmd: targetDate.trim() || null,
      });
      const anchor = forwardBookingEntries[0];
      if (!anchor) throw new Error('Could not create forward booking rows.');
      const intent =
        forwardBookingEntries.length > 1
          ? buildRoutingForwardBookingIntentFromEntries(anchor, forwardBookingEntries)
          : buildRoutingForwardBookingIntentFromEntry(anchor);
      if (!intent) throw new Error('This client is missing data needed for routing.');
      const returnHref =
        `/schedule/scheduling-tools/waitlist?highlight=${entry.id}` +
        (targetDate.trim() ? `&targetDate=${encodeURIComponent(targetDate.trim())}` : '');
      writeRoutingForwardBookingIntent({
        ...intent,
        staffNote: entry.notes,
        returnToListAfterBook: true,
        workspaceActive: true,
        origin: 'waitlist',
        waitlistEntryId: entry.id,
        waitlistReturn: {
          entryId: entry.id,
          clientId: entry.clientId,
          returnHref,
        },
        serviceMinutes:
          entry.serviceMinutes != null && entry.serviceMinutes > 0
            ? entry.serviceMinutes
            : intent.serviceMinutes,
        ...(selectedDoctorInternalId != null
          ? { primaryProviderInternalId: String(selectedDoctorInternalId) }
          : {}),
        primaryDoctorPimsId: selectedDoctor ? fillDoctorIdForProvider(selectedDoctor) : intent.primaryDoctorPimsId,
        primaryDoctorDisplayName: selectedDoctor?.name ?? intent.primaryDoctorDisplayName,
        routingSearch: waitlistRoutingSearchDateRange(targetDate.trim() || null, PRACTICE_TZ),
      });
      navigate('/schedule/routing');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not start routing.';
      setError(String(msg));
    } finally {
      setRoutingId(null);
    }
  }

  function openOpeningSms(entry: WaitlistEntry) {
    const dateLabel = targetDate.trim()
      ? DateTime.fromISO(targetDate.trim(), { zone: PRACTICE_TZ }).toFormat('EEE, MMM d')
      : null;
    setSmsError(null);
    setSmsEntry(entry);
    setSmsMessage(
      buildWaitlistOpeningSmsMessage({
        petNames: waitlistPetNames(entry),
        clientFirstName: waitlistClientFirstName(entry),
        clientDisplayName: waitlistClientDisplayName(entry),
        targetDateLabel: dateLabel,
        providerLastName: selectedDoctor?.lastName ?? selectedDoctor?.name?.split(/\s+/).pop() ?? null,
      }),
    );
  }

  async function sendSms(overrideNonProd: boolean) {
    if (!smsEntry) return;
    const message = smsMessage.trim();
    if (!message) {
      setSmsError('Enter a message before sending.');
      return;
    }
    setSmsSending(true);
    setSmsError(null);
    try {
      await sendClientSms(smsEntry.clientId, {
        message,
        useRemindersFrom: true,
        source: 'waitlist',
        ...(overrideNonProd ? { overrideNonProd: true } : {}),
      });
      await patchWaitlistEntry(smsEntry.id, {
        practiceId: PRACTICE_ID,
        touchLastContacted: true,
      }).catch(() => null);
      setSmsEntry(null);
      setSmsMessage('');
      await load(status);
      notifySchedulingToolsNavCountsRefresh();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to send text.';
      setSmsError(String(msg));
    } finally {
      setSmsSending(false);
    }
  }

  async function removeEntry(entry: WaitlistEntry) {
    const reason = await appPrompt({
      title: 'Remove from waitlist?',
      message: 'Optional reason.',
      defaultValue: '',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (reason === null) return;
    setRemovingId(entry.id);
    try {
      await patchWaitlistEntry(entry.id, {
        practiceId: PRACTICE_ID,
        status: 'removed',
        removedReason: reason.trim() || undefined,
      });
      await load(status);
      notifySchedulingToolsNavCountsRefresh();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not remove this household.';
      setError(String(msg));
    } finally {
      setRemovingId(null);
    }
  }

  useEffect(() => {
    const raw = searchParams.get('highlight');
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id) && id > 0) setHighlightId(id);
    const date = searchParams.get('targetDate')?.trim();
    if (date) setTargetDate(date);
  }, [searchParams]);

  return (
    <div className="waitlist-page">
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Waitlist
      </h2>
      <p className="settings-muted waitlist-intro">
        When the schedule is full, add the household here. Notes stay with the card. Pick a doctor and
        cancellation date to rank who can take the opening, then recommend a slot (same routing as
        schedule loader) or text them about the visit.
      </p>

      <div className="waitlist-toolbar">
        <button type="button" className="btn" onClick={() => setAddOpen(true)}>
          Add to waitlist
        </button>
        <input
          className="settings-input"
          style={{ maxWidth: 280 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, pet, notes…"
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`settings-tab${status === tab.key ? ' active' : ''}`}
              style={{
                marginBottom: 0,
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 14px',
              }}
              onClick={() => setStatus(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="waitlist-fill">
        <strong>Fill a cancellation</strong>
        <p className="settings-muted" style={{ margin: '4px 0 12px' }}>
          Optional — same idea as schedule loader. Matching households sort to the top. Recommend slot
          searches that doctor’s day; leave the date blank to search the next 14 days.
        </p>
        <div className="waitlist-fill__grid">
          <label className="waitlist-field" style={{ marginBottom: 0 }}>
            <span>Doctor</span>
            <div className="waitlist-fill__doctor" ref={doctorBoxRef}>
              <input
                className="settings-input"
                value={doctorQuery}
                onChange={(e) => {
                  setDoctorQuery(e.target.value);
                  setShowDoctorMenu(true);
                }}
                onFocus={() => setShowDoctorMenu(true)}
                placeholder="Search doctor…"
              />
              {showDoctorMenu && doctorResults.length > 0 ? (
                <ul className="waitlist-search-menu">
                  {doctorResults.map((d) => (
                    <li key={String(d.id)}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedDoctor(d);
                          setDoctorQuery(d.name);
                          setShowDoctorMenu(false);
                        }}
                      >
                        {d.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </label>
          <label className="waitlist-field" style={{ marginBottom: 0 }}>
            <span>Opening date</span>
            <input
              className="settings-input"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>
          {(selectedDoctor || targetDate) ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setSelectedDoctor(null);
                setDoctorQuery('');
                setTargetDate('');
              }}
            >
              Clear
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>

      {error ? <p className="waitlist-error">{error}</p> : null}

      {loading ? (
        <p className="settings-muted">Loading waitlist…</p>
      ) : filtered.length === 0 ? (
        <p className="settings-muted">
          {status === 'waiting'
            ? 'No households waiting. Add someone when you cannot offer a slot today.'
            : `No ${status} waitlist rows.`}
        </p>
      ) : (
        <>
          {pageRows.map((entry) => {
            const days = waitlistDaysWaiting(entry, PRACTICE_TZ);
            const matches =
              targetDate.trim() !== '' &&
              waitlistEntryMatchesTargetDate(entry, targetDate.trim(), PRACTICE_TZ);
            const prefDocMatch =
              selectedDoctorInternalId != null &&
              Number(entry.preferredProviderId) === selectedDoctorInternalId;
            const phone = entry.client?.phone1?.trim() || null;
            const canText = careOutreachClientHasSmsPhone(phone);
            const clientPims = entry.client?.pimsId?.trim() || String(entry.clientId);
            return (
              <article
                key={entry.id}
                className={`waitlist-card${matches ? ' waitlist-card--match' : ''}${
                  highlightId === entry.id ? ' waitlist-card--highlight' : ''
                }`}
              >
                <div className="waitlist-card__top">
                  <div>
                    <h3 className="waitlist-card__name">
                      {entry.client?.pimsId ? (
                        <a href={evetClientLink(clientPims)} target="_blank" rel="noreferrer">
                          {waitlistClientDisplayName(entry)}
                        </a>
                      ) : (
                        waitlistClientDisplayName(entry)
                      )}
                    </h3>
                    <div className="waitlist-card__meta">
                      <span className="waitlist-chip">{formatDaysWaiting(days)}</span>
                      <span className="waitlist-chip waitlist-chip--muted">
                        {waitlistWindowLabel(entry.preferredWindow)}
                      </span>
                      {matches ? <span className="waitlist-chip waitlist-chip--ok">Fits this opening</span> : null}
                      {prefDocMatch ? (
                        <span className="waitlist-chip waitlist-chip--ok">Preferred doctor</span>
                      ) : null}
                      {entry.status === 'waiting' &&
                      (entry.createdVia === 'online_booking' || entry.bookedAppointmentStart) ? (
                        <span className="waitlist-chip waitlist-chip--ok">
                          {entry.bookedAppointmentStart
                            ? `Has ${DateTime.fromISO(entry.bookedAppointmentStart)
                                .setZone(PRACTICE_TZ)
                                .toFormat('ccc, LLL d')} — wants sooner`
                            : 'Wants sooner'}
                        </span>
                      ) : null}
                      {entry.appointmentTypeName ? <span>{entry.appointmentTypeName}</span> : null}
                      {entry.preferredProvider?.name || entry.preferredProvider?.lastName ? (
                        <span>
                          Prefers{' '}
                          {entry.preferredProvider.name ||
                            [entry.preferredProvider.firstName, entry.preferredProvider.lastName]
                              .filter(Boolean)
                              .join(' ')}
                        </span>
                      ) : null}
                      {waitlistAddressLine(entry) ? <span>{waitlistAddressLine(entry)}</span> : null}
                      {phone ? <span>{phone}</span> : null}
                      {formatRelativeContact(entry.lastContactedAt) ? (
                        <span>{formatRelativeContact(entry.lastContactedAt)}</span>
                      ) : null}
                    </div>
                    <div className="waitlist-card__meta">
                      {(entry.patients ?? []).map((p) => (
                        <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {p.pimsId ? (
                            <a href={evetPatientLink(p.pimsId)} target="_blank" rel="noreferrer">
                              {p.name}
                            </a>
                          ) : (
                            p.name
                          )}
                          <BookPatientChartButton
                            patientId={String(p.id)}
                            patientName={p.name || `Pet ${p.id}`}
                            practiceId={PRACTICE_ID}
                            practiceTz={PRACTICE_TZ}
                            label="Details"
                            showAlerts
                          />
                        </span>
                      ))}
                    </div>
                    {entry.client?.alerts ? (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '4px 8px',
                          background: '#fef3c7',
                          borderRadius: 4,
                          fontSize: 12,
                          color: '#92400e',
                          fontWeight: 600,
                        }}
                      >
                        {entry.client.alerts}
                      </div>
                    ) : null}
                  </div>
                </div>

                {status === 'waiting' ? (
                  <div className="waitlist-notes">
                    <label className="waitlist-field" htmlFor={`waitlist-notes-${entry.id}`}>
                      <span>Notes {notesSaving[entry.id] ? '· Saving…' : ''}</span>
                      <textarea
                        id={`waitlist-notes-${entry.id}`}
                        className="settings-input"
                        value={notesDraft[entry.id] ?? ''}
                        onChange={(e) => scheduleNotesSave(entry.id, e.target.value)}
                        placeholder="Why they’re waiting, flexibility, who called…"
                      />
                    </label>
                  </div>
                ) : entry.notes ? (
                  <p className="settings-muted" style={{ whiteSpace: 'pre-wrap' }}>
                    {entry.notes}
                  </p>
                ) : null}

                {status === 'waiting' ? (
                  <div className="waitlist-card__actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={routingId === entry.id}
                      onClick={() => void handleRecommendSlot(entry)}
                    >
                      {routingId === entry.id ? 'Opening routing…' : 'Recommend slot'}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={!canText}
                      title={canText ? 'Text about this opening' : 'No mobile number on file'}
                      onClick={() => openOpeningSms(entry)}
                    >
                      Text client
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setMessagesClientId(entry.clientId);
                        setMessagesLabel(waitlistClientDisplayName(entry));
                      }}
                    >
                      Messages
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={removingId === entry.id}
                      onClick={() => void removeEntry(entry)}
                    >
                      {removingId === entry.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
          <SchedulingToolsListPagination
            listPage={listPage}
            totalItems={filtered.length}
            onPageChange={setListPage}
            itemLabel="households"
          />
        </>
      )}

      {addOpen ? (
        <WaitlistAddModal
          onClose={() => setAddOpen(false)}
          onCreated={(entry) => {
            setAddOpen(false);
            setStatus('waiting');
            setHighlightId(entry.id);
            void load('waiting');
            notifySchedulingToolsNavCountsRefresh();
          }}
        />
      ) : null}

      <ClientSmsComposeModal
        open={smsEntry != null}
        clientId={smsEntry?.clientId}
        clientLabel={smsEntry ? waitlistClientDisplayName(smsEntry) : ''}
        message={smsMessage}
        onMessageChange={setSmsMessage}
        onClose={() => {
          setSmsEntry(null);
          setSmsError(null);
        }}
        onSend={({ overrideNonProd }) => void sendSms(overrideNonProd)}
        onOpenMessagesHistory={() => {
          if (!smsEntry) return;
          setMessagesClientId(smsEntry.clientId);
          setMessagesLabel(waitlistClientDisplayName(smsEntry));
        }}
        sending={smsSending}
        sendError={smsError}
        title={smsEntry?.status === 'booked' ? 'Text booked visit' : 'Text about this opening'}
        fromLineLabel={fromLine}
      />

      {messagesClientId != null ? (
        <ClientMessagesHistoryModal
          open
          clientId={messagesClientId}
          clientLabel={messagesLabel}
          onClose={() => {
            setMessagesClientId(null);
            setMessagesLabel('');
          }}
        />
      ) : null}
    </div>
  );
}
