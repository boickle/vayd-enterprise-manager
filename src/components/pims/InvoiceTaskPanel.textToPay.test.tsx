import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/tasks', () => ({ patchTask: vi.fn() }));
vi.mock('../../api/clientSms', () => ({ sendClientSms: vi.fn() }));
vi.mock('../../api/scoutChart', () => ({ recordScoutChartCommunication: vi.fn() }));
vi.mock('../../api/visitWorkflow', () => ({
  createClientPayLink: vi.fn(async () => ({
    url: 'https://pay.test/abc',
    amount: 75,
    invoiceLabels: ['Invoice for Biscuit'],
  })),
}));
const fetchClientByIdStaff = vi.fn();
vi.mock('../../api/clientsStaff', () => ({
  fetchClientByIdStaff: (...a: unknown[]) => fetchClientByIdStaff(...a),
}));
vi.mock('../ClientEmailComposeModal', () => ({ ClientEmailComposeModal: () => null }));
vi.mock('./TaskBodyContent', () => ({ TaskBodyContent: () => null }));
vi.mock('../../hooks/useMessageTemplates', () => ({
  useMessageTemplates: () => ({
    loading: false,
    templates: [
      {
        id: 't1',
        name: 'Balance reminder',
        subject: '',
        body: 'Hi {{client_first_name}}, you have a balance.',
        isSystem: false,
      },
    ],
  }),
}));

// The real compose window is heavy; keep its message box and the real template picker.
import MessageTemplatePicker from '../messageTemplates/MessageTemplatePicker';
vi.mock('../ClientSmsComposeModal', () => ({
  ClientSmsComposeModal: (p: {
    open: boolean;
    message: string;
    onMessageChange: (v: string) => void;
    mergeValues?: Record<string, string>;
  }) =>
    p.open ? (
      <div>
        <MessageTemplatePicker
          channel="sms"
          mergeValues={p.mergeValues}
          onApply={(n) => p.onMessageChange(n.body)}
        />
        <textarea aria-label="Message" value={p.message} onChange={(e) => p.onMessageChange(e.target.value)} />
      </div>
    ) : null,
}));

import InvoiceTaskPanel from './InvoiceTaskPanel';

const task = {
  id: 751,
  title: 'Close the invoice for Tom Chen',
  body: null,
  status: 'open',
  links: [{ entityType: 'client', entityId: 12 }],
  idempotencyKey: 'rule:1:invoice:abc',
} as never;

function renderPanel(clientName: string | null) {
  return render(
    <MemoryRouter>
      <InvoiceTaskPanel
        task={task}
        clientName={clientName}
        employees={[]}
        canComplete
        onComplete={() => {}}
        onUpdated={() => {}}
      />
    </MemoryRouter>,
  );
}

describe('InvoiceTaskPanel Text to Pay greeting (T-B9)', () => {
  beforeEach(() => {
    fetchClientByIdStaff.mockReset();
    fetchClientByIdStaff.mockResolvedValue({ firstName: 'Tom', lastName: 'Chen' });
  });

  it('T-B9-1: greets the client by first name, even when the link label is still "client #12"', async () => {
    renderPanel('client #12');
    fireEvent.click(screen.getByText('Text to Pay'));
    const box = (await screen.findByLabelText('Message')) as HTMLTextAreaElement;
    expect(box.value).toMatch(/^Hi Tom,/);
    expect(box.value).not.toMatch(/Hi client/i);

    // Fill names ticked (default): the picked template gets the first name too.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Use template'));
    await waitFor(() => expect(box.value).toBe('Hi Tom, you have a balance.'));
  });

  it('T-B9-1b: a real label is used as is', async () => {
    renderPanel('Tom Chen');
    fireEvent.click(screen.getByText('Text to Pay'));
    const box = (await screen.findByLabelText('Message')) as HTMLTextAreaElement;
    expect(box.value).toMatch(/^Hi Tom,/);
  });

  it('T-B9-2: with Fill names unticked, the template text is inserted unchanged', async () => {
    renderPanel('Tom Chen');
    fireEvent.click(screen.getByText('Text to Pay'));
    const box = (await screen.findByLabelText('Message')) as HTMLTextAreaElement;
    fireEvent.click(screen.getByLabelText('Fill names when inserting'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Use template'));
    await waitFor(() => expect(box.value).toBe('Hi {{client_first_name}}, you have a balance.'));
  });
});
