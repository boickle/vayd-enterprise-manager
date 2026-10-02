import { BookPatientChartButton } from './BookPatientChartButton';
import { EvetNameLink } from './EvetNameLink';
import { requestDataPetRowSummaries } from '../utils/appointmentRequestDetailDisplay';
import {
  enrichPetRowSummariesFromLinkedAppointment,
  type LinkedAppointmentEvetIds,
} from '../utils/appointmentRequestLinkedEvet';
import { evetPatientLink } from '../utils/evet';

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
            {pet.patientPimsId ? (
              <EvetNameLink
                href={evetPatientLink(pet.patientPimsId)}
                className="appt-request-pet-summary-name appt-request-evet-link"
                title="Open patient in eVet"
              >
                {pet.name}
              </EvetNameLink>
            ) : (
              <span className="appt-request-pet-summary-name">{pet.name}</span>
            )}
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
          {pet.appointmentType ? (
            <div className="appt-request-pet-summary-type">{pet.appointmentType}</div>
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
