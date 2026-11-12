import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { listAppointmentChanges, type AppointmentChangeEntry } from '../../api/appointments';
import {
  historyHeadline,
  historyLines,
  historyWhen,
  type HistoryLine,
} from '../../utils/appointmentHistoryFormat';
import './AppointmentHistoryModal.css';

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function Value({ text, long }: { text: string | null; long?: boolean }) {
  if (!text) return <span className="appt-history__none">none</span>;
  return <span className={long ? 'appt-history__long' : undefined}>{text}</span>;
}

function Line({ line, created }: { line: HistoryLine; created: boolean }) {
  return (
    <li className="appt-history__line">
      <span className="appt-history__label">{line.label}</span>
      {created ? (
        <span className="appt-history__values">
          <Value text={line.to} long={line.long} />
        </span>
      ) : (
        <span className="appt-history__values">
          <span className="appt-history__from">
            <Value text={line.from} long={line.long} />
          </span>
          <span className="appt-history__arrow" aria-label="changed to">
            →
          </span>
          <span className="appt-history__to">
            <Value text={line.to} long={line.long} />
          </span>
        </span>
      )}
    </li>
  );
}

/** What the screen already knows about changes made before History existed. */
export type AppointmentHistoryExtras = {
  /** "Sep 21, 2025, 5:16 PM by Missy Adams", from the appointment itself. */
  createdLine?: string | null;
  /** Old "Edited … by … on …" lines from the staff notes, oldest first. */
  earlierLines?: string[];
};

/**
 * Who changed this appointment and exactly what changed, newest first. Opens on top of
 * Visit Highlights or the appointment window; fits the screen on a computer or a phone.
 */
export default function AppointmentHistoryModal({
  appointmentId,
  title,
  extras,
  onClose,
}: {
  appointmentId: number | string;
  title?: string | null;
  extras?: AppointmentHistoryExtras;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AppointmentChangeEntry[] | null>(null);
  const earlier = extras?.earlierLines ?? [];
  // The appointment's own Created line, unless History already recorded the booking.
  const showCreated = Boolean(
    extras?.createdLine?.trim() && rows && !rows.some((r) => r.action === 'created')
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    listAppointmentChanges(appointmentId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setError('Could not load the history.'));
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="appt-history__backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="appt-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appt-history-title"
      >
        <header className="appt-history__head">
          <History size={16} aria-hidden />
          <h2 id="appt-history-title">History{title ? ` — ${title}` : ''}</h2>
          <button
            type="button"
            className="appt-history__close"
            onClick={onClose}
            aria-label="Close history"
          >
            <X size={18} />
          </button>
        </header>
        <div className="appt-history__body">
          {error ? <p className="appt-history__msg">{error}</p> : null}
          {!error && rows == null ? <p className="appt-history__msg">Loading…</p> : null}
          {rows && rows.length === 0 && !earlier.length && !showCreated ? (
            <p className="appt-history__msg">No changes recorded yet.</p>
          ) : null}
          {rows && rows.length > 0 ? (
            <ol className="appt-history__list">
              {rows.map((entry) => {
                const lines = historyLines(entry.changes, PRACTICE_TZ);
                return (
                  <li key={entry.id} className={`appt-history__entry is-${entry.action}`}>
                    <div className="appt-history__who">
                      <strong>{historyHeadline(entry)}</strong>
                      <span>{historyWhen(entry.createdAt, PRACTICE_TZ)}</span>
                    </div>
                    {entry.note ? <p className="appt-history__note">{entry.note}</p> : null}
                    {lines.length ? (
                      <ul className="appt-history__lines">
                        {lines.map((line, i) => (
                          <Line
                            key={`${line.label}-${i}`}
                            line={line}
                            created={entry.action === 'created'}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {rows && (earlier.length || showCreated) ? (
            <section className="appt-history__earlier">
              <h3>Earlier (from staff notes, before History)</h3>
              <p className="appt-history__msg">
                These were written as notes, so they say who and when but not what it was before.
              </p>
              <ul>
                {[...earlier].reverse().map((line, i) => (
                  <li key={`${i}-${line}`}>{line}</li>
                ))}
                {showCreated ? <li>Created {extras?.createdLine}</li> : null}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
