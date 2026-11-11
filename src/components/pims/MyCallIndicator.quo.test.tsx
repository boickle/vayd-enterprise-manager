/**
 * COM-CALL (owner, Nov 10, 2026): an answered call waiting more than 3 minutes for its summary stays
 * in the dock as "Summary taking longer than 3 minutes — still checking" with Dismiss (= don't
 * file); it no longer turns into "Nothing for the record" on its own.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import MyCallIndicator from './MyCallIndicator';
import type { StackedCall } from '../../hooks/useClientCallActivity';

const stack = vi.hoisted(() => ({
  calls: [] as unknown[],
  more: false,
  dismiss: vi.fn(),
  refresh: vi.fn(),
}));
const resolveCall = vi.hoisted(() => vi.fn(async () => undefined));
const markCallReviewOpened = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../hooks/useClientCallActivity', async (orig) => ({
  ...(await orig<typeof import('../../hooks/useClientCallActivity')>()),
  useMyCallStack: () => stack,
}));
vi.mock('../../api/calls', async (orig) => ({
  ...(await orig<typeof import('../../api/calls')>()),
  resolveCall,
  markCallReviewOpened,
  listClientCalls: vi.fn(async () => ({ calls: [], phoneKeys: [] })),
}));
vi.mock('../../api/clientsStaff', () => ({ fetchClientByIdStaff: vi.fn(async () => ({})) }));
vi.mock('./ClientCallPill', () => ({ CallTranscriptModal: () => null }));

function waiting(endedMinutesAgo: number, extra: Record<string, unknown> = {}): StackedCall {
  const completedAt = new Date(Date.now() - endedMinutesAgo * 60_000).toISOString();
  return {
    key: 'AC1',
    callId: 'AC1',
    clientId: 7,
    clientName: 'Callie Client',
    patientId: null,
    phase: 'transcribing',
    elapsedSeconds: 120,
    optimistic: false,
    call: {
      callId: 'AC1',
      clientId: 7,
      practiceId: 1,
      phase: 'transcribing',
      direction: 'incoming',
      counterpartyPhone: '2075551234',
      startedAt: completedAt,
      answeredAt: completedAt,
      completedAt,
      durationSeconds: 120,
      hasTranscript: false,
      transcriptText: null,
      triageReason: null,
      triageCategory: null,
      initiatedByEmployeeId: null,
      answeredByEmployeeId: 5,
      filedAt: null,
      dismissedAt: null,
      ...extra,
    },
  } as StackedCall;
}

beforeEach(() => {
  stack.calls = [];
  stack.more = false;
  stack.dismiss.mockClear();
  resolveCall.mockClear();
  markCallReviewOpened.mockClear();
});

it('says Summarizing in the first 3 minutes', () => {
  stack.calls = [waiting(1)];
  render(<MyCallIndicator />);
  expect(screen.getByText(/Quo is writing up the call/)).toBeInTheDocument();
  expect(screen.queryByText(/longer than 3 minutes/)).toBeNull();
});

it('after 3 minutes: "Summary taking longer than 3 minutes — still checking", and Dismiss means don’t file', () => {
  stack.calls = [waiting(10)];
  render(<MyCallIndicator />);
  expect(
    screen.getByText('Summary taking longer than 3 minutes — still checking')
  ).toBeInTheDocument();
  expect(screen.queryByText(/Nothing for the record/)).toBeNull();

  // The labeled Dismiss in the action row (the grip's X does the same).
  fireEvent.click(screen.getByText('Dismiss', { selector: 'button' }));
  expect(resolveCall).toHaveBeenCalledWith('AC1');
  expect(stack.dismiss).toHaveBeenCalledWith('AC1');
});

it('still checking two days later, and says so when Quo won’t write it up', () => {
  stack.calls = [waiting(2 * 24 * 60, { transcriptStatus: 'absent' })];
  render(<MyCallIndicator />);
  expect(
    screen.getByText('Summary taking longer than 3 minutes — still checking')
  ).toBeInTheDocument();
  expect(screen.getByText(/Quo says it won’t write up this call/)).toBeInTheDocument();
});

it('says when there are more calls than the dock lists', () => {
  stack.calls = [waiting(10)];
  stack.more = true;
  render(<MyCallIndicator />);
  expect(screen.getByText(/Showing your 50 newest calls/)).toBeInTheDocument();
});

it('opening a non-clinical call to file it anyway records that it was opened (so it never auto-clears)', () => {
  const call = waiting(30, {
    phase: 'no_record_needed',
    hasTranscript: true,
    transcriptText: '[x] Can we move Tuesday?',
    triageClinical: false,
  });
  stack.calls = [{ ...call, phase: 'no_record_needed' }];
  render(<MyCallIndicator />);
  expect(
    screen.getByText(/clears itself a day after the call unless you open it/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText('File anyway', { selector: 'button' }));
  expect(markCallReviewOpened).toHaveBeenCalledWith('AC1');
});
