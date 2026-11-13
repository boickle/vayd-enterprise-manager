/** T-Q6: the admin's Run now button says that end-of-day rules wait for their hour. */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsAutomaticTasks from './SettingsAutomaticTasks';
import type { TaskAutomationRule } from '../../api/taskAutomation';

const list = vi.hoisted(() => vi.fn());
vi.mock('../../api/taskAutomation', () => ({
  listTaskAutomationRules: (...a: unknown[]) => list(...a),
  patchTaskAutomationRule: vi.fn(),
  runTaskAutomationRules: vi.fn(),
}));
vi.mock('../../api/appointmentSettings', () => ({
  fetchAllEmployees: vi.fn().mockResolvedValue([]),
  fetchEmployeeRoles: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/branchInventory', () => ({
  listPracticeBranches: vi.fn().mockResolvedValue([]),
}));

const rule = (over: Partial<TaskAutomationRule> = {}): TaskAutomationRule => ({
  id: 1,
  practiceId: 1,
  trigger: 'invoice_open',
  name: 'Invoice open',
  isEnabled: true,
  timingMode: 'age',
  thresholdMinutes: 60,
  endOfDayHour: 18,
  weeklyDay: 4,
  assigneeMode: 'owner',
  assigneeRoleId: null,
  assigneeEmployeeId: null,
  watcherRoleIds: [],
  watcherEmployeeIds: [],
  queueRoleId: null,
  branchId: null,
  titleTemplate: 'T',
  bodyTemplate: null,
  priority: null,
  dueInHours: null,
  recreateIfIncomplete: false,
  lastRunAt: null,
  lastError: null,
  lastErrorAt: null,
  ...over,
});

describe('SettingsAutomaticTasks run note (T-Q6)', () => {
  it('T-Q6-1: shows the end-of-day note in the same toolbar as Run now, for admins', async () => {
    list.mockResolvedValue({ rules: [rule()], placeholders: {} });
    render(<SettingsAutomaticTasks practiceId={1} />);

    const runNow = await screen.findByRole('button', { name: 'Run now' });
    const note = screen.getByText('End-of-day rules wait for their hour.');
    expect(runNow.parentElement).toBe(note.parentElement);
  });
});
