import { createPortal } from 'react-dom';
import type { Appointment } from '../api/roomLoader';
import { appointmentPatientLabel } from '../utils/householdVisitTimeAlign';
import { DateTime } from 'luxon';
import '../pages/Scheduler.css';

export type HouseholdTimeAlignChoice = 'align_all' | 'this_only';

type Props = {
  open: boolean;
  practiceTz: string;
  newStartIso: string;
  newEndIso: string;
  addedPetName: string;
  siblings: Appointment[];
  saving?: boolean;
  onChoose: (choice: HouseholdTimeAlignChoice) => void;
  onCancel: () => void;
};

function siblingCurrentTimeLabel(a: Appointment, practiceTz: string): string {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const end = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid || !end.isValid) return '—';
  return `${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
}

function scheduledTimeLabel(startIso: string, endIso: string, practiceTz: string): string {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid || !end.isValid) return 'the selected time';
  return `${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
}

/** Prompt when editing a visit whose household pets sit in the same ±2h window but have different times. */
export function HouseholdVisitTimeAlignModal({
  open,
  practiceTz,
  newStartIso,
  newEndIso,
  addedPetName,
  siblings,
  saving = false,
  onChoose,
  onCancel,
}: Props) {
  if (!open || siblings.length === 0) return null;

  const addedPetTimeLabel = scheduledTimeLabel(newStartIso, newEndIso, practiceTz);
  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        className="scheduler-modal scheduler-household-time-align-modal"
        role="dialog"
        aria-modal
        aria-labelledby="household-time-align-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Same household visit</p>
            <h2 id="household-time-align-title">Align scheduled times?</h2>
          </div>
          <button
            type="button"
            className="scheduler-modal-close"
            aria-label="Close"
            disabled={saving}
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          <p className="scheduler-household-time-align-lead">
            Other pets in this same household scheduled for this date have different scheduled
            times than <strong>{addedPetName || 'this pet'}</strong> at{' '}
            <strong>{addedPetTimeLabel}</strong>. Pets on the same stop should share the same start
            and end times — update them together, or keep only this visit’s times.
          </p>
          <ul className="scheduler-household-time-align-list">
            {siblings.map((a) => (
              <li key={a.id} className="scheduler-household-time-align-item">
                <strong>{appointmentPatientLabel(a)}</strong>
                <span className="scheduler-household-time-align-when">
                  Currently {siblingCurrentTimeLabel(a, practiceTz)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="scheduler-household-time-align-actions">
          <button type="button" className="btn secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={saving}
            onClick={() => onChoose('this_only')}
          >
            Only this pet
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => onChoose('align_all')}
          >
            {saving ? 'Updating…' : `Update all ${siblings.length + 1} pets`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
