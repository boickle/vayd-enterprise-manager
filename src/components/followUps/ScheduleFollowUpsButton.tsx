import { ArrowRight, CalendarPlus } from 'lucide-react';
import type { VisitWrapUpPet } from '../../api/visitWrapUp';
import { forwardBookingDispositionIsComplete } from '../../utils/forwardBookingDisposition';
import { forwardBookingModeOption } from '../forwardBooking/ForwardBookingDecisionFields';
import './ScheduleFollowUpsPlanner.css';

/**
 * The checkout entry point: a pill button that reads as a button, with a chip per pet on
 * today's visit. Pulses while follow-ups are still open; once every pet has one it turns
 * into a quieter outlined "Review follow-ups".
 */
export default function ScheduleFollowUpsButton({
  pets,
  onOpen,
  disabled,
}: {
  pets: VisitWrapUpPet[];
  onOpen: () => void;
  disabled?: boolean;
}) {
  const done = (p: VisitWrapUpPet) =>
    forwardBookingDispositionIsComplete(p.forwardBookingDisposition);
  const allDone = pets.length > 0 && pets.every(done);
  return (
    <div className="fup-cta">
      <div className="fup-cta__pets">
        {pets.map((p) => (
          <span key={p.patientId} className={`fup-cta__pet${done(p) ? ' is-done' : ''}`}>
            {done(p) ? '✓' : '○'} {p.patientName}
            {done(p)
              ? ` · ${forwardBookingModeOption(p.forwardBookingDisposition!.mode)?.label ?? ''}`
              : ''}
          </span>
        ))}
      </div>
      <button
        type="button"
        className={`fup-cta__btn ${allDone ? 'is-reviewed' : 'is-pending'}`}
        onClick={onOpen}
        disabled={disabled}
      >
        <CalendarPlus size={22} aria-hidden="true" />
        <span>{allDone ? 'Review follow-ups' : 'Schedule follow-ups'}</span>
        <ArrowRight size={20} className="fup-cta__arrow" aria-hidden="true" />
      </button>
    </div>
  );
}
