/** T-B3: an automatic task says "Automatic" in its source pill, not the raw source name. */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./CallbackJotPanel', () => ({ default: () => null }));
vi.mock('../../hooks/useOutboundCallFromLine', () => ({ useOutboundCallFromLine: () => ({}) }));
vi.mock('../../utils/extractUploadText', () => ({ extractUploadText: vi.fn() }));

const getTask = vi.fn();
vi.mock('../../api/tasks', () => ({
  getTask: (...a: unknown[]) => getTask(...a),
  patchTask: vi.fn(),
  updateTask: vi.fn(),
  reassignFromEmployee: vi.fn(),
}));

import PimsTaskDetailView from './PimsTaskDetailView';

const baseTask = {
  id: 7,
  title: 'Close the invoice',
  body: null,
  status: 'open',
  priority: 'normal',
  assignedToEmployeeId: null,
  createdByEmployeeId: null,
  queueRoleId: null,
  startAt: null,
  dueAt: null,
  created: '2026-11-10T15:00:00.000Z',
  updated: '2026-11-10T15:00:00.000Z',
  branchIds: [],
  watchers: [],
  links: [],
  events: [],
};

const props = {
  taskId: 7,
  branches: [],
  employees: [],
  roles: [],
  myEmployeeId: null,
  isPracticeAdmin: true,
  onBack: () => {},
  onUpdated: () => {},
};

describe('PimsTaskDetailView source pill (T-B3)', () => {
  beforeEach(() => {
    getTask.mockReset();
  });

  it('T-B3-1: an automatic task shows "Automatic" and never the raw "trigger" text', async () => {
    getTask.mockResolvedValue({ ...baseTask, source: 'trigger' });
    const { container } = render(<PimsTaskDetailView {...props} />);
    await waitFor(() => expect(container.querySelector('.pims-task-detail__pill')).not.toBeNull());

    const pill = container.querySelector('.pims-task-detail__pill');
    expect(pill?.textContent).toBe('Automatic');
    expect(container.textContent).not.toMatch(/\btrigger\b/);
  });

  it('T-B3-2: a manual task shows no source pill', async () => {
    getTask.mockResolvedValue({ ...baseTask, source: 'manual' });
    const { container } = render(<PimsTaskDetailView {...props} />);
    await waitFor(() => expect(container.textContent).toContain('Close the invoice'));

    expect(container.querySelector('.pims-task-detail__pill')).toBeNull();
  });
});
