import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// Owner, Nov 11, 2026: "Role: Any role" read as if a CL-queue task were open to every role. Cards say whose
// queue a task is on (or "Anyone"), and the Unassigned filter is "Show: All my queues" with only your queues.

const ME = 5;
const base = { status: 'open', kind: 'general', priority: 'normal', assignedToEmployeeId: null, dueAt: null, startAt: null, links: [], watchers: [] };
const tasks = [
  { ...base, id: 41, title: "Refund Juniper's visit", queueRoleId: 30 },
  { ...base, id: 42, title: 'Consent signed for Pippin', queueRoleId: null },
];

vi.mock('../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../api/tasks')>()),
  listTasks: async (q: { involvement?: string }) =>
    q.involvement === 'unassigned' ? { items: tasks, total: tasks.length } : { items: [], total: 0 },
  patchTask: vi.fn(),
  fetchTasksSummary: async () => ({
    assigned: { active: 0, expired: 0, upcoming: 0, total: 0 },
    watching: { active: 0, expired: 0, upcoming: 0, total: 0 },
    unassigned: { active: 2, expired: 0, upcoming: 0, total: 2 },
    myBranchIds: [],
  }),
  getTask: vi.fn(),
  completeTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ token: null, role: ['employee'], userEmail: 'casey@example.com', userId: '1', doctorId: String(ME) }),
}));
vi.mock('../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => [{ id: ME, firstName: 'Casey', lastName: 'Morgan', email: 'casey@example.com', roleIds: [30] }],
  fetchEmployeeRoles: async () => [
    { id: 30, name: 'Client Liaison', roleValue: 'client_liaison' },
    { id: 31, name: 'Technician', roleValue: 'technician' },
  ],
}));
vi.mock('../utils/taskRealtime', () => ({ subscribePracticeTasks: () => () => undefined }));
vi.mock('../utils/taskLinkDisplay', async (orig) => ({
  ...(await orig<typeof import('../utils/taskLinkDisplay')>()),
  useTaskLinkLabels: () => ({}),
}));

import PimsTasksPage from './PimsTasksPage';

describe('Tasks page: queue wording', () => {
  it("cards name the queue (or Anyone) and the filter lists only the person's queues", async () => {
    render(
      <MemoryRouter>
        <PimsTasksPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Unassigned/ }));
    expect(await screen.findByText(/Unassigned · Client Liaison queue/)).toBeTruthy();
    expect(screen.getByText(/Unassigned · Anyone/)).toBeTruthy();

    const filter = screen.getByRole('combobox', { name: 'Show a queue' });
    const options = within(filter).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All my queues', 'Client Liaison queue']);
    expect(screen.queryByText('Any role')).toBeNull();
  });
});
