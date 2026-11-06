import axios, { AxiosError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  http,
  isNetworkError,
  isOffline,
  NOT_CHARGED_OFFLINE_MESSAGE,
  paymentErrorMessage,
  resetNetworkStatusForTests,
  subscribeNetworkStatus,
} from './http';
import { updateEncounter } from './visitWorkflow';
import {
  clearSoapChartDraft,
  readSoapChartDraft,
  writeSoapChartDraft,
} from '../utils/soapChartDraft';

const networkFailure = (config: any) =>
  Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config, {}));
const httpFailure = (status: number) => (config: any) =>
  Promise.reject(
    new AxiosError('bad', 'ERR_BAD_REQUEST', config, {}, {
      status,
      statusText: '',
      data: { message: 'nope' },
      headers: {},
      config,
    } as any)
  );
const ok = (config: any) =>
  Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });

afterEach(() => {
  http.defaults.adapter = undefined;
  resetNetworkStatusForTests();
  vi.restoreAllMocks();
});

describe('http network-error detection (EMR-A10)', () => {
  it('treats a request with no response as a network error, but not an HTTP error or a cancel', async () => {
    http.defaults.adapter = networkFailure;
    const net = await http.get('/x').catch((e) => e);
    expect(isNetworkError(net)).toBe(true);

    http.defaults.adapter = httpFailure(500);
    const server = await http.get('/x').catch((e) => e);
    expect(isNetworkError(server)).toBe(false);

    expect(isNetworkError(new axios.CanceledError('canceled'))).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });

  it('goes offline on a network failure, stays online on an HTTP error, and clears on the next success', async () => {
    const seen = vi.fn();
    const off = subscribeNetworkStatus(seen);
    http.defaults.adapter = httpFailure(500);
    await http.get('/x').catch(() => undefined);
    expect(isOffline()).toBe(false);

    http.defaults.adapter = networkFailure;
    await http.get('/x').catch(() => undefined);
    expect(isOffline()).toBe(true);

    http.defaults.adapter = ok;
    await http.get('/x');
    expect(isOffline()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });

  it('follows the browser offline and online events', () => {
    window.dispatchEvent(new Event('offline'));
    expect(isOffline()).toBe(true);
    window.dispatchEvent(new Event('online'));
    expect(isOffline()).toBe(false);
  });
});

describe('payment message (EMR-A10-2)', () => {
  it('says not charged on a network error and leaves HTTP errors alone', async () => {
    http.defaults.adapter = networkFailure;
    const net = await http.post('/visit-payments/1/charge-saved-card').catch((e) => e);
    expect(paymentErrorMessage(net)).toBe(NOT_CHARGED_OFFLINE_MESSAGE);
    expect(NOT_CHARGED_OFFLINE_MESSAGE).toContain('Not charged');
    expect(NOT_CHARGED_OFFLINE_MESSAGE).toContain('it will show here when the connection returns');

    http.defaults.adapter = httpFailure(402);
    const declined = await http.post('/x').catch((e) => e);
    expect(paymentErrorMessage(declined)).toBe('nope');
  });

  it('never retries a charge on its own: one failed request is one attempt', async () => {
    const adapter = vi.fn(networkFailure);
    http.defaults.adapter = adapter;
    await http.post('/visit-payments/1/charge-saved-card').catch(() => undefined);
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});

describe('SOAP save while offline (EMR-A10-1)', () => {
  it('sends expectedUpdatedAt, fails as a network error, and the local draft survives for the retry', async () => {
    const adapter = vi.fn(networkFailure);
    http.defaults.adapter = adapter;
    const err = await updateEncounter('enc-1', { planNotes: 'Recheck in 2 weeks' } as any, {
      expectedUpdatedAt: '2026-11-03T10:00:00.000Z',
    }).catch((e) => e);
    expect(isNetworkError(err)).toBe(true);
    expect(JSON.stringify(adapter.mock.calls[0][0].data)).toContain('2026-11-03T10:00:00.000Z');

    writeSoapChartDraft('enc-1', { planNotes: 'Recheck in 2 weeks', at: new Date().toISOString() } as any);
    expect(readSoapChartDraft('enc-1')?.planNotes).toBe('Recheck in 2 weeks');
    clearSoapChartDraft('enc-1');
  });

  it('a retry that meets a newer version is a 409, not a network error', async () => {
    http.defaults.adapter = httpFailure(409);
    const err = await updateEncounter('enc-1', { planNotes: 'x' } as any, {
      expectedUpdatedAt: '2026-11-03T10:00:00.000Z',
    }).catch((e) => e);
    expect(isNetworkError(err)).toBe(false);
    expect(err.response.status).toBe(409);
  });
});
