import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '../../api/appointmentSettings';

const getTask = vi.fn();
const patchTask = vi.fn();
vi.mock('../../api/tasks', () => ({
  getTask: (...a: unknown[]) => getTask(...a),
  patchTask: (...a: unknown[]) => patchTask(...a),
  reassignFromEmployee: vi.fn(),
}));

import TaskReassignModal from './TaskReassignModal';

const employees = [
  { id: 1, firstName: 'Ann', lastName: 'Lee', email: 'ann@x', isActive: true },
  { id: 2, firstName: 'Bo', lastName: 'Kim', email: 'bo@x', isActive: true },
  { id: 3, firstName: 'Cy', lastName: 'Ng', email: 'cy@x', isActive: true },
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
});
