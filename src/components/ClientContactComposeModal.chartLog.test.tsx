import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { sendClientSms, submitCompose, gmailAllowed } = vi.hoisted(() => ({
  sendClientSms: vi.fn(async () => undefined),
  submitCompose: vi.fn(async () => ({ id: 'm1', threadId: 't1' })),
  gmailAllowed: { value: false },
}));

vi.mock('../api/clientSms', async (orig) => ({ ...(await orig<object>()), sendClientSms }));
vi.mock('./gmail/gmailCompose', async (orig) => ({ ...(await orig<object>()), submitCompose }));
vi.mock('../api/clientsStaff', async (orig) => ({
  ...(await orig<object>()),
  fetchClientByIdStaff: vi.fn(async () => ({ id: 9 })),
}));
vi.mock('../hooks/useGmailInboxAccess', () => ({
  useGmailInboxAccess: () => ({ allowed: gmailAllowed.value, loading: false }),
}));
vi.mock('../hooks/useClientEmailComposeSetup', () => ({
  useClientEmailComposeSetup: () => ({
    loading: false,
    error: null,
    mailbox: 'info@vayd.test',
    from: 'info@vayd.test',
    setFrom: () => {},
    fromOptions: [],
    handleFromChange: () => {},
    signatureHtml: '',
    to: 'ana@example.com',
    setTo: () => {},
  }),
}));

import { ClientContactComposeModal } from './ClientContactComposeModal';

beforeEach(() => {
  sendClientSms.mockClear();
  submitCompose.mockClear();
});
afterEach(cleanup);

async function clickSend() {
  await waitFor(() => {
    const send = screen.getAllByRole('button').filter((b) => /^send/i.test(b.textContent ?? ''));
    expect(send.length).toBeGreaterThan(0);
    expect((send[0] as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(screen.getAllByRole('button').filter((b) => /^send/i.test(b.textContent ?? ''))[0]);
}

it('COM-07d: a Care Outreach text sends the pet ids so the API files it on each pet', async () => {
  gmailAllowed.value = false;
  render(
    <ClientContactComposeModal
      open
      clientId={9}
      clientLabel="Ana Rivera"
      initialSmsMessage="Hi Ana, Biscuit is due."
      canText
      onClose={() => {}}
      smsSource="care_outreach"
      patientIds={[41, 42]}
    />,
  );
  await clickSend();
  await waitFor(() => expect(sendClientSms).toHaveBeenCalledTimes(1));
  expect(sendClientSms).toHaveBeenCalledWith(
    9,
    expect.objectContaining({ source: 'care_outreach', patientIds: [41, 42] }),
  );
});

it('COM-07d: a text with no pet sends no pet ids (client-level entry)', async () => {
  gmailAllowed.value = false;
  render(
    <ClientContactComposeModal
      open
      clientId={9}
      clientLabel="Ana Rivera"
      initialSmsMessage="Hi Ana."
      canText
      onClose={() => {}}
      smsSource="care_outreach"
    />,
  );
  await clickSend();
  await waitFor(() => expect(sendClientSms).toHaveBeenCalledTimes(1));
  const payload = (sendClientSms.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
  expect(payload.patientIds).toBeUndefined();
});

it('COM-07d: a Care Outreach email asks the API for the chart entry with the client and pets', async () => {
  gmailAllowed.value = true;
  render(
    <ClientContactComposeModal
      open
      clientId={9}
      clientLabel="Ana Rivera"
      initialSmsMessage="Hi Ana, Biscuit is due."
      canText={false}
      onClose={() => {}}
      patientIds={[41]}
    />,
  );
  await clickSend();
  await waitFor(() => expect(submitCompose).toHaveBeenCalledTimes(1));
  const arg = (submitCompose.mock.calls[0] as unknown[])[0] as { chartLog?: unknown };
  expect(arg.chartLog).toEqual({ clientId: 9, patientIds: [41], typeLabel: 'Care outreach email' });
});
