import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('./http', () => ({ http: { get: (...args: unknown[]) => get(...args) }, getToken: () => null }));

import { listSurveyResponses } from './survey';

/** B14-2 (communications training review, Nov 12, 2026): the Survey Results list was always empty. */
describe('listSurveyResponses', () => {
  beforeEach(() => get.mockReset());

  it('reads the list the API sends as { data, total }', async () => {
    get.mockResolvedValue({
      data: { data: [{ id: 1, surveyId: 2, appointmentId: null, submittedAt: '2026-11-10T15:00:00.000Z', clientId: 7491 }], total: 1 },
    });
    const res = await listSurveyResponses({ surveySlug: 'post-appointment', from: '2026-10-14', to: '2026-11-13' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe(1);
    expect(res.total).toBe(1);
  });

  it('still reads a bare array', async () => {
    get.mockResolvedValue({ data: [{ id: 3 }] });
    const res = await listSurveyResponses({ surveySlug: 'post-appointment', from: '2026-10-14', to: '2026-11-13' });
    expect(res.items).toHaveLength(1);
  });
});
