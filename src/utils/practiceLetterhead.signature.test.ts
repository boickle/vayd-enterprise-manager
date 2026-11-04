/**
 * EMR-SETTINGSPERM: provider signatures are saved through the manager-only signature endpoint,
 * never through the general practice-settings save, and are still read from practice settings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../api/http', () => ({
  apiBaseUrl: '',
  http: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
    post: vi.fn(),
  },
}));

import { loadProviderSignature, saveProviderSignature } from './practiceLetterhead';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('saveProviderSignature (EMR-SETTINGSPERM)', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    del.mockReset();
    put.mockResolvedValue({ data: { ok: true, employeeId: 42, hasSignature: true } });
    del.mockResolvedValue({ data: { ok: true, employeeId: 42, hasSignature: false } });
  });

  it('SETPERM-FE-1: sets a signature with PUT /employees/:id/signature', async () => {
    await saveProviderSignature(42, PNG, 1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/employees/42/signature', { practiceId: 1, image: PNG });
    expect(del).not.toHaveBeenCalled();
  });

  it('SETPERM-FE-2: clears a signature with DELETE /employees/:id/signature', async () => {
    await saveProviderSignature(42, null, 1);
    expect(del).toHaveBeenCalledWith('/employees/42/signature', { params: { practiceId: 1 } });
    expect(put).not.toHaveBeenCalled();
  });

  it('SETPERM-FE-3: never writes the practice settings map (no read-modify-write of every signature)', async () => {
    await saveProviderSignature(42, PNG, 1);
    await saveProviderSignature(42, null, 1);
    const urls = [...put.mock.calls, ...del.mock.calls].map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/settings'))).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('SETPERM-FE-4: a refused save (403) reaches the screen as an error', async () => {
    put.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { response: { status: 403 } }));
    await expect(saveProviderSignature(42, PNG, 1)).rejects.toThrow('Forbidden');
  });

  it('SETPERM-FE-5: reading is unchanged: the signature comes from practice settings', async () => {
    get.mockResolvedValue({ data: { 'labels.providerSignatures': JSON.stringify({ 42: PNG, 7: 'nope' }) } });
    expect(await loadProviderSignature(42, 1)).toBe(PNG);
    expect(await loadProviderSignature(7, 1)).toBeNull();
    expect(get).toHaveBeenCalledWith('/practice/1/settings');
  });
});
