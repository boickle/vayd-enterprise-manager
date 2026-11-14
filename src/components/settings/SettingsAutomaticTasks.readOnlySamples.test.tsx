/** T-B12: the read-only (practice manager) view shows rule wording with sample names, never raw {{placeholders}}. */
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
  trigger: 'membership_signup_failed',
  name: 'Membership sign-up failed',
  isEnabled: true,
  timingMode: 'age',
  thresholdMinutes: 120,
  endOfDayHour: 18,
  weeklyDay: 4,
  assigneeMode: 'queue',
  assigneeRoleId: null,
  assigneeEmployeeId: null,
  watcherRoleIds: [],
  watcherEmployeeIds: [],
  queueRoleId: null,
  branchId: null,
  titleTemplate: '{{client}} tried to sign up for a membership',
  bodyTemplate: null,
  priority: null,
  dueInHours: null,
  recreateIfIncomplete: false,
  lastRunAt: null,
  lastError: null,
  lastErrorAt: null,
  ...over,
});

describe('SettingsAutomaticTasks read-only samples (T-B12)', () => {
  it('T-B12-1: fills client, patient and plan with sample names and leaves no {{', async () => {
    list.mockResolvedValue({
      rules: [
        rule({
          bodyTemplate:
            '{{client}} tried to sign {{patient}} up for {{plan}} and it didn\'t go through.',
        }),
      ],
      placeholders: {},
    });
    const { container } = render(<SettingsAutomaticTasks practiceId={1} readOnly />);

    const copy = await screen.findByText(/^Maria Rivera tried to sign/);
    expect(copy).toHaveTextContent(
      "Maria Rivera tried to sign Maple up for PLUS and it didn't go through.",
    );
    expect(container.textContent).not.toContain('{{');
  });

  it('T-B12-1: every placeholder a rule can use gets a sample, not raw braces', async () => {
    const all =
      '{{patient}} {{client}} {{doctor}} {{opened}} {{branch}} {{invoice}} {{total}} {{headline}} ' +
      '{{items}} {{item}} {{count}} {{lab}} {{forms}} {{phone}} {{reason}} {{when}} {{plan}} ' +
      '{{week}} {{lastDownload}}';
    list.mockResolvedValue({
      rules: [rule({ bodyTemplate: all })],
      placeholders: {},
    });
    const { container } = render(<SettingsAutomaticTasks practiceId={1} readOnly />);

    await screen.findByText(/Maria Rivera/);
    expect(container.textContent).not.toContain('{{');
    expect(container.textContent).not.toContain('}}');
  });
});
