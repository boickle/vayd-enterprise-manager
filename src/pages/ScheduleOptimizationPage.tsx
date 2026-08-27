import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { DateTime } from 'luxon';
import { fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { ClientContactComposeModal } from '../components/ClientContactComposeModal';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import SchedulingToolsListPagination, {
  paginateSchedulingToolsList,
} from '../components/SchedulingToolsListPagination';
import { useScheduleOptimizeQueue } from '../hooks/useScheduleOptimizeQueue';
import { SCHEDULING_TOOLS_PAGE_REFRESH_EVENT } from '../hooks/useSchedulingToolsNavCounts';
import { careOutreachClientHasSmsPhone } from '../utils/careOutreachSmsMessage';
import { formatPointsPerDriveHour } from '../utils/pointsPerDriveHour';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import {
  addScheduleOptimizeToQueue,
  hideScheduleOptimizeSuggestion,
  markScheduleOptimizeQueueTexted,
  queueItemFromMove,
  queueItemToOptimizeMove,
  updateScheduleOptimizeQueueNotes,
  type ScheduleOptimizeQueueItem,
  type ScheduleOptimizeQueueStatus,
} from '../utils/scheduleOptimizeQueue';
import { useScheduleOptimizeMoveMeta } from '../hooks/useScheduleOptimizeMoveMeta';
import {
  setScheduleOptimizeMoveHidden,
  type ScheduleOptimizeMoveMeta,
} from '../utils/scheduleOptimizeMoveMeta';
import { beginScheduleOptimizeApplyInCalendar, openScheduleOptimizeCurrentAppointment } from '../utils/scheduleOptimizeCalendarPreview';
import {
  formatOptimizeResimulateWarning,
  revalidateOptimizeMove,
} from '../utils/scheduleOptimizeMoves';
import { buildScheduleOptimizeSmsMessage } from '../utils/scheduleOptimizeSmsMessage';
import './ScheduleOptimizationPage.css';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ = practiceTimeZoneOrDefault(undefined);
const NOTES_DEBOUNCE_MS = 400;

type StatusTab = 'queued' | 'moved' | 'all' | 'hidden';

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'moved', label: 'Moved' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'all', label: 'All' },
];

function formatDayLabel(dateIso: string, practiceTz: string): string {
  const dt = DateTime.fromISO(dateIso, { zone: practiceTz });
  return dt.isValid ? dt.toFormat('ccc M/d') : dateIso;
}

function slotLabel(
  dateIso: string,
  timeLabel: string,
  practiceTz: string,
  windowLabel?: string | null
): string {
  const day = formatDayLabel(dateIso, practiceTz);
  const time = timeLabel.trim();
  const win = windowLabel?.trim();
  const when = [time || null, win || null].filter(Boolean).join(' ');
  return when ? `${day} ${when}` : day;
}

function driveSavedLabel(deltaMin: number): string {
  const n = Math.abs(deltaMin);
  return deltaMin < 0 ? `Saves ${n} min drive` : `Adds ${n} min drive`;
}

function hiddenQueueItemFromMeta(
  meta: ScheduleOptimizeMoveMeta,
  practiceId: number
): ScheduleOptimizeQueueItem | null {
  if (!meta.move) return null;
  return {
    ...queueItemFromMove({
      move: meta.move,
      practiceId,
      doctorId: meta.doctorId?.trim() || '',
      doctorName: meta.doctorName?.trim() || '',
    }),
    status: 'queued',
    notes: meta.notes,
    createdAt: meta.hiddenAt ?? meta.updatedAt,
    updatedAt: meta.updatedAt,
  };
}

export default function ScheduleOptimizationPage() {
  const navigate = useNavigate();
  const items = useScheduleOptimizeQueue(PRACTICE_ID);
  const moveMeta = useScheduleOptimizeMoveMeta(PRACTICE_ID);
  const [status, setStatus] = useState<StatusTab>('queued');
  const [listPage, setListPage] = useState(1);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [notesSaving, setNotesSaving] = useState<Record<string, boolean>>({});
  const notesTimers = useRef<Record<string, number>>({});
  const lastStoredNotes = useRef<Record<string, string>>({});
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smsFromLine, setSmsFromLine] = useState<string | null>(null);
  const [contactItem, setContactItem] = useState<ScheduleOptimizeQueueItem | null>(null);
  const [messagesItem, setMessagesItem] = useState<ScheduleOptimizeQueueItem | null>(null);
  const [pendingWorse, setPendingWorse] = useState<{
    kind: 'apply' | 'text';
    row: ScheduleOptimizeQueueItem;
    live: ReturnType<typeof queueItemToOptimizeMove>;
    warning: string;
  } | null>(null);
  const [, setRefreshTick] = useState(0);

  useEffect(() => {
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setSmsFromLine(phone);
    });
  }, []);

  useEffect(() => {
    const onRefresh = () => setRefreshTick((n) => n + 1);
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onRefresh);
  }, []);

  const hiddenItems = useMemo(
    () =>
      moveMeta
        .filter((row) => row.hidden)
        .map((row) => hiddenQueueItemFromMeta(row, PRACTICE_ID))
        .filter((row): row is ScheduleOptimizeQueueItem => row != null),
    [moveMeta]
  );

  useEffect(() => {
    setNotesDraft((prev) => {
      const next = { ...prev };
      for (const row of [...items, ...hiddenItems]) {
        const stored = lastStoredNotes.current[row.id];
        const draft = next[row.id];
        if (draft == null || stored == null || draft === stored) {
          next[row.id] = row.notes;
        }
        lastStoredNotes.current[row.id] = row.notes;
      }
      return next;
    });
  }, [items, hiddenItems]);

  const showingHidden = status === 'hidden';
  const filtered = useMemo(() => {
    const rows =
      status === 'hidden'
        ? hiddenItems
        : status === 'all'
          ? items
          : items.filter((row) => row.status === (status as ScheduleOptimizeQueueStatus));
    return [...rows].sort((a, b) => {
      const aKey = a.status === 'moved' ? a.movedAt ?? a.updatedAt : a.updatedAt;
      const bKey = b.status === 'moved' ? b.movedAt ?? b.updatedAt : b.updatedAt;
      return bKey.localeCompare(aKey);
    });
  }, [items, hiddenItems, status]);

  useEffect(() => {
    setListPage(1);
  }, [status]);

  const pageRows = useMemo(
    () => paginateSchedulingToolsList(filtered, listPage),
    [filtered, listPage]
  );

  function scheduleNotesSave(id: string, value: string) {
    setNotesDraft((prev) => ({ ...prev, [id]: value }));
    if (notesTimers.current[id]) window.clearTimeout(notesTimers.current[id]);
    notesTimers.current[id] = window.setTimeout(() => {
      setNotesSaving((prev) => ({ ...prev, [id]: true }));
      updateScheduleOptimizeQueueNotes(PRACTICE_ID, id, value);
      window.setTimeout(() => {
        setNotesSaving((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 250);
    }, NOTES_DEBOUNCE_MS);
  }

  async function applyRow(row: ScheduleOptimizeQueueItem) {
    if (row.status === 'moved') return;
    setApplyingId(row.id);
    setError(null);
    try {
      setScheduleOptimizeMoveHidden({
        practiceId: PRACTICE_ID,
        move: queueItemToOptimizeMove(row),
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        hidden: false,
      });
      const result = await beginScheduleOptimizeApplyInCalendar({
        move: row,
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        practiceId: PRACTICE_ID,
        practiceTz: PRACTICE_TZ,
        navigate,
        returnPath: '/schedule/scheduling-tools/schedule-optimization',
        queueItemId: row.id,
      });
      if (!result.ok) {
        setError(result.reason);
      }
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not open this visit on the calendar.';
      setError(String(msg));
    } finally {
      setApplyingId(null);
    }
  }

  async function resimulateThen(row: ScheduleOptimizeQueueItem, kind: 'apply' | 'text') {
    if (row.status === 'moved') return;
    setPendingWorse(null);
    setApplyingId(row.id);
    setError(null);
    try {
      const saved = queueItemToOptimizeMove(row);
      const result = await revalidateOptimizeMove({
        move: saved,
        doctorId: row.doctorId,
        practiceTz: PRACTICE_TZ,
      });
      if (!result.live) {
        setError(result.unavailableReason || 'This suggestion is no longer valid.');
        return;
      }
      const updated = addScheduleOptimizeToQueue({
        move: result.live,
        practiceId: PRACTICE_ID,
        doctorId: row.doctorId,
        doctorName: row.doctorName,
      });
      setScheduleOptimizeMoveHidden({
        practiceId: PRACTICE_ID,
        move: result.live,
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        hidden: false,
      });
      if (result.driveWorse || result.windowWorse) {
        setPendingWorse({
          kind,
          row: updated,
          live: result.live,
          warning:
            formatOptimizeResimulateWarning(saved, result.live) ??
            'This suggestion is worse than when it was simulated. Continue anyway?',
        });
        return;
      }
      if (kind === 'apply') {
        await applyRow(updated);
        return;
      }
      setContactItem(updated);
    } catch (e) {
      setError((e as Error)?.message?.trim() || 'Could not re-check this suggestion.');
    } finally {
      setApplyingId(null);
    }
  }

  async function onApply(row: ScheduleOptimizeQueueItem) {
    await resimulateThen(row, 'apply');
  }

  function onViewCurrent(row: ScheduleOptimizeQueueItem) {
    const ok = openScheduleOptimizeCurrentAppointment({
      move: {
        id: row.id,
        appointmentIds: row.appointmentIds,
        newStartIso: row.newStartIso,
        newEndIso: row.newEndIso,
        toDate: row.toDate,
        fromDate: row.fromDate,
        client: row.client,
        clientId: row.clientId,
        petNames: row.petNames,
        insertionIndex: row.insertionIndex,
      },
      fromDate: row.fromDate,
      doctorId: row.doctorId,
      doctorName: row.doctorName,
      practiceId: PRACTICE_ID,
      queueItemId: row.id,
      navigate,
      returnHref: '/schedule/scheduling-tools/schedule-optimization',
    });
    if (!ok) {
      setError('This item is missing a current appointment to open.');
    }
  }

  function openText(row: ScheduleOptimizeQueueItem) {
    if (row.clientId == null) return;
    void resimulateThen(row, 'text');
  }

  function onHide(row: ScheduleOptimizeQueueItem) {
    if (notesTimers.current[row.id]) {
      window.clearTimeout(notesTimers.current[row.id]);
      delete notesTimers.current[row.id];
    }
    updateScheduleOptimizeQueueNotes(PRACTICE_ID, row.id, notesDraft[row.id] ?? row.notes);
    hideScheduleOptimizeSuggestion({
      practiceId: PRACTICE_ID,
      move: queueItemToOptimizeMove(row),
      doctorId: row.doctorId,
      doctorName: row.doctorName,
    });
  }

  function onUnhide(row: ScheduleOptimizeQueueItem) {
    setScheduleOptimizeMoveHidden({
      practiceId: PRACTICE_ID,
      move: queueItemToOptimizeMove(row),
      doctorId: row.doctorId,
      doctorName: row.doctorName,
      hidden: false,
    });
    addScheduleOptimizeToQueue({
      move: queueItemToOptimizeMove(row),
      practiceId: PRACTICE_ID,
      doctorId: row.doctorId,
      doctorName: row.doctorName,
    });
  }

  const queuedCount = items.filter((row) => row.status === 'queued').length;
  const movedCount = items.filter((row) => row.status === 'moved').length;
  const hiddenCount = hiddenItems.length;

  return (
    <div className="schedule-optimize-page">
      <p className="schedule-optimize-intro settings-muted">
        Suggested day and time moves from Practice calendar → Optimize. Text the client, add notes,
        then View optimized appt to preview the new time on the calendar and Reschedule there.
      </p>

      <div className="schedule-optimize-toolbar">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn ${status === tab.key ? '' : 'secondary'}`}
            onClick={() => setStatus(tab.key)}
          >
            {tab.label}
            {tab.key === 'queued'
              ? ` (${queuedCount})`
              : tab.key === 'moved'
                ? ` (${movedCount})`
                : tab.key === 'hidden'
                  ? ` (${hiddenCount})`
                  : ''}
          </button>
        ))}
      </div>

      {pendingWorse ? (
        <div className="schedule-optimize-error" role="alert">
          <p>{pendingWorse.warning}</p>
          <div className="schedule-optimize-card__actions">
            <button type="button" className="btn secondary" onClick={() => setPendingWorse(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const next = pendingWorse;
                setPendingWorse(null);
                if (next.kind === 'apply') void applyRow(next.row);
                else setContactItem(next.row);
              }}
            >
              Continue anyway
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="schedule-optimize-error" role="alert">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="settings-muted">
          {status === 'hidden'
            ? 'No hidden suggestions.'
            : status === 'moved'
              ? 'No applied moves yet.'
              : 'No queued suggestions. Open Optimize on the practice calendar to add moves here.'}
        </p>
      ) : (
        <>
          {pageRows.map((row) => {
            const canText =
              row.clientId != null && careOutreachClientHasSmsPhone(row.clientPhone);
            const fromSlot = slotLabel(
              row.fromDate,
              row.fromTimeLabel,
              PRACTICE_TZ,
              row.fromWindowLabel
            );
            const toSlot = slotLabel(row.toDate, row.toTimeLabel, PRACTICE_TZ, row.toWindowLabel);
            const sameDay = row.scope === 'day' || row.fromDate === row.toDate;
            const fromWhen = [row.fromTimeLabel.trim() || '—', row.fromWindowLabel?.trim()]
              .filter(Boolean)
              .join(' ');
            const toWhen = [row.toTimeLabel.trim() || '—', row.toWindowLabel?.trim()]
              .filter(Boolean)
              .join(' ');
            return (
              <article
                key={row.id}
                className={`schedule-optimize-card${row.status === 'moved' ? ' schedule-optimize-card--moved' : ''}`}
              >
                <div className="schedule-optimize-card__top">
                  <div>
                    <div
                      className={`schedule-optimize-save${row.driveDeltaMin >= 0 ? ' is-worse' : ''}`}
                    >
                      {driveSavedLabel(row.driveDeltaMin)}
                    </div>
                    <div className="schedule-optimize-ppdh">
                      PPDH {formatPointsPerDriveHour(row.ppdhBefore, 2)}
                      {' → '}
                      {formatPointsPerDriveHour(row.ppdhAfter, 2)}
                    </div>
                    <h3 className="schedule-optimize-card__name">{row.client}</h3>
                    {row.appointmentType?.trim() ? (
                      <div className="schedule-optimize-visit-type">{row.appointmentType.trim()}</div>
                    ) : null}
                    {row.appointmentDescription?.trim() ? (
                      <div className="schedule-optimize-visit-notes">
                        <b>Appt notes:</b> {row.appointmentDescription.trim()}
                      </div>
                    ) : null}
                    {row.roomLoaderStatus?.trim() ? (
                      <div
                        className="schedule-optimize-visit-rl"
                        style={{ color: row.roomLoaderStatusColor || undefined }}
                      >
                        <b>Room loader:</b> {row.roomLoaderStatus.trim()}
                      </div>
                    ) : null}
                    <div className="schedule-optimize-card__meta">
                      <span
                        className={`schedule-optimize-chip${
                          showingHidden
                            ? ' schedule-optimize-chip--muted'
                            : row.status === 'moved'
                              ? ' schedule-optimize-chip--ok'
                              : ''
                        }`}
                      >
                        {showingHidden
                          ? 'Hidden'
                          : row.status === 'moved'
                            ? row.outcome === 'alternative'
                              ? 'Alternative added'
                              : row.outcome === 'rescheduled'
                                ? 'Rescheduled'
                                : 'Moved'
                            : 'Queued'}
                      </span>
                      <span className="schedule-optimize-chip schedule-optimize-chip--muted">
                        {row.doctorName}
                      </span>
                      {row.petNames.length > 0 ? (
                        <span className="schedule-optimize-chip schedule-optimize-chip--muted">
                          {row.petNames.join(', ')}
                        </span>
                      ) : null}
                      {row.textedAt ? (
                        <span className="schedule-optimize-chip schedule-optimize-chip--ok">Texted</span>
                      ) : null}
                      <span className="schedule-optimize-chip schedule-optimize-chip--muted">
                        {sameDay ? 'Same day' : 'Different day'}
                      </span>
                    </div>
                    <div className="schedule-optimize-move">
                      {sameDay
                        ? `${formatDayLabel(row.fromDate, PRACTICE_TZ)} · ${fromWhen} → ${toWhen}`
                        : `${fromSlot} → ${toSlot}`}
                    </div>
                    {row.reason ? (
                      <p className="schedule-optimize-reason">{row.reason}</p>
                    ) : null}
                    {row.insertionIndex != null ? (
                      <p className="schedule-optimize-reason">
                        Fits as visit #{row.insertionIndex + 1} on that day
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="schedule-optimize-notes">
                  <label htmlFor={`schedule-optimize-notes-${row.id}`}>
                    <span>Notes {notesSaving[row.id] ? '· Saving…' : ''}</span>
                    <textarea
                      id={`schedule-optimize-notes-${row.id}`}
                      className="settings-input"
                      value={notesDraft[row.id] ?? ''}
                      onChange={(e) => scheduleNotesSave(row.id, e.target.value)}
                    />
                  </label>
                </div>

                <div className="schedule-optimize-card__actions">
                  {row.status === 'queued' ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={applyingId != null}
                      title="Open the calendar at the suggested time"
                      onClick={() => void onApply(row)}
                    >
                      {applyingId === row.id ? 'Checking…' : 'View optimized appt'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={row.appointmentIds.every((id) => !(Number.isFinite(id) && id > 0))}
                    title="Open this visit on the calendar at its current time"
                    onClick={() => onViewCurrent(row)}
                  >
                    View current appt
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={row.clientId == null}
                    title={
                      row.clientId == null
                        ? 'No client id on this visit'
                        : canText
                          ? 'Text the new time'
                          : 'No mobile number on file — email may still work'
                    }
                    onClick={() => openText(row)}
                  >
                    Text client
                  </button>
                  {row.clientId != null ? (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setMessagesItem(row)}
                    >
                      Messages
                    </button>
                  ) : null}
                  {row.status === 'queued' && !showingHidden ? (
                    <button
                      type="button"
                      className="btn secondary"
                      title="Take this off the list and hide it in Optimize. You can find it again under Hidden."
                      onClick={() => onHide(row)}
                    >
                      Hide
                    </button>
                  ) : null}
                  {showingHidden ? (
                    <button
                      type="button"
                      className="btn secondary"
                      title="Put this back on Queued and on Optimize Recommended."
                      onClick={() => onUnhide(row)}
                    >
                      Unhide
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          <SchedulingToolsListPagination
            listPage={listPage}
            totalItems={filtered.length}
            onPageChange={setListPage}
            itemLabel="suggestions"
          />
        </>
      )}

      {contactItem && contactItem.clientId != null ? (
        <ClientContactComposeModal
          open
          clientId={contactItem.clientId}
          clientLabel={contactItem.client}
          initialSmsMessage={buildScheduleOptimizeSmsMessage({
            client: contactItem.client,
            petNames: contactItem.petNames,
            doctorName: contactItem.doctorName,
            fromDate: contactItem.fromDate,
            toDate: contactItem.toDate,
            fromTimeLabel: contactItem.fromTimeLabel,
            toTimeLabel: contactItem.toTimeLabel,
            practiceTz: PRACTICE_TZ,
            scope: contactItem.scope,
          })}
          providerLastName={contactItem.doctorName.trim().split(/\s+/).filter(Boolean).slice(-1)[0] ?? null}
          canText={careOutreachClientHasSmsPhone(contactItem.clientPhone)}
          onClose={() => setContactItem(null)}
          onSent={() => markScheduleOptimizeQueueTexted(PRACTICE_ID, contactItem.id)}
          smsFromLine={smsFromLine}
          smsSource="schedule_optimization"
          onOpenMessagesHistory={() => {
            setMessagesItem(contactItem);
            setContactItem(null);
          }}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesItem?.clientId != null}
        clientId={messagesItem?.clientId ?? null}
        clientLabel={messagesItem?.client}
        openPhoneLine={smsFromLine}
        onClose={() => setMessagesItem(null)}
      />
    </div>
  );
}
