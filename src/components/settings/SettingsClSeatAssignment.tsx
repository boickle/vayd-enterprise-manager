import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchEmployeeRoles,
  fetchEmployeesByRole,
  type Employee,
  type EmployeeRole,
} from '../../api/appointmentSettings';
import {
  eachIsoDateInclusive,
  fetchClSeatAssignments,
  fetchClSeatDayOverrides,
  fetchClSeatPar,
  mergeClSeatDayOverrides,
  sundayWeekStartLocal,
  updateClSeatPar,
  upsertClSeatAssignments,
  type ClSeatDayOverride,
  type ClSeatParSettings,
} from '../../api/clSeatAssignments';
import { fetchClPerformanceAnalytics } from '../../api/clPerformanceAnalytics';
import {
  CL_SEAT_LABELS,
  type ClSeat,
} from '../../utils/clPoints';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

function todayLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function findReceptionistRoleId(roles: EmployeeRole[]): number | null {
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const byName = roles.find((r) => norm(r.name) === 'receptionist');
  if (byName) return byName.id;
  const byValue = roles.find((r) => norm(r.roleValue) === 'receptionist');
  if (byValue) return byValue.id;
  const fuzzy = roles.find((r) => norm(r.name).includes('receptionist'));
  return fuzzy?.id ?? null;
}

function formatWeekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startLabel = start.toLocaleDateString(undefined, opts);
  const endLabel = end.toLocaleDateString(undefined, {
    ...opts,
    year: 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDayHeader(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
}

const SEAT_OPTIONS: Array<{ value: ClSeat | ''; label: string }> = [
  { value: '', label: 'Unassigned' },
  { value: 'phones', label: CL_SEAT_LABELS.phones },
  { value: 'outreach', label: CL_SEAT_LABELS.outreach },
  { value: 'email', label: CL_SEAT_LABELS.email },
];

/** Cell value in the day-override grid: empty = use weekly default. */
type DayCellValue = '' | 'off' | ClSeat;

const DAY_CELL_OPTIONS: Array<{ value: DayCellValue; label: string }> = [
  { value: '', label: 'Default' },
  { value: 'off', label: 'OFF' },
  { value: 'phones', label: CL_SEAT_LABELS.phones },
  { value: 'outreach', label: CL_SEAT_LABELS.outreach },
  { value: 'email', label: CL_SEAT_LABELS.email },
];

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsClSeatAssignment({ practiceId, onMessage }: Props) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const [liaisons, setLiaisons] = useState<Employee[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [weekStart, setWeekStart] = useState(() =>
    sundayWeekStartLocal(new Date().toISOString().slice(0, 10))
  );
  /** employeeId → seat or '' */
  const [seatByEmployee, setSeatByEmployee] = useState<Record<number, ClSeat | ''>>({});
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [savingWeek, setSavingWeek] = useState(false);

  /** employeeId → date → DayCellValue ('' = no override / cleared) */
  const [dayOverrideDraft, setDayOverrideDraft] = useState<
    Record<number, Record<string, DayCellValue>>
  >({});
  const [allDayOverrides, setAllDayOverrides] = useState<ClSeatDayOverride[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(false);
  const [savingOverrides, setSavingOverrides] = useState(false);

  const [swapDate, setSwapDate] = useState('');
  const [swapA, setSwapA] = useState<number | ''>('');
  const [swapB, setSwapB] = useState<number | ''>('');
  const [swapFeedback, setSwapFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  const [seatPar, setSeatPar] = useState<ClSeatParSettings>({
    phones: 80,
    outreach: 140,
    email: 100,
  });
  const [loadingPar, setLoadingPar] = useState(true);
  const [savingPar, setSavingPar] = useState(false);
  const [suggestedPar, setSuggestedPar] = useState<ClSeatParSettings | null>(null);
  const [suggestedParMeta, setSuggestedParMeta] = useState<{
    startDate: string;
    endDate: string;
    workdays: Record<ClSeat, number>;
  } | null>(null);
  const [loadingSuggestedPar, setLoadingSuggestedPar] = useState(false);

  const weekLabel = useMemo(() => formatWeekLabel(weekStart), [weekStart]);
  const weekEnd = useMemo(() => addDaysIso(weekStart, 6), [weekStart]);
  const weekDates = useMemo(
    () => eachIsoDateInclusive(weekStart, weekEnd),
    [weekStart, weekEnd]
  );

  const loadRoster = useCallback(async () => {
    setLoadingRoster(true);
    setRosterError(null);
    try {
      const roles = await fetchEmployeeRoles();
      const roleId = findReceptionistRoleId(roles);
      if (roleId == null) {
        setLiaisons([]);
        setRosterError('No Receptionist (Client Liaison) role found.');
        return;
      }
      const emps = await fetchEmployeesByRole(roleId);
      const list = (Array.isArray(emps) ? emps : [])
        .filter((e) => e && !e.isDeleted && e.isActive !== false)
        .sort((a, b) =>
          formatEmployeeDisplayName(a).localeCompare(formatEmployeeDisplayName(b))
        );
      setLiaisons(list);
    } catch (e) {
      setRosterError(extractErr(e));
      setLiaisons([]);
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  const loadWeek = useCallback(async () => {
    setLoadingWeek(true);
    try {
      const res = await fetchClSeatAssignments(practiceId, weekStart);
      const map: Record<number, ClSeat | ''> = {};
      for (const row of res.assignments ?? []) {
        map[row.employeeId] = row.seat;
      }
      setSeatByEmployee(map);
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
      setSeatByEmployee({});
    } finally {
      setLoadingWeek(false);
    }
  }, [practiceId, weekStart]);

  const applyOverridesToDraft = useCallback(
    (overrides: ClSeatDayOverride[], dates: string[]) => {
      const dateSet = new Set(dates);
      const draft: Record<number, Record<string, DayCellValue>> = {};
      for (const o of overrides) {
        if (!dateSet.has(o.date)) continue;
        if (!draft[o.employeeId]) draft[o.employeeId] = {};
        draft[o.employeeId][o.date] = o.seat;
      }
      setDayOverrideDraft(draft);
      setSwapDate((prev) => {
        if (prev && dateSet.has(prev)) return prev;
        return (
          dates.find((d) => {
            const [y, m, dd] = d.split('-').map(Number);
            const dow = new Date(y, m - 1, dd).getDay();
            return dow >= 1 && dow <= 5;
          }) ??
          dates[1] ??
          dates[0] ??
          ''
        );
      });
    },
    []
  );

  const loadOverrides = useCallback(async () => {
    setLoadingOverrides(true);
    try {
      const list = await fetchClSeatDayOverrides(practiceId);
      setAllDayOverrides(list);
      applyOverridesToDraft(list, eachIsoDateInclusive(weekStart, addDaysIso(weekStart, 6)));
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
      setAllDayOverrides([]);
      setDayOverrideDraft({});
    } finally {
      setLoadingOverrides(false);
    }
  }, [practiceId, weekStart, applyOverridesToDraft]);

  const loadPar = useCallback(async () => {
    setLoadingPar(true);
    try {
      const par = await fetchClSeatPar(practiceId);
      setSeatPar(par);
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setLoadingPar(false);
    }
  }, [practiceId]);

  const loadSuggestedPar = useCallback(async () => {
    setLoadingSuggestedPar(true);
    try {
      const endDate = todayLocalIso();
      const startDate = addDaysIso(endDate, -29);
      const res = await fetchClPerformanceAnalytics({
        startDate,
        endDate,
        practiceId,
      });
      const next: ClSeatParSettings = {
        phones: res.seatPar.phones,
        outreach: res.seatPar.outreach,
        email: res.seatPar.email,
      };
      const workdays: Record<ClSeat, number> = {
        phones: 0,
        outreach: 0,
        email: 0,
      };
      let any = false;
      for (const row of res.seatAverages) {
        workdays[row.seat] = row.workdayCount;
        if (row.suggestedWeeklyPar != null) {
          next[row.seat] = row.suggestedWeeklyPar;
          any = true;
        }
      }
      setSuggestedPar(any ? next : null);
      setSuggestedParMeta(any ? { startDate, endDate, workdays } : null);
    } catch {
      setSuggestedPar(null);
      setSuggestedParMeta(null);
    } finally {
      setLoadingSuggestedPar(false);
    }
  }, [practiceId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    void loadPar();
  }, [loadPar]);

  useEffect(() => {
    void loadSuggestedPar();
  }, [loadSuggestedPar]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  const shiftWeek = (delta: number) => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta * 7);
    const next = sundayWeekStartLocal(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    );
    setWeekStart(next);
  };

  const onWeekInputChange = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setWeekStart(sundayWeekStartLocal(value));
  };

  const setSeat = (employeeId: number, seat: ClSeat | '') => {
    setSeatByEmployee((prev) => ({ ...prev, [employeeId]: seat }));
  };

  const setDayCell = (employeeId: number, date: string, value: DayCellValue) => {
    setDayOverrideDraft((prev) => {
      const nextEmp = { ...(prev[employeeId] ?? {}) };
      if (!value) {
        delete nextEmp[date];
      } else {
        nextEmp[date] = value;
      }
      return { ...prev, [employeeId]: nextEmp };
    });
  };

  /** Apply multiple day-cell edits in one state update (needed for swaps). */
  const setDayCells = (
    updates: Array<{ employeeId: number; date: string; value: DayCellValue }>
  ) => {
    setDayOverrideDraft((prev) => {
      const next = { ...prev };
      for (const { employeeId, date, value } of updates) {
        const nextEmp = { ...(next[employeeId] ?? {}) };
        if (!value) {
          delete nextEmp[date];
        } else {
          nextEmp[date] = value;
        }
        next[employeeId] = nextEmp;
      }
      return next;
    });
  };

  const effectiveSeatForDay = (employeeId: number, date: string): ClSeat | 'off' | null => {
    const ov = dayOverrideDraft[employeeId]?.[date];
    if (ov === 'off') return 'off';
    if (ov === 'phones' || ov === 'outreach' || ov === 'email') return ov;
    const weekly = seatByEmployee[employeeId];
    return weekly || null;
  };

  const handleSaveWeek = async () => {
    setSavingWeek(true);
    try {
      const assignments = liaisons.map((emp) => ({
        employeeId: emp.id,
        seat: (seatByEmployee[emp.id] || null) as ClSeat | null,
      }));
      const res = await upsertClSeatAssignments(practiceId, {
        weekStart,
        assignments,
      });
      const map: Record<number, ClSeat | ''> = {};
      for (const row of res.assignments ?? []) {
        map[row.employeeId] = row.seat;
      }
      setSeatByEmployee(map);
      onMessageRef.current?.(`Saved CL seats for ${formatWeekLabel(weekStart)}.`, 'success');
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setSavingWeek(false);
    }
  };

  const handleCopyFromPriorWeek = async () => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 7);
    const prior = sundayWeekStartLocal(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    );
    setLoadingWeek(true);
    try {
      const res = await fetchClSeatAssignments(practiceId, prior);
      const map: Record<number, ClSeat | ''> = {};
      for (const row of res.assignments ?? []) {
        map[row.employeeId] = row.seat;
      }
      setSeatByEmployee(map);
      onMessageRef.current?.(
        `Loaded seats from prior week (${formatWeekLabel(prior)}). Save to apply to this week.`,
        'success'
      );
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setLoadingWeek(false);
    }
  };

  const handleSaveDayOverrides = async () => {
    setSavingOverrides(true);
    try {
      const upsert: ClSeatDayOverride[] = [];
      const remove: Array<{ employeeId: number; date: string }> = [];
      const dateSet = new Set(weekDates);

      for (const emp of liaisons) {
        for (const date of weekDates) {
          const cell = dayOverrideDraft[emp.id]?.[date] ?? '';
          if (cell === 'off' || cell === 'phones' || cell === 'outreach' || cell === 'email') {
            upsert.push({ employeeId: emp.id, date, seat: cell });
          } else {
            const had = allDayOverrides.some(
              (o) => o.employeeId === emp.id && o.date === date
            );
            if (had) remove.push({ employeeId: emp.id, date });
          }
        }
      }

      // Also clear any leftover overrides for this week for employees no longer on roster
      for (const o of allDayOverrides) {
        if (!dateSet.has(o.date)) continue;
        if (liaisons.some((e) => e.id === o.employeeId)) continue;
        remove.push({ employeeId: o.employeeId, date: o.date });
      }

      const saved = await mergeClSeatDayOverrides(practiceId, { upsert, remove });
      setAllDayOverrides(saved);
      applyOverridesToDraft(saved, weekDates);
      const n = upsert.length;
      onMessageRef.current?.(
        n > 0
          ? `Saved ${n} day override${n === 1 ? '' : 's'} for ${formatWeekLabel(weekStart)}.`
          : `Cleared day overrides for ${formatWeekLabel(weekStart)}.`,
        'success'
      );
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setSavingOverrides(false);
    }
  };

  const handleApplySwap = () => {
    const fail = (text: string) => {
      setSwapFeedback({ kind: 'error', text });
      onMessageRef.current?.(text, 'error');
    };
    if (swapA === '' || swapB === '' || !swapDate) {
      fail('Pick a date and two Client Liaisons to swap.');
      return;
    }
    if (swapA === swapB) {
      fail('Choose two different people to swap.');
      return;
    }
    const empA = liaisons.find((e) => e.id === swapA);
    const empB = liaisons.find((e) => e.id === swapB);
    if (!empA || !empB) {
      fail('Could not find one of the selected Client Liaisons.');
      return;
    }
    const seatA = effectiveSeatForDay(swapA, swapDate);
    const seatB = effectiveSeatForDay(swapB, swapDate);
    if (seatA === 'off' || seatB === 'off') {
      fail('One of them is marked OFF that day. Clear OFF first, or set seats manually in the grid.');
      return;
    }
    if (!seatA || !seatB) {
      fail(
        'Both need a weekly seat before swapping. Set Seat this week above (and Save seat assignments), then try again — or pick seats in the day grid manually.'
      );
      return;
    }
    if (seatA === seatB) {
      fail(
        `${formatEmployeeDisplayName(empA)} and ${formatEmployeeDisplayName(empB)} are both on ${CL_SEAT_LABELS[seatA]} that day — nothing to swap.`
      );
      return;
    }
    setDayCells([
      { employeeId: swapA, date: swapDate, value: seatB },
      { employeeId: swapB, date: swapDate, value: seatA },
    ]);
    const text = `Drafted swap for ${formatDayHeader(swapDate)}: ${formatEmployeeDisplayName(empA)} → ${CL_SEAT_LABELS[seatB]}, ${formatEmployeeDisplayName(empB)} → ${CL_SEAT_LABELS[seatA]}. Click Save day overrides to persist.`;
    setSwapFeedback({ kind: 'success', text });
    onMessageRef.current?.(text, 'success');
  };

  const handleSavePar = async () => {
    setSavingPar(true);
    try {
      const saved = await updateClSeatPar(practiceId, seatPar);
      setSeatPar(saved);
      onMessageRef.current?.('Saved seat par targets.', 'success');
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setSavingPar(false);
    }
  };

  const seatCounts = useMemo(() => {
    const counts: Record<ClSeat | 'unassigned', number> = {
      phones: 0,
      outreach: 0,
      email: 0,
      unassigned: 0,
    };
    for (const emp of liaisons) {
      const seat = seatByEmployee[emp.id];
      if (seat === 'phones' || seat === 'outreach' || seat === 'email') {
        counts[seat] += 1;
      } else {
        counts.unassigned += 1;
      }
    }
    return counts;
  }, [liaisons, seatByEmployee]);

  const weekOverrideCount = useMemo(() => {
    let n = 0;
    for (const emp of liaisons) {
      for (const date of weekDates) {
        const cell = dayOverrideDraft[emp.id]?.[date];
        if (cell) n += 1;
      }
    }
    return n;
  }, [liaisons, weekDates, dayOverrideDraft]);

  const busy =
    loadingWeek || savingWeek || loadingOverrides || savingOverrides || loadingRoster;

  return (
    <div className="settings-section">
      <div className="settings-card" style={{ marginBottom: 24 }}>
        <h3 className="settings-card-title">Seat par (weekly targets)</h3>
        <p className="settings-muted" style={{ marginBottom: 16 }}>
          Normalized score = points ÷ seat par. 1.0 means on target for that rotating seat.
          Day offs and mid-week seat swaps prorate par (weekly ÷ 5 per workday). Adjust these when
          the competition targets change. Suggested values come from the last 30 days of actual
          points by seat (Analytics → CL Performance).
        </p>
        {loadingPar ? (
          <p className="settings-muted">Loading par…</p>
        ) : (
          <>
            <div className="settings-form-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {(['phones', 'outreach', 'email'] as ClSeat[]).map((seat) => (
                <div key={seat} className="settings-form-group">
                  <label htmlFor={`cl-par-${seat}`}>{CL_SEAT_LABELS[seat]} par</label>
                  <input
                    id={`cl-par-${seat}`}
                    type="number"
                    min={1}
                    step={1}
                    value={seatPar[seat]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setSeatPar((prev) => ({
                        ...prev,
                        [seat]: Number.isFinite(n) ? n : prev[seat],
                      }));
                    }}
                    style={{ width: 120 }}
                  />
                  {suggestedPar ? (
                    <p className="settings-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      30D avg ≈ {suggestedPar[seat]}
                      {suggestedParMeta
                        ? ` (${suggestedParMeta.workdays[seat]} person-days)`
                        : ''}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {loadingSuggestedPar ? (
              <p className="settings-muted" style={{ marginTop: 8 }}>
                Loading 30-day seat averages…
              </p>
            ) : suggestedPar && suggestedParMeta ? (
              <p className="settings-muted" style={{ marginTop: 8 }}>
                Trailing 30 days ({suggestedParMeta.startDate} → {suggestedParMeta.endDate}):
                weekly-equivalent average points by seat. Apply to use these as targets, then Save.
              </p>
            ) : (
              <p className="settings-muted" style={{ marginTop: 8 }}>
                No 30-day seat averages yet — assign weekly seats so points can be attributed by
                seat.
              </p>
            )}
            <div className="settings-action-bar">
              <button
                type="button"
                className="btn"
                onClick={() => void handleSavePar()}
                disabled={savingPar}
              >
                {savingPar ? 'Saving…' : 'Save seat par'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!suggestedPar || savingPar || loadingSuggestedPar}
                onClick={() => {
                  if (!suggestedPar) return;
                  setSeatPar(suggestedPar);
                  onMessageRef.current?.(
                    'Applied 30-day seat averages as par draft — click Save seat par to persist.',
                    'success'
                  );
                }}
              >
                Apply 30D averages
              </button>
            </div>
          </>
        )}
      </div>

      <div className="settings-card" style={{ marginBottom: 24 }}>
        <h3 className="settings-card-title">Weekly seat assignment</h3>
        <p className="settings-muted" style={{ marginBottom: 16 }}>
          Assign each Client Liaison to Phones, Outreach, or Email for the week (Sunday–Saturday).
          Used by Analytics → CL Performance for normalized scores. Use day overrides below for
          days off or one-day seat swaps (same idea as DPG schedule overrides).
        </p>

        <div
          className="settings-form-row"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}
        >
          <button type="button" className="btn secondary" onClick={() => shiftWeek(-1)}>
            ← Prior week
          </button>
          <div className="settings-form-group" style={{ margin: 0 }}>
            <label htmlFor="cl-week-start">Week of</label>
            <input
              id="cl-week-start"
              type="date"
              value={weekStart}
              onChange={(e) => onWeekInputChange(e.target.value)}
            />
          </div>
          <button type="button" className="btn secondary" onClick={() => shiftWeek(1)}>
            Next week →
          </button>
          <span className="settings-muted">{weekLabel}</span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void handleCopyFromPriorWeek()}
            disabled={busy}
          >
            Copy prior week
          </button>
        </div>

        <p className="settings-muted" style={{ marginBottom: 12 }}>
          Phones {seatCounts.phones} · Outreach {seatCounts.outreach} · Email {seatCounts.email}
          {seatCounts.unassigned > 0 ? ` · Unassigned ${seatCounts.unassigned}` : ''}
        </p>

        {loadingRoster ? (
          <p className="settings-muted">Loading Client Liaisons…</p>
        ) : rosterError ? (
          <p className="settings-error-message">{rosterError}</p>
        ) : liaisons.length === 0 ? (
          <p className="settings-muted">No active Receptionist-role employees found.</p>
        ) : (
          <div className="settings-table-container">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Client liaison</th>
                  <th>Email</th>
                  <th>Seat this week</th>
                </tr>
              </thead>
              <tbody>
                {liaisons.map((emp) => (
                  <tr key={emp.id}>
                    <td>{formatEmployeeDisplayName(emp)}</td>
                    <td className="settings-muted">{emp.email || '—'}</td>
                    <td>
                      <select
                        value={seatByEmployee[emp.id] ?? ''}
                        onChange={(e) =>
                          setSeat(emp.id, (e.target.value || '') as ClSeat | '')
                        }
                        disabled={busy}
                        aria-label={`Seat for ${formatEmployeeDisplayName(emp)}`}
                      >
                        {SEAT_OPTIONS.map((opt) => (
                          <option key={opt.value || 'none'} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="settings-action-bar">
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveWeek()}
            disabled={busy || liaisons.length === 0}
          >
            {savingWeek ? 'Saving…' : 'Save seat assignments'}
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Day overrides (off / seat swap)</h3>
        <p className="settings-muted" style={{ marginBottom: 16 }}>
          Override the weekly seat for a specific date — mark someone OFF (PTO) or put them on a
          different seat for the day. Same week as above ({weekLabel}). Default = weekly seat.
          Day offs reduce prorated par in CL Performance.
        </p>

        {liaisons.length > 0 && (
          <div
            className="settings-form-row cl-seat-swap-row"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'flex-end',
              marginBottom: 16,
              padding: '12px 14px',
              background: 'var(--settings-subtle-bg, #f6f7f5)',
              borderRadius: 8,
            }}
          >
            <div className="settings-form-group" style={{ margin: 0 }}>
              <label htmlFor="cl-swap-date">Swap seats for day</label>
              <select
                id="cl-swap-date"
                value={swapDate}
                onChange={(e) => {
                  setSwapDate(e.target.value);
                  setSwapFeedback(null);
                }}
                disabled={busy}
              >
                {weekDates.map((d) => (
                  <option key={d} value={d}>
                    {formatDayHeader(d)}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-form-group" style={{ margin: 0 }}>
              <label htmlFor="cl-swap-a">Person A</label>
              <select
                id="cl-swap-a"
                value={swapA === '' ? '' : String(swapA)}
                onChange={(e) => {
                  setSwapA(e.target.value ? Number(e.target.value) : '');
                  setSwapFeedback(null);
                }}
                disabled={busy}
              >
                <option value="">Select…</option>
                {liaisons.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {formatEmployeeDisplayName(emp)}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-form-group" style={{ margin: 0 }}>
              <label htmlFor="cl-swap-b">Person B</label>
              <select
                id="cl-swap-b"
                value={swapB === '' ? '' : String(swapB)}
                onChange={(e) => {
                  setSwapB(e.target.value ? Number(e.target.value) : '');
                  setSwapFeedback(null);
                }}
                disabled={busy}
              >
                <option value="">Select…</option>
                {liaisons.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {formatEmployeeDisplayName(emp)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn secondary"
              onClick={handleApplySwap}
              disabled={busy}
            >
              Draft swap
            </button>
            {swapFeedback && (
              <p
                className={
                  swapFeedback.kind === 'error'
                    ? 'settings-error-message'
                    : 'settings-success-message'
                }
                style={{ flexBasis: '100%', margin: '4px 0 0' }}
                role="status"
              >
                {swapFeedback.text}
              </p>
            )}
          </div>
        )}

        <p className="settings-muted" style={{ marginBottom: 12 }}>
          {loadingOverrides
            ? 'Loading day overrides…'
            : `${weekOverrideCount} override${weekOverrideCount === 1 ? '' : 's'} drafted this week`}
        </p>

        {loadingRoster ? null : rosterError ? null : liaisons.length === 0 ? null : (
          <div className="settings-table-container cl-seat-day-override-scroll">
            <table className="settings-table cl-seat-day-override-table">
              <thead>
                <tr>
                  <th>Client liaison</th>
                  {weekDates.map((d) => (
                    <th key={d}>{formatDayHeader(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {liaisons.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      <div>{formatEmployeeDisplayName(emp)}</div>
                      <div className="settings-muted" style={{ fontSize: '0.85em' }}>
                        Week: {seatByEmployee[emp.id]
                          ? CL_SEAT_LABELS[seatByEmployee[emp.id] as ClSeat]
                          : 'Unassigned'}
                      </div>
                    </td>
                    {weekDates.map((d) => {
                      const cell = dayOverrideDraft[emp.id]?.[d] ?? '';
                      const isOff = cell === 'off';
                      const isSeatChange = cell === 'phones' || cell === 'outreach' || cell === 'email';
                      return (
                        <td
                          key={d}
                          className={
                            isOff
                              ? 'cl-seat-day-cell cl-seat-day-cell--off'
                              : isSeatChange
                                ? 'cl-seat-day-cell cl-seat-day-cell--swap'
                                : 'cl-seat-day-cell'
                          }
                        >
                          <select
                            value={cell}
                            onChange={(e) =>
                              setDayCell(emp.id, d, e.target.value as DayCellValue)
                            }
                            disabled={busy}
                            aria-label={`Override for ${formatEmployeeDisplayName(emp)} on ${d}`}
                          >
                            {DAY_CELL_OPTIONS.map((opt) => (
                              <option key={opt.value || 'default'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="settings-action-bar">
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveDayOverrides()}
            disabled={busy || liaisons.length === 0}
          >
            {savingOverrides ? 'Saving…' : 'Save day overrides'}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setDayOverrideDraft({});
              onMessageRef.current?.(
                'Cleared draft for this week. Save day overrides to remove stored overrides.',
                'success'
              );
            }}
            disabled={busy || weekOverrideCount === 0}
          >
            Clear week draft
          </button>
        </div>
      </div>
    </div>
  );
}
