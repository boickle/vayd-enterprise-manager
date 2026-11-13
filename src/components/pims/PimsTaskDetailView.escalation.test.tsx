import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  title: 'Call client back',
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
  escalation: {
    nextEscalationAt: '2026-11-12T16:00:00.000Z',
    intervalSeconds: 3600,
    escalationCount: 2,
  },
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

describe('PimsTaskDetailView escalation UI (TA-A1)', () => {
  beforeEach(() => {
    getTask.mockReset();
  });

  it('TA-A1-1: hides the Escalation section and interval field, in view and Edit', async () => {
    getTask.mockResolvedValue(baseTask);
    render(<PimsTaskDetailView {...props} />);
    await waitFor(() => expect(screen.getByText('Call client back')).toBeTruthy());

    expect(screen.queryByRole('heading', { name: 'Escalation' })).toBeNull();
    expect(screen.queryByText('Next reminder')).toBeNull();
    expect(screen.queryByText('Count')).toBeNull();

    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => expect(screen.getByText('Edit task')).toBeTruthy());
    expect(screen.queryByText(/Escalation interval/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Escalation' })).toBeNull();
  });

  it('TA-A1-2: hides the escalation banner but history still lists the reminder', async () => {
    getTask.mockResolvedValue({
      ...baseTask,
      events: [
        {
          id: 1,
          eventType: 'escalation_sent',
          actorEmployeeId: null,
          payload: null,
          created: '2026-11-12T16:00:00.000Z',
        },
      ],
    });
    render(<PimsTaskDetailView {...props} />);
    await waitFor(() => expect(screen.getByText('Call client back')).toBeTruthy());

    expect(screen.queryByTitle('Latest history event is an escalation reminder')).toBeNull();
    expect(screen.queryByText('Escalation')).toBeNull();
    expect(screen.getByText('Escalation reminder')).toBeTruthy();
  });
});
