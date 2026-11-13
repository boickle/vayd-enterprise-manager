/**
 * T-B2: a "Call not filed" task opens on its call, never on the callback form
 * ("Call the client", Open Quo call, an empty transcript box).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./CallbackJotPanel', () => ({ default: () => <div>CALLBACK FORM: Open Quo call</div> }));
vi.mock('../../hooks/useOutboundCallFromLine', () => ({ useOutboundCallFromLine: () => ({}) }));
vi.mock('../../utils/extractUploadText', () => ({ extractUploadText: vi.fn() }));
vi.mock('../../utils/taskLinkDisplay', async (orig) => ({
  ...(await orig<typeof import('../../utils/taskLinkDisplay')>()),
  useTaskLinkLabels: () => ({ 'client:7': 'Maria Rivera' }),
}));
vi.mock('../../api/clientsStaff', () => ({ fetchClientByIdStaff: vi.fn(async () => ({ patients: [] })) }));

const fetchCallByRowId = vi.hoisted(() => vi.fn());
vi.mock('../../api/calls', async (orig) => ({
  ...(await orig<typeof import('../../api/calls')>()),
  fetchCallByRowId,
}));

const getTask = vi.fn();
vi.mock('../../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../../api/tasks')>()),
  getTask: (...a: unknown[]) => getTask(...a),
  patchTask: vi.fn(),
  updateTask: vi.fn(),
  reassignFromEmployee: vi.fn(),
}));

import PimsTaskDetailView from './PimsTaskDetailView';

const callTask = {
  id: 9,
  title: 'File the call with Maria Rivera',
  body: null,
  kind: 'callback',
  source: 'trigger',
  triggerDefinitionId: 'call_unfiled:3',
  idempotencyKey: 'rule:3:call:501',
  status: 'assigned',
  priority: 'normal',
  assignedToEmployeeId: 4,
  createdByEmployeeId: 4,
  queueRoleId: null,
  startAt: '2026-11-12T15:00:00.000Z',
  dueAt: null,
  created: '2026-11-12T15:00:00.000Z',
  updated: '2026-11-12T15:00:00.000Z',
  branchIds: [],
  watchers: [],
  links: [
    { id: 1, entityType: 'client', entityId: 7 },
    { id: 2, entityType: 'openphone_call', entityId: 501 },
  ],
  events: [],
};

const props = {
  taskId: 9,
  branches: [],
  employees: [],
  roles: [],
  myEmployeeId: 4,
  isPracticeAdmin: false,
  onBack: () => {},
  onUpdated: () => {},
};

beforeEach(() => {
  getTask.mockReset();
  fetchCallByRowId.mockReset();
  fetchCallByRowId.mockResolvedValue({
    callId: 'AC-tb2',
    clientId: 7,
    clientName: 'Maria Rivera',
    practiceId: 1,
    phase: 'transcript_ready',
    direction: 'incoming',
    counterpartyPhone: '+19195550101',
    startedAt: '2026-11-12T15:00:00.000Z',
    answeredAt: null,
    completedAt: null,
    durationSeconds: 120,
    hasTranscript: true,
    transcriptText: 'Maple is vomiting again.',
    triageReason: null,
    triageCategory: null,
    initiatedByEmployeeId: null,
    answeredByEmployeeId: 4,
    filedAt: null,
    dismissedAt: null,
  });
});

describe('PimsTaskDetailView call-not-filed task (T-B2)', () => {
  it('T-B2-2: opens on the call with File to chart / Don\'t file, not the callback form', async () => {
    getTask.mockResolvedValue(callTask);
    render(
      <MemoryRouter>
        <PimsTaskDetailView {...props} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Maple is vomiting again\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /File to chart/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Don.t file/ })).toBeInTheDocument();
    expect(screen.queryByText(/CALLBACK FORM/)).toBeNull();
  });

  it('T-B2-4: an old task with no call link or call key shows the fallback, not an empty callback form', async () => {
    getTask.mockResolvedValue({
      ...callTask,
      idempotencyKey: null,
      links: [{ id: 1, entityType: 'client', entityId: 7 }],
    });
    render(
      <MemoryRouter>
        <PimsTaskDetailView {...props} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Open the call dock to file this call/)).toBeInTheDocument();
    expect(screen.queryByText(/CALLBACK FORM/)).toBeNull();
    expect(fetchCallByRowId).not.toHaveBeenCalled();
  });

  it('the call link is listed under Linked records as a phone call, not "openphone call #501"', async () => {
    getTask.mockResolvedValue(callTask);
    render(
      <MemoryRouter>
        <PimsTaskDetailView {...props} />
      </MemoryRouter>,
    );
    await screen.findByText(/Maple is vomiting again\./);
    expect(screen.queryByText(/openphone call #501/)).toBeNull();
    await waitFor(() => expect(screen.getByText('Phone call')).toBeInTheDocument());
  });
});
