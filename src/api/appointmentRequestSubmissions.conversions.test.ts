import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('./http', () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import {
  fetchAllAppointmentRequestSubmissions,
  fetchAppointmentRequestSubmissionsPage,
} from './appointmentRequestSubmissions';

/** B8 (training review, Nov 7, 2026): the Appointments banner needs real conversion counts. */
describe('appointment request conversion counts', () => {
  beforeEach(() => get.mockReset());

  it('asks the API for conversion counts when requested', async () => {
    get.mockResolvedValue({ data: { items: [], total: 0, conversions: { converted: 0, totalRequests: 0 } } });
    await fetchAppointmentRequestSubmissionsPage({ practiceId: 1, page: 1, limit: 200, includeConversions: true });
    expect(get.mock.calls[0][1].params.includeConversions).toBe('true');
  });

  it('gets the counts with page 1 only, not with every later page', async () => {
    get
      .mockResolvedValueOnce({
        data: { items: [{ id: 1 }], total: 2, conversions: { converted: 1, totalRequests: 2 } },
      })
      .mockResolvedValueOnce({ data: { items: [{ id: 2 }], total: 2 } });
    const res = await fetchAllAppointmentRequestSubmissions({ practiceId: 1, includeConversions: true }, 1);
    expect(res.conversions).toEqual({ converted: 1, totalRequests: 2 });
    expect(get.mock.calls[0][1].params.includeConversions).toBe('true');
    expect(get.mock.calls[1][1].params.includeConversions).toBeUndefined();
  });
});
