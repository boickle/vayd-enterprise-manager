import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { DateTime } from 'luxon';
import { fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { ClientContactComposeModal } from './ClientContactComposeModal';
import { useScheduleOptimizeQueue } from '../hooks/useScheduleOptimizeQueue';
import { useScheduleOptimizeMoveMeta } from '../hooks/useScheduleOptimizeMoveMeta';
import type { DayData } from '../pages/MyWeek';
import type { AppointmentTypeCatalog } from '../utils/appointmentTypeSettings';
import { careOutreachClientHasSmsPhone } from '../utils/careOutreachSmsMessage';
import { formatPointsPerDriveHour } from '../utils/pointsPerDriveHour';
import {
  buildOptimizeBaseline,
  optimizeWindowDates,
  type OptimizeBaseline,
  type OptimizeWindowMode,
} from '../utils/scheduleOptimize';
import { beginScheduleOptimizeApplyInCalendar, openScheduleOptimizeCurrentAppointment } from '../utils/scheduleOptimizeCalendarPreview';
import {
  addScheduleOptimizeToQueue,
  hideScheduleOptimizeSuggestion,
  markScheduleOptimizeQueueTexted,
  updateScheduleOptimizeQueueNotes,
} from '../utils/scheduleOptimizeQueue';
import {
  setScheduleOptimizeMoveHidden,
} from '../utils/scheduleOptimizeMoveMeta';
import {
  formatOptimizeResimulateWarning,
  revalidateOptimizeMove,
  validateOptimizeMoves,
  type OptimizeMove,
} from '../utils/scheduleOptimizeMoves';
import { buildScheduleOptimizeSmsMessage } from '../utils/scheduleOptimizeSmsMessage';
import { fetchSchedulerDriveContextForDate } from '../utils/schedulerDriveEta';
import '../pages/Scheduler.css';

type Props = {
  open: boolean;
  onClose: () => void;
  doctorId: string;
  doctorName: string;
  practiceTz: string;
  practiceId: number;
  typeCatalog: AppointmentTypeCatalog;
  /** Sunday–Saturday ISO dates of the week on the calendar. */
  weekDates: string[];
};

function formatDayLabel(dateIso: string, practiceTz: string): string {
  const dt = DateTime.fromISO(dateIso, { zone: practiceTz });
  return dt.isValid ? dt.toFormat('ccc M/d') : dateIso;
}

function formatPoints(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatRangeLabel(dates: string[], practiceTz: string): string {
  if (dates.length === 0) return '';
  const first = DateTime.fromISO(dates[0]!, { zone: practiceTz });
  const last = DateTime.fromISO(dates[dates.length - 1]!, { zone: practiceTz });
  if (!first.isValid || !last.isValid) return `${dates[0]} – ${dates[dates.length - 1]}`;
  return `${first.toFormat('ccc, LLL d')} – ${last.toFormat('ccc, LLL d, yyyy')}`;
}

function driveSavedLabel(deltaMin: number): string {
  const n = Math.abs(deltaMin);
  return deltaMin < 0 ? `Saves ${n} min drive` : `Adds ${n} min drive`;
}

type OptimizeMoveTab = 'all' | 'day' | 'week' | 'weeks2' | 'hidden';

const NOTES_DEBOUNCE_MS = 400;

function isFirstWeekMove(m: OptimizeMove, week1: Set<string>): boolean {
  return week1.has(m.fromDate) && week1.has(m.toDate);
}

function rankByDriveSaved(a: OptimizeMove, b: OptimizeMove): number {
  if (a.driveDeltaMin !== b.driveDeltaMin) return a.driveDeltaMin - b.driveDeltaMin;
  return a.client.localeCompare(b.client);
}

function partitionOptimizeMoves(moves: OptimizeMove[], dates: string[]) {
  const week1 = new Set(dates.slice(0, Math.min(7, dates.length)));
  const day = moves.filter((m) => m.scope === 'day').sort(rankByDriveSaved);
  const week = moves
    .filter((m) => m.scope === 'week' && isFirstWeekMove(m, week1))
    .sort(rankByDriveSaved);
  const weeks2 = moves
    .filter((m) => m.scope === 'week' && !isFirstWeekMove(m, week1))
    .sort(rankByDriveSaved);
  const all = [...moves].sort(rankByDriveSaved);
  return { all, day, week, weeks2 };
}

function tabCountLabel(n: number): string {
  return ` (${n})`;
}

function timeWithWindow(timeLabel: string, windowLabel?: string | null): string {
  const time = timeLabel.trim() || '—';
  const win = windowLabel?.trim();
  return win ? `${time} ${win}` : time;
}

export function SchedulerOptimizeModal({
  open,
  onClose,
  doctorId,
  doctorName,
  practiceTz,
  practiceId,
  typeCatalog,
  weekDates,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<OptimizeBaseline | null>(null);
  const [searchingMoves, setSearchingMoves] = useState(false);
  const [moves, setMoves] = useState<OptimizeMove[]>([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [contactMove, setContactMove] = useState<OptimizeMove | null>(null);
  const [smsFromLine, setSmsFromLine] = useState<string | null>(null);
  const [moveTab, setMoveTab] = useState<OptimizeMoveTab>('all');
  const [windowMode, setWindowMode] = useState<OptimizeWindowMode>('rolling');
  const [pendingWorse, setPendingWorse] = useState<{
    kind: 'apply' | 'text';
    live: OptimizeMove;
    warning: string;
  } | null>(null);
  const queueItems = useScheduleOptimizeQueue(practiceId);
  const moveMeta = useScheduleOptimizeMoveMeta(practiceId);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [notesSaving, setNotesSaving] = useState<Record<string, boolean>>({});
  const notesTimers = useRef<Record<string, number>>({});
  const lastStoredNotes = useRef<Record<string, string>>({});
  const weekDatesKey = useMemo(() => weekDates.join(','), [weekDates]);
  const typeCatalogRef = useRef(typeCatalog);
  typeCatalogRef.current = typeCatalog;

  useEffect(() => {
    if (!open) return;
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setSmsFromLine(phone);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const load = useCallback(async () => {
    if (!doctorId.trim()) return;
    const todayIso = DateTime.now().setZone(practiceTz).toISODate();
    if (!todayIso) return;
    const dates = weekDatesKey.split(',').filter(Boolean);
    const { dates: windowDates, mode } = optimizeWindowDates(
      dates,
      todayIso,
      practiceTz,
      2
    );
    setWindowMode(mode);
    if (windowDates.length === 0) {
      setBaseline(null);
      setMoves([]);
      setLoadError(
        'This week is already in the past. Open this week or a future week to optimize.'
      );
      setLoading(false);
      setSearchingMoves(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setBaseline(null);
    setMoves([]);
    setApplyError(null);
    setSearchingMoves(false);

    const nextDays = new Map<string, DayData | null>();
    const errors = new Map<string, string>();
    await Promise.all(
      windowDates.map(async (date) => {
        try {
          const r = await fetchSchedulerDriveContextForDate(date, doctorId);
          nextDays.set(date, r?.dayData ?? null);
        } catch (e) {
          const msg =
            (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            (e as Error)?.message ??
            'Could not load this day';
          errors.set(date, String(msg));
          nextDays.set(date, null);
        }
      })
    );

    const nextBaseline = buildOptimizeBaseline(
      windowDates,
      nextDays,
      typeCatalogRef.current,
      errors
    );
    setBaseline(nextBaseline);
    if (errors.size === windowDates.length) {
      setLoadError('Could not load this week for this doctor.');
      setLoading(false);
      return;
    }
    setLoading(false);

    setSearchingMoves(true);
    try {
      const found = await validateOptimizeMoves({
        doctorId,
        practiceTz,
        dates: windowDates,
        dayByDate: nextDays,
        baseline: nextBaseline,
        typeCatalog: typeCatalogRef.current,
      });
      setMoves(found);
    } catch (e) {
      setMoves([]);
      setApplyError(
        (e as Error)?.message?.trim() || 'Could not search for better days.'
      );
    } finally {
      setSearchingMoves(false);
    }
  }, [doctorId, practiceTz, weekDatesKey]);

  useEffect(() => {
    if (!open || !doctorId.trim()) return;
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [open, doctorId, load]);

  const hiddenIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of moveMeta) {
      if (row.hidden) set.add(row.id);
    }
    return set;
  }, [moveMeta]);

  const hiddenMoves = useMemo(() => {
    const liveById = new Map(moves.map((m) => [m.id, m]));
    const out: OptimizeMove[] = [];
    const seen = new Set<string>();
    for (const row of moveMeta) {
      if (!row.hidden) continue;
      if (row.doctorId && row.doctorId !== doctorId && !liveById.has(row.id)) continue;
      const move = liveById.get(row.id) ?? row.move;
      if (!move || seen.has(move.id)) continue;
      seen.add(move.id);
      out.push(move);
    }
    return out.sort(rankByDriveSaved);
  }, [moveMeta, moves, doctorId]);

  const staleHiddenIds = useMemo(() => {
    const live = new Set(moves.map((m) => m.id));
    return new Set(hiddenMoves.filter((m) => !live.has(m.id)).map((m) => m.id));
  }, [hiddenMoves, moves]);

  const storedNotesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of moveMeta) map.set(row.id, row.notes);
    for (const row of queueItems) map.set(row.id, row.notes);
    return map;
  }, [moveMeta, queueItems]);

  useEffect(() => {
    setNotesDraft((prev) => {
      const next = { ...prev };
      const ids = new Set<string>([
        ...moves.map((m) => m.id),
        ...hiddenMoves.map((m) => m.id),
        ...storedNotesById.keys(),
      ]);
      for (const id of ids) {
        const stored = storedNotesById.get(id) ?? '';
        const last = lastStoredNotes.current[id];
        const draft = next[id];
        if (draft == null || last == null || draft === last) {
          next[id] = stored;
        }
        lastStoredNotes.current[id] = stored;
      }
      return next;
    });
  }, [storedNotesById, moves, hiddenMoves]);

  function flushNotes(id: string) {
    if (notesTimers.current[id]) {
      window.clearTimeout(notesTimers.current[id]);
      delete notesTimers.current[id];
    }
    updateScheduleOptimizeQueueNotes(practiceId, id, notesDraft[id] ?? '');
  }

  function scheduleNotesSave(id: string, value: string) {
    setNotesDraft((prev) => ({ ...prev, [id]: value }));
    if (notesTimers.current[id]) window.clearTimeout(notesTimers.current[id]);
    notesTimers.current[id] = window.setTimeout(() => {
      setNotesSaving((prev) => ({ ...prev, [id]: true }));
      updateScheduleOptimizeQueueNotes(practiceId, id, value);
      window.setTimeout(() => {
        setNotesSaving((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 250);
    }, NOTES_DEBOUNCE_MS);
  }

  function unhideMove(move: OptimizeMove) {
    if (!hiddenIds.has(move.id)) return;
    setScheduleOptimizeMoveHidden({
      practiceId,
      move,
      doctorId,
      doctorName,
      hidden: false,
    });
  }

  function onHideMove(move: OptimizeMove) {
    setApplyError(null);
    flushNotes(move.id);
    hideScheduleOptimizeSuggestion({
      practiceId,
      move,
      doctorId,
      doctorName,
    });
  }

  async function applyLiveMove(live: OptimizeMove) {
    setApplyingId(live.id);
    setApplyError(null);
    try {
      unhideMove(live);
      flushNotes(live.id);
      const queued = addScheduleOptimizeToQueue({ move: live, practiceId, doctorId, doctorName });
      const result = await beginScheduleOptimizeApplyInCalendar({
        move: live,
        doctorId,
        doctorName,
        practiceId,
        practiceTz,
        navigate,
        returnPath: '/schedule/scheduler',
        queueItemId: queued.id,
      });
      if (!result.ok) {
        setApplyError(result.reason);
        return;
      }
      onClose();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not open this visit on the calendar.';
      setApplyError(String(msg));
    } finally {
      setApplyingId(null);
    }
  }

  async function resimulateThen(move: OptimizeMove, kind: 'apply' | 'text'): Promise<void> {
    setPendingWorse(null);
    setApplyingId(move.id);
    setApplyError(null);
    try {
      const result = await revalidateOptimizeMove({
        move,
        doctorId,
        practiceTz,
        typeCatalog: typeCatalogRef.current,
      });
      if (!result.live) {
        setApplyError(result.unavailableReason || 'This suggestion is no longer valid.');
        return;
      }
      addScheduleOptimizeToQueue({ move: result.live, practiceId, doctorId, doctorName });
      unhideMove(move);
      unhideMove(result.live);
      if (result.driveWorse || result.windowWorse) {
        setPendingWorse({
          kind,
          live: result.live,
          warning:
            formatOptimizeResimulateWarning(move, result.live) ??
            'This suggestion is worse than when it was simulated. Continue anyway?',
        });
        return;
      }
      if (kind === 'apply') {
        await applyLiveMove(result.live);
        return;
      }
      setContactMove(result.live);
    } catch (e) {
      setApplyError((e as Error)?.message?.trim() || 'Could not re-check this suggestion.');
    } finally {
      setApplyingId(null);
    }
  }

  async function onApply(move: OptimizeMove) {
    await resimulateThen(move, 'apply');
  }

  function onViewCurrent(move: OptimizeMove) {
    const queued = addScheduleOptimizeToQueue({ move, practiceId, doctorId, doctorName });
    const ok = openScheduleOptimizeCurrentAppointment({
      move,
      fromDate: move.fromDate,
      doctorId,
      doctorName,
      practiceId,
      queueItemId: queued.id,
      navigate,
      returnHref: '/schedule/scheduler',
      reopenModal: true,
    });
    if (!ok) {
      setApplyError('This suggestion is missing a current appointment to open.');
      return;
    }
    onClose();
  }

  function onAddToList(move: OptimizeMove) {
    setApplyError(null);
    flushNotes(move.id);
    unhideMove(move);
    addScheduleOptimizeToQueue({ move, practiceId, doctorId, doctorName });
  }

  if (!open) return null;

  const outlierCount = baseline?.days.reduce((n, d) => n + d.outliers.length, 0) ?? 0;
  const lowPpdhCount = baseline?.days.filter((d) => d.lowPpdh).length ?? 0;
  const buckets = partitionOptimizeMoves(
    moves.filter((m) => !hiddenIds.has(m.id)),
    baseline?.dates ?? []
  );
  const showingHidden = moveTab === 'hidden';
  const visibleMoves =
    showingHidden
      ? hiddenMoves
      : moveTab === 'day'
        ? buckets.day
        : moveTab === 'week'
          ? buckets.week
          : moveTab === 'weeks2'
            ? buckets.weeks2
            : buckets.all;

  return (
    <>
      {createPortal(
        <div
          className="scheduler-modal-backdrop"
          role="presentation"
          onMouseDown={onClose}
        >
      <div
        className="scheduler-modal scheduler-optimize-modal"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-optimize-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">
              <span className="scheduler-modal-eyebrow-type">Optimize</span>
            </p>
            <h2 id="scheduler-optimize-title" className="scheduler-modal-title-h">
              {doctorName || 'Doctor'}
            </h2>
            <p className="scheduler-modal-subtitle">
              {windowMode === 'rolling'
                ? 'Next 14 days, not including today'
                : 'This week and next'}
              {baseline ? ` · ${formatRangeLabel(baseline.dates, practiceTz)}` : ''}
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-optimize-body">
          {loading ? (
            <p className="scheduler-optimize-status">
              {windowMode === 'rolling'
                ? 'Loading drive times for the next 14 days…'
                : 'Loading drive times for this week and next…'}
            </p>
          ) : loadError ? (
            <p className="scheduler-optimize-error" role="alert">
              {loadError}
            </p>
          ) : baseline ? (
            <>
              <div className="scheduler-optimize-stats">
                <div>
                  <div className="scheduler-optimize-stat-value">{formatPoints(baseline.totalPoints)}</div>
                  <div className="scheduler-optimize-stat-label">Points</div>
                </div>
                <div>
                  <div className="scheduler-optimize-stat-value">{baseline.totalDriveMin} min</div>
                  <div className="scheduler-optimize-stat-label">Drive</div>
                </div>
                <div>
                  <div className="scheduler-optimize-stat-value">
                    {formatPointsPerDriveHour(baseline.ppdh, 2)}
                  </div>
                  <div className="scheduler-optimize-stat-label">Points / drive hour</div>
                </div>
              </div>

              <p className="scheduler-optimize-note">
                Moves keep every visit and only keep a suggestion when the new day cuts week drive by at least 5 minutes.
                {outlierCount > 0 || lowPpdhCount > 0
                  ? ` ${outlierCount} geographic outlier${outlierCount === 1 ? '' : 's'}, ${lowPpdhCount} low-PPDH day${lowPpdhCount === 1 ? '' : 's'}.`
                  : ''}
              </p>

              <div className="scheduler-optimize-table-wrap">
                <table className="scheduler-optimize-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Status</th>
                      <th className="scheduler-optimize-num">Stops</th>
                      <th className="scheduler-optimize-num">Points</th>
                      <th className="scheduler-optimize-num">Drive</th>
                      <th className="scheduler-optimize-num">PPDH</th>
                      <th>Outliers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baseline.days.map((row) => {
                      const highlight = row.outliers.length > 0 || row.lowPpdh;
                      return (
                        <tr
                          key={row.date}
                          className={
                            highlight
                              ? 'scheduler-optimize-row--warn'
                              : row.isOff
                                ? 'scheduler-optimize-row--off'
                                : undefined
                          }
                        >
                          <td>{formatDayLabel(row.date, practiceTz)}</td>
                          <td>
                            {row.error ? 'Error' : row.isOff ? 'Off' : 'Work'}
                          </td>
                          <td className="scheduler-optimize-num">{row.stopCount}</td>
                          <td className="scheduler-optimize-num">{formatPoints(row.points)}</td>
                          <td className="scheduler-optimize-num">
                            {row.driveMin > 0 ? `${row.driveMin} min` : '—'}
                          </td>
                          <td className="scheduler-optimize-num">
                            {formatPointsPerDriveHour(row.ppdh, 2)}
                            {row.lowPpdh ? (
                              <span className="scheduler-optimize-tag">low</span>
                            ) : null}
                          </td>
                          <td>
                            {row.error ? (
                              <span className="scheduler-optimize-error-inline">{row.error}</span>
                            ) : row.outliers.length === 0 ? (
                              '—'
                            ) : (
                              <ul className="scheduler-optimize-outlier-list">
                                {row.outliers.map((o) => (
                                  <li key={`${row.date}-${o.client}-${o.hopMin}`}>
                                    {o.client}
                                    <span className="scheduler-optimize-hop"> {o.hopMin} min hop</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="scheduler-optimize-moves">
                <div className="scheduler-optimize-moves-head">
                  <h3 className="scheduler-optimize-moves-title">
                    {showingHidden ? 'Hidden moves' : 'Recommended moves'}
                  </h3>
                  <div className="scheduler-optimize-scope" role="tablist" aria-label="Move type">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={moveTab === 'all'}
                      className={`scheduler-optimize-scope-btn${moveTab === 'all' ? ' is-active' : ''}`}
                      onClick={() => setMoveTab('all')}
                    >
                      All{tabCountLabel(buckets.all.length)}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={moveTab === 'day'}
                      className={`scheduler-optimize-scope-btn${moveTab === 'day' ? ' is-active' : ''}`}
                      onClick={() => setMoveTab('day')}
                    >
                      Day{tabCountLabel(buckets.day.length)}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={moveTab === 'week'}
                      className={`scheduler-optimize-scope-btn${moveTab === 'week' ? ' is-active' : ''}`}
                      onClick={() => setMoveTab('week')}
                    >
                      Week{tabCountLabel(buckets.week.length)}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={moveTab === 'weeks2'}
                      className={`scheduler-optimize-scope-btn${moveTab === 'weeks2' ? ' is-active' : ''}`}
                      onClick={() => setMoveTab('weeks2')}
                    >
                      2 weeks{tabCountLabel(buckets.weeks2.length)}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={showingHidden}
                      className={`scheduler-optimize-scope-btn${showingHidden ? ' is-active' : ''}`}
                      onClick={() => setMoveTab('hidden')}
                    >
                      Hidden{tabCountLabel(hiddenMoves.length)}
                    </button>
                  </div>
                </div>
                <p className="scheduler-optimize-note">
                  {showingHidden
                    ? 'Suggestions you hid as a bad choice. Unhide to put them back on Recommended.'
                    : moveTab === 'all'
                      ? 'Same-day, this week, and next week — ranked by drive time saved.'
                      : moveTab === 'day'
                        ? 'Same-day time changes — usually easier for clients than switching dates.'
                        : moveTab === 'weeks2'
                          ? windowMode === 'rolling'
                            ? 'Moves a visit onto a closer day in the next 14 days.'
                            : 'Moves a visit onto a closer day later in these two weeks.'
                          : windowMode === 'rolling'
                            ? 'Moves a visit onto a closer day later in the next 7 days.'
                            : 'Moves a visit onto a closer day later this week.'}
                </p>
                {searchingMoves ? (
                  <p className="scheduler-optimize-status">
                    Checking better times…
                  </p>
                ) : visibleMoves.length === 0 ? (
                  <p className="scheduler-optimize-note">
                    {showingHidden
                      ? 'No hidden suggestions.'
                      : moveTab === 'day'
                        ? 'No same-day time changes found that cut drive by at least 5 minutes.'
                        : moveTab === 'all' && hiddenMoves.length > 0
                          ? 'No remaining suggestions. Open Hidden to see ones you dismissed.'
                          : moveTab === 'all'
                            ? 'No moves found that cut drive by at least 5 minutes. Arrival windows or Fixed Time visits may be pinning these days.'
                            : 'No different-day moves found that cut drive by at least 5 minutes. Arrival windows or Fixed Time visits may be pinning these days.'}
                  </p>
                ) : (
                  <ul className="scheduler-optimize-move-list">
                    {visibleMoves.map((m) => {
                      const queued = queueItems.find((row) => row.id === m.id);
                      const alreadyMoved = queued?.status === 'moved';
                      const onList = queued?.status === 'queued';
                      const sameDay = m.scope === 'day' || m.fromDate === m.toDate;
                      const isHidden = hiddenIds.has(m.id);
                      const isStale = showingHidden && staleHiddenIds.has(m.id);
                      return (
                      <li
                        key={m.id}
                        className={`scheduler-optimize-move${isHidden ? ' scheduler-optimize-move--hidden' : ''}`}
                      >
                        <div className="scheduler-optimize-move-copy">
                          <div
                            className={`scheduler-optimize-move-save${m.driveDeltaMin >= 0 ? ' is-worse' : ''}`}
                          >
                            {driveSavedLabel(m.driveDeltaMin)}
                          </div>
                          <div className="scheduler-optimize-move-meta">
                            PPDH {formatPointsPerDriveHour(m.ppdhBefore, 2)}
                            {' → '}
                            {formatPointsPerDriveHour(m.ppdhAfter, 2)}
                          </div>
                          <div className="scheduler-optimize-move-client">{m.client}</div>
                          {m.appointmentType?.trim() ? (
                            <div className="scheduler-optimize-move-type">{m.appointmentType.trim()}</div>
                          ) : null}
                          {m.appointmentDescription?.trim() ? (
                            <div className="scheduler-optimize-move-notes">
                              <b>Appt notes:</b> {m.appointmentDescription.trim()}
                            </div>
                          ) : null}
                          {m.roomLoaderStatus?.trim() ? (
                            <div
                              className="scheduler-optimize-move-rl"
                              style={{ color: m.roomLoaderStatusColor || undefined }}
                            >
                              <b>Room loader:</b> {m.roomLoaderStatus.trim()}
                            </div>
                          ) : null}
                          <div>
                            {sameDay ? (
                              <>
                                {formatDayLabel(m.fromDate, practiceTz)}
                                {' · '}
                                {timeWithWindow(m.fromTimeLabel, m.fromWindowLabel)}
                                {' → '}
                                {timeWithWindow(m.toTimeLabel, m.toWindowLabel)}
                              </>
                            ) : (
                              <>
                                {formatDayLabel(m.fromDate, practiceTz)}
                                {m.fromTimeLabel
                                  ? ` ${timeWithWindow(m.fromTimeLabel, m.fromWindowLabel)}`
                                  : ''}
                                {' → '}
                                {formatDayLabel(m.toDate, practiceTz)}
                                {m.toTimeLabel
                                  ? ` ${timeWithWindow(m.toTimeLabel, m.toWindowLabel)}`
                                  : ''}
                              </>
                            )}
                          </div>
                          {m.insertionIndex >= 0 ? (
                            <div className="scheduler-optimize-move-reason">
                              Fits as visit #{m.insertionIndex + 1} on that day
                            </div>
                          ) : null}
                          <div className="scheduler-optimize-move-reason">{m.reason}</div>
                          {isStale ? (
                            <div className="scheduler-optimize-move-reason">
                              Not in the current search — unhide only keeps it if Optimize still recommends it.
                            </div>
                          ) : null}
                          <div className="scheduler-optimize-staff-notes">
                            <label htmlFor={`scheduler-optimize-notes-${m.id}`}>
                              <span>Notes {notesSaving[m.id] ? '· Saving…' : ''}</span>
                              <textarea
                                id={`scheduler-optimize-notes-${m.id}`}
                                value={notesDraft[m.id] ?? ''}
                                onChange={(e) => scheduleNotesSave(m.id, e.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                        <div className="scheduler-optimize-move-actions">
                          <button
                            type="button"
                            className="scheduler-optimize-apply"
                            disabled={applyingId != null || alreadyMoved}
                            title="Open the calendar at the suggested time"
                            onClick={() => void onApply(m)}
                          >
                            {applyingId === m.id ? 'Checking…' : alreadyMoved ? 'Moved' : 'View optimized appt'}
                          </button>
                          <button
                            type="button"
                            className="scheduler-optimize-apply scheduler-optimize-apply--secondary"
                            disabled={m.appointmentIds.every((id) => !(Number.isFinite(id) && id > 0))}
                            title="Open this visit on the calendar at its current time"
                            onClick={() => onViewCurrent(m)}
                          >
                            View current appt
                          </button>
                          <button
                            type="button"
                            className="scheduler-optimize-apply scheduler-optimize-apply--secondary"
                            disabled={alreadyMoved || onList}
                            onClick={() => onAddToList(m)}
                          >
                            {onList ? 'On list' : 'Add to list'}
                          </button>
                          <button
                            type="button"
                            className="scheduler-optimize-apply scheduler-optimize-apply--secondary"
                            disabled={applyingId != null || m.clientId == null}
                            title={
                              m.clientId == null
                                ? 'No client id on this visit'
                                : 'Text the new time to the client'
                            }
                            onClick={() => void resimulateThen(m, 'text')}
                          >
                            Text
                          </button>
                          {isHidden ? (
                            <button
                              type="button"
                              className="scheduler-optimize-apply scheduler-optimize-apply--secondary"
                              onClick={() => unhideMove(m)}
                            >
                              Unhide
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="scheduler-optimize-apply scheduler-optimize-apply--muted"
                              onClick={() => onHideMove(m)}
                            >
                              Hide
                            </button>
                          )}
                          {onList ? <div className="scheduler-optimize-queued">Queued for CL</div> : null}
                          {queued?.textedAt ? <div className="scheduler-optimize-queued">Texted</div> : null}
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                )}
                {pendingWorse ? (
                  <div className="scheduler-optimize-error" role="alert">
                    <p>{pendingWorse.warning}</p>
                    <div className="scheduler-optimize-move-actions" style={{ flexDirection: 'row', minWidth: 0 }}>
                      <button
                        type="button"
                        className="scheduler-optimize-apply scheduler-optimize-apply--secondary"
                        onClick={() => setPendingWorse(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="scheduler-optimize-apply"
                        onClick={() => {
                          const next = pendingWorse;
                          setPendingWorse(null);
                          if (next.kind === 'apply') void applyLiveMove(next.live);
                          else setContactMove(next.live);
                        }}
                      >
                        Continue anyway
                      </button>
                    </div>
                  </div>
                ) : null}
                {applyError ? (
                  <p className="scheduler-optimize-error" role="alert">
                    {applyError}
                  </p>
                ) : null}
                {visibleMoves.length > 0 ? (
                  <p className="scheduler-optimize-note">
                    Text or add to the list for later. View optimized appt opens the calendar with
                    the new time locked in preview — Reschedule there after the client agrees.{' '}
                    <Link
                      className="scheduler-optimize-list-link"
                      to="/schedule/scheduling-tools/schedule-optimization"
                      onClick={onClose}
                    >
                      Open Schedule optimization
                    </Link>
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
        </div>,
        document.body
      )}
      {contactMove && contactMove.clientId != null ? (
      <ClientContactComposeModal
        open
        clientId={contactMove.clientId}
        clientLabel={contactMove.client}
        initialSmsMessage={buildScheduleOptimizeSmsMessage({
          client: contactMove.client,
          petNames: contactMove.petNames,
          doctorName,
          fromDate: contactMove.fromDate,
          toDate: contactMove.toDate,
          fromTimeLabel: contactMove.fromTimeLabel,
          toTimeLabel: contactMove.toTimeLabel,
          practiceTz,
          scope: contactMove.scope,
        })}
        providerLastName={doctorName.trim().split(/\s+/).filter(Boolean).slice(-1)[0] ?? null}
        canText={careOutreachClientHasSmsPhone(contactMove.clientPhone)}
        onClose={() => setContactMove(null)}
        onSent={() => {
          addScheduleOptimizeToQueue({
            move: contactMove,
            practiceId,
            doctorId,
            doctorName,
          });
          markScheduleOptimizeQueueTexted(practiceId, contactMove.id);
        }}
        smsFromLine={smsFromLine}
        smsSource="schedule_optimization"
      />
    ) : null}
    </>
  );
}
