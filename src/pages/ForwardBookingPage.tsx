import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  fetchForwardBookings,
  patchForwardBooking,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import { ForwardBookingManualCompleteModal } from '../components/ForwardBookingManualCompleteModal';
import {
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { DateTime } from 'luxon';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const NOTES_DEBOUNCE_MS = 750;

type StatusFilter = 'all' | 'pending' | 'booked';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Needs booking' },
  { key: 'booked', label: 'Booked' },
  { key: 'all', label: 'All active' },
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

function formatTargetDue(iso: string | null | undefined): string {
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

function compareEntries(a: ForwardBookingEntry, b: ForwardBookingEntry): number {
  const ta = a.targetDueDate ? new Date(a.targetDueDate).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.targetDueDate ? new Date(b.targetDueDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return clientDisplay(a).name.localeCompare(clientDisplay(b).name, undefined, { sensitivity: 'base' });
}

/** Hide rows whose booked visit is in the past (visit has occurred). */
function entryIsVisibleActive(entry: ForwardBookingEntry, asOfMs: number): boolean {
  if (entry.status !== 'booked') return true;
  const start = entry.bookedAppointmentStart;
  if (!start) return true;
  const t = new Date(start).getTime();
  return Number.isNaN(t) || t >= asOfMs;
}

export default function ForwardBookingPage() {
  const navigate = useNavigate();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ForwardBookingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualCompleteEntry, setManualCompleteEntry] = useState<ForwardBookingEntry | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [noteError, setNoteError] = useState<Record<number, string | null>>({});
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchForwardBookings({
        practiceId: PRACTICE_ID,
        asOf: new Date().toISOString(),
        limit: 2000,
      });
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
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timerMap = debounceTimers.current;
    return () => {
      for (const t of timerMap.values()) {
        clearTimeout(t);
      }
      timerMap.clear();
    };
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

  const scheduleNoteSave = useCallback(
    (entryId: number, value: string) => {
      const prevTimer = debounceTimers.current.get(entryId);
      if (prevTimer) clearTimeout(prevTimer);
      const t = setTimeout(() => {
        debounceTimers.current.delete(entryId);
        void flushNoteSave(entryId, value);
      }, NOTES_DEBOUNCE_MS);
      debounceTimers.current.set(entryId, t);
    },
    [flushNoteSave]
  );

  function onNoteChange(entryId: number, value: string) {
    setNoteDrafts((d) => ({ ...d, [entryId]: value }));
    scheduleNoteSave(entryId, value);
  }

  async function onNoteBlur(entryId: number, valueFromDom: string) {
    const t = debounceTimers.current.get(entryId);
    if (t) {
      clearTimeout(t);
      debounceTimers.current.delete(entryId);
    }
    const value = valueFromDom;
    setNoteDrafts((d) => ({ ...d, [entryId]: value }));
    const server = rows.find((r) => r.id === entryId);
    const serverVal = server ? initialNote(server) : '';
    if (value !== serverVal) {
      await flushNoteSave(entryId, value);
    }
  }

  const asOfMs = Date.now();

  const visibleRows = useMemo(
    () => rows.filter((r) => entryIsVisibleActive(r, asOfMs)),
    [rows, asOfMs]
  );

  const filtered = useMemo(() => {
    let list = visibleRows;
    if (statusFilter !== 'all') {
      list = list.filter((r) => r.status === statusFilter);
    }
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
        const hay = [
          c.name,
          c.phone ?? '',
          pet,
          String(r.monthsOut),
          r.appointmentTypeName ?? '',
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
  }, [visibleRows, statusFilter, search, noteDrafts]);

  const onBook = (entry: ForwardBookingEntry) => {
    const intent = buildRoutingForwardBookingIntentFromEntry(entry);
    if (!intent) {
      setError('This forward booking is missing client or patient data.');
      return;
    }
    writeRoutingForwardBookingIntent(intent);
    navigate('/schedule/routing');
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

  const mergeEntry = (updated: ForwardBookingEntry) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setNoteDrafts((d) => ({ ...d, [updated.id]: initialNote(updated) }));
  };

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Forward booking
      </h2>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        Clients who need their next visit scheduled after a completed appointment. Staff set how many
        months out to book when ending a visit. Use Book to open routing with client and patient
        details prefilled. Booking notes from the visit are read-only; queue notes can be edited
        below. Entries disappear after the booked visit occurs.
      </p>

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
            }}
            onClick={() => setStatusFilter(key)}
          >
            {label}
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
            const isBooked = entry.status === 'booked';
            const patientName = pickStr(entry.patient?.name) ?? `Patient #${entry.patientId}`;
            const patientPimsId = pickStr(entry.patient?.pimsId);
            const overdue =
              entry.targetDueDate && dayjs(entry.targetDueDate).startOf('day').isBefore(dayjs().startOf('day'));

            return (
              <li
                key={entry.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  opacity: isBooked ? 0.85 : 1,
                  background: isBooked ? 'var(--surface-muted, #f8f9fa)' : undefined,
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
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
                    <div className="settings-muted" style={{ fontSize: '0.92rem' }}>
                      {patientPimsId ? (
                        <a href={evetPatientLink(patientPimsId)} target="_blank" rel="noreferrer">
                          {patientName}
                        </a>
                      ) : (
                        patientName
                      )}
                      <span> · </span>
                      {entry.appointmentTypeName?.trim() || 'Visit'}
                      <span> · </span>
                      {entry.monthsOut} mo out
                    </div>
                    <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 6 }}>
                      Target:{' '}
                      <span style={overdue && !isBooked ? { color: 'var(--danger, #c62828)' } : undefined}>
                        {formatTargetDue(entry.targetDueDate)}
                      </span>
                      <span> · Provider: {providerLabel(entry)}</span>
                    </div>
                    {bookingNotesDisplay(entry) ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Forward booking note: {bookingNotesDisplay(entry)}
                      </div>
                    ) : null}
                    {isBooked && entry.bookedAppointmentStart ? (
                      <div className="settings-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        Booked: {formatBookedVisit(entry.bookedAppointmentStart, entry.bookedAppointmentEnd, practiceTz)}
                        {entry.bookedBy ? (
                          <span> · Booked by: {employeeLabel(entry.bookedBy)}</span>
                        ) : null}
                      </div>
                    ) : null}
                    <label
                      style={{
                        display: 'block',
                        marginTop: 10,
                        fontSize: '0.88rem',
                        color: 'var(--text-muted, #64748b)',
                      }}
                    >
                      <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Queue note</span>
                      <textarea
                        className="settings-input"
                        rows={2}
                        style={{
                          width: '100%',
                          maxWidth: 480,
                          resize: 'vertical',
                          fontFamily: 'inherit',
                          fontSize: 13,
                        }}
                        value={noteDrafts[entry.id] ?? initialNote(entry)}
                        onChange={(e) => onNoteChange(entry.id, e.target.value)}
                        onBlur={(e) => void onNoteBlur(entry.id, e.currentTarget.value)}
                        placeholder="e.g. Call client in March"
                        aria-label={`Queue note for ${c.name}, ${patientName}`}
                        disabled={Boolean(noteSaving[entry.id])}
                      />
                      {noteSaving[entry.id] ? (
                        <span className="settings-muted" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                          Saving…
                        </span>
                      ) : null}
                      {noteError[entry.id] ? (
                        <span style={{ color: '#b91c1c', fontSize: 12, display: 'block', marginTop: 4 }}>
                          {noteError[entry.id]}
                        </span>
                      ) : null}
                    </label>
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
                    {isBooked ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => onViewAppointment(entry)}
                        disabled={!entry.bookedAppointmentStart}
                      >
                        View appointment
                      </button>
                    ) : (
                      <>
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
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {manualCompleteEntry ? (
        <ForwardBookingManualCompleteModal
          entry={manualCompleteEntry}
          onClose={() => setManualCompleteEntry(null)}
          onCompleted={mergeEntry}
        />
      ) : null}
    </div>
  );
}
