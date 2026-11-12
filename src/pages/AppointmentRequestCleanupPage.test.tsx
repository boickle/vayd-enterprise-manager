/** One-time cleanup of old open requests (owner, Nov 11, 2026). */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchAppointmentRequestCleanup: vi.fn(),
  applyAppointmentRequestCleanup: vi.fn(),
}));
vi.mock('../api/appointmentRequestSubmissions', () => api);
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));

import AppointmentRequestCleanupPage from './AppointmentRequestCleanupPage';

const items = [
  {
    id: 1,
    submittedAt: '2026-10-01T14:00:00Z',
    status: 'new',
    clientName: 'Alison Cronkhite',
    petNames: ['Bert', 'Ernie'],
    notes: null,
    visit: {
      appointmentId: 2010330,
      start: '2026-11-09T15:00:00Z',
      typeName: 'Standard',
      isHold: false,
      past: true,
    },
    proposal: 'booked',
  },
  {
    id: 2,
    submittedAt: '2026-09-20T14:00:00Z',
    status: 'contacted',
    clientName: 'Megan Jordan',
    petNames: ['Cola'],
    notes: 'Left voicemail',
    visit: null,
    proposal: 'not_booked',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AppointmentRequestCleanupPage />
    </MemoryRouter>
  );
}

describe('AppointmentRequestCleanupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchAppointmentRequestCleanup.mockResolvedValue({ olderThanDays: 10, items });
    api.applyAppointmentRequestCleanup.mockResolvedValue({ booked: 1, notBooked: 1, skipped: 0 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows each request with its proposal; Booked needs a visit', async () => {
    renderPage();
    const alison = (await screen.findByText('Alison Cronkhite')).closest('tr')!;
    expect(within(alison).getByText('Seen 11/9/26')).toBeTruthy();
    expect(within(alison).getByRole('radio', { name: 'Booked' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    const megan = screen.getByText('Megan Jordan').closest('tr')!;
    expect(within(megan).getByRole('radio', { name: 'Booked' }).hasAttribute('disabled')).toBe(
      true
    );
    expect(screen.getByText(/selected:/).textContent).toContain('1 Booked, 1 Not booked');
  });

  it('applies only the selected requests with the chosen outcome', async () => {
    renderPage();
    const alison = (await screen.findByText('Alison Cronkhite')).closest('tr')!;
    // Change Alison to Not booked, then leave Megan out.
    fireEvent.click(within(alison).getByRole('radio', { name: 'Not booked' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Megan Jordan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 1' }));
    await waitFor(() =>
      expect(api.applyAppointmentRequestCleanup).toHaveBeenCalledWith([
        { id: 1, action: 'not_booked', appointmentId: null },
      ])
    );
    expect(await screen.findByText(/Done: 1 Booked, 1 Not booked/)).toBeTruthy();
  });

  it('links the visit when closing as Booked', async () => {
    renderPage();
    await screen.findByText('Alison Cronkhite');
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2' }));
    await waitFor(() =>
      expect(api.applyAppointmentRequestCleanup).toHaveBeenCalledWith([
        { id: 1, action: 'booked', appointmentId: 2010330 },
        { id: 2, action: 'not_booked', appointmentId: null },
      ])
    );
  });
});
