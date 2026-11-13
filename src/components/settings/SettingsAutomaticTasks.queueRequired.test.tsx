/** TA-A2-2: a rule in queue mode cannot be saved with "No queue"; no request is sent. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsAutomaticTasks from './SettingsAutomaticTasks';
import type { TaskAutomationRule } from '../../api/taskAutomation';

const list = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
vi.mock('../../api/taskAutomation', () => ({
  listTaskAutomationRules: (...a: unknown[]) => list(...a),
  patchTaskAutomationRule: (...a: unknown[]) => patch(...a),
  runTaskAutomationRules: vi.fn(),
}));
vi.mock('../../api/appointmentSettings', () => ({
  fetchAllEmployees: vi.fn().mockResolvedValue([]),
  fetchEmployeeRoles: vi.fn().mockResolvedValue([
    { id: 3, name: 'Inventory Manager', roleValue: 3, slug: 'inventory_manager' },
  ]),
}));
vi.mock('../../api/branchInventory', () => ({
  listPracticeBranches: vi.fn().mockResolvedValue([]),
}));

const rule = (over: Partial<TaskAutomationRule> = {}): TaskAutomationRule => ({
  id: 1,
  practiceId: 1,
  trigger: 'order_list_item',
  name: 'Order list',
  isEnabled: true,
  timingMode: 'age',
  thresholdMinutes: 60,
  endOfDayHour: 18,
  weeklyDay: 4,
  assigneeMode: 'queue',
  assigneeRoleId: null,
  assigneeEmployeeId: null,
  watcherRoleIds: [],
  watcherEmployeeIds: [],
  queueRoleId: 3,
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

beforeEach(() => {
  patch.mockReset();
  patch.mockResolvedValue(rule());
});

it('does not offer "No queue" for a queue-mode rule, and sends no request if it is chosen', async () => {
  list.mockResolvedValue({ rules: [rule()], placeholders: {} });
  render(<SettingsAutomaticTasks practiceId={1} />);
  await screen.findByText('Order list');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

  const noQueue = await screen.findByRole('option', { name: 'No queue' });
  expect(noQueue).toBeDisabled();

  const queueSelect = screen.getByLabelText('Queue it sits on when nobody is found');
  fireEvent.change(queueSelect, { target: { value: '' } });
  await waitFor(() => expect(patch).not.toHaveBeenCalled());
});

it('still lets a rule in another mode clear its queue', async () => {
  list.mockResolvedValue({ rules: [rule({ assigneeMode: 'owner' })], placeholders: {} });
  patch.mockResolvedValue(rule({ assigneeMode: 'owner', queueRoleId: null }));
  render(<SettingsAutomaticTasks practiceId={1} />);
  await screen.findByText('Order list');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

  const noQueue = await screen.findByRole('option', { name: 'No queue' });
  expect(noQueue).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText('Queue it sits on when nobody is found'), {
    target: { value: '' },
  });
  await waitFor(() => expect(patch).toHaveBeenCalledWith(1, 1, { queueRoleId: null }));
});
