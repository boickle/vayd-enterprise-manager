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
const gmail = vi.hoisted(() => ({
  fetchGmailMailboxes: vi.fn(),
  fetchGmailMessages: vi.fn(),
  fetchGmailThread: vi.fn(),
}));
vi.mock('../../api/gmail', async (orig) => ({ ...(await orig<object>()), ...gmail }));
vi.mock('../../utils/practiceGmailMailboxes', () => ({
  sharedConnectedMailboxes: (m: Array<{ connected: boolean }>) => m.filter((x) => x.connected),
}));
const composed = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('../ClientEmailComposeModal', () => ({
  ClientEmailComposeModal: (props: Record<string, unknown>) => {
    composed.props = props;
    return <div role="dialog" aria-label="Email client window" />;
  },
}));

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

  it('shows the thread from when the hold was placed; no Email tab without a client email', async () => {
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

  it('shows emails with the client (older ones folded) and Email opens the Email client window (Nov 12)', async () => {
    gmail.fetchGmailMailboxes.mockResolvedValue({
      mailboxes: [{ email: 'info@vetatyourdoor.com', connected: true }],
    });
    gmail.fetchGmailMessages.mockResolvedValue({
      threads: [{ threadId: 'th1', id: 'm2', date: '2026-11-07T15:00:00Z', labelIds: ['INBOX'] }],
      untaggedQueue: [],
    });
    const msg = (id: string, date: string, fromEmail: string, text: string) => ({
      id,
      threadId: 'th1',
      date,
      subject: 'Luna',
      from: { name: null, email: fromEmail },
      snippet: text,
      labelIds: [],
      body: { text, html: null },
    });
    gmail.fetchGmailThread.mockResolvedValue({
      messages: [
        msg('m1', '2026-10-01T15:00:00Z', 'amanda@example.com', 'Old question about fleas'),
        msg('m2', '2026-11-07T15:00:00Z', 'amanda@example.com', 'January works better for us'),
      ],
    });
    const withEmail = { ...hold, client: { ...hold.client, email: 'amanda@example.com' } } as HoldListItem;
    render(<HoldConversationPanel hold={withEmail} canText practiceTz="America/New_York" />);

    expect(await screen.findByText('January works better for us')).toBeTruthy();
    expect(screen.queryByText('Old question about fleas')).toBeNull();
    expect(screen.getByRole('button', { name: /Show 1 earlier message/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Email/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Email message' }), {
      target: { value: 'Hi Amanda, January it is.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open email window' }));
    expect(await screen.findByRole('dialog', { name: 'Email client window' })).toBeTruthy();
    expect(composed.props).toEqual(
      expect.objectContaining({
        clientId: 42,
        initialBodyText: 'Hi Amanda, January it is.',
        initialSubject: "Visit hold follow-up from Dr. Cheeseman's team at Vet At Your Door",
        regardingPatientId: 7,
      })
    );
  });

  it('SCH-R15: also searches the second email, same shared mailboxes, and drops duplicate messages', async () => {
    gmail.fetchGmailMailboxes.mockResolvedValue({
      mailboxes: [{ email: 'info@vetatyourdoor.com', connected: true }],
    });
    gmail.fetchGmailMessages.mockImplementation(async (_mb: string, o: { q: string }) => ({
      threads: [
        o.q.includes('partner@example.com')
          ? { threadId: 'thB', id: 'mB', date: '2026-11-08T15:00:00Z', labelIds: [] }
          : { threadId: 'thA', id: 'mA', date: '2026-11-07T15:00:00Z', labelIds: [] },
        // The same thread comes back for both addresses: shown once.
        { threadId: 'thShared', id: 'mS', date: '2026-11-06T15:00:00Z', labelIds: [] },
      ],
      untaggedQueue: [],
    }));
    const mk = (id: string, threadId: string, date: string, text: string) => ({
      id,
      threadId,
      date,
      subject: 'Luna',
      from: { name: null, email: 'x@example.com' },
      snippet: text,
      labelIds: [],
      body: { text, html: null },
    });
    gmail.fetchGmailThread.mockImplementation(async (_mb: string, threadId: string) => ({
      messages: [
        threadId === 'thA'
          ? mk('mA', 'thA', '2026-11-07T15:00:00Z', 'From the primary address')
          : threadId === 'thB'
            ? mk('mB', 'thB', '2026-11-08T15:00:00Z', 'From the second address')
            : mk('mS', 'thShared', '2026-11-06T15:00:00Z', 'Both addresses on this one'),
      ],
    }));
    const both = {
      ...hold,
      client: { ...hold.client, email: 'amanda@example.com', secondEmail: 'partner@example.com' },
    } as HoldListItem;
    render(<HoldConversationPanel hold={both} canText practiceTz="America/New_York" />);

    expect(await screen.findByText('From the second address')).toBeTruthy();
    expect(screen.getByText('From the primary address')).toBeTruthy();
    expect(screen.getAllByText('Both addresses on this one')).toHaveLength(1);
    const queries = gmail.fetchGmailMessages.mock.calls.map((c: unknown[]) => (c[1] as { q: string }).q);
    expect(queries.some((q: string) => q.includes('amanda@example.com'))).toBe(true);
    expect(queries.some((q: string) => q.includes('partner@example.com'))).toBe(true);
    // Shared mailboxes only.
    expect(new Set(gmail.fetchGmailMessages.mock.calls.map((c: unknown[]) => c[0]))).toEqual(
      new Set(['info@vetatyourdoor.com']),
    );
  });
});
