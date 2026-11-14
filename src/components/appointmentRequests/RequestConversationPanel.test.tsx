/** Appointments conversation panel (owner, Nov 11, 2026): one thread for email, text and calls; reply from one box. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentRequestSubmissionItem } from '../../api/appointmentRequestSubmissions';

const api = vi.hoisted(() => ({
  fetchAppointmentRequestConversation: vi.fn(),
  logAppointmentRequestCall: vi.fn(),
  sendAppointmentRequestSubmissionSms: vi.fn(),
  summarizeAppointmentRequestQuoCall: vi.fn(),
}));
vi.mock('../../api/appointmentRequestSubmissions', () => api);

const emailHook = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../hooks/useAppointmentRequestEmail', () => ({
  useAppointmentRequestEmail: () => ({
    messages: [],
    loading: false,
    error: null,
    canSend: true,
    clientEmail: 'laura@example.com',
    fromLabel: 'info@vetatyourdoor.com',
    subject: 'Re: Appointment Request: Laura Hayden for Ruby',
    send: emailHook.send,
    reload: () => {},
  }),
}));
vi.mock('../../hooks/useOutboundCallFromLine', () => ({
  useOutboundCallFromLine: () => '+12075368387',
}));
const callActivity = vi.hoisted(() => ({ markClientCallStarted: vi.fn() }));
vi.mock('../../hooks/useClientCallActivity', () => callActivity);
vi.mock('../../utils/appointmentRequestSmsMessage', () => ({
  resolveAppointmentRequestSmsMessage: vi.fn(async () => 'Hi Laura, it is Vet At Your Door.'),
}));

const emailWindow = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('../AppointmentRequestEmailModal', () => ({
  AppointmentRequestEmailModal: (props: Record<string, unknown>) => {
    emailWindow.props = props;
    return <div role="dialog" aria-label="Request email window" />;
  },
}));

import { RequestConversationPanel } from './RequestConversationPanel';

const item: AppointmentRequestSubmissionItem = {
  id: 5,
  practiceId: 1,
  submittedAt: '2026-11-10T01:54:00Z',
  requestData: {
    email: 'laura@example.com',
    phoneNumber: '7203775237',
    canWeText: 'Yes',
    fullName: { first: 'Laura' },
  },
  created: '2026-11-10T01:54:00Z',
  updated: '2026-11-10T01:54:00Z',
  status: 'new',
};

describe('RequestConversationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchAppointmentRequestConversation.mockResolvedValue({
      submissionId: 5,
      phone: '7203775237',
      texts: [
        {
          id: 'old',
          direction: 'in',
          body: 'Old text from last spring',
          at: '2026-04-01T12:00:00Z',
          beforeRequest: true,
        },
        {
          id: 's1',
          direction: 'in',
          body: 'Tomorrow morning works!',
          at: '2026-11-10T14:24:00Z',
          beforeRequest: false,
        },
      ],
      textsError: null,
      calls: [],
    });
  });

  it('shows the client’s reply, folds texts from before the request, and flags the reply', async () => {
    render(
      <RequestConversationPanel
        item={item}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={() => {}}
        onSubmissionUpdated={() => {}}
      />
    );
    expect(await screen.findByText('Tomorrow morning works!')).toBeTruthy();
    expect(screen.queryByText('Old text from last spring')).toBeNull();
    expect(screen.getByText(/Owner texted back/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 earlier message' }));
    expect(screen.getByText('Old text from last spring')).toBeTruthy();
  });

  it('read-only (techs, doctors): shows the texts but no way to send (Nov 13, 2026)', async () => {
    render(
      <RequestConversationPanel
        item={item}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={() => {}}
        onSubmissionUpdated={() => {}}
        readOnly
      />
    );
    expect(await screen.findByText('Tomorrow morning works!')).toBeTruthy();
    expect(screen.getByText(/View only/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull();
    expect(screen.queryByText(/Log it/)).toBeNull();
  });

  it('sends a text and marks the request contacted', async () => {
    const onContacted = vi.fn();
    api.sendAppointmentRequestSubmissionSms.mockResolvedValue({ success: true });
    render(
      <RequestConversationPanel
        item={item}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={onContacted}
        onSubmissionUpdated={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /Text/ }));
    fireEvent.change(screen.getByLabelText('Text message'), {
      target: { value: 'See you tomorrow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }));
    await waitFor(() =>
      expect(api.sendAppointmentRequestSubmissionSms).toHaveBeenCalledWith(5, {
        message: 'See you tomorrow',
      })
    );
    expect(onContacted).toHaveBeenCalledWith(item);
  });

  it('logs a call with its outcome', async () => {
    const onUpdated = vi.fn();
    api.logAppointmentRequestCall.mockResolvedValue({ ...item, status: 'contacted' });
    render(
      <RequestConversationPanel
        item={item}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={() => {}}
        onSubmissionUpdated={onUpdated}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /Call/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Called from another phone? Log it' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Left voicemail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }));
    await waitFor(() =>
      expect(api.logAppointmentRequestCall).toHaveBeenCalledWith(5, {
        outcome: 'voicemail',
        note: null,
      })
    );
    expect(onUpdated).toHaveBeenCalled();
  });

  it('fills in the suggested message and emails it', async () => {
    emailHook.send.mockResolvedValue(null);
    const onContacted = vi.fn();
    render(
      <RequestConversationPanel
        item={item}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={onContacted}
        onSubmissionUpdated={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Suggested message' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Email message') as HTMLTextAreaElement).value).toContain(
        'Hi Laura'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
    await waitFor(() =>
      expect(emailHook.send).toHaveBeenCalledWith('Hi Laura, it is Vet At Your Door.')
    );
    expect(onContacted).toHaveBeenCalled();
  });
});

describe('RequestConversationPanel filter', () => {
  it('shows only texts, only calls, or everything', async () => {
    api.fetchAppointmentRequestConversation.mockResolvedValue({
      submissionId: 5,
      phone: '7203775237',
      texts: [
        {
          id: 's1',
          direction: 'in',
          body: 'Tomorrow morning works!',
          at: '2026-11-10T14:24:00Z',
          beforeRequest: false,
        },
      ],
      textsError: null,
      calls: [
        {
          id: 9,
          at: '2026-11-10T13:00:00Z',
          outcome: 'reached',
          note: 'Spoke with Laura',
          employee: null,
        },
      ],
    });
    render(
      <RequestConversationPanel
        item={item}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={() => {}}
        onSubmissionUpdated={() => {}}
      />
    );
    await screen.findByText('Tomorrow morning works!');
    expect(screen.getByText('Spoke with Laura')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Text/ }));
    expect(screen.getByText('Tomorrow morning works!')).toBeTruthy();
    expect(screen.queryByText('Spoke with Laura')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Calls/ }));
    expect(screen.queryByText('Tomorrow morning works!')).toBeNull();
    expect(screen.getByText('Spoke with Laura')).toBeTruthy();
    // The status still reflects everything.
    expect(screen.getByText(/Owner texted back/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText('Tomorrow morning works!')).toBeTruthy();
  });
});

describe('RequestConversationPanel calls', () => {
  it('dials through Quo and shows Quo calls with summary and transcript', async () => {
    api.fetchAppointmentRequestConversation.mockResolvedValue({
      submissionId: 5,
      phone: '7203775237',
      texts: [],
      textsError: null,
      calls: [],
      quoCalls: [
        {
          id: 77,
          direction: 'in',
          status: 'completed',
          at: '2026-11-10T15:00:00Z',
          durationSeconds: 240,
          staff: { id: 3, firstName: 'Lindsey', lastName: 'Weiser' },
          transcript: 'Client: Can we do Thursday?',
          summary: 'Client asked for Thursday; offered Thursday morning.',
          beforeRequest: false,
        },
      ],
    });
    render(
      <RequestConversationPanel
        item={{ ...item, requestData: { ...item.requestData, clientId: '42' } }}
        practiceId={1}
        practiceTz="America/New_York"
        onContacted={() => {}}
        onSubmissionUpdated={() => {}}
      />
    );
    expect(
      await screen.findByText('Client asked for Thursday; offered Thursday morning.')
    ).toBeTruthy();
    expect(screen.getByText(/Incoming call · 4 min/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }));
    expect(screen.getByText('Client: Can we do Thursday?')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Call/ }));
    const dial = screen.getByRole('link', { name: /Call 7203775237 in Quo/ });
    expect(dial.getAttribute('href')).toContain('7203775237');
    dial.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(dial);
    expect(callActivity.markClientCallStarted).toHaveBeenCalledWith(42, expect.any(String), null);
  });

  describe('loading and call summaries (owner, Nov 12, 2026)', () => {
    const quoCall = (over: Record<string, unknown>) => ({
      id: 77,
      direction: 'out',
      status: 'completed',
      at: '2026-11-10T15:00:00Z',
      durationSeconds: 71,
      staff: { id: 3, firstName: 'Maggie', lastName: 'Smith' },
      transcript: null,
      summary: null,
      transcriptStatus: null,
      beforeRequest: false,
      ...over,
    });

    it('shows calls while texts are still loading, says what it is checking, and does not claim no reply yet', async () => {
      let finishTexts: (v: unknown) => void = () => {};
      api.fetchAppointmentRequestConversation.mockImplementation((_id: number, part?: string) =>
        part === 'texts'
          ? new Promise((r) => {
              finishTexts = r;
            })
          : Promise.resolve({ submissionId: 5, phone: null, texts: [], textsError: null, calls: [], quoCalls: [quoCall({ summary: 'Booked Tue AM.' })] })
      );
      render(<RequestConversationPanel item={item} practiceId={1} practiceTz="America/New_York" onContacted={vi.fn()} onSubmissionUpdated={vi.fn()} />);
      expect(await screen.findByText('Booked Tue AM.')).toBeInTheDocument();
      expect(screen.getByText('Checking texts…')).toBeInTheDocument();
      expect(screen.getByText('Calls ✓')).toBeInTheDocument();
      expect(screen.getByText('Checking for messages…')).toBeInTheDocument();
      expect(api.fetchAppointmentRequestConversation).toHaveBeenCalledWith(5, 'calls', false);
      expect(api.fetchAppointmentRequestConversation).toHaveBeenCalledWith(5, 'texts', false);

      finishTexts({ submissionId: 5, phone: null, texts: [], textsError: null, calls: [] });
      await waitFor(() => expect(screen.queryByText('Checking texts…')).not.toBeInTheDocument());
      expect(screen.queryByText('Checking for messages…')).not.toBeInTheDocument();
    });

    it('summarizes a call since the request on its own, and says when Quo has no transcript', async () => {
      api.fetchAppointmentRequestConversation.mockResolvedValue({
        submissionId: 5,
        phone: null,
        texts: [],
        textsError: null,
        calls: [],
        quoCalls: [quoCall({}), quoCall({ id: 78, at: '2026-11-10T16:00:00Z', transcriptStatus: 'absent' })],
      });
      api.summarizeAppointmentRequestQuoCall.mockResolvedValue({
        id: 77,
        transcript: 'Speaker 1: Tuesday works.',
        summary: 'Client chose Tuesday morning with Dr. Messina.',
        transcriptStatus: 'completed',
      });
      render(<RequestConversationPanel item={item} practiceId={1} practiceTz="America/New_York" onContacted={vi.fn()} onSubmissionUpdated={vi.fn()} />);
      expect(await screen.findByText('Client chose Tuesday morning with Dr. Messina.')).toBeInTheDocument();
      expect(api.summarizeAppointmentRequestQuoCall).toHaveBeenCalledTimes(1);
      expect(api.summarizeAppointmentRequestQuoCall).toHaveBeenCalledWith(5, 77);
      expect(screen.getByText(/No transcript in Quo for this call/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show transcript' })).toBeInTheDocument();
    });

    it('offers Summarize on a very short call instead of doing it on its own', async () => {
      api.fetchAppointmentRequestConversation.mockResolvedValue({
        submissionId: 5,
        phone: null,
        texts: [],
        textsError: null,
        calls: [],
        quoCalls: [quoCall({ at: '2026-11-11T15:00:00Z', durationSeconds: 5 })],
      });
      api.summarizeAppointmentRequestQuoCall.mockResolvedValue({
        id: 77,
        transcript: null,
        summary: null,
        transcriptStatus: 'absent',
      });
      render(<RequestConversationPanel item={item} practiceId={1} practiceTz="America/New_York" onContacted={vi.fn()} onSubmissionUpdated={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Summarize' }));
      expect(await screen.findByText(/No transcript in Quo for this call/)).toBeInTheDocument();
    });
  });

  it('From, templates… opens the email window with what was typed (Nov 12)', async () => {
    render(<RequestConversationPanel item={item} practiceId={1} practiceTz="America/New_York" onContacted={vi.fn()} onSubmissionUpdated={vi.fn()} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email message' }), {
      target: { value: 'Hi Laura, Tuesday works.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /From, templates/ }));
    expect(await screen.findByRole('dialog', { name: 'Request email window' })).toBeTruthy();
    expect(emailWindow.props).toEqual(expect.objectContaining({ initialBodyText: 'Hi Laura, Tuesday works.' }));
    expect(emailHook.send).not.toHaveBeenCalled();
  });
});
