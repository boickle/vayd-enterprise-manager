/** EMR-07b: the label-print entry in the prescription history never gets in the way of printing. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();
vi.mock('./http', () => ({
  http: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}));
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));

import { getRecordHistory, recordRxLabelPrinted } from './recordHistory';

beforeEach(() => {
  post.mockReset();
  get.mockReset();
});

describe('EMR-07b: record history API', () => {
  it('logs a printed label with its Rx number', async () => {
    post.mockResolvedValue({ data: {} });
    await recordRxLabelPrinted('12345');
    expect(post).toHaveBeenCalledWith('/record-history/rx-label-printed', {
      practiceId: 1,
      rxNumber: 12345,
    });
  });

  it('skips a label with no real Rx number', async () => {
    await recordRxLabelPrinted('');
    await recordRxLabelPrinted(null);
    await recordRxLabelPrinted('—');
    expect(post).not.toHaveBeenCalled();
  });

  it('swallows a failed log so the print still counts as done', async () => {
    post.mockRejectedValue(new Error('network'));
    await expect(recordRxLabelPrinted(7)).resolves.toBeUndefined();
  });

  it('asks for history by record type and id', async () => {
    get.mockResolvedValue({ data: [] });
    await getRecordHistory('invoice_line', 'line-1');
    expect(get).toHaveBeenCalledWith('/record-history', {
      params: { practiceId: 1, entityType: 'invoice_line', entityId: 'line-1' },
    });
  });
});
