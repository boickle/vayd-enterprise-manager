/** TA-A4-2: a rule whose last run hit an error shows a warning with the message and Eastern time. */
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

const rule = (id: number, over: Partial<TaskAutomationRule> = {}): TaskAutomationRule => ({
  id,
  practiceId: 1,
  trigger: 'invoice_open',
  name: `Rule ${id}`,
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

it('shows the message and the Eastern time under a rule with lastError, and nothing otherwise', async () => {
  list.mockResolvedValue({
    rules: [
      rule(1, { lastError: 'invoice:abc-123: boom', lastErrorAt: '2036-12-04T14:00:00Z' }),
      rule(2),
    ],
    placeholders: {},
  });
  render(<SettingsAutomaticTasks practiceId={1} />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('invoice:abc-123: boom');
  // 14:00 UTC on Dec 4 is 9:00 AM EST.
  expect(alert).toHaveTextContent('Dec 4, 2036');
  expect(alert).toHaveTextContent('9:00 AM EST');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});
