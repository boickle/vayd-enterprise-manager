import { BookPatientChartButton } from './BookPatientChartButton';
import { requestDataPetRowSummaries } from '../utils/appointmentRequestDetailDisplay';
import {
  enrichPetRowSummariesFromLinkedAppointment,
  type LinkedAppointmentEvetIds,
} from '../utils/appointmentRequestLinkedEvet';

export function AppointmentRequestPetSummaryList({
  requestData,
  practiceId,
  practiceTz,
  linkedAppointment,
}: {
  requestData: Record<string, unknown>;
  practiceId: number;
  practiceTz: string;
  /** Client/patient ids from the linked booked appointment when not on the form payload. */
  linkedAppointment?: LinkedAppointmentEvetIds | null;
}) {
  const pets = enrichPetRowSummariesFromLinkedAppointment(
    requestDataPetRowSummaries(requestData),
    linkedAppointment,
  );
  if (pets.length === 0) return null;

  return (
    <ul className="appt-request-pet-summary-list">
      {pets.map((pet) => (
        <li key={pet.key} className="appt-request-pet-summary-item">
          <div className="appt-request-pet-summary-head">
            <span className="appt-request-pet-summary-name">{pet.name}</span>
            <span
              className={`appt-request-detail-pet-badge${
                pet.isNew ? '' : ' appt-request-detail-pet-badge--existing'
              }`}
            >
              {pet.isNew ? 'New patient' : 'Existing patient'}
            </span>
            {pet.patientId ? (
              <BookPatientChartButton
                patientId={pet.patientId}
                patientName={pet.name}
                practiceId={practiceId}
                practiceTz={practiceTz}
                label="View details"
                className="appt-request-pet-summary-link"
              />
            ) : null}
          </div>
          {pet.typeName || pet.appointmentType ? (
            <div className="appt-request-pet-summary-type">
              {pet.typeName ?? pet.appointmentType}
              {pet.typeName && pet.reason && pet.reason !== pet.typeName ? (
                <span className="appt-request-pet-summary-reason"> · {pet.reason}</span>
              ) : null}
            </div>
          ) : null}
          {pet.primaryProvider ? (
            <div className="appt-request-pet-summary-provider">
              <span className="appt-request-pet-summary-provider-label">Primary provider</span>
              <span>{pet.primaryProvider}</span>
            </div>
          ) : null}
          {pet.clientDetails ? (
            <div className="appt-request-pet-summary-details">{pet.clientDetails}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
