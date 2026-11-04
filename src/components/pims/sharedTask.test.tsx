/**
 * SCH-E shared tasks on the task screen: the "Shared with …" and "Watching: …" lines, the
 * "Also close it for …?" prompt, and the reopen prompt. Plus the labs-task helper that makes
 * the linked copies in one request.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail, TaskShareGroupMember } from '../../api/tasks';

const api = vi.hoisted(() => ({
  getTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  patchTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../../api/tasks')>()),
  ...api,
}));
// pdf.js (pulled in by chart panels) cannot load in this test environment; not used here.
vi.mock('../../utils/extractUploadText', () => ({ extractTextFromUpload: vi.fn() }));
vi.mock('../RoomLoaderPdfCanvas', () => ({ RoomLoaderPdfCanvas: () => null }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ employeeId: '7', role: ['employee'] }) }));
vi.mock('../../auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('../../auth/AuthProvider')>()),
  useAuth: () => ({ employeeId: '7', role: ['employee'] }),
}));
vi.mock('../../utils/taskLinkDisplay', async (orig) => ({
  ...(await orig<typeof import('../../utils/taskLinkDisplay')>()),
  useTaskLinkLabels: () => ({}),
}));

import PimsTaskDetailView from './PimsTaskDetailView';
import TaskReopenModal from './TaskReopenModal';
import { createLabsPendingForwardBookingTasks } from '../forwardBooking/saveForwardBookingDecision';

const employees = [
  { id: 7, firstName: 'Lena', lastName: 'Crispell', email: 'lc@x.test', isActive: true },
  { id: 21, firstName: 'Jen', lastName: 'Ortiz', email: 'jo@x.test', isActive: true },
  { id: 22, firstName: 'Sam', lastName: 'Lee', email: 'sl@x.test', isActive: false },
  { id: 31, firstName: 'Mo', lastName: 'Director', email: 'md@x.test', isActive: true },
  { id: 40, firstName: 'Ana', lastName: 'New', email: 'an@x.test', isActive: true },
] as never[];

const member = (
  employeeId: number,
  firstName: string,
  lastName: string,
  o: Partial<TaskShareGroupMember> = {}
): TaskShareGroupMember => ({
  employeeId,
  firstName,
  lastName,
  isActive: true,
  isOpen: true,
  isThisCopy: false,
  ...o,
});

function labsTask(o: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 501,
    practiceId: 1,
    title: 'Forward book Biscuit once labs are back',
    body: null,
    status: 'assigned',
    assignedToEmployeeId: 7,
    queueRoleId: null,
    defaultAssigneeEmployeeId: null,
    createdByEmployeeId: 7,
    startAt: null,
    dueAt: null,
    priority: null,
    source: 'manual',
    kind: 'forward_booking',
    triggerDefinitionId: null,
    completedAt: null,
    resolution: null,
    resolutionNote: null,
    created: '2026-11-03T14:00:00Z',
    updated: '2026-11-03T14:00:00Z',
    branchIds: [1],
    shareGroupId: 'g-1',
    shareGroup: {
      id: 'g-1',
      members: [member(7, 'Lena', 'Crispell', { isThisCopy: true }), member(21, 'Jen', 'Ortiz')],
    },
    watchers: [{ employeeId: 31, addedByEmployeeId: 7, created: '2026-11-03T14:00:00Z' }],
    links: [
      { id: 1, entityType: 'appointment', entityId: 104 },
      { id: 2, entityType: 'patient', entityId: 4 },
      { id: 3, entityType: 'client', entityId: 50 },
    ],
    escalation: null,
    events: [],
    ...o,
  };
}

function renderDetail() {
  render(
    <MemoryRouter>
      <PimsTaskDetailView
        taskId={501}
        branches={[]}
        employees={employees}
        myEmployeeId={7}
        isPracticeAdmin={false}
        onBack={vi.fn()}
        onUpdated={vi.fn()}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('labs-pending task helper', () => {
  it('makes one shared-task request for several people, watchers not doubled up', async () => {
    api.createTask.mockResolvedValue({ id: 91 });
    const id = await createLabsPendingForwardBookingTasks({
      title: 'Forward book Biscuit once labs are back',
      branchIds: [1],
      assigneeEmployeeIds: [7, 21, 7],
      watcherEmployeeIds: [21, 31],
      startAt: '2026-11-06T14:00:00Z',
      dueAt: null,
      links: [{ entityType: 'patient', entityId: 4 }],
    });
    expect(id).toBe(91);
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(api.createTask.mock.calls[0][0]).toMatchObject({
      kind: 'forward_booking',
      assignedToEmployeeId: 7,
      assignedToEmployeeIds: [7, 21],
      watcherEmployeeIds: [31],
      branchIds: [1],
    });
  });

  it('one person is an ordinary task', async () => {
    api.createTask.mockResolvedValue({ id: 92 });
    await createLabsPendingForwardBookingTasks({
      title: 't',
      branchIds: [1],
      assigneeEmployeeIds: [7],
      startAt: null,
      dueAt: null,
      links: [],
    });
    expect(api.createTask.mock.calls[0][0]).not.toHaveProperty('assignedToEmployeeIds');
    expect(api.createTask.mock.calls[0][0].assignedToEmployeeId).toBe(7);
  });
});

describe('task screen', () => {
  it('shows Shared with every member (inactive marked) and who is watching', async () => {
    api.getTask.mockResolvedValue(
      labsTask({
        shareGroup: {
          id: 'g-1',
          members: [
            member(7, 'Lena', 'Crispell', { isThisCopy: true }),
            member(21, 'Jen', 'Ortiz'),
            member(22, 'Sam', 'Lee', { isActive: false, isOpen: false }),
          ],
        },
      })
    );
    renderDetail();
    expect(await screen.findByText('Shared')).toBeTruthy();
    expect(
      screen.getByText('Shared with Lena Crispell · Jen Ortiz · Sam Lee (inactive)')
    ).toBeTruthy();
    expect(screen.getByText('Watching:').parentElement?.textContent).toBe('Watching: Mo Director');
  });

  it('an ordinary task has no Shared line', async () => {
    api.getTask.mockResolvedValue(labsTask({ shareGroupId: null, shareGroup: null, watchers: [] }));
    renderDetail();
    await screen.findByText('Forward book Biscuit once labs are back');
    expect(screen.queryByText('Shared')).toBeNull();
    expect(screen.queryByText('Watching:')).toBeNull();
  });

  it('Mark complete asks "Also close it for …?" and Close for everyone sends alsoCloseFor all', async () => {
    api.getTask.mockResolvedValue(labsTask());
    api.completeTask.mockResolvedValue(labsTask({ status: 'done', resolution: 'completed' }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Also close it for Jen Ortiz?')).toBeTruthy();
    expect(api.completeTask).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close for everyone' }));
    await waitFor(() =>
      expect(api.completeTask).toHaveBeenCalledWith(501, { alsoCloseFor: 'all' })
    );
  });

  it('Just me closes only this copy; Cancel closes nothing', async () => {
    api.getTask.mockResolvedValue(labsTask());
    api.completeTask.mockResolvedValue(labsTask({ status: 'done', resolution: 'completed' }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.completeTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Just me' })
    );
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith(501, {}));
  });

  it('no prompt when nobody else still has it open', async () => {
    api.getTask.mockResolvedValue(
      labsTask({
        shareGroup: {
          id: 'g-1',
          members: [
            member(7, 'Lena', 'Crispell', { isThisCopy: true }),
            member(21, 'Jen', 'Ortiz', { isOpen: false }),
          ],
        },
      })
    );
    api.completeTask.mockResolvedValue(labsTask({ status: 'done' }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith(501, {}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a closed copy offers Reopen', async () => {
    api.getTask.mockResolvedValue(labsTask({ status: 'done', resolution: 'completed' }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    expect(
      await screen.findByText(
        'Reopen for everyone (Lena Crispell and Jen Ortiz) or just one person?'
      )
    ).toBeTruthy();
  });
});

describe('reopen prompt', () => {
  const closed = (members: TaskShareGroupMember[]) =>
    labsTask({ status: 'done', resolution: 'completed', shareGroup: { id: 'g-1', members } });

  it('everyone: reopens for every member still active', async () => {
    api.reopenTask.mockResolvedValue(labsTask());
    const onReopened = vi.fn();
    render(
      <TaskReopenModal
        task={closed([
          member(7, 'Lena', 'Crispell', { isThisCopy: true, isOpen: false }),
          member(21, 'Jen', 'Ortiz', { isOpen: false }),
          member(22, 'Sam', 'Lee', { isActive: false, isOpen: false }),
        ])}
        employees={employees}
        onClose={vi.fn()}
        onReopened={onReopened}
      />
    );
    // Only active people are offered.
    expect(
      screen.getByText('Reopen for everyone (Lena Crispell and Jen Ortiz) or just one person?')
    ).toBeTruthy();
    expect(screen.queryByLabelText('Sam Lee (inactive)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen for everyone' }));
    await waitFor(() => expect(api.reopenTask).toHaveBeenCalledWith(501, { scope: 'all' }));
    expect(onReopened).toHaveBeenCalled();
  });

  it('just one: reopens for the person picked', async () => {
    api.reopenTask.mockResolvedValue(labsTask());
    render(
      <TaskReopenModal
        task={closed([
          member(7, 'Lena', 'Crispell', { isThisCopy: true, isOpen: false }),
          member(21, 'Jen', 'Ortiz', { isOpen: false }),
        ])}
        employees={employees}
        onClose={vi.fn()}
        onReopened={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Jen Ortiz'));
    fireEvent.click(screen.getByRole('button', { name: 'Just Jen Ortiz' }));
    await waitFor(() => expect(api.reopenTask).toHaveBeenCalledWith(501, { employeeId: 21 }));
  });

  it('nobody active: choose someone else to assign it to', async () => {
    api.reopenTask.mockResolvedValue(labsTask());
    render(
      <TaskReopenModal
        task={closed([
          member(7, 'Lena', 'Crispell', { isThisCopy: true, isOpen: false, isActive: false }),
          member(22, 'Sam', 'Lee', { isActive: false, isOpen: false }),
        ])}
        employees={employees}
        onClose={vi.fn()}
        onReopened={vi.fn()}
      />
    );
    expect(screen.getByText(/Nobody on this task is still active/)).toBeTruthy();
    const select = screen.getByLabelText('Assign the reopened task to') as HTMLSelectElement;
    // Inactive staff are not offered.
    expect([...select.options].map((o) => o.text)).not.toContain('Sam Lee');
    fireEvent.change(select, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(api.reopenTask).toHaveBeenCalledWith(501, { employeeId: 40 }));
  });
});
