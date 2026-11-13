/**
 * Goals vs actual (owner, Nov 13, 2026): a day counts only when the API says countsForGoals
 * (scheduled, inside the goal window: goals start or first appointment, to last day or, for
 * someone deactivated without one, last appointment). The card says what it counts.
 */
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
// Doctor 1 is working today; doctor 2 (departed) is outside their goal window today, even though
// their weekly schedule still says workday.
vi.mock('../api/employeeGoals', async (importActual) => {
  const actual = await importActual<typeof import('../api/employeeGoals')>();
  return {
    ...actual,
    fetchEmployeeGoals: vi.fn(async (id: number) => ({
      dailyRevenueGoal: 1000,
      dailyPointGoal: 8,
      dailyGoalBreakdown: [
        {
          date: today,
          dayOfWeek: dayjs(today).day(),
          isWorkday: true,
          countsForGoals: id === 1,
          dailyPointGoal: id === 1 ? 8 : 0,
          dailyRevenueGoal: id === 1 ? 1000 : 0,
        },
      ],
    })),
  };
});
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

it('counts only goal-window days: the departed doctor adds neither goal nor VSD', async () => {
  fetchPrimaryProviders.mockResolvedValue([
    { id: 1, pimsId: 1, name: 'Ann Active', email: '' },
    { id: 2, pimsId: 2, name: 'Dee Departed', email: '', isActive: false },
  ]);

  render(<VeterinaryServicesDeliveredPage />);

  // Practice total still has both; goals vs actual only Ann.
  await waitFor(() => expect(screen.getByText(/Practice total:\s*\$1,500\.00/)).toBeTruthy());
  await waitFor(() => expect(screen.getByText(/\$1,000\.00 \/ \$1,000\.00/)).toBeTruthy());
  expect(screen.getByText(/Counts only doctors with goals set/)).toBeTruthy();
  expect(screen.getByText(/lower than the practice total below/)).toBeTruthy();
});
