/**
 * EMR-HIST (owner decision Nov 3, 2026): the pet's chart has a staff-only History listing every
 * logged step on its prescriptions, vaccine doses edited after sign-off and lab results.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientRecordHistoryPanel from './PatientRecordHistoryPanel';

const getPatientRecordHistory = vi.fn();
vi.mock('../../api/recordHistory', () => ({
  getPatientRecordHistory: (...args: unknown[]) => getPatientRecordHistory(...args),
}));

let effective: { employeeId: number | null; isPlatformAdmin: boolean } | null = null;
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ effective }),
}));

const ENTRIES = [
  {
    id: 'l2',
    at: '2026-11-03T16:00:00.000Z',
    kind: 'result_completed',
    entityType: 'lab_result',
    entityId: '81',
    subject: 'Heartworm snap',
    actorName: 'Lena Larchmont',
    actorRole: 'tech',
    forName: null,
    rxNumber: null,
    before: null,
    after: null,
    text: 'Result completed by Lena Larchmont (tech): Heartworm Negative → Positive',
  },
  {
    id: 'v1',
    at: '2026-11-02T15:00:00.000Z',
    kind: 'dose_changed',
    entityType: 'vaccination',
    entityId: '501',
    subject: 'Rabies 3yr dose',
    actorName: 'Odile Oakhollow',
    actorRole: 'vet',
    forName: null,
    rxNumber: null,
    before: null,
    after: null,
    text: 'Dose changed by Odile Oakhollow (vet): tag 123 → 456',
  },
  {
    id: 'r1',
    at: '2026-11-01T14:00:00.000Z',
    kind: 'label_printed',
    entityType: 'prescription',
    entityId: '77',
    subject: 'Rx #4401',
    actorName: 'Sam Fernsby',
    actorRole: 'tech',
    forName: null,
    rxNumber: 4401,
    before: null,
    after: null,
    text: 'Label printed by Sam Fernsby (tech), Rx #4401',
  },
];

beforeEach(() => {
  getPatientRecordHistory.mockReset();
  effective = { employeeId: 12, isPlatformAdmin: false };
});

describe('EMR-HIST: pet History on the chart', () => {
  it('lists prescription, vaccine-dose and lab-result steps in the order given (newest first)', async () => {
    getPatientRecordHistory.mockResolvedValue(ENTRIES);
    render(<PatientRecordHistoryPanel patientId="42" />);
    expect(getPatientRecordHistory).toHaveBeenCalledWith('42');
    const region = await screen.findByRole('region', { name: 'Pet record history' });
    await waitFor(() => expect(within(region).getAllByRole('row')).toHaveLength(4));
    const rows = within(region).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('Lab result · Heartworm snap');
    expect(rows[0].textContent).toContain('Heartworm Negative → Positive');
    expect(rows[1].textContent).toContain('Vaccine dose · Rabies 3yr dose');
    expect(rows[1].textContent).toContain('tag 123 → 456');
    expect(rows[2].textContent).toContain('Prescription · Rx #4401');
    expect(rows.map((r) => r.getAttribute('data-history-entity'))).toEqual([
      'lab_result',
      'vaccination',
      'prescription',
    ]);
    expect(region).toHaveClass('record-history');
  });

  it('says so when nothing is logged', async () => {
    getPatientRecordHistory.mockResolvedValue([]);
    render(<PatientRecordHistoryPanel patientId={42} />);
    expect(await screen.findByText('Nothing logged yet.')).toBeInTheDocument();
  });

  it('shows the error when the history cannot load', async () => {
    getPatientRecordHistory.mockRejectedValue(new Error('Request failed with status code 500'));
    render(<PatientRecordHistoryPanel patientId={42} />);
    expect(await screen.findByText('Request failed with status code 500')).toBeInTheDocument();
  });

  it('renders nothing and asks for nothing for a client (non-staff) login', () => {
    effective = { employeeId: null, isPlatformAdmin: false };
    const { container } = render(<PatientRecordHistoryPanel patientId={42} />);
    expect(container).toBeEmptyDOMElement();
    expect(getPatientRecordHistory).not.toHaveBeenCalled();
  });
});
