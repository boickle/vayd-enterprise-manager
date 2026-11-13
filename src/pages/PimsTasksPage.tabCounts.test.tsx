import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// T-B7 (owner, Nov 13, 2026): a tab's count must match the list under it. The summary can be stale (no refresh
// on tab switch) and doesn't know about the queue picker, so once a list has loaded the tab shows the list's count.

const ME = 5;
const base = { status: 'open', kind: 'general', priority: 'normal', dueAt: null, startAt: null, links: [], watchers: [] };
const mine = [
  { ...base, id: 1, title: 'Call Maria Rivera', assignedToEmployeeId: ME, queueRoleId: null },
  { ...base, id: 2, title: 'Restock the car kit', assignedToEmployeeId: ME, queueRoleId: null },
];
const queue = [
  { ...base, id: 11, title: 'Refund Juniper', assignedToEmployeeId: null, queueRoleId: 30 },
  { ...base, id: 12, title: 'Consent for Pippin', assignedToEmployeeId: null, queueRoleId: 31 },
  { ...base, id: 13, title: 'Call back Lee', assignedToEmployeeId: null, queueRoleId: 30 },
];

vi.mock('../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../api/tasks')>()),
  listTasks: async (q: { involvement?: string; roleId?: number }) => {
    if (q.involvement === 'assigned') return { items: mine, total: mine.length };
    if (q.involvement === 'unassigned') {
      const rows = q.roleId ? queue.filter((t) => t.queueRoleId === q.roleId) : queue;
      return { items: rows, total: rows.length };
    }
    return { items: [], total: 0 };
  },
  patchTask: vi.fn(),
  // Stale summary: says 5 active and 4 unassigned while the lists hold 2 and 3.
  fetchTasksSummary: async () => ({
    assigned: { active: 5, expired: 0, upcoming: 0, total: 5 },
    watching: { active: 0, expired: 0, upcoming: 0, total: 0 },
    unassigned: { active: 4, expired: 0, upcoming: 0, total: 4 },
    myBranchIds: [],
  }),
  getTask: vi.fn(async () => ({ links: [] })),
  completeTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ token: null, role: ['employee'], userEmail: 'casey@example.com', userId: '1', doctorId: String(ME) }),
}));
vi.mock('../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => [
    { id: ME, firstName: 'Casey', lastName: 'Morgan', email: 'casey@example.com', roleIds: [30, 31] },
  ],
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

const renderPage = () =>
  render(
    <MemoryRouter>
      <PimsTasksPage />
    </MemoryRouter>,
  );

describe('Tasks page: tab counts match the list (T-B7)', () => {
  it('Active shows the number of cards in its list, not a stale summary', async () => {
    renderPage();
    expect(await screen.findByText('Call Maria Rivera')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Active/ }).textContent).toBe('Active (2)'));
    expect(screen.getByText('2 tasks')).toBeTruthy();
  });

  it('Unassigned shows the list total, and follows the queue picker', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /Unassigned/ }));
    expect(await screen.findByText('Refund Juniper')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Unassigned/ }).textContent).toBe('Unassigned (3)'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Show a queue' }), { target: { value: '30' } });
    await waitFor(() => expect(screen.queryByText('Consent for Pippin')).toBeNull());
    await waitFor(() => expect(screen.getByRole('tab', { name: /Unassigned/ }).textContent).toBe('Unassigned (2)'));
    expect(screen.getByText('2 tasks')).toBeTruthy();
  });
});
