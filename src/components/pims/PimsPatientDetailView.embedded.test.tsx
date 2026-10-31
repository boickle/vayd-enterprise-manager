import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PimsPatientDetailView from './PimsPatientDetailView';

vi.mock('../../api/patients', async (orig) => ({
  ...(await orig<object>()),
  fetchPatientByIdStaff: vi.fn(async () => ({
    id: '7', name: 'Ziggy', clientId: '9', client: { id: '9', firstName: 'A', lastName: 'B' },
  })),
  fetchPatientMedicalRecordStaff: vi.fn(async () => null),
}));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ abilities: [], userId: 'u' }) }));

function mount(embedded?: boolean) {
  return render(
    <MemoryRouter initialEntries={['/x?keep=1']}>
      <PimsPatientDetailView patientId="7" onBack={() => {}} embedded={embedded} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
});

it('embedded: no household/breadcrumb chrome and no browser URL change', async () => {
  const before = window.location.search;
  const { container } = mount(true);
  await waitFor(() => expect(screen.queryByText('Loading patient…')).toBeNull(), { timeout: 5000 });
  expect(container.querySelector('.pims-emr-household')).toBeNull();
  expect(window.location.search).toBe(before);
});

it('non-embedded still shows the household/breadcrumb nav', async () => {
  const { container } = mount(false);
  await waitFor(() => expect(container.querySelector('.pims-emr-household')).not.toBeNull(), { timeout: 5000 });
});
