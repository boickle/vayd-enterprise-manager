/** SCH-R7: after booking, every pet on a multi-pet request gets its Scout chart id (not just the visit's pet). */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  clientPatientsFromSearchRows,
  enrichPetRowSummariesFromLinkedAppointment,
  linkedEvetIdsFromBookedApptSummary,
} from './appointmentRequestLinkedEvet';
import { requestDataPetRowSummaries } from './appointmentRequestDetailDisplay';
import { AppointmentRequestPetSummaryList } from '../components/AppointmentRequestPetSummaryList';

vi.mock('../components/BookPatientChartButton', () => ({
  BookPatientChartButton: ({ patientId, patientName }: { patientId: string; patientName: string }) => (
    <span data-testid={`chart-${patientName}`}>{patientId}</span>
  ),
}));

const requestData = {
  clientType: 'new',
  pets: [
    { id: 'p1', name: 'Luna' },
    { id: 'p2', name: 'Milo' },
  ],
  petSpecificData: { p1: { needsToday: 'Wellness' }, p2: { needsToday: 'Wellness' } },
};

const booked = {
  clientPimsId: null,
  patientPimsId: null,
  patientInternalId: '901',
  patientName: 'Luna',
};
const household = clientPatientsFromSearchRows([
  { id: 901, name: 'Luna' },
  { id: 902, name: ' milo ', pimsId: '7777' },
]);

describe('SCH-R7-1 second pet after booking', () => {
  it('gives both new pets their Scout ids (name match, case-insensitive, trimmed)', () => {
    const rows = enrichPetRowSummariesFromLinkedAppointment(
      requestDataPetRowSummaries(requestData),
      linkedEvetIdsFromBookedApptSummary(booked, household),
    );
    expect(rows.map((r) => [r.name, r.patientId])).toEqual([
      ['Luna', '901'],
      ['Milo', '902'],
    ]);
  });

  it('without the household only the booked visit pet has an id (old behavior)', () => {
    const rows = enrichPetRowSummariesFromLinkedAppointment(
      requestDataPetRowSummaries(requestData),
      linkedEvetIdsFromBookedApptSummary(booked),
    );
    expect(rows.map((r) => r.patientId)).toEqual(['901', null]);
  });

  it('a pet not in the household stays without an id', () => {
    const rows = enrichPetRowSummariesFromLinkedAppointment(
      requestDataPetRowSummaries(requestData),
      linkedEvetIdsFromBookedApptSummary(booked, household.filter((p) => p.name === 'Luna')),
    );
    expect(rows.map((r) => r.patientId)).toEqual(['901', null]);
  });

  it('both names open their charts in the pet list', () => {
    const onOpenPatient = vi.fn();
    render(
      <AppointmentRequestPetSummaryList
        requestData={requestData}
        practiceId={1}
        practiceTz="America/New_York"
        linkedAppointment={linkedEvetIdsFromBookedApptSummary(booked, household)}
        onOpenPatient={onOpenPatient}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Luna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Milo' }));
    expect(onOpenPatient).toHaveBeenNthCalledWith(1, '901', 'Luna');
    expect(onOpenPatient).toHaveBeenNthCalledWith(2, '902', 'Milo');
    expect(screen.queryByText(/No chart yet/)).toBeNull();
  });
});
