/** T-B6: after Chart & complete, the "Call filed to … and the callback is done." message is handed to the parent. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CallbackJotPanel from './CallbackJotPanel';
import type { TaskDetail } from '../../api/tasks';

const complete = vi.hoisted(() => vi.fn());
vi.mock('../../api/tasks', () => ({
  completeTask: (...a: unknown[]) => complete(...a),
  patchTask: vi.fn(),
  removeTask: vi.fn(),
}));
vi.mock('../../api/scoutChart', () => ({
  createAndSignScoutChartNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
  recordScoutChartCommunication: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/clientsStaff', () => ({
  fetchClientByIdStaff: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../api/calls', () => ({
  resolveCall: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/soapScribe', () => ({
  polishSpokenNotes: vi.fn(),
}));
vi.mock('../../hooks/useClientCallActivity', () => ({
  useClientCallActivity: () => ({ call: null, phase: 'idle', optimistic: null }),
  markClientCallStarted: vi.fn(),
}));
vi.mock('../../hooks/useOutboundCallFromLine', () => ({
  useOutboundCallFromLine: () => '',
}));

const task = {
  id: 9,
  title: 'Call Maria back about Maple',
  body: null,
  kind: 'callback',
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
  source: 'manual',
} as unknown as TaskDetail;

describe('CallbackJotPanel confirmation (T-B6)', () => {
  it('T-B6-1: Chart & complete reports the filed message to the parent', async () => {
    complete.mockResolvedValue({});
    const onFiled = vi.fn();
    const onDone = vi.fn();
    const { container } = render(
      <CallbackJotPanel
        task={task}
        employees={[]}
        myEmployeeId={4}
        patientName="Maple"
        patients={[{ id: 5, name: 'Maple' }]}
        onDone={onDone}
        onFiled={onFiled}
      />,
    );

    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'Maria says Maple is eating well.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chart & complete' }));

    const message = 'Call filed to Maple\'s record and the callback is done.';
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onFiled).toHaveBeenCalledWith(message);
    expect(screen.getByText(message)).toBeTruthy();
  });
});
