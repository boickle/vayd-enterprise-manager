import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '../../api/appointmentSettings';

const getTask = vi.fn();
const patchTask = vi.fn();
const reassignFromEmployee = vi.fn();
vi.mock('../../api/tasks', () => ({
  getTask: (...a: unknown[]) => getTask(...a),
  patchTask: (...a: unknown[]) => patchTask(...a),
  reassignFromEmployee: (...a: unknown[]) => reassignFromEmployee(...a),
}));

import TaskReassignModal from './TaskReassignModal';

const employees = [
  { id: 1, firstName: 'Ann', lastName: 'Lee', email: 'ann@x', isActive: true },
  { id: 2, firstName: 'Bo', lastName: 'Kim', email: 'bo@x', isActive: true },
  { id: 3, firstName: 'Cy', lastName: 'Ng', email: 'cy@x', isActive: true },
  { id: 4, firstName: 'Di', lastName: 'Ox', email: 'di@x', isActive: false },
] as unknown as Employee[];

const baseTask = {
  id: 9,
  title: 'Call back Mrs. Smith',
  assignedToEmployeeId: 1,
  startAt: null,
  dueAt: null,
  created: '2026-11-10T15:00:00.000Z',
};

const addSelect = () => screen.getByLabelText('Add a watcher') as HTMLSelectElement;

describe('Move this task: watchers', () => {
  beforeEach(() => {
    getTask.mockReset();
    patchTask.mockReset();
    patchTask.mockResolvedValue({ id: 9 });
    reassignFromEmployee.mockReset();
    reassignFromEmployee.mockResolvedValue({ reassigned: 1, taskIds: [9], closedAsDuplicate: [] });
  });

  it('adds a watcher on top of the ones already there', async () => {
    render(
      <TaskReassignModal
        task={{ ...baseTask, watchers: [{ employeeId: 2, addedByEmployeeId: 1, created: '' }] }}
        employees={employees}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(addSelect(), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patchTask).toHaveBeenCalled());
    expect(patchTask.mock.calls[0][1].watcherEmployeeIds).toEqual([2, 3]);
    expect(getTask).not.toHaveBeenCalled();
  });

  it('loads current watchers when opened from the list, and leaves them alone if unchanged', async () => {
    getTask.mockResolvedValue({ watchers: [{ employeeId: 3, addedByEmployeeId: 1, created: '' }] });
    render(<TaskReassignModal task={baseTask} employees={employees} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Remove Cy Ng as a watcher')).toBeTruthy());
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patchTask).toHaveBeenCalled());
    expect(patchTask.mock.calls[0][1]).not.toHaveProperty('watcherEmployeeIds');
  });

  it('never sends watchers if the current list could not be loaded', async () => {
    getTask.mockRejectedValue(new Error('down'));
    render(<TaskReassignModal task={baseTask} employees={employees} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toContain('Could not load watchers'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patchTask).toHaveBeenCalled());
    expect(patchTask.mock.calls[0][1]).not.toHaveProperty('watcherEmployeeIds');
  });

  it('keeps me watching when I hand off my own task, unless I untick it', async () => {
    const mine = { ...baseTask, watchers: [] };
    const { unmount } = render(
      <TaskReassignModal task={mine} employees={employees} myEmployeeId={1} onClose={() => {}} onSaved={() => {}} />,
    );
    // Still mine: no box.
    expect(screen.queryByLabelText('Keep me watching')).toBeNull();
    fireEvent.change(screen.getByDisplayValue('Ann Lee'), { target: { value: '2' } });
    expect((screen.getByLabelText('Keep me watching') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patchTask).toHaveBeenCalled());
    expect(patchTask.mock.calls[0][1]).toMatchObject({ assignedToEmployeeId: 2, watcherEmployeeIds: [1] });
    unmount();

    patchTask.mockClear();
    render(
      <TaskReassignModal task={mine} employees={employees} myEmployeeId={1} onClose={() => {}} onSaved={() => {}} />,
    );
    fireEvent.change(screen.getByDisplayValue('Ann Lee'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Keep me watching'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patchTask).toHaveBeenCalled());
    expect(patchTask.mock.calls[0][1]).not.toHaveProperty('watcherEmployeeIds');
  });

  it('labels a watcher who has left as inactive', () => {
    render(
      <TaskReassignModal
        task={{ ...baseTask, watchers: [{ employeeId: 4, addedByEmployeeId: 1, created: '' }] }}
        employees={employees}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText('Remove Di Ox (inactive) as a watcher')).toBeTruthy();
  });

  it('bulk Re-assign adds the chosen watchers to every task', async () => {
    render(
      <TaskReassignModal
        bulk={{ fromEmployeeId: 1, taskIds: [9, 10], upcomingOnly: true, label: 'Move 2 future tasks' }}
        employees={employees.filter((e) => e.id !== 1)}
        requireAssignee
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(document.body.textContent).toContain('Each task keeps its own watchers.');
    fireEvent.change(screen.getByDisplayValue('Select a person…'), { target: { value: '2' } });
    // The new owner isn't offered as a watcher.
    expect(
      Array.from(addSelect().options).some((o) => o.value === '2'),
    ).toBe(false);
    fireEvent.change(addSelect(), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(reassignFromEmployee).toHaveBeenCalled());
    expect(reassignFromEmployee.mock.calls[0][0]).toMatchObject({
      toEmployeeId: 2,
      taskIds: [9, 10],
      addWatcherEmployeeIds: [3],
    });
  });
});

describe('Bulk re-assign: nothing moved (T-B10-4)', () => {
  it('shows an error and stays open instead of closing as saved', async () => {
    reassignFromEmployee.mockReset();
    reassignFromEmployee.mockResolvedValue({ reassigned: 0, taskIds: [], closedAsDuplicate: [] });
    const onSaved = vi.fn();
    render(
      <TaskReassignModal
        bulk={{ fromEmployeeId: 1, taskIds: [9], upcomingOnly: true, label: 'Move 1 future task to someone else' }}
        employees={employees.filter((e) => e.id !== 1)}
        requireAssignee
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText(/Nothing was moved/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
