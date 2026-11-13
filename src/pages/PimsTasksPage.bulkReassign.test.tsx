import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-B10: an admin viewing another person's list re-assigns THAT person's tasks (not their own).
// T-Q4: the bulk buttons are on Active, Expired and Future; only Future is limited to upcoming tasks.

const ME = 5;
const JORDAN = 7;
const ROBIN = 8;
const DAY = 24 * 3600 * 1000;
const mk = (id: number, owner: number, dates: { startAt?: string; dueAt?: string } = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'open',
  kind: 'general',
  priority: 'normal',
  assignedToEmployeeId: owner,
  dueAt: dates.dueAt ?? null,
  startAt: dates.startAt ?? null,
  links: [],
  watchers: [],
});

const listTasks = vi.fn(async (q: { involvement?: string; bucket?: string; forEmployeeId?: number }) => {
  if (q.involvement === 'assigned') {
    const owner = q.forEmployeeId ?? ME;
    const past = new Date(Date.now() - 3 * DAY).toISOString();
    const later = new Date(Date.now() + 10 * DAY).toISOString();
    const items = [
      mk(owner * 100 + 1, owner),
      mk(owner * 100 + 2, owner),
      mk(owner * 100 + 11, owner, { dueAt: past }),
      mk(owner * 100 + 12, owner, { dueAt: past }),
      mk(owner * 100 + 21, owner, { startAt: later, dueAt: later }),
      mk(owner * 100 + 22, owner, { startAt: later, dueAt: later }),
    ];
    return { items, total: items.length };
  }
  return { items: [], total: 0 };
});
const reassignFromEmployee = vi.fn();

vi.mock('../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../api/tasks')>()),
  listTasks: (q: any) => listTasks(q),
  reassignFromEmployee: (b: any) => reassignFromEmployee(b),
  fetchTasksSummary: async () => ({
    assigned: { active: 2, expired: 2, upcoming: 2, total: 6 },
    watching: { active: 0, expired: 0, upcoming: 0, total: 0 },
    unassigned: { active: 0, expired: 0, upcoming: 0, total: 0 },
    myBranchIds: [],
  }),
  getTask: vi.fn(),
  completeTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ token: null, role: ['admin'], userEmail: 'admin@example.com', userId: '1', doctorId: String(ME) }),
}));
vi.mock('../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => [
    { id: ME, firstName: 'Admin', lastName: 'Me', email: 'admin@example.com', isActive: true },
    { id: JORDAN, firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com', isActive: true },
    { id: ROBIN, firstName: 'Robin', lastName: 'Ng', email: 'robin@example.com', isActive: true },
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

describe('Tasks page: bulk re-assign', () => {
  beforeEach(() => {
    listTasks.mockClear();
    reassignFromEmployee.mockReset();
    reassignFromEmployee.mockResolvedValue({ reassigned: 2, taskIds: [71, 72], closedAsDuplicate: [] });
  });

  it.each(['Active', 'Expired', 'Future'])('T-Q4-1: %s shows both bulk buttons and the pick boxes', async (name) => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(name) }));
    expect(await screen.findByRole('button', { name: /Re-assign selected/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-assign all on this tab' })).toBeTruthy();
    expect(screen.getByLabelText('Select all')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Select Task/).length).toBeGreaterThan(0);
  });

  it('T-Q4-2: Active sends upcomingOnly false and a label without "future"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Re-assign all on this tab' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Move 2 tasks to someone else')).toBeTruthy();
    fireEvent.change(within(dialog).getAllByRole('combobox')[0], { target: { value: String(ROBIN) } });
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(reassignFromEmployee).toHaveBeenCalled());
    expect(reassignFromEmployee.mock.calls[0][0]).toMatchObject({
      fromEmployeeId: ME,
      toEmployeeId: ROBIN,
      upcomingOnly: false,
    });
  });

  it('T-Q4-3 / T-B10-3: viewing Jordan on Future sends Jordan\'s id, upcomingOnly true, and Jordan is not in the picker', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('View tasks for'), { target: { value: String(JORDAN) } });
    fireEvent.click(await screen.findByRole('tab', { name: /Future/ }));
    await screen.findByText('Task 721');
    fireEvent.click(screen.getByRole('button', { name: 'Re-assign all on this tab' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Move 2 future tasks to someone else')).toBeTruthy();
    const options = within(dialog.querySelector('select') as HTMLElement).getAllByRole('option').map((o) => o.textContent);
    expect(options.join('|')).toContain('Robin');
    expect(options.join('|')).not.toContain('Jordan');
    expect(options.join('|')).toContain('Admin');
    fireEvent.change(dialog.querySelector('select') as HTMLSelectElement, { target: { value: String(ROBIN) } });
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(reassignFromEmployee).toHaveBeenCalled());
    expect(reassignFromEmployee.mock.calls[0][0]).toMatchObject({
      fromEmployeeId: JORDAN,
      toEmployeeId: ROBIN,
      upcomingOnly: true,
      taskIds: [721, 722],
    });
  });
});
