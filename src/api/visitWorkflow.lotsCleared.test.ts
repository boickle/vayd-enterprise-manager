/**
 * CAT-09 review: a line edit whose new quantity no longer fits the line's lots comes back with
 * lotsCleared, and staff are told to pick the lots again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patch = vi.fn();
const appAlert = vi.fn(async () => undefined);
vi.mock('./http', () => ({ apiBaseUrl: '', http: { patch: (...a: unknown[]) => patch(...a) } }));
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));
vi.mock('../utils/appDialog', () => ({ appAlert: (...a: unknown[]) => appAlert(...(a as [])) }));

import { updateCounterInvoiceLine } from './visitWorkflow';

describe('updateCounterInvoiceLine: lots cleared by a quantity change', () => {
  beforeEach(() => {
    patch.mockReset();
    appAlert.mockClear();
  });

  it('says the lots were cleared when the server cleared them', async () => {
    patch.mockResolvedValue({ data: { id: 'inv', lines: [], lotsCleared: true, lotsClearedLineId: 'l1' } });
    const inv = await updateCounterInvoiceLine('inv', 'l1', { qty: 15 });
    expect(inv.lotsCleared).toBe(true);
    expect(appAlert).toHaveBeenCalledWith({
      title: 'Lots cleared',
      message: 'Lots were cleared because the quantity changed — pick lots again.',
    });
  });

  it('says nothing when the lots still fit', async () => {
    patch.mockResolvedValue({ data: { id: 'inv', lines: [] } });
    await updateCounterInvoiceLine('inv', 'l1', { qty: 25 });
    expect(appAlert).not.toHaveBeenCalled();
  });

  it('LAB-07-3: tells staff when an IDEXX order stays with the first pet', async () => {
    patch.mockResolvedValue({ data: { id: 'inv', lines: [], labWarnings: ['IDEXX order 9 stays with Max. Its results will arrive on that pet.'] } });
    await updateCounterInvoiceLine('inv', 'l1', { patientId: 2 });
    expect(appAlert).toHaveBeenCalledWith({
      title: 'Lab stays with the first pet',
      message: 'IDEXX order 9 stays with Max. Its results will arrive on that pet.',
    });
  });
});
