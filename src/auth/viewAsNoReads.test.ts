/**
 * CAT-13: while viewing as someone, opening screens must not record anything for them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();
const put = vi.fn();
vi.mock('../api/http', () => ({
  apiBaseUrl: '',
  http: {
    post: (...a: unknown[]) => post(...a),
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
  },
}));

import { mayRecordOnOpen } from './impersonationSession';
import { markGmailMessageReadOnOpen } from '../api/gmail';
import { ensureRoomLoaderConfigSeeded } from '../api/roomLoaderConfig';

function startViewingAs() {
  localStorage.setItem(
    'vayd_impersonation',
    JSON.stringify({
      target: { userId: 2, email: 'a@b.c', role: 'staff', name: 'A', clientId: null },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      returnTo: '/',
      saved: {},
    })
  );
}

describe('view as: no automatic records', () => {
  beforeEach(() => {
    localStorage.clear();
    post.mockReset();
    get.mockReset();
    put.mockReset();
    post.mockResolvedValue({ data: { labelIds: [] } });
  });

  it('opening a Gmail message does not mark it read while viewing as', async () => {
    startViewingAs();
    expect(mayRecordOnOpen()).toBe(false);
    const result = await markGmailMessageReadOnOpen('box@x.com', 'm1', 't1');
    expect(result).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('opening a Gmail message still marks it read for a normal login', async () => {
    expect(mayRecordOnOpen()).toBe(true);
    await markGmailMessageReadOnOpen('box@x.com', 'm1', 't1');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('Room Loader settings are not seeded while viewing as, and are for a normal login', async () => {
    get.mockResolvedValue({ data: { config: null } });
    put.mockResolvedValue({ data: { config: {} } });
    startViewingAs();
    await ensureRoomLoaderConfigSeeded();
    expect(put).not.toHaveBeenCalled();
    localStorage.clear();
    await ensureRoomLoaderConfigSeeded();
    expect(put).toHaveBeenCalledTimes(1);
  });
});
