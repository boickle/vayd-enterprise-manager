import type { ReactNode } from 'react';
import { BookPatientChartButton } from './BookPatientChartButton';
import {
  buildAppointmentRequestDetailSections,
  type AppointmentRequestDetailRow,
  type AppointmentRequestPetDetail,
} from '../utils/appointmentRequestDetailDisplay';
import {
  formatRequestDataAddress,
  requestDataUsesAlternateVisitAddress,
} from '../utils/appointmentRequestDisplay';
import {
  enrichPetDetailsFromLinkedAppointment,
  type LinkedAppointmentEvetIds,
} from '../utils/appointmentRequestLinkedEvet';
import { AppointmentRequestAlternateAddressCallout } from './AppointmentRequestAlternateAddressCallout';
import { EvetNameLink } from './EvetNameLink';
import { evetClientLink, evetPatientLink } from '../utils/evet';

function FactGrid({ rows }: { rows: AppointmentRequestDetailRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="appt-request-detail-fact-grid">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value.slice(0, 24)}`} className="appt-request-detail-fact">
          <span className="appt-request-detail-fact-label">{row.label}</span>
          <span className="appt-request-detail-fact-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function NoteBlocks({ rows }: { rows: AppointmentRequestDetailRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="appt-request-detail-notes">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value.slice(0, 24)}`} className="appt-request-detail-note">
          <div className="appt-request-detail-note-label">{row.label}</div>
          <div className="appt-request-detail-note-value">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

function InfoCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={['appt-request-detail-card', className].filter(Boolean).join(' ')}>
      <h4 className="appt-request-detail-card-title">{title}</h4>
      {children}
    </section>
  );
}

function PetCard({
  pet,
  practiceId,
  practiceTz,
}: {
  pet: AppointmentRequestPetDetail;
  practiceId: number;
  practiceTz: string;
}) {
  const reasonRow = pet.facts.find((r) => r.label === 'Reason for visit');
  const factRows = pet.facts.filter((r) => r.label !== 'Reason for visit');
  const petName = pet.patientPimsId ? (
    <EvetNameLink
      href={evetPatientLink(pet.patientPimsId)}
      className="appt-request-detail-pet-name appt-request-evet-link"
      title="Open patient in eVet"
    >
      {pet.name}
    </EvetNameLink>
  ) : (
    pet.name
  );

  return (
    <article className="appt-request-detail-pet-card">
      <header className="appt-request-detail-pet-header">
        <div className="appt-request-detail-pet-heading">
          <h5 className="appt-request-detail-pet-name">{petName}</h5>
          <div className="appt-request-detail-pet-badges">
            {pet.species ? (
              <span className="appt-request-detail-pet-species">{pet.species}</span>
            ) : null}
            {pet.isNew ? <span className="appt-request-detail-pet-badge">New pet</span> : null}
          </div>
        </div>
        {pet.patientId ? (
          <BookPatientChartButton
            patientId={pet.patientId}
            patientName={pet.name}
            practiceId={practiceId}
            practiceTz={practiceTz}
            label="View details"
            showAlerts
            className="appt-request-detail-pet-link"
          />
        ) : null}
      </header>

      {reasonRow ? (
        <div className="appt-request-detail-reason">
          <span className="appt-request-detail-reason-label">Reason for visit</span>
          <span className="appt-request-detail-reason-value">{reasonRow.value}</span>
        </div>
      ) : null}

      <FactGrid rows={factRows} />
      <NoteBlocks rows={pet.notes} />
    </article>
  );
}

function SectionBlock({
  title,
  rows,
}: {
  title: string;
  rows: AppointmentRequestDetailRow[];
}) {
  if (rows.length === 0) return null;
  const facts = rows.filter((r) => r.variant !== 'note');
  const notes = rows.filter((r) => r.variant === 'note');
  return (
    <InfoCard title={title}>
      <FactGrid rows={facts} />
      <NoteBlocks rows={notes} />
    </InfoCard>
  );
}

export function AppointmentRequestDetailPanel({
  requestData,
  practiceId,
  practiceTz,
  clientPimsId = null,
  linkedAppointment = null,
}: {
  requestData: Record<string, unknown>;
  practiceId: number;
  practiceTz: string;
  clientPimsId?: string | null;
  linkedAppointment?: LinkedAppointmentEvetIds | null;
}) {
  const sections = buildAppointmentRequestDetailSections(requestData, practiceTz);
  const pets = enrichPetDetailsFromLinkedAppointment(sections.pets, linkedAppointment);
  const alternateVisitAddress = requestDataUsesAlternateVisitAddress(requestData)
    ? formatRequestDataAddress(requestData)
    : null;
  const hasContent =
    sections.client.length > 0 ||
    sections.address.length > 0 ||
    alternateVisitAddress ||
    sections.pets.length > 0 ||
    sections.veterinaryHistory.length > 0 ||
    sections.scheduling.length > 0 ||
    sections.other.length > 0;

  if (!hasContent) {
    return (
      <div className="appt-request-detail-panel appt-request-detail-panel--empty settings-muted">
        No additional request details were saved.
      </div>
    );
  }

  const clientNameRow = sections.client.find((r) => r.label === 'Name');
  const clientFactRows = sections.client.filter((r) => r.label !== 'Name' && r.variant !== 'note');
  const clientNotes = sections.client.filter((r) => r.variant === 'note');

  return (
    <div className="appt-request-detail-panel">
      <div className="appt-request-detail-panel-head">
        <span className="appt-request-detail-panel-kicker">Full request</span>
        <span className="appt-request-detail-panel-subtitle">
          Everything the client submitted on the appointment form
        </span>
      </div>

      <div className="appt-request-detail-top-grid">
        {sections.client.length > 0 ? (
          <InfoCard title="Client">
            {clientPimsId && clientNameRow ? (
              <div className="appt-request-detail-client-evet-name">
                <EvetNameLink
                  href={evetClientLink(clientPimsId)}
                  className="appt-request-evet-link appt-request-evet-link--detail-client"
                  title="Open client in eVet"
                >
                  {clientNameRow.value}
                </EvetNameLink>
              </div>
            ) : clientNameRow ? (
              <FactGrid rows={[clientNameRow]} />
            ) : null}
            <FactGrid rows={clientFactRows} />
            <NoteBlocks rows={clientNotes} />
          </InfoCard>
        ) : null}
        {alternateVisitAddress ? (
          <section className="appt-request-detail-card appt-request-detail-card--alt-address">
            <h4 className="appt-request-detail-card-title">Visit location</h4>
            <AppointmentRequestAlternateAddressCallout address={alternateVisitAddress} />
          </section>
        ) : sections.address.length > 0 ? (
          <SectionBlock title="Address" rows={sections.address} />
        ) : null}
      </div>

      {pets.length > 0 ? (
        <div className="appt-request-detail-pets-wrap">
          <h4 className="appt-request-detail-section-label">Pet(s)</h4>
          <div className="appt-request-detail-pets">
            {pets.map((pet) => (
              <PetCard
                key={`${pet.patientId ?? 'new'}-${pet.name}`}
                pet={pet}
                practiceId={practiceId}
                practiceTz={practiceTz}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="appt-request-detail-bottom-grid">
        <SectionBlock title="Scheduling" rows={sections.scheduling} />
        <SectionBlock title="Veterinary history" rows={sections.veterinaryHistory} />
        <SectionBlock title="Additional notes" rows={sections.other} />
      </div>
    </div>
  );
}
