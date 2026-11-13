import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { payLinkPreviewText } from './payLinkPreview';

const fetchCredit = vi.fn();
vi.mock('../api/visitWorkflow', () => ({
  fetchAvailableAccountCredit: (...a: unknown[]) => fetchCredit(...a),
}));

import { usePayLinkCredit } from './usePayLinkCredit';

const money = (n: number) => `$${n.toFixed(2)}`;

it('PAY-W9B-2: the pay-link line recomputes after Add credit without a reload', async () => {
  fetchCredit.mockResolvedValue({ total: 0 });
  const { result } = renderHook(() => usePayLinkCredit(7, 100));
  await waitFor(() => expect(fetchCredit).toHaveBeenCalledTimes(1));
  expect(payLinkPreviewText(100, result.current.credit, 1, money)).toContain('Sends $100.00');

  fetchCredit.mockResolvedValue({ total: 30 });
  act(() => result.current.refreshCredit());
  await waitFor(() => expect(result.current.credit).toBe(30));
  expect(payLinkPreviewText(100, result.current.credit, 1, money)).toContain('Sends $70.00');
});

it("PAY-A17-11: a deposit held for an unpaid bill's own visit comes off the pay-link line", async () => {
  fetchCredit.mockReset();
  fetchCredit.mockResolvedValue({ total: 0, depositHeld: 100, payLinkDeposit: 100 });
  const { result } = renderHook(() => usePayLinkCredit(7, 187));
  await waitFor(() => expect(result.current.credit).toBe(100));
  expect(fetchCredit).toHaveBeenCalledWith(7, undefined, { forPayLink: true });
  expect(payLinkPreviewText(187, result.current.credit, 2, money)).toContain('Sends $87.00');
});
