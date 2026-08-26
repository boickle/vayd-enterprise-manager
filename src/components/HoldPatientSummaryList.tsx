import type { HoldListItem } from '../api/holds';
import { holdPatientInlineNotes, resolveHoldPatientLabel } from '../utils/holdsDisplay';
import { BookPatientChartButton } from './BookPatientChartButton';

type Props = {
  holds: readonly HoldListItem[];
  practiceId: number;
  practiceTz: string;
  appointmentTypeLabel?: (hold: HoldListItem) => string;
  showTypeWhenMixed?: boolean;
};

export function HoldPatientSummaryList({
  holds,
  practiceId,
  practiceTz,
  appointmentTypeLabel,
  showTypeWhenMixed = false,
}: Props) {
  if (holds.length === 0) return null;

  const typeLabels = appointmentTypeLabel
    ? [...new Set(holds.map((h) => appointmentTypeLabel(h).trim()).filter(Boolean))]
    : [];
  const showPerPetType = showTypeWhenMixed && typeLabels.length > 1;

  return (
    <ul className="appt-request-pet-summary-list">
      {holds.map((hold) => {
        const name = resolveHoldPatientLabel(hold);
        const patientId = hold.patient?.id;
        const notes = holdPatientInlineNotes(hold);
        const typeLabel = appointmentTypeLabel?.(hold)?.trim() || null;

        return (
          <li key={hold.id} className="appt-request-pet-summary-item">
            <div className="appt-request-pet-summary-head">
              <span className="appt-request-pet-summary-name">{name}</span>
              {patientId != null ? (
                <BookPatientChartButton
                  patientId={String(patientId)}
                  patientName={name}
                  practiceId={practiceId}
                  practiceTz={practiceTz}
                  excludeAppointmentId={hold.id}
                  label="View details"
                  showAlerts
                  className="appt-request-pet-summary-link"
                />
              ) : null}
            </div>
            {showPerPetType && typeLabel ? (
              <div className="appt-request-pet-summary-type">{typeLabel}</div>
            ) : null}
            {notes.map((note) => (
              <div key={note} className="appt-request-pet-summary-details">
                {note}
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
