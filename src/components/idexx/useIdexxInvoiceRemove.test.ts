/**
 * Owner decision (Oct 30, 2026): once IDEXX has sent results, removing the charge asks for a
 * reason and says the results stay on the chart; it never offers to cancel the order.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useIdexxInvoice } from './useIdexxInvoice';

const state = (results: unknown[], status = 'SUBMITTED') => ({
  configured: true,
  invoiceStatus: 'finalized',
  lines: [{ lineId: 'line-1', orderId: 7, patientId: 1 }],
  orders: [{ id: 7, idexxOrderId: '100450016', status, results, invoiceLineIds: ['line-1'] }],
});
const getIdexxInvoiceState = vi.fn();
vi.mock('../../api/idexx', () => ({
  getIdexxInvoiceState: (...a: unknown[]) => getIdexxInvoiceState(...a),
  syncIdexxOrder: vi.fn(),
}));

async function hookWith(s: unknown) {
  getIdexxInvoiceState.mockResolvedValue(s);
  const { result } = renderHook(() => useIdexxInvoice('inv-1', 'line-1'));
  await waitFor(() => expect(result.current.state).not.toBeNull());
  return result;
}

it('results in: asks for a reason, says the results stay, never offers to cancel', async () => {
  const result = await hookWith(state([{ id: 1 }], 'COMPLETED'));
  const confirm = vi.fn(async () => true);
  const prompt = vi.fn(async () => 'Courtesy — owner declined the panel');

  const out = await result.current.confirmRemove('line-1', confirm, prompt);

  expect(out).toEqual({ reason: 'Courtesy — owner declined the panel', ranAtIdexx: true });
  expect(confirm).not.toHaveBeenCalled();
  const [opts] = prompt.mock.calls[0] as unknown as [{ message: string; requireReason: boolean }];
  expect(opts.message).toMatch(/results stay on the chart/);
  expect(opts.message).toMatch(/benefit stays used/);
  expect(opts.requireReason).toBe(true);
});

it('results in, no reason given: stops', async () => {
  const result = await hookWith(state([{ id: 1 }], 'COMPLETED'));
  await expect(result.current.confirmRemove('line-1', vi.fn(), vi.fn(async () => null))).resolves.toBe(false);
});

it('no results yet: still the "cancel the IDEXX order" question', async () => {
  const result = await hookWith(state([]));
  const confirm = vi.fn(async () => true);
  await expect(result.current.confirmRemove('line-1', confirm, vi.fn())).resolves.toEqual({
    reason: null,
    ranAtIdexx: false,
  });
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel the IDEXX order?' }));
});
