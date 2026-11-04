/**
 * EMR-PROBLEMS (owner decision Nov 4, 2026): eVet problem suggestions also show at the top of the
 * pet's chart, for staff only.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import PimsPatientDetailView from './PimsPatientDetailView';

const staff = vi.hoisted(() => ({ value: true }));

vi.mock('../../api/patients', async (orig) => ({
  ...(await orig<object>()),
  fetchPatientByIdStaff: vi.fn(async () => ({
    id: '7',
    name: 'Ziggy',
    clientId: '9',
    client: { id: '9', firstName: 'A', lastName: 'B' },
  })),
  fetchPatientMedicalRecordStaff: vi.fn(async () => null),
}));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ abilities: [], userId: 'u' }) }));
vi.mock('../../permissions/PermissionContext', async (orig) => {
  const real = await orig<typeof import('../../permissions/PermissionContext')>();
  return {
    ...real,
    usePermissions: () => ({
      ...real.usePermissions(),
      effective: staff.value ? ({ employeeId: 1, isPlatformAdmin: false } as any) : null,
    }),
  };
});
const listEvet = vi.hoisted(() => vi.fn());
vi.mock('../../api/visitWorkflow', async (orig) => ({
  ...(await orig<object>()),
  listEvetProblemSuggestions: listEvet,
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    )
  );
  listEvet.mockResolvedValue([
    {
      key: 'hyperthyroidism',
      label: 'Hyperthyroidism',
      source: 'diagnosis',
      date: '2025-03-14T15:00:00.000Z',
      doctorName: 'Dr. Ada Quill',
      statusLabel: null,
      comments: null,
      recordCount: 1,
    },
  ]);
});

function mount() {
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <PimsPatientDetailView patientId="7" onBack={() => {}} embedded />
    </MemoryRouter>
  );
}

it('EMR-PROBLEMS-E7 the chart shows eVet suggestion cards at the top for staff', async () => {
  staff.value = true;
  const { container } = mount();
  expect(
    await screen.findByText(
      'From eVet: Hyperthyroidism (Dr. Ada Quill, Mar 2025)',
      {},
      { timeout: 5000 }
    )
  ).toBeInTheDocument();
  const cards = container.querySelector(
    '.pims-emr-story__care-chips [data-testid="evet-problem-suggestions"]'
  );
  expect(cards).not.toBeNull();
  expect(
    screen.getByRole('button', { name: 'Accept Hyperthyroidism as a chronic problem' })
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dismiss Hyperthyroidism' })).toBeInTheDocument();
  expect(listEvet).toHaveBeenCalledWith(7);
});

it('EMR-PROBLEMS-E8 no suggestions for a login that is not staff', async () => {
  staff.value = false;
  mount();
  await waitFor(() => expect(screen.queryByText('Loading patient…')).toBeNull(), { timeout: 5000 });
  expect(screen.queryByText(/From eVet/)).toBeNull();
  expect(listEvet).not.toHaveBeenCalled();
});
