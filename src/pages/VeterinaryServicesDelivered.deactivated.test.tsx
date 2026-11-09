/** RP-07-1: a deactivated doctor with production stays in VSD, labelled, and in the practice total. */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import dayjs from 'dayjs';

const today = dayjs().format('YYYY-MM-DD');

const fetchPrimaryProviders = vi.fn();
vi.mock('../api/employee', () => ({
  fetchPrimaryProviders: (...a: unknown[]) => fetchPrimaryProviders(...a),
  isHospitalAccountProvider: () => false,
}));
vi.mock('../api/opsStats', () => ({
  fetchDoctorRevenueSeries: vi.fn(async ({ doctorId }: { doctorId?: string }) => {
    const total = doctorId === '1' ? 1000 : doctorId === '2' ? 500 : 0;
    return {
      doctorId: doctorId ? Number(doctorId) : null,
      start: today,
      end: today,
      total,
      series: total ? [{ date: today, total }] : [],
    };
  }),
}));
vi.mock('../api/employeeGoals', () => ({
  fetchEmployeeGoals: vi.fn(async () => ({})),
  getGoalForDate: vi.fn(() => null),
  hasAnyGoal: vi.fn(() => false),
}));
vi.mock('../api/appointments', () => ({ fetchDoctorMonth: vi.fn(async () => []) }));
vi.mock('../api/appointmentSettings', () => ({
  fetchAllAppointmentTypes: vi.fn(async () => []),
  fetchEmployee: vi.fn(async () => ({ weeklySchedules: [] })),
  scheduleOverrideIsOff: vi.fn(() => false),
}));
vi.mock('../utils/scheduleOverrideMerge', () => ({
  fetchScheduleOverridesByDate: vi.fn(async () => new Map()),
}));
// One stable object: a new array per render would re-trigger the page's effects forever.
const auth = { role: ['admin'], assignedDoctorIds: [] as string[] };
vi.mock('../auth/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../utils/practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));

import VeterinaryServicesDeliveredPage from './VeterinaryServicesDelivered';

it('RP-07-1: the departed doctor has a (Deactivated) row and the practice total includes them', async () => {
  fetchPrimaryProviders.mockResolvedValue([
    { id: 1, pimsId: 1, name: 'Ann Active', email: '' },
    { id: 2, pimsId: 2, name: 'Dee Departed', email: '', isActive: false },
  ]);

  render(<VeterinaryServicesDeliveredPage />);

  expect(await screen.findByText(/Dee Departed \(Deactivated\)/)).toBeTruthy();
  expect(screen.getByText(/Ann Active/)).toBeTruthy();
  await waitFor(() => expect(screen.getByText(/Practice total:\s*\$1,500\.00/)).toBeTruthy());
  // The page asks for deactivated doctors with activity in the chosen dates.
  expect(fetchPrimaryProviders).toHaveBeenCalledWith({ from: today, to: today });
});
