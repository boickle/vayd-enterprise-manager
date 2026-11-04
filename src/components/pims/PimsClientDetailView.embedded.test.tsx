import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import PimsClientDetailView from './PimsClientDetailView';

vi.mock('../../api/clientsStaff', async (orig) => ({
  ...(await orig<object>()),
  fetchClientByIdStaff: vi.fn(async () => ({
    id: '9',
    firstName: 'Ana',
    lastName: 'Rivera',
    isActive: true,
    patients: [{ id: '7', name: 'Biscuit', isActive: true }],
  })),
}));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ abilities: [], userId: 'u' }) }));

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function mount(props: { embedded?: boolean; onOpenPatient?: (id: string, name: string | null) => void }) {
  return render(
    <MemoryRouter initialEntries={['/schedule/soap/1/7']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PimsClientDetailView clientId="9" onBack={() => {}} {...props} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('embedded: a pet link opens the pet in the pop-up and the page does not navigate', async () => {
  const onOpenPatient = vi.fn();
  mount({ embedded: true, onOpenPatient });
  await waitFor(() => expect(screen.queryByText('Loading client…')).toBeNull(), { timeout: 5000 });
  const links = await screen.findAllByRole('link', { name: /Biscuit/ });
  fireEvent.click(links[0]);
  expect(onOpenPatient).toHaveBeenCalledWith('7', 'Biscuit');
  expect(screen.getByTestId('where').textContent).toBe('/schedule/soap/1/7');
});

it('not embedded: pet links still navigate as before', async () => {
  mount({});
  await waitFor(() => expect(screen.queryByText('Loading client…')).toBeNull(), { timeout: 5000 });
  const links = await screen.findAllByRole('link', { name: /Biscuit/ });
  fireEvent.click(links[0]);
  await waitFor(() =>
    expect(screen.getByTestId('where').textContent).toBe('/schedule/patients?patientId=7'),
  );
});
