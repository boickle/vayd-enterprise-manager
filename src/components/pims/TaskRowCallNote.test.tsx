import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskListItem } from '../../api/tasks';

// Owner, Nov 13, 2026: on a "File call with …" row, Mark done with an empty note opens the task
// (nobody closes a call without writing what happened); with a note it charts it and closes.

const row = {
  id: 77,
  title: 'File call with Smokey Eule',
  body: 'Quo transcribed this call and nobody filed it to a chart.',
  status: 'open',
  source: 'system',
  updated: '2026-11-13T12:00:00Z',
} as unknown as TaskListItem;

const getTask = vi.fn(async () => ({
  ...row,
  idempotencyKey: 'openphone-call:ACsmokey',
  shareGroup: null,
}));
const completeTask = vi.fn(async () => ({}));
const patchTask = vi.fn(async () => ({}));
const recordScoutChartCommunication = vi.fn(async () => ({}));
const createAndSignScoutChartNote = vi.fn(async () => ({ id: 'note-1' }));
const resolveCall = vi.fn(async () => undefined);

vi.mock('../../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../../api/tasks')>()),
  getTask: () => getTask(),
  completeTask: (...a: unknown[]) => completeTask(...(a as [])),
  patchTask: (...a: unknown[]) => patchTask(...(a as [])),
}));
vi.mock('../../api/scoutChart', () => ({
  recordScoutChartCommunication: (...a: unknown[]) => recordScoutChartCommunication(...(a as [])),
  createAndSignScoutChartNote: (...a: unknown[]) => createAndSignScoutChartNote(...(a as [])),
}));
vi.mock('../../api/calls', () => ({
  resolveCall: (...a: unknown[]) => resolveCall(...(a as [])),
}));
vi.mock('../../api/clientsStaff', () => ({
  fetchClientByIdStaff: async () => ({ patients: [{ id: 9, name: 'Bear' }] }),
}));

import TaskRowCallNote from './TaskRowCallNote';

function renderRow(task = row) {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <TaskRowCallNote task={task} clientId={12} clientLabel="Smokey Eule" onChanged={onChanged} />
    </MemoryRouter>
  );
  return onChanged;
}

describe('TaskRowCallNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('with an empty note, Mark done opens the task instead of closing it', () => {
    renderRow();
    const done = screen.getByText('Mark done');
    expect(done.closest('a')?.getAttribute('href')).toContain('taskId=77');
    expect(completeTask).not.toHaveBeenCalled();
  });

  it('with a note, Mark done charts it to the client and a pet, files the call and closes the task', async () => {
    const onChanged = renderRow();
    const box = screen.getByLabelText(/Call note for/);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'Called about balance, LMOM.' } });
    fireEvent.click(await screen.findByLabelText('Bear'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(createAndSignScoutChartNote).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 9,
        clientId: 12,
        body: expect.stringContaining('Called about balance, LMOM.'),
      })
    );
    expect(recordScoutChartCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 12, patientIds: [9], typeLabel: 'Call note' })
    );
    expect(resolveCall).toHaveBeenCalledWith('ACsmokey', { noteId: 'note-1', filed: true });
    expect(completeTask).toHaveBeenCalled();
  });

  it('Save keeps the note on the task without charting it', async () => {
    const onChanged = renderRow();
    fireEvent.change(screen.getByLabelText(/Call note for/), {
      target: { value: 'Left message.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(patchTask).toHaveBeenCalled();
    expect(recordScoutChartCommunication).not.toHaveBeenCalled();
    expect(completeTask).not.toHaveBeenCalled();
  });
});
