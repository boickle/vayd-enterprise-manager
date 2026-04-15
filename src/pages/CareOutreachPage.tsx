import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  fetchUnscheduledReminders,
  patchReminderOutreachNotes,
  type UnscheduledReminder,
} from '../api/careOutreach';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const NOTES_DEBOUNCE_MS = 750;

type PriorityFilter = 'all' | 'overdue_today' | 'due_22_26';

function formatEmployeeName(emp: UnscheduledReminder['employee']): string {
  if (!emp) return '—';
  const parts: string[] = [];
  if (emp.title) parts.push(String(emp.title));
  if (emp.firstName) parts.push(String(emp.firstName));
  if (emp.lastName) parts.push(String(emp.lastName));
  if (emp.designation) parts.push(String(emp.designation));
  const s = parts.join(' ').trim();
  return s || '—';
}

function extractClient(r: UnscheduledReminder) {
  const p = r.patient;
  const raw = p?.clients?.[0] ?? p?.client ?? null;
  const name =
    raw && (`${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim() || `Client #${raw.id}`);
  const isMember = Boolean(p?.isMember || raw?.isMember);
  return {
    id: raw?.id ?? null,
    displayName: name || 'Unknown client',
    phone: raw?.phone1?.trim() || null,
    isMember,
  };
}

function calendarDayDiffFromToday(dueIso: string | null | undefined): number | null {
  if (!dueIso) return null;
  const due = dayjs(dueIso).startOf('day');
  if (!due.isValid()) return null;
  return due.diff(dayjs().startOf('day'), 'day');
}

function dueSortTime(dueIso: string | null | undefined): number {
  if (!dueIso) return Number.MAX_SAFE_INTEGER;
  const t = new Date(dueIso).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function buildPhoneDialHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '#';
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const tpl = (import.meta.env.VITE_QUO_CALL_URL_TEMPLATE as string | undefined)?.trim();
  if (tpl && (tpl.includes('{e164}') || tpl.includes('{digits}'))) {
    return tpl.replace(/\{e164\}/g, encodeURIComponent(e164)).replace(/\{digits\}/g, digits);
  }
  // Quo (OpenPhone) and other apps commonly register for tel: when set as default calling app.
  return `tel:${e164}`;
}

function formatDisplayDate(iso: string | null | undefined): string {
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

function initialNotes(r: UnscheduledReminder): string {
  return (r.outreachNotes ?? r.notes ?? '') || '';
}

export default function CareOutreachPage() {
  const [dueDateFrom, setDueDateFrom] = useState(() =>
    dayjs().subtract(2, 'month').format('YYYY-MM-DD')
  );
  const [dueDateTo, setDueDateTo] = useState(() => dayjs().add(2, 'month').format('YYYY-MM-DD'));
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UnscheduledReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [noteError, setNoteError] = useState<Record<number, string | null>>({});
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchUnscheduledReminders({
        dueDateFrom,
        dueDateTo,
        practiceId: PRACTICE_ID,
        limit: 2000,
      });
      setRows(list);
      const drafts: Record<number, string> = {};
      for (const r of list) {
        drafts[r.id] = initialNotes(r);
      }
      setNoteDrafts(drafts);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to load unscheduled reminders';
      setError(String(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dueDateFrom, dueDateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredByPriority = useMemo(() => {
    return rows.filter((r) => {
      if (priority === 'all') return true;
      const diff = calendarDayDiffFromToday(r.dueDate ?? null);
      if (diff === null) return false;
      if (priority === 'overdue_today') return diff === -1;
      if (priority === 'due_22_26') return diff >= 22 && diff <= 26;
      return true;
    });
  }, [rows, priority]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByPriority;
    return filteredByPriority.filter((r) => {
      const c = extractClient(r);
      const pet = r.patient?.name ?? '';
      const desc = r.description ?? '';
      const prov = formatEmployeeName(r.employee).toLowerCase();
      const notes = (noteDrafts[r.id] ?? '').toLowerCase();
      const hay = [c.displayName, c.phone ?? '', pet, desc, prov, notes].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [filteredByPriority, search, noteDrafts]);

  type ClientBucket = {
    clientKey: string;
    clientId: number | null;
    displayName: string;
    phone: string | null;
    isMember: boolean;
    patients: Map<
      number,
      { patientName: string; isMember: boolean; reminders: UnscheduledReminder[] }
    >;
  };

  const grouped = useMemo(() => {
    const clients = new Map<string, ClientBucket>();
    for (const r of filtered) {
      const c = extractClient(r);
      const clientKey = c.id != null ? `c-${c.id}` : `orphan-p-${r.patient?.id ?? r.id}`;
      let bucket = clients.get(clientKey);
      if (!bucket) {
        bucket = {
          clientKey,
          clientId: c.id,
          displayName: c.displayName,
          phone: c.phone,
          isMember: c.isMember,
          patients: new Map(),
        };
        clients.set(clientKey, bucket);
      }
      const pid = r.patient?.id;
      if (pid == null) continue;
      let pg = bucket.patients.get(pid);
      if (!pg) {
        pg = {
          patientName: r.patient?.name?.trim() || `Patient #${pid}`,
          isMember: Boolean(r.patient?.isMember || bucket.isMember),
          reminders: [],
        };
        bucket.patients.set(pid, pg);
      }
      pg.reminders.push(r);
    }
    for (const b of clients.values()) {
      for (const pg of b.patients.values()) {
        pg.reminders.sort((a, b) => dueSortTime(a.dueDate) - dueSortTime(b.dueDate));
      }
    }
    const list = Array.from(clients.values());
    list.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );
    for (const b of list) {
      const parr = Array.from(b.patients.entries()).sort(([, pa], [, pb]) =>
        pa.patientName.localeCompare(pb.patientName, undefined, { sensitivity: 'base' })
      );
      b.patients = new Map(parr);
    }
    return list;
  }, [filtered]);

  const flushSave = useCallback(async (reminderId: number, value: string) => {
    setNoteSaving((s) => ({ ...s, [reminderId]: true }));
    setNoteError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminderOutreachNotes(reminderId, value);
      setRows((prev) => prev.map((row) => (row.id === reminderId ? { ...row, ...updated } : row)));
      setNoteDrafts((d) => ({
        ...d,
        [reminderId]: initialNotes(updated),
      }));
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not save notes';
      setNoteError((er) => ({ ...er, [reminderId]: String(msg) }));
    } finally {
      setNoteSaving((s) => ({ ...s, [reminderId]: false }));
    }
  }, []);

  const scheduleSave = useCallback(
    (reminderId: number, value: string) => {
      const prevTimer = debounceTimers.current.get(reminderId);
      if (prevTimer) clearTimeout(prevTimer);
      const t = setTimeout(() => {
        debounceTimers.current.delete(reminderId);
        void flushSave(reminderId, value);
      }, NOTES_DEBOUNCE_MS);
      debounceTimers.current.set(reminderId, t);
    },
    [flushSave]
  );

  useEffect(() => {
    const timerMap = debounceTimers.current;
    return () => {
      for (const t of timerMap.values()) {
        clearTimeout(t);
      }
      timerMap.clear();
    };
  }, []);

  function onNotesChange(reminderId: number, value: string) {
    setNoteDrafts((d) => ({ ...d, [reminderId]: value }));
    scheduleSave(reminderId, value);
  }

  async function onNotesBlur(reminderId: number, valueFromDom: string) {
    const t = debounceTimers.current.get(reminderId);
    if (t) {
      clearTimeout(t);
      debounceTimers.current.delete(reminderId);
    }
    const value = valueFromDom;
    setNoteDrafts((d) => ({ ...d, [reminderId]: value }));
    const server = rows.find((r) => r.id === reminderId);
    const serverVal = server ? initialNotes(server) : '';
    if (value !== serverVal) {
      await flushSave(reminderId, value);
    }
  }

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Care outreach
      </h2>
      <p className="settings-muted" style={{ marginBottom: 16, maxWidth: 800 }}>
        Clients and patients who still need preventive or recommended care scheduled with their
        assigned provider. Reminders disappear from this list once a future appointment exists with
        that provider.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <span className="settings-muted" style={{ marginRight: 4 }}>
          Due between
        </span>
        <input
          type="date"
          value={dueDateFrom}
          onChange={(e) => setDueDateFrom(e.target.value)}
          className="settings-input"
          style={{ maxWidth: 160 }}
        />
        <span className="settings-muted">and</span>
        <input
          type="date"
          value={dueDateTo}
          onChange={(e) => setDueDateTo(e.target.value)}
          className="settings-input"
          style={{ maxWidth: 160 }}
        />
        <button
          type="button"
          className="btn primary"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span className="settings-muted" style={{ alignSelf: 'center', marginRight: 4 }}>
          Daily priorities
        </span>
        {(
          [
            ['all', 'All in range'],
            ['overdue_today', 'Newly overdue today'],
            ['due_22_26', 'Due in 22–26 days'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`settings-tab${priority === key ? ' active' : ''}`}
            style={{
              marginBottom: 0,
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 14px',
            }}
            onClick={() => setPriority(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <input
          type="search"
          className="settings-input"
          placeholder="Search client, patient, phone, service, provider, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search outreach list"
        />
      </div>

      {error && (
        <p className="settings-muted" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="settings-loading">
          <span className="settings-spinner" aria-hidden />
          Loading reminders…
        </div>
      ) : grouped.length === 0 ? (
        <p className="settings-muted">No reminders match the current filters.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {grouped.map((client) => (
            <section
              key={client.clientKey}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--panel, #fff)',
              }}
            >
              <header
                style={{
                  padding: '12px 16px',
                  background: 'var(--subtle-bg, #f4f6f8)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'baseline',
                }}
              >
                <strong style={{ fontSize: '1.05rem' }}>{client.displayName}</strong>
                {client.phone ? (
                  <a
                    href={buildPhoneDialHref(client.phone)}
                    style={{ fontWeight: 600, color: 'var(--accent-strong, #2563eb)' }}
                  >
                    {client.phone}
                  </a>
                ) : (
                  <span className="settings-muted">No phone on file</span>
                )}
              </header>
              <div style={{ padding: '8px 0' }}>
                {Array.from(client.patients.entries()).map(([patientId, pg]) => (
                  <div key={patientId} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        padding: '8px 16px 4px',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {pg.patientName}
                      {pg.isMember ? ' ❤️' : ''}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: 14,
                        }}
                      >
                        <thead>
                          <tr className="settings-muted" style={{ textAlign: 'left' }}>
                            <th style={{ padding: '6px 16px', fontWeight: 600 }}>Service</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Provider</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Due</th>
                            <th style={{ padding: '6px 16px', fontWeight: 600, minWidth: 220 }}>
                              Outreach notes
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pg.reminders.map((r) => {
                            const diff = calendarDayDiffFromToday(r.dueDate ?? null);
                            const overdue = diff !== null && diff < 0;
                            return (
                              <tr
                                key={r.id}
                                style={{
                                  borderTop: '1px solid var(--border)',
                                  background: overdue ? '#fff5f5' : undefined,
                                }}
                              >
                                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                                  {r.description}
                                </td>
                                <td
                                  style={{
                                    padding: '10px 8px',
                                    verticalAlign: 'top',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatEmployeeName(r.employee)}
                                </td>
                                <td
                                  style={{
                                    padding: '10px 8px',
                                    verticalAlign: 'top',
                                    fontWeight: overdue ? 700 : 400,
                                    color: overdue ? '#b91c1c' : undefined,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatDisplayDate(r.dueDate ?? undefined)}
                                </td>
                                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                                  <textarea
                                    className="settings-input"
                                    rows={2}
                                    style={{
                                      width: '100%',
                                      minWidth: 200,
                                      resize: 'vertical',
                                      fontFamily: 'inherit',
                                      fontSize: 13,
                                    }}
                                    value={noteDrafts[r.id] ?? ''}
                                    onChange={(e) => onNotesChange(r.id, e.target.value)}
                                    onBlur={(e) => void onNotesBlur(r.id, e.currentTarget.value)}
                                    placeholder="e.g. 11/14/2026 DF – LMOM"
                                    aria-label={`Outreach notes for ${r.description}`}
                                  />
                                  {noteSaving[r.id] && (
                                    <span className="settings-muted" style={{ fontSize: 12 }}>
                                      Saving…
                                    </span>
                                  )}
                                  {noteError[r.id] && (
                                    <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>
                                      {noteError[r.id]}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
