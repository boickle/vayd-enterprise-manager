/**
 * T-B2: the "File the call with …" task shows the call that needs filing (caller, time,
 * transcript) with the call dock's File to chart / Don't file, instead of a blank callback form.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientCall } from '../../api/calls';

const api = vi.hoisted(() => ({
  fetchCallByRowId: vi.fn(),
  resolveCall: vi.fn(async () => undefined),
  markCallReviewOpened: vi.fn(async () => undefined),
  createAndSignScoutChartNote: vi.fn(async () => ({ id: 'note-1' })),
  recordScoutChartCommunication: vi.fn(async () => undefined),
  polishSpokenNotes: vi.fn(async () => 'Owner says Maple is vomiting again.'),
  fetchClientByIdStaff: vi.fn(async () => ({ patients: [{ id: 21, name: 'Maple' }] })),
}));

vi.mock('../../api/calls', async (orig) => ({
  ...(await orig<typeof import('../../api/calls')>()),
  fetchCallByRowId: api.fetchCallByRowId,
  resolveCall: api.resolveCall,
  markCallReviewOpened: api.markCallReviewOpened,
}));
vi.mock('../../api/scoutChart', () => ({
  createAndSignScoutChartNote: api.createAndSignScoutChartNote,
  recordScoutChartCommunication: api.recordScoutChartCommunication,
}));
vi.mock('../../api/soapScribe', () => ({ polishSpokenNotes: api.polishSpokenNotes }));
vi.mock('../../api/clientsStaff', () => ({ fetchClientByIdStaff: api.fetchClientByIdStaff }));

import CallFilingTaskPanel from './CallFilingTaskPanel';

const call: ClientCall & { clientName?: string | null } = {
  callId: 'AC-tb2',
  clientId: 7,
  clientName: 'Maria Rivera',
  practiceId: 1,
  phase: 'transcript_ready',
  direction: 'incoming',
  counterpartyPhone: '+19195550101',
  // 10:00 AM in Eastern.
  startedAt: '2026-11-12T15:00:00.000Z',
  answeredAt: '2026-11-12T15:00:05.000Z',
  completedAt: '2026-11-12T15:04:00.000Z',
  durationSeconds: 235,
  hasTranscript: true,
  transcriptText: '[US123] Hi, Maple is vomiting again.\n[US456] Sorry to hear that.',
  triageReason: 'Vomiting recheck',
  triageCategory: 'clinical',
  initiatedByEmployeeId: null,
  answeredByEmployeeId: 4,
  filedAt: null,
  dismissedAt: null,
};

const task = {
  id: 9,
  title: 'File the call with Maria Rivera',
  links: [
    { id: 1, entityType: 'client', entityId: 7 },
    { id: 2, entityType: 'openphone_call', entityId: 501 },
  ],
  idempotencyKey: 'rule:3:call:501',
  triggerDefinitionId: 'call_unfiled:3',
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
  api.fetchCallByRowId.mockReset();
  api.fetchCallByRowId.mockResolvedValue(call);
});

describe('CallFilingTaskPanel (T-B2)', () => {
  it('T-B2-2: shows the caller, call time, direction, summary and transcript, with File to chart and Don\'t file', async () => {
    render(<CallFilingTaskPanel task={task} canAct onDone={() => {}} />);

    await waitFor(() => expect(screen.getByText('Maria Rivera')).toBeInTheDocument());
    expect(api.fetchCallByRowId).toHaveBeenCalledWith(501);
    expect(screen.getByText(/Incoming call/)).toBeInTheDocument();
    expect(screen.getByText(/Nov 12, 10:00 AM ET/)).toBeInTheDocument();
    expect(screen.getByText('Vomiting recheck')).toBeInTheDocument();
    // Quo's speaker ids are dropped, as in the dock's review window.
    expect(screen.getByText(/Hi, Maple is vomiting again\./)).toBeInTheDocument();
    expect(screen.queryByText(/US123/)).toBeNull();
    expect(screen.getByRole('button', { name: /File to chart/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Don.t file/ })).toBeInTheDocument();
    // Never the callback form.
    expect(screen.queryByText(/Open Quo call/)).toBeNull();
  });

  it('T-B2-3: File to chart opens the dock\'s filing window; filing there resolves the call as filed', async () => {
    const onDone = vi.fn();
    render(<CallFilingTaskPanel task={task} canAct defaultPatientId={21} onDone={onDone} />);
    fireEvent.click(await screen.findByRole('button', { name: /File to chart/ }));

    // The call dock's review window (CallTranscriptModal).
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Call with Maria Rivera');
    await waitFor(() => expect(api.polishSpokenNotes).toHaveBeenCalled());
    await waitFor(() =>
      expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
        'Owner says Maple is vomiting again.',
      ),
    );
    const fileBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      /File to chart/.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    await waitFor(() => expect(fileBtn.disabled).toBe(false));
    fireEvent.click(fileBtn);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.createAndSignScoutChartNote).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 21, clientId: 7 }),
    );
    expect(api.resolveCall).toHaveBeenCalledWith('AC-tb2', { noteId: 'note-1', filed: true });
    expect(onDone.mock.calls[0][0]).toMatch(/filed/i);
  });

  it('T-B2-3: Don\'t file dismisses the call, like the dock', async () => {
    const onDone = vi.fn();
    render(<CallFilingTaskPanel task={task} canAct onDone={onDone} />);
    fireEvent.click(await screen.findByRole('button', { name: /Don.t file/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.resolveCall).toHaveBeenCalledWith('AC-tb2');
  });

  it('an older task with no call link finds its call from the task key', async () => {
    render(
      <CallFilingTaskPanel
        task={{ ...task, links: [{ id: 1, entityType: 'client', entityId: 7 }] }}
        canAct
        onDone={() => {}}
      />,
    );
    await waitFor(() => expect(api.fetchCallByRowId).toHaveBeenCalledWith(501));
    expect(await screen.findByRole('button', { name: /File to chart/ })).toBeInTheDocument();
  });

  it('T-B2-4: no call to find shows the call dock fallback, not an empty callback form', async () => {
    render(
      <CallFilingTaskPanel
        task={{
          ...task,
          links: [{ id: 1, entityType: 'client', entityId: 7 }],
          idempotencyKey: null,
        }}
        canAct
        onDone={() => {}}
      />,
    );
    expect(await screen.findByText(/Open the call dock to file this call/)).toBeInTheDocument();
    expect(api.fetchCallByRowId).not.toHaveBeenCalled();
    expect(screen.queryByText(/Open Quo call/)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('T-B2-4: a call that no longer loads shows the same fallback', async () => {
    api.fetchCallByRowId.mockResolvedValue(null);
    render(<CallFilingTaskPanel task={task} canAct onDone={() => {}} />);
    expect(await screen.findByText(/Open the call dock to file this call/)).toBeInTheDocument();
  });

  it('a call already filed says so and offers nothing to press', async () => {
    api.fetchCallByRowId.mockResolvedValue({ ...call, filedAt: '2026-11-12T16:00:00.000Z' });
    render(<CallFilingTaskPanel task={task} canAct onDone={() => {}} />);
    expect(await screen.findByText(/already filed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /File to chart/ })).toBeNull();
  });
});
