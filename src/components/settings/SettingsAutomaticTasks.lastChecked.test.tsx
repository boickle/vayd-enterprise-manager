/** T-B5: "Last checked" in an open rule shows Eastern time with "ET", whatever the computer's zone. */
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('SettingsAutomaticTasks last checked (T-B5)', () => {
  it('T-B5-1: shows 6:00 PM ET for 23:00Z on Nov 12, even under TZ=UTC', async () => {
    list.mockResolvedValue({
      rules: [rule({ lastRunAt: '2026-11-12T23:00:00Z' })],
      placeholders: {},
    });
    render(<SettingsAutomaticTasks practiceId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByText(/Last checked/)).toHaveTextContent('Last checked Nov 12, 6:00 PM ET.');
  });
});
