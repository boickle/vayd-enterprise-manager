import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../api/http', () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import { fetchRoutingDoctor } from './routingDoctorLookup';

/** B3 (training review, Nov 7, 2026): routing names a doctor with no eVet id by employee id. */
describe('fetchRoutingDoctor', () => {
  beforeEach(() => get.mockReset());

  it('uses the eVet id when the doctor has one', async () => {
    get.mockResolvedValueOnce({ data: { id: 7673, firstName: 'Avery', lastName: 'Lane' } });
    expect((await fetchRoutingDoctor('90417'))?.firstName).toBe('Avery');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/employees/pims/90417');
  });

  it('falls back to the employee id for a doctor added in Scout', async () => {
    get
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
      .mockResolvedValueOnce({ data: { id: 7673, firstName: 'Avery', lastName: 'Lane' } });
    const emp = await fetchRoutingDoctor('7673');
    expect(get.mock.calls[1][0]).toBe('/employees/7673');
    expect(emp?.lastName).toBe('Lane');
  });

  it('returns null when neither lookup finds the doctor', async () => {
    get
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    expect(await fetchRoutingDoctor('7673')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
