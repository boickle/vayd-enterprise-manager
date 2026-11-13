import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-Q5-4: a practice manager gets the Person box with only the people at their branch(es)
// (the API sends them as personEmployeeIds); other staff don't get it.

const ME = 5;
const JORDAN = 7;
const CASEY = 9; // another branch
let personEmployeeIds: number[] | undefined;

const listTasks = vi.fn(async (_q: { involvement?: string; forEmployeeId?: number }) => ({
  items: [],
  total: 0,
}));

vi.mock('../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../api/tasks')>()),
  listTasks: (q: any) => listTasks(q),
  reassignFromEmployee: vi.fn(),
  fetchTasksSummary: async () => ({
    assigned: { active: 0, expired: 0, upcoming: 0, total: 0 },
    watching: { active: 0, expired: 0, upcoming: 0, total: 0 },
    unassigned: { active: 0, expired: 0, upcoming: 0, total: 0 },
    myBranchIds: [1],
    ...(personEmployeeIds ? { personEmployeeIds } : {}),
  }),
  getTask: vi.fn(),
  completeTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ token: null, role: ['employee'], userEmail: 'me@example.com', userId: '1', doctorId: String(ME) }),
}));
vi.mock('../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => [
    { id: ME, firstName: 'Pat', lastName: 'Manager', email: 'me@example.com', isActive: true },
    { id: JORDAN, firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com', isActive: true },
    { id: CASEY, firstName: 'Casey', lastName: 'Far', email: 'casey@example.com', isActive: true },
  ],
  fetchEmployeeRoles: async () => [],
}));
vi.mock('../utils/taskRealtime', () => ({ subscribePracticeTasks: () => () => undefined }));
vi.mock('../utils/taskLinkDisplay', async (orig) => ({
  ...(await orig<typeof import('../utils/taskLinkDisplay')>()),
  useTaskLinkLabels: () => ({}),
}));

import PimsTasksPage from './PimsTasksPage';

function renderPage() {
  render(
    <MemoryRouter>
      <PimsTasksPage />
    </MemoryRouter>,
  );
}

describe('Tasks page: Person box for practice managers (T-Q5-4)', () => {
  beforeEach(() => {
    listTasks.mockClear();
    personEmployeeIds = undefined;
  });

  it("shows for a practice manager with only their branch's people, and views the chosen person", async () => {
    personEmployeeIds = [ME, JORDAN];
    renderPage();
    const box = await screen.findByLabelText('View tasks for');
    await waitFor(() => expect(within(box).getAllByRole('option').length).toBe(2));
    const names = within(box)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Me', 'Jordan Lee']);
    fireEvent.change(box, { target: { value: String(JORDAN) } });
    await waitFor(() =>
      expect(listTasks).toHaveBeenCalledWith(expect.objectContaining({ forEmployeeId: JORDAN })),
    );
  });

  it('is hidden for other staff', async () => {
    personEmployeeIds = [];
    renderPage();
    await screen.findByRole('tab', { name: /Active/ });
    await waitFor(() => expect(listTasks).toHaveBeenCalled());
    expect(screen.queryByLabelText('View tasks for')).toBeNull();
  });
});
