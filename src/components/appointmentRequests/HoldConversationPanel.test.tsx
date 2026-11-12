/** Hold tab conversation (owner, Nov 11, 2026): texts, Quo calls and call notes for a hold's client. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HoldListItem } from '../../api/holds';

const holdsApi = vi.hoisted(() => ({ fetchHoldConversation: vi.fn(), logHoldCall: vi.fn() }));
vi.mock('../../api/holds', () => holdsApi);
const sms = vi.hoisted(() => ({ sendClientSms: vi.fn() }));
vi.mock('../../api/clientSms', () => sms);
vi.mock('../../hooks/useOutboundCallFromLine', () => ({
  useOutboundCallFromLine: () => '+12075368387',
}));
vi.mock('../../hooks/useClientCallActivity', () => ({ markClientCallStarted: vi.fn() }));

import { HoldConversationPanel } from './HoldConversationPanel';

const hold = {
  id: 501,
  appointmentStart: '2026-12-01T14:00:00Z',
  appointmentEnd: null,
  allDay: false,
  holdPlacedAtIso: '2026-11-05T14:00:00Z',
  appointmentType: { id: 9, name: 'HOLD', prettyName: 'Hold' },
  client: {
    id: 42,
    firstName: 'Amanda',
    lastName: 'Jones',
    phone1: '2075551234',
    email: null,
    address1: null,
    city: 'Portland',
    state: 'ME',
    zipcode: null,
  },
  patient: { id: 7, name: 'Luna', pimsId: null },
  primaryProvider: { id: 3, firstName: 'Liz', lastName: 'Cheeseman' },
  createdByEmployee: null,
  holdOwner: null,
  holdOwnerAssignedAt: null,
  ownerBucket: 'unassigned',
  effectiveOwnerEmployeeId: null,
  ownerIsCurrentUser: false,
  source: 'end_visit',
  description: null,
  instructions: null,
  pimsId: null,
  appointmentRequestSubmissionId: null,
  forwardBooking: null,
} as unknown as HoldListItem;

describe('HoldConversationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holdsApi.fetchHoldConversation.mockResolvedValue({
      appointmentId: 501,
      placedAt: '2026-11-05T14:00:00Z',
      phone: '2075551234',
      texts: [
        {
          id: 't1',
          direction: 'in',
          body: 'Can we push Luna to January?',
          at: '2026-11-06T14:00:00Z',
          beforeRequest: false,
        },
      ],
      textsError: null,
      quoCalls: [],
      calls: [],
    });
    holdsApi.logHoldCall.mockResolvedValue(undefined);
    sms.sendClientSms.mockResolvedValue(undefined);
  });

  it('shows the thread from when the hold was placed, with Text and Call but no Email', async () => {
    render(<HoldConversationPanel hold={hold} canText practiceTz="America/New_York" />);
    expect(await screen.findByText('Can we push Luna to January?')).toBeTruthy();
    expect(screen.getByText('Hold placed')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Email/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Text/ })).toBeTruthy();
  });

  it('texts the client from the hold doctor’s line', async () => {
    render(<HoldConversationPanel hold={hold} canText practiceTz="America/New_York" />);
    await screen.findByText('Can we push Luna to January?');
    fireEvent.change(screen.getByLabelText('Text message'), {
      target: { value: 'Sure, January works.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }));
    await waitFor(() =>
      expect(sms.sendClientSms).toHaveBeenCalledWith(42, {
        message: 'Sure, January works.',
        source: 'holds',
        primaryProviderId: 3,
      })
    );
  });

  it('logs a call on the hold', async () => {
    const onChanged = vi.fn();
    render(
      <HoldConversationPanel
        hold={hold}
        canText
        practiceTz="America/New_York"
        onChanged={onChanged}
      />
    );
    await screen.findByText('Can we push Luna to January?');
    fireEvent.click(screen.getByRole('tab', { name: /Call/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Called from another phone? Log it' }));
    fireEvent.click(screen.getByRole('radio', { name: 'No answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }));
    await waitFor(() =>
      expect(holdsApi.logHoldCall).toHaveBeenCalledWith(501, { outcome: 'no_answer', note: null })
    );
    expect(onChanged).toHaveBeenCalled();
  });
});
