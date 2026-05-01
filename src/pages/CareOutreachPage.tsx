import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  fetchUnscheduledReminders,
  patchReminder,
  patchReminderOutreachNotes,
  type CareOutreachClientRef,
  type CareOutreachPatientRef,
  type UnscheduledReminder,
} from '../api/careOutreach';
import './Settings.css';
import { evetClientLink, evetPatientLink } from '../utils/evet';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const NOTES_DEBOUNCE_MS = 750;

type PriorityFilter = 'all' | 'overdue_today' | 'due_21';

const PRIORITY_TABS: { key: PriorityFilter; label: string; title?: string }[] = [
  { key: 'overdue_today', label: 'Newly overdue today' },
  {
    key: 'due_21',
    label: 'Due in 21 days',
    title:
      'Reminders due 21 calendar days from today. If that day is a Friday, Saturday and Sunday are included (21–23 days out).',
  },
  { key: 'all', label: 'All in range' },
];

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
  const clientPimsId =
    raw?.pimsId != null && String(raw.pimsId).trim() !== '' ? String(raw.pimsId).trim() : null;
  return {
    id: raw?.id ?? null,
    displayName: name || 'Unknown client',
    phone: raw?.phone1?.trim() || null,
    isMember,
    clientPimsId,
  };
}

const evetLinkStyle: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none',
  fontWeight: 'inherit',
};

function EvetInlineLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={evetLinkStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = 'underline';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = 'none';
      }}
    >
      {children}
    </a>
  );
}

function calendarDayDiffFromToday(dueIso: string | null | undefined): number | null {
  if (!dueIso) return null;
  const due = dayjs(dueIso).startOf('day');
  if (!due.isValid()) return null;
  return due.diff(dayjs().startOf('day'), 'day');
}

/**
 * "Due in 21 days" bucket: calendar day-diff from today to due date.
 * Anchor = today + 21 days. If that anchor is a Friday, include Sat/Sun too (diff 22 and 23).
 * dayjs: 0 Sun … 5 Fri, 6 Sat.
 */
function dayDiffsForDueIn21DayBucket(todayStart: dayjs.Dayjs): Set<number> {
  const anchor = todayStart.add(21, 'day');
  if (anchor.day() === 5) {
    return new Set([21, 22, 23]);
  }
  return new Set([21]);
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
  const any = r as Record<string, unknown>;
  const snake = typeof any.outreach_notes === 'string' ? any.outreach_notes : null;
  return (r.outreachNotes ?? snake ?? r.notes ?? '') || '';
}

function reminderIsHidden(r: UnscheduledReminder): boolean {
  const any = r as Record<string, unknown>;
  if (typeof any.is_hidden === 'boolean') return any.is_hidden;
  return r.isHidden === true;
}

function patientHasListableId(p: UnscheduledReminder['patient']): p is NonNullable<
  UnscheduledReminder['patient']
> & { id: number } {
  if (!p || typeof p !== 'object') return false;
  const id = (p as { id?: unknown }).id;
  return id != null && id !== '' && Number.isFinite(Number(id));
}

function employeeIsPresent(
  e: UnscheduledReminder['employee']
): e is NonNullable<UnscheduledReminder['employee']> {
  if (e == null || typeof e !== 'object') return false;
  return (
    (e as { id?: unknown }).id != null ||
    Boolean((e as { firstName?: string }).firstName) ||
    Boolean((e as { lastName?: string }).lastName)
  );
}

function clientPayloadHasIdentity(c: CareOutreachClientRef | null | undefined): boolean {
  if (!c || typeof c !== 'object') return false;
  if (c.id != null && Number.isFinite(Number(c.id))) return true;
  return Boolean(String(c.firstName ?? '').trim() || String(c.lastName ?? '').trim());
}

/** PIMS PATCH payloads often omit `employee` but include the assigned vet on `patient.primaryProvider`. */
function employeeFromPatientPrimary(
  patient: UnscheduledReminder['patient']
): UnscheduledReminder['employee'] {
  if (!patient || typeof patient !== 'object') return null;
  const raw = (patient as Record<string, unknown>).primaryProvider;
  if (!raw || typeof raw !== 'object') return null;
  if (!employeeIsPresent(raw as UnscheduledReminder['employee'])) return null;
  return raw as UnscheduledReminder['employee'];
}

function reminderAssignedProvider(r: UnscheduledReminder): UnscheduledReminder['employee'] {
  if (employeeIsPresent(r.employee)) return r.employee;
  return employeeFromPatientPrimary(r.patient);
}

/** Earliest due first (most overdue first), then provider, then service name. */
function compareRemindersForDisplay(a: UnscheduledReminder, b: UnscheduledReminder): number {
  const td = dueSortTime(a.dueDate) - dueSortTime(b.dueDate);
  if (td !== 0) return td;
  const pa = formatEmployeeName(reminderAssignedProvider(a));
  const pb = formatEmployeeName(reminderAssignedProvider(b));
  const pe = pa.localeCompare(pb, undefined, { sensitivity: 'base' });
  if (pe !== 0) return pe;
  return String(a.description ?? '').localeCompare(String(b.description ?? ''), undefined, {
    sensitivity: 'base',
  });
}

/**
 * PATCH often returns patient `{ id, name }` only. The list needs `clients` / `client` for
 * grouping, sort key, and phone — otherwise we show "Unknown client" and the card jumps to Z.
 */
function mergePatientForReminder(
  row: UnscheduledReminder,
  updated: UnscheduledReminder
): CareOutreachPatientRef | null {
  const rp = row.patient;
  const up = updated.patient;

  if (!patientHasListableId(up) && patientHasListableId(rp)) return rp;
  if (!patientHasListableId(up)) return (up ?? rp ?? null) as CareOutreachPatientRef | null;

  if (!patientHasListableId(rp) || Number(rp.id) !== Number(up.id)) {
    return up;
  }

  const mergedClients =
    Array.isArray(up.clients) && up.clients.length > 0 ? up.clients : rp.clients;
  const mergedClient = clientPayloadHasIdentity(up.client) ? up.client : (rp.client ?? null);

  return {
    ...rp,
    ...up,
    clients: mergedClients,
    client: mergedClient,
  };
}

/** PATCH responses are often partial; avoid clobbering list/navigation fields with nulls. */
function mergeReminderAfterPatch(
  row: UnscheduledReminder,
  updated: UnscheduledReminder
): UnscheduledReminder {
  const merged: UnscheduledReminder = { ...row, ...updated };
  merged.patient = mergePatientForReminder(row, updated);
  if (employeeIsPresent(updated.employee)) merged.employee = updated.employee;
  else if (employeeIsPresent(row.employee)) merged.employee = row.employee;
  else merged.employee = updated.employee ?? row.employee ?? null;
  if (!employeeIsPresent(merged.employee)) {
    merged.employee =
      employeeFromPatientPrimary(merged.patient) ??
      employeeFromPatientPrimary(row.patient) ??
      employeeFromPatientPrimary(updated.patient) ??
      merged.employee;
  }

  if (updated.dueDate == null && row.dueDate != null) merged.dueDate = row.dueDate;
  if (
    (updated.description == null || String(updated.description).trim() === '') &&
    row.description
  ) {
    merged.description = row.description;
  }
  if (updated.practice == null && row.practice != null) merged.practice = row.practice;

  const uAny = updated as Record<string, unknown>;
  const hiddenFromPatch =
    typeof uAny.is_hidden === 'boolean' ? (uAny.is_hidden as boolean) : undefined;
  const hiddenFromPatch2 = typeof updated.isHidden === 'boolean' ? updated.isHidden : undefined;
  if (hiddenFromPatch !== undefined) merged.isHidden = hiddenFromPatch;
  else if (hiddenFromPatch2 !== undefined) merged.isHidden = hiddenFromPatch2;
  else if (typeof row.isHidden === 'boolean') merged.isHidden = row.isHidden;
  else {
    const rAny = row as Record<string, unknown>;
    if (typeof rAny.is_hidden === 'boolean') merged.isHidden = rAny.is_hidden as boolean;
  }

  return merged;
}

export default function CareOutreachPage() {
  const [dueDateFrom, setDueDateFrom] = useState(() =>
    dayjs().subtract(2, 'month').format('YYYY-MM-DD')
  );
  const [dueDateTo, setDueDateTo] = useState(() => dayjs().add(2, 'month').format('YYYY-MM-DD'));
  const [priority, setPriority] = useState<PriorityFilter>('overdue_today');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UnscheduledReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [noteError, setNoteError] = useState<Record<number, string | null>>({});
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const [showHiddenReminders, setShowHiddenReminders] = useState(false);
  const [reminderHiddenSaving, setReminderHiddenSaving] = useState<Record<number, boolean>>({});
  const [reminderHiddenError, setReminderHiddenError] = useState<Record<number, string | null>>({});

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
      setReminderHiddenSaving({});
      setReminderHiddenError({});
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
    const todayStart = dayjs().startOf('day');
    const due21Allowed = dayDiffsForDueIn21DayBucket(todayStart);
    return rows.filter((r) => {
      if (priority === 'all') return true;
      const diff = calendarDayDiffFromToday(r.dueDate ?? null);
      if (diff === null) return false;
      if (priority === 'overdue_today') return diff === -1;
      if (priority === 'due_21') return due21Allowed.has(diff);
      return true;
    });
  }, [rows, priority]);

  const filteredByHidden = useMemo(
    () => filteredByPriority.filter((r) => showHiddenReminders || !reminderIsHidden(r)),
    [filteredByPriority, showHiddenReminders]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByHidden;
    return filteredByHidden.filter((r) => {
      const c = extractClient(r);
      const pet = r.patient?.name ?? '';
      const desc = r.description ?? '';
      const prov = formatEmployeeName(reminderAssignedProvider(r)).toLowerCase();
      const notes = (noteDrafts[r.id] ?? '').toLowerCase();
      const hay = [c.displayName, c.phone ?? '', pet, desc, prov, notes].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [filteredByHidden, search, noteDrafts]);

  const sortedForDisplay = useMemo(() => {
    return [...filtered].sort(compareRemindersForDisplay);
  }, [filtered]);

  type ClientBucket = {
    clientKey: string;
    clientId: number | null;
    clientPimsId: string | null;
    displayName: string;
    phone: string | null;
    isMember: boolean;
    patients: Map<
      number,
      {
        patientName: string;
        isMember: boolean;
        patientPimsId: string | null;
        reminders: UnscheduledReminder[];
      }
    >;
  };

  const grouped = useMemo(() => {
    const clients = new Map<string, ClientBucket>();
    for (const r of sortedForDisplay) {
      const c = extractClient(r);
      const clientKey = c.id != null ? `c-${c.id}` : `orphan-p-${r.patient?.id ?? r.id}`;
      let bucket = clients.get(clientKey);
      if (!bucket) {
        bucket = {
          clientKey,
          clientId: c.id,
          clientPimsId: c.clientPimsId,
          displayName: c.displayName,
          phone: c.phone,
          isMember: c.isMember,
          patients: new Map(),
        };
        clients.set(clientKey, bucket);
      }
      if (bucket.clientPimsId == null && c.clientPimsId) {
        bucket.clientPimsId = c.clientPimsId;
      }
      const pid = r.patient?.id;
      if (pid == null) continue;
      let pg = bucket.patients.get(pid);
      if (!pg) {
        const patientPimsId =
          r.patient?.pimsId != null && String(r.patient.pimsId).trim() !== ''
            ? String(r.patient.pimsId).trim()
            : null;
        pg = {
          patientName: r.patient?.name?.trim() || `Patient #${pid}`,
          isMember: Boolean(r.patient?.isMember || bucket.isMember),
          patientPimsId,
          reminders: [],
        };
        bucket.patients.set(pid, pg);
      }
      if (pg.patientPimsId == null) {
        const nextPims =
          r.patient?.pimsId != null && String(r.patient.pimsId).trim() !== ''
            ? String(r.patient.pimsId).trim()
            : null;
        if (nextPims) pg.patientPimsId = nextPims;
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
  }, [sortedForDisplay]);

  const flushSave = useCallback(async (reminderId: number, value: string) => {
    setNoteSaving((s) => ({ ...s, [reminderId]: true }));
    setNoteError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminderOutreachNotes(reminderId, value);
      let mergedForDraft: UnscheduledReminder | null = null;
      setRows((prev) => {
        const row = prev.find(
          (r) => Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
        );
        if (!row) return prev;
        mergedForDraft = mergeReminderAfterPatch(row, updated);
        return prev.map((r) =>
          Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
            ? mergedForDraft!
            : r
        );
      });
      if (mergedForDraft) {
        const draftSource = mergedForDraft;
        setNoteDrafts((d) => ({ ...d, [reminderId]: initialNotes(draftSource) }));
      }
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
    const server = rows.find(
      (r) => Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
    );
    const serverVal = server ? initialNotes(server) : '';
    if (value !== serverVal) {
      await flushSave(reminderId, value);
    }
  }

  const setReminderHidden = useCallback(async (reminderId: number, isHidden: boolean) => {
    setReminderHiddenSaving((s) => ({ ...s, [reminderId]: true }));
    setReminderHiddenError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminder(reminderId, { isHidden });
      setRows((prev) => {
        const row = prev.find(
          (r) => Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId)
        );
        if (!row) return prev;
        const mergedRow = mergeReminderAfterPatch(row, updated);
        setNoteDrafts((d) => ({ ...d, [reminderId]: initialNotes(mergedRow) }));
        return prev.map((r) =>
          Number(r.id) === Number(reminderId) || String(r.id) === String(reminderId) ? mergedRow : r
        );
      });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not update reminder';
      setReminderHiddenError((er) => ({ ...er, [reminderId]: String(msg) }));
    } finally {
      setReminderHiddenSaving((s) => ({ ...s, [reminderId]: false }));
    }
  }, []);

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
        {PRIORITY_TABS.map(({ key, label, title }) => (
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
            title={title}
            onClick={() => setPriority(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <input
            type="search"
            className="settings-input"
            placeholder="Search client, patient, phone, service, provider, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search outreach list"
            style={{ width: '100%' }}
          />
        </div>
        <label
          className="settings-muted"
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <input
            type="checkbox"
            checked={showHiddenReminders}
            onChange={(e) => setShowHiddenReminders(e.target.checked)}
          />
          <span>Show hidden reminders</span>
        </label>
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
                <strong style={{ fontSize: '1.05rem' }}>
                  {client.clientPimsId ? (
                    <EvetInlineLink href={evetClientLink(client.clientPimsId)}>
                      {client.displayName}
                    </EvetInlineLink>
                  ) : (
                    client.displayName
                  )}
                </strong>
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
                      {pg.patientPimsId ? (
                        <EvetInlineLink href={evetPatientLink(pg.patientPimsId)}>
                          {pg.patientName}
                        </EvetInlineLink>
                      ) : (
                        pg.patientName
                      )}
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
                            <th style={{ padding: '6px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Visibility
                            </th>
                            <th style={{ padding: '6px 16px', fontWeight: 600, minWidth: 220 }}>
                              Outreach notes
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pg.reminders.map((r) => {
                            const diff = calendarDayDiffFromToday(r.dueDate ?? null);
                            const overdue = diff !== null && diff < 0;
                            const hidden = reminderIsHidden(r);
                            return (
                              <tr
                                key={r.id}
                                style={{
                                  borderTop: '1px solid var(--border)',
                                  background: overdue ? '#fff5f5' : undefined,
                                }}
                              >
                                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                    <span>{r.description}</span>
                                    {hidden && showHiddenReminders && (
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          color: '#92400e',
                                          background: '#fef3c7',
                                          border: '1px solid #fbbf24',
                                          borderRadius: 4,
                                          padding: '2px 6px',
                                        }}
                                      >
                                        Hidden
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td
                                  style={{
                                    padding: '10px 8px',
                                    verticalAlign: 'top',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatEmployeeName(reminderAssignedProvider(r))}
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
                                <td style={{ padding: '10px 12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={Boolean(reminderHiddenSaving[r.id])}
                                    onClick={() => void setReminderHidden(r.id, !hidden)}
                                    style={{
                                      fontSize: 13,
                                      padding: '6px 12px',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {reminderHiddenSaving[r.id]
                                      ? 'Saving…'
                                      : hidden
                                        ? 'Unhide'
                                        : 'Hide'}
                                  </button>
                                  {reminderHiddenError[r.id] && (
                                    <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 6, maxWidth: 160 }}>
                                      {reminderHiddenError[r.id]}
                                    </div>
                                  )}
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
                                    value={noteDrafts[r.id] ?? initialNotes(r)}
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
