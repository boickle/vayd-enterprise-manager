import { useEffect, useState } from 'react';
import { fetchAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import { requestDataPetRowSummaries } from '../utils/appointmentRequestDetailDisplay';
import { requestDataPetSummary } from '../utils/appointmentRequestDisplay';
import {
  readRoutingAppointmentRequestIntent,
  ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY,
  type RoutingAppointmentRequestIntentV1,
} from '../utils/routingAppointmentRequestIntent';
import { EvetNameLink } from './EvetNameLink';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import './AppointmentRequestRoutingSummary.css';

type RoutingPetLine = NonNullable<RoutingAppointmentRequestIntentV1['pets']>[number];

function mapPetSummaries(
  rows: ReturnType<typeof requestDataPetRowSummaries>,
): RoutingPetLine[] {
  return rows.map((pet) => ({
    name: pet.name,
    appointmentType: pet.appointmentType,
    patientPimsId: pet.patientPimsId,
  }));
}

function patchIntentPets(pets: RoutingPetLine[]): void {
  const cur = readRoutingAppointmentRequestIntent();
  if (!cur || (cur.pets?.length ?? 0) > 0) return;
  try {
    sessionStorage.setItem(
      ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY,
      JSON.stringify({ ...cur, pets }),
    );
  } catch {
    /* quota */
  }
}

function PetTypeLines({ pets }: { pets: RoutingPetLine[] }) {
  if (pets.length === 0) return null;
  return (
    <ul className="appt-request-routing-summary__pets">
      {pets.map((pet) => (
        <li key={`${pet.name}-${pet.appointmentType ?? 'type'}`}>
          {pet.patientPimsId ? (
            <EvetNameLink
              href={evetPatientLink(pet.patientPimsId)}
              className="appt-request-routing-summary__pet-name"
              title="Open patient in eVet"
            >
              {pet.name}
            </EvetNameLink>
          ) : (
            <span className="appt-request-routing-summary__pet-name">{pet.name}</span>
          )}
          {pet.appointmentType ? `: ${pet.appointmentType}` : null}
        </li>
      ))}
    </ul>
  );
}

export function AppointmentRequestRoutingSummary({
  intent,
}: {
  intent: RoutingAppointmentRequestIntentV1;
}) {
  const client = intent.clientDisplayLabel?.trim() || 'Client';
  const [pets, setPets] = useState<RoutingPetLine[]>(() => intent.pets ?? []);

  useEffect(() => {
    const fromIntent = intent.pets ?? [];
    if (fromIntent.length > 0) {
      setPets(fromIntent);
      return;
    }

    const submissionId = intent.appointmentRequestSubmissionId;
    if (!submissionId) return;

    let cancelled = false;
    void fetchAppointmentRequestSubmission(submissionId)
      .then((submission) => {
        if (cancelled) return;
        const hydrated = mapPetSummaries(requestDataPetRowSummaries(submission.requestData ?? {}));
        if (hydrated.length > 0) {
          setPets(hydrated);
          patchIntentPets(hydrated);
          return;
        }

        const rd = submission.requestData ?? {};
        const type = intent.appointmentTypeName?.trim();
        const names = requestDataPetSummary(rd)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (type && names.length > 0) {
          const fallback = names.map((name) => ({
            name,
            appointmentType: type,
            patientPimsId: null as string | null,
          }));
          setPets(fallback);
          patchIntentPets(fallback);
        }
      })
      .catch(() => {
        /* keep empty */
      });

    return () => {
      cancelled = true;
    };
  }, [intent.appointmentRequestSubmissionId, intent.pets]);

  return (
    <div className="appt-request-routing-summary" role="status" aria-live="polite">
      <p className="appt-request-routing-summary__lead">
        Appointment request from{' '}
        {intent.clientPimsId ? (
          <EvetNameLink
            href={evetClientLink(intent.clientPimsId)}
            className="appt-request-routing-summary__client"
            title="Open client in eVet"
          >
            {client}
          </EvetNameLink>
        ) : (
          <span className="appt-request-routing-summary__client">{client}</span>
        )}
        .
      </p>

      {intent.isAlternateStop ? (
        <p className="appt-request-routing-summary__alt">
          Alternate visit address only — client not linked for routing.
        </p>
      ) : null}

      <PetTypeLines pets={pets} />

      {intent.howSoon?.trim() ? (
        <p className="appt-request-routing-summary__urgency">
          Urgency: <strong>{intent.howSoon.trim()}</strong>
        </p>
      ) : null}
    </div>
  );
}
