/**
 * LAB-A14 follow-up (docs/test-plans/labs.md): the send screen pre-picks the bill line's provider
 * as the ordering vet. When that provider is a tech (not in the vet list), the dropdown showed
 * "Appointment's doctor" but sent the tech's id. A non-vet pre-pick now falls back to the
 * appointment's doctor (no vet sent, so the API uses the appointment's doctor); a vet stays picked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IdexxSendModal from './IdexxSendModal';
import { sendIdexxFromInvoice } from '../../api/idexx';

vi.mock('../../api/idexx', () => ({
  getIdexxOrderPreview: vi.fn(async () => ({ missing: [], patient: { genderCode: 'MALE_NEUTERED' } })),
  idexxGenders: vi.fn(async () => []),
  idexxSpecies: vi.fn(async () => []),
  sendIdexxFromInvoice: vi.fn(async () => ({ id: 1, status: 'CREATED', uiUrl: null })),
  idexxErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

vi.mock('../../api/employee', () => ({
  fetchVeterinarians: vi.fn(async () => ({
    providers: [
      { id: 11, name: 'Dr. Lee' },
      { id: 12, name: 'Dr. Park' },
    ],
  })),
}));

const lines = [
  { lineId: 'line-1', patientId: 5, labId: 1, labName: 'Chem 25', testCode: 'CHEM25', orderId: null },
];

function open(defaultVeterinarianId: number | null) {
  render(
    <IdexxSendModal
      invoiceId="inv-1"
      patientId={5}
      patientName="Max"
      lines={lines}
      defaultVeterinarianId={defaultVeterinarianId}
      onClose={() => undefined}
      onSent={() => undefined}
    />
  );
}

async function sendNow() {
  const button = await screen.findByRole('button', { name: /Send 1 test to IDEXX/ });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(sendIdexxFromInvoice).toHaveBeenCalledTimes(1));
  return vi.mocked(sendIdexxFromInvoice).mock.calls[0][1];
}

describe('IdexxSendModal ordering vet', () => {
  beforeEach(() => {
    vi.mocked(sendIdexxFromInvoice).mockClear();
  });

  it('a tech pre-picked from the bill line falls back to the appointment\'s doctor', async () => {
    open(99); // a tech: not in the vet list
    const select = (await screen.findByLabelText(/Veterinarian/)) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Dr. Lee' });
    await waitFor(() => expect(select.value).toBe(''));

    const body = await sendNow();
    expect(body.veterinarianEmployeeId).toBeUndefined();
  });

  it('a vet pre-picked from the bill line stays picked and is sent', async () => {
    open(12);
    const select = (await screen.findByLabelText(/Veterinarian/)) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Dr. Park' });
    expect(select.value).toBe('12');

    const body = await sendNow();
    expect(body.veterinarianEmployeeId).toBe(12);
  });
});
