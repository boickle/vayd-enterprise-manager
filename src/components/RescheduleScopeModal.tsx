import { createPortal } from 'react-dom';
import type { RoutingRescheduleScope } from '../utils/routingRescheduleIntent';
import '../pages/Scheduler.css';

export type RescheduleScopeVisitRow = {
  appointmentId: number;
  /** e.g. "Maple · Recheck · 3:00 PM – 3:30 PM" */
  label: string;
  /** The visit that was right-clicked. */
  isSelected: boolean;
};

type Props = {
  open: boolean;
  /** Reschedule moves the visits; Explore alternatives only searches. */
  explore: boolean;
  clientLabel: string;
  dayLabel: string;
  selectedPetName: string;
  visits: RescheduleScopeVisitRow[];
  onChoose: (scope: RoutingRescheduleScope) => void;
  onCancel: () => void;
};

/**
 * Asked before Reschedule (or Explore alternatives) opens routing when the household has other
 * visits that same day: move only the visit that was right-clicked, or every visit that day
 * (owner, Nov 7, 2026). Same look as HouseholdVisitTimeAlignModal.
 */
export function RescheduleScopeModal({
  open,
  explore,
  clientLabel,
  dayLabel,
  selectedPetName,
  visits,
  onChoose,
  onCancel,
}: Props) {
  if (!open || visits.length < 2) return null;
  const verb = explore ? 'Look for times for' : 'Move';
  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="scheduler-modal scheduler-household-time-align-modal"
        role="dialog"
        aria-modal
        aria-labelledby="reschedule-scope-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Same household, same day</p>
            <h2 id="reschedule-scope-title">
              {explore ? 'Explore which visits?' : 'Reschedule which visits?'}
            </h2>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="scheduler-modal-body">
          <p className="scheduler-household-time-align-lead">
            <strong>{clientLabel}</strong> has {visits.length} visits on <strong>{dayLabel}</strong>.{' '}
            {verb} only {selectedPetName ? `${selectedPetName}’s visit` : 'this visit'}, or all of them
            together?
          </p>
          <ul className="scheduler-household-time-align-list">
            {visits.map((v) => (
              <li key={v.appointmentId} className="scheduler-household-time-align-item">
                <strong>{v.label}</strong>
                {v.isSelected ? (
                  <span className="scheduler-household-time-align-when">The visit you picked</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="scheduler-household-time-align-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn secondary" onClick={() => onChoose('selected_pet')}>
            {selectedPetName ? `Only ${selectedPetName}` : 'Only this visit'}
          </button>
          <button type="button" className="btn" onClick={() => onChoose('household_day')}>
            {`All ${visits.length} visits`}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}
