import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// P-21: after "Assign to me" on the Unassigned tab, the Active tab count went up but its list stayed
// empty until a reload: the page's own-tasks list was only reloaded while an Active/Expired/Future tab
// was open.

const ME = 5;
const task = {
  id: 41,
  title: 'Refund Juniper visit',
  status: 'open',
  kind: 'general',
  priority: 'normal',
  assignedToEmployeeId: null as number | null,
  dueAt: null,
  startAt: null,
  links: [],
  watchers: [],
};
let claimed = false;

const listTasks = vi.fn(async (q: { involvement?: string }) => {
  if (q.involvement === 'unassigned') return { items: claimed ? [] : [task], total: claimed ? 0 : 1 };
  if (q.involvement === 'assigned') {
    const items = claimed ? [{ ...task, assignedToEmployeeId: ME }] : [];
    return { items, total: items.length };
  }
  return { items: [], total: 0 };
});
const patchTask = vi.fn(async () => {
  claimed = true;
  return { ...task, assignedToEmployeeId: ME };
});

vi.mock('../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../api/tasks')>()),
  listTasks: (q: any) => listTasks(q),
  patchTask: () => patchTask(),
  fetchTasksSummary: async () => ({
    assigned: { active: claimed ? 1 : 0, expired: 0, upcoming: 0, total: claimed ? 1 : 0 },
    watching: { active: 0, expired: 0, upcoming: 0, total: 0 },
    unassigned: { active: claimed ? 0 : 1, expired: 0, upcoming: 0, total: claimed ? 0 : 1 },
    myBranchIds: [],
  }),
  getTask: vi.fn(),
  completeTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ token: null, role: ['employee'], userEmail: 'robin@example.com', userId: '1', doctorId: String(ME) }),
}));
vi.mock('../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('../api/appointmentSettings', () => ({ fetchAllEmployees: async () => [], fetchEmployeeRoles: async () => [] }));
vi.mock('../utils/taskRealtime', () => ({ subscribePracticeTasks: () => () => undefined }));
vi.mock('../utils/taskLinkDisplay', async (orig) => ({
  ...(await orig<typeof import('../utils/taskLinkDisplay')>()),
  useTaskLinkLabels: () => ({}),
}));

import PimsTasksPage from './PimsTasksPage';

describe('Tasks page: a claimed task shows on the Active tab without a reload (P-21)', () => {
  beforeEach(() => {
    claimed = false;
    listTasks.mockClear();
  });

  it('lists the task on Active right after Assign to me on Unassigned', async () => {
    render(
      <MemoryRouter>
        <PimsTasksPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Unassigned/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Assign to me' }));
    await waitFor(() => expect(patchTask).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: /Active/ }));
    expect(await screen.findByText('Refund Juniper visit')).toBeTruthy();
  });
});
