/** EMR-A5: when the invite exists but its email failed, the staff screen says so instead of "Form sent!". */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ChartSendForm from './ChartSendForm';

const sendFormInvite = vi.fn();
vi.mock('../../api/forms', () => ({
  listFormInvites: async () => [],
  sendFormInvite: (...a: unknown[]) => sendFormInvite(...a),
}));
vi.mock('../../utils/formTemplateSeeds', () => ({
  ensureDefaultFormTemplates: async () => [
    { id: 4, name: 'Boarding waiver', isPublished: true, allowEditBeforeSend: false, fields: [] },
  ],
}));

async function submit() {
  render(<ChartSendForm patientId={7} clientId={3} defaultEmail="wren@vayd.test" open onClose={() => {}} />);
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: /send form link/i }));
}

describe('EMR-A5-1 form invite email failure', () => {
  beforeEach(() => sendFormInvite.mockReset());

  it('shows the failure and not the success line', async () => {
    sendFormInvite.mockResolvedValue({
      id: 9, token: 't', emailSent: false,
      emailError: 'The form was created but the email was not sent: SES is down',
    });
    await submit();
    expect(await screen.findByText(/email was not sent: SES is down/)).toBeTruthy();
    expect(screen.queryByText(/Form sent/)).toBeNull();
  });

  it('shows success when the email went out', async () => {
    sendFormInvite.mockResolvedValue({ id: 9, token: 't', emailSent: true, emailError: null });
    await submit();
    await waitFor(() => expect(screen.getByText(/Form sent/)).toBeTruthy());
  });
});
