import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchAppointmentById } from '../../api/appointments';
import { completeFollowUpTask } from '../../utils/forwardBookingTaskComplete';
import { DEFAULT_PRACTICE_TIMEZONE } from '../../utils/practiceTimezone';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import ScheduleFollowUpsPlanner, { type PlannerSaveResult } from './ScheduleFollowUpsPlanner';
import { plannerVisitForClient, type PlannerVisitInput } from './plannerData';
import './ScheduleFollowUpsPlanner.css';

/**
 * "Forward book Biscuit once labs are back": Schedule follow-ups for that household
 * with Biscuit needing a plan. Biscuit can join a visit already on the books, get a
 * new card (book now or send to the CLs), or be marked no follow-up. The earlier
 * visit's saved choice (Labs pending) is left as it is. When Done saves, the task is
 * closed with a note saying what was done.
 */
export default function ScheduleFollowUpsForTask({
  patientId,
  appointmentId,
  taskId,
  onClose,
  onDone,
}: {
  patientId: number;
  /** The visit the labs were drawn at; new list rows link back to it. */
  appointmentId: number;
  /** Labs-pending task to close; null when opened without one. */
  taskId: number | null;
  onClose: () => void;
  /** After Done; `taskClosed` is false when the task could not be closed. */
  onDone: (result: { taskClosed: boolean }) => void;
}) {
  const [visit, setVisit] = useState<PlannerVisitInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const practiceId = currentPracticeId();
  /** Set once Done saved; the planner may still show the owner-text step after that. */
  const saved = useRef<{ taskClosed: boolean } | null>(null);

  useEffect(() => {
    let on = true;
    fetchAppointmentById(appointmentId, { practiceId })
      .then((appt) => {
        if (!on) return;
        const c = appt?.client;
        if (!c?.id) {
          setError('Could not find the household for that visit.');
          return;
        }
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null;
        setVisit(
          plannerVisitForClient(Number(c.id), name, [
            { patientId, sourceAppointmentId: appointmentId, reason: 'Labs are back' },
          ])
        );
      })
      .catch(() => on && setError('Could not load that visit.'));
    return () => {
      on = false;
    };
  }, [appointmentId, patientId, practiceId]);

  if (error) {
    return createPortal(
      <div className="fup-root">
        <button type="button" className="fup-overlay" aria-label="Close" onClick={onClose} />
        <section className="fup-confirm__card fup-launcher" role="alertdialog" aria-modal="true">
          <h3>Schedule follow-ups</h3>
          <p>{error}</p>
          <div className="fup-actions fup-actions--end">
            <button type="button" className="fup-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </section>
      </div>,
      document.body
    );
  }
  if (!visit) return null;

  return (
    <ScheduleFollowUpsPlanner
      open
      visit={visit}
      practiceId={practiceId}
      tz={DEFAULT_PRACTICE_TIMEZONE}
      onClose={() => (saved.current ? onDone(saved.current) : onClose())}
      onSaved={async (result: PlannerSaveResult) => {
        const closed =
          taskId != null && result.focusSummary
            ? await completeFollowUpTask(taskId, result.focusSummary)
            : false;
        saved.current = { taskClosed: closed };
      }}
    />
  );
}
