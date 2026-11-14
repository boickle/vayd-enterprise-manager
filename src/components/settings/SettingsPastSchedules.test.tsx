/** Past schedules (owner, Nov 13, 2026): Settings lists dated schedules and adds or removes one. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsPastSchedules from './SettingsPastSchedules';

const api = vi.hoisted(() => ({
  fetchScheduleHistory: vi.fn(),
  addPastSchedule: vi.fn(),
  removePastSchedule: vi.fn(),
}));
vi.mock('../../api/scheduleHistory', () => api);
vi.mock('../../utils/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));

const start = { effectiveFrom: '1900-01-01', workdays: [2, 3, 4, 5], fromStart: true };
const left = { effectiveFrom: '2026-10-15', workdays: [], fromStart: false };

it('lists the schedule from the start and dated ones; the start cannot be removed', async () => {
  api.fetchScheduleHistory.mockResolvedValue([start, left]);
  render(<SettingsPastSchedules employeeId={7} />);
  const table = await screen.findByRole('table', { name: 'Past schedules' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows[0].textContent).toContain('From the start');
  expect(rows[0].textContent).toContain('Tue, Wed, Thu, Fri');
  expect(within(rows[0]).queryByRole('button', { name: 'Remove' })).toBeNull();
  expect(rows[1].textContent).toContain('Oct 15, 2026');
  expect(rows[1].textContent).toContain('No days (not working)');

  api.removePastSchedule.mockResolvedValue([start]);
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(api.removePastSchedule).toHaveBeenCalledWith(7, '2026-10-15'));
});

it('adds a past schedule: Mondays through Thursdays from July 1', async () => {
  api.fetchScheduleHistory.mockResolvedValue([start]);
  api.addPastSchedule.mockResolvedValue([start]);
  render(<SettingsPastSchedules employeeId={7} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add a past schedule' }));

  fireEvent.change(screen.getByLabelText('Schedule started'), { target: { value: '2026-07-01' } });
  const group = screen.getByRole('group', { name: 'Days worked' });
  // Starts from their latest schedule (Tue-Fri): add Monday, drop Friday.
  fireEvent.click(within(group).getByLabelText('Mon'));
  fireEvent.click(within(group).getByLabelText('Fri'));
  fireEvent.click(screen.getByRole('button', { name: 'Save past schedule' }));

  await waitFor(() => expect(api.addPastSchedule).toHaveBeenCalled());
  const [id, from, days] = api.addPastSchedule.mock.calls[0];
  expect([id, from, [...days].sort()]).toEqual([7, '2026-07-01', [1, 2, 3, 4]]);
});
