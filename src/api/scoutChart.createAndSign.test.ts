import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('./http', () => ({ http: { post: (...args: unknown[]) => post(...args) }, getToken: () => null }));

import { createAndSignScoutChartNote } from './scoutChart';

/**
 * Call and callback notes go on the pet's chart signed (owner, Nov 12, 2026: anyone on staff
 * signs a medical note). A failed signing must not leave a stray draft on the chart.
 */
describe('createAndSignScoutChartNote', () => {
  beforeEach(() => post.mockReset());

  it('creates the note, then signs it', async () => {
    post
      .mockResolvedValueOnce({ data: { id: 'n1', status: 'draft' } })
      .mockResolvedValueOnce({ data: { id: 'n1', status: 'finalized' } });
    const note = await createAndSignScoutChartNote({ patientId: 8578, clientId: 7490, body: 'Phone call' });
    expect(note.status).toBe('finalized');
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/scout-chart/notes', '/scout-chart/notes/n1/finalize']);
  });

  it('takes the draft back off the chart when signing fails, then shows the error', async () => {
    const refused = new Error('Request failed with status code 403');
    post
      .mockResolvedValueOnce({ data: { id: 'n2', status: 'draft' } })
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce({ data: { id: 'n2' } });
    await expect(createAndSignScoutChartNote({ patientId: 8578, body: 'Callback' })).rejects.toBe(refused);
    expect(post.mock.calls[2][0]).toBe('/scout-chart/notes/n2/remove-from-chart');
    expect(post.mock.calls[2][1]).toMatchObject({ reason: 'uploaded_in_error' });
  });
});
