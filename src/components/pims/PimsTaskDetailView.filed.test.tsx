/** T-B6-1: after Chart & complete the panel closes as the task completes, but the "Call filed …" message stays visible. */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type PanelProps = { onFiled?: (m: string) => void; onDone: () => void };
const panel = vi.hoisted(() => ({ props: null as PanelProps | null }));
vi.mock('./CallbackJotPanel', () => ({
  // Stands in for the real panel: it files, reports the message, then the task completes and the panel unmounts.
  default: (props: PanelProps) => {
    panel.props = props;
    return null;
  },
}));
vi.mock('../../hooks/useOutboundCallFromLine', () => ({ useOutboundCallFromLine: () => ({}) }));
vi.mock('../../utils/extractUploadText', () => ({ extractUploadText: vi.fn() }));

const getTask = vi.fn();
vi.mock('../../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../../api/tasks')>()),
  getTask: (...a: unknown[]) => getTask(...a),
  patchTask: vi.fn(),
  updateTask: vi.fn(),
  reassignFromEmployee: vi.fn(),
}));

import PimsTaskDetailView from './PimsTaskDetailView';

const baseTask = {
  id: 7,
  title: 'Call Maria back',
  body: null,
  kind: 'callback',
  source: 'manual',
  status: 'open',
  priority: 'normal',
  assignedToEmployeeId: 4,
  createdByEmployeeId: 4,
  queueRoleId: null,
  startAt: null,
  dueAt: null,
  created: '2026-11-12T15:00:00.000Z',
  updated: '2026-11-12T15:00:00.000Z',
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
  myEmployeeId: 4,
  isPracticeAdmin: false,
  onBack: () => {},
  onUpdated: () => {},
};

describe('PimsTaskDetailView filed confirmation (T-B6)', () => {
  beforeEach(() => {
    getTask.mockReset();
    panel.props = null;
  });

  it('T-B6-1: the filed message stays visible after the task completes and the panel closes', async () => {
    getTask.mockResolvedValue(baseTask);
    render(<PimsTaskDetailView {...props} />);
    await waitFor(() => expect(panel.props).not.toBeNull());

    const message = "Call filed to Maple's record and the callback is done.";
    getTask.mockResolvedValue({ ...baseTask, status: 'done' });
    await act(async () => {
      panel.props?.onFiled?.(message);
      await panel.props?.onDone();
    });

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });
});
