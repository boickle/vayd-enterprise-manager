/** W12-1: the Card on file section on the client's Financial tab. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const granted = new Set<string>();
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  usePermissions: () => ({}),
}));

const getClientCardOnFile = vi.fn();
const startClientCardReplacement = vi.fn();
const saveClientCardOnFile = vi.fn();
const removeClientCardOnFile = vi.fn();
vi.mock('../../api/visitWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/visitWorkflow')>()),
  getClientCardOnFile: (...a: unknown[]) => getClientCardOnFile(...a),
  startClientCardReplacement: (...a: unknown[]) => startClientCardReplacement(...a),
  saveClientCardOnFile: (...a: unknown[]) => saveClientCardOnFile(...a),
  removeClientCardOnFile: (...a: unknown[]) => removeClientCardOnFile(...a),
}));
const listPatientMemberships = vi.fn();
const getMembershipCard = vi.fn();
vi.mock('../../api/memberships', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/memberships')>()),
  listPatientMemberships: (...a: unknown[]) => listPatientMemberships(...a),
  getMembershipCard: (...a: unknown[]) => getMembershipCard(...a),
}));
vi.mock('./ClientCardSetupEntry', async () => {
  const React = await import('react');
  return {
    default: ({ name, onReady }: { name?: string | null; onReady: (c: (s: string) => Promise<string>) => void }) => {
      React.useEffect(() => {
        onReady(async () => 'seti_confirmed');
      }, [onReady]);
      return <div>card box{name ? ` for ${name}` : ''}</div>;
    },
  };
});

import ClientCardOnFileSection, { agreedHow } from './ClientCardOnFileSection';
import { CARD_ON_FILE_STAFF_WORDING } from '../../utils/cardOnFileWording';

const withCard = {
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, expired: false },
  consentAt: '2026-09-01T12:00:00Z',
  consentSource: 'terminal',
  agreementVersion: '2026-10-07',
  currentAgreementVersion: '2026-10-07',
  declinedAt: null,
};
const noCard = { ...withCard, card: null, consentAt: null, consentSource: null, agreementVersion: null };

const ui = () => (
  <MemoryRouter>
    <ClientCardOnFileSection clientId={5} />
  </MemoryRouter>
);

describe('Card on file section', () => {
  beforeEach(() => {
    getClientCardOnFile.mockReset().mockResolvedValue(withCard);
    startClientCardReplacement.mockReset().mockResolvedValue({ setupIntentId: 'seti_1', clientSecret: 'seti_1_secret' });
    saveClientCardOnFile.mockReset().mockResolvedValue({ ...withCard, card: { ...withCard.card, last4: '1111' } });
    removeClientCardOnFile.mockReset().mockResolvedValue(noCard);
    listPatientMemberships.mockReset().mockResolvedValue([]);
    getMembershipCard.mockReset();
  });
  afterEach(() => granted.clear());

  it('shows the card, and when and how the owner agreed', async () => {
    render(ui());
    expect(await screen.findByText(/Visa ending 4242, expires 12\/30/)).toBeTruthy();
    expect(screen.getByText(/Owner agreed .*Tap to Pay at a visit, agreement 2026-10-07/)).toBeTruthy();
  });

  it('INV-20 review (Nov 13, 2026): how the owner agreed reads as a note in brackets', async () => {
    getClientCardOnFile.mockResolvedValue({ ...withCard, consentSource: 'manual', agreementVersion: '2026-11-12' });
    render(ui());
    expect(await screen.findByText(/Owner agreed .* \(entered by staff, agreement 2026-11-12\)\./)).toBeTruthy();
    expect(screen.queryByText(/from entered by staff/)).toBeNull();
  });

  it('agreedHow: source and version, either one missing', () => {
    expect(agreedHow('terminal', '2026-10-07')).toBe('Tap to Pay at a visit, agreement 2026-10-07');
    expect(agreedHow(null, '2026-11-12')).toBe('agreement 2026-11-12');
    expect(agreedHow('store', null)).toBe('the online store, before agreement versions were recorded');
  });

  it("INV-20 review: Replace card fills in Name on card with the client's name", async () => {
    granted.add('card_on_file.manage');
    render(
      <MemoryRouter>
        <ClientCardOnFileSection clientId={5} clientName="Maria Rivera" />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Replace card' }));
    expect(await screen.findByText('card box for Maria Rivera')).toBeTruthy();
  });

  it('PAY-C5-1: an expired card is shown as "Expired, ending 4242", not as a card to use', async () => {
    getClientCardOnFile.mockResolvedValue({ ...withCard, card: { ...withCard.card, expired: true } });
    render(ui());
    expect(await screen.findByText('Expired, ending 4242')).toBeTruthy();
    expect(screen.queryByText(/expires 12\/30/)).toBeNull();
    expect(screen.queryByText('No card on file')).toBeNull();
  });

  it('says "No card on file" when there is none', async () => {
    getClientCardOnFile.mockResolvedValue(noCard);
    render(ui());
    expect(await screen.findByText('No card on file')).toBeTruthy();
  });

  it('an observer (no card_on_file.manage) sees the card but no buttons', async () => {
    render(ui());
    await screen.findByText(/Visa ending 4242/);
    expect(screen.queryByRole('button', { name: /replace card/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove card/i })).toBeNull();
  });

  it('Replace card: consent starts unticked and Save stays off until it is ticked, then saves', async () => {
    granted.add('card_on_file.manage');
    render(ui());
    fireEvent.click(await screen.findByRole('button', { name: 'Replace card' }));
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    const save = screen.getByRole('button', { name: 'Save card' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(box);
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(saveClientCardOnFile).toHaveBeenCalledWith(5, { setupIntentId: 'seti_confirmed', consent: true }));
    expect(startClientCardReplacement).toHaveBeenCalledWith(5);
    expect(await screen.findByText(/Visa ending 1111/)).toBeTruthy();
  });

  it('PAY-C3-1: Replace card shows the practice-wide staff wording', async () => {
    granted.add('card_on_file.manage');
    render(ui());
    fireEvent.click(await screen.findByRole('button', { name: 'Replace card' }));
    const text = document.querySelector('.client-card__consent')?.textContent ?? '';
    expect(text).toContain(CARD_ON_FILE_STAFF_WORDING);
    expect(text).toMatch(/visits, refills, memberships and online store orders/);
  });

  it('Remove card asks for a reason first, then removes', async () => {
    granted.add('card_on_file.manage');
    render(ui());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove card' }));
    const go = screen.getAllByRole('button', { name: 'Remove card' }).pop() as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Owner asked' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(removeClientCardOnFile).toHaveBeenCalledWith(5, 'Owner asked'));
    expect(await screen.findByText('No card on file')).toBeTruthy();
  });

  it('PAY-C2-4: the Remove window names the membership that keeps the card', async () => {
    granted.add('card_on_file.manage');
    getClientCardOnFile.mockResolvedValue({ ...withCard, stillUsedBy: ["Pippin's Gold membership"] });
    removeClientCardOnFile.mockResolvedValue({
      ...noCard,
      removed: { last4: '4242', brand: 'visa', detached: false, stillUsedBy: ["Pippin's Gold membership"] },
    });
    render(ui());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove card' }));
    expect(screen.getByText(/Still used by Pippin's Gold membership\. The card is kept for it only/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Owner asked' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove card' }).pop() as HTMLButtonElement);
    expect(await screen.findByText("Card removed. Kept only for Pippin's Gold membership.")).toBeTruthy();
  });

  it('PAY-C2-4: no membership or auto-ship on the card: the Remove window says it is removed everywhere', async () => {
    granted.add('card_on_file.manage');
    render(ui());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove card' }));
    expect(screen.queryByText(/Still used by/)).toBeNull();
    expect(screen.getByText(/Removes the card everywhere/)).toBeTruthy();
  });

  it('notes a membership billed on a different card, with a link to the pet', async () => {
    listPatientMemberships.mockResolvedValue([
      { id: 9, patientId: 77, patientName: 'Hazel', status: 'active', stripeSubscriptionId: 'sub_1' },
      { id: 10, patientId: 78, patientName: 'Moss', status: 'active', stripeSubscriptionId: 'sub_2' },
    ]);
    getMembershipCard
      .mockResolvedValueOnce({ card: { brand: 'mastercard', last4: '1111', expMonth: 1, expYear: 2030 } })
      .mockResolvedValueOnce({ card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 } });
    render(ui());
    expect(await screen.findByText(/Hazel's membership is billed on a different card/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Hazel's membership/ });
    expect(link.getAttribute('href')).toBe('/schedule/patients?patientId=77');
    expect(screen.queryByText(/Moss/)).toBeNull();
  });
});
