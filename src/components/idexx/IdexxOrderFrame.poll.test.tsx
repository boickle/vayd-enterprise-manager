/**
 * LAB-01-5 (docs/test-plans/labs.md): while the IDEXX order frame is open, Scout checks the order
 * every 10 s. A check (POST /idexx/orders/:id/sync) can be slow; the next one must wait for it to
 * finish, so there is never more than one sync of the order in flight (two at once could each
 * charge the same add-on).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IdexxOrderFrame, { CHECK_EVERY_MS } from './IdexxOrderFrame';
import type { IdexxOrder, IdexxSyncResult } from '../../api/idexx';

vi.mock('../../api/idexx', () => ({
  syncIdexxOrder: vi.fn(),
  idexxErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const SYNC_MS = 15_000;

const order = {
  id: 7,
  idexxOrderId: '100450016',
  status: 'CREATED',
  uiUrl: 'https://fake-idexx.test/order/100450016',
  results: [],
  invoiceLineIds: ['line-1'],
} as unknown as IdexxOrder;

function slowSync() {
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const onSync = vi.fn(
    () =>
      new Promise<IdexxSyncResult>((resolve) => {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve({ order, added: [], uncaptured: [], removed: [], stillCharged: [] });
        }, SYNC_MS);
      })
  );
  return { onSync, stats: () => ({ inFlight, maxInFlight, calls }) };
}

async function advance(ms: number) {
  // Step through so the timers each finished sync schedules get to run.
  for (let t = 0; t < ms; t += 500) {
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
  }
}

describe('IdexxOrderFrame polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LAB-01-5: a 15 s sync never overlaps the next poll (30 s open, fresh link)', async () => {
    const { onSync, stats } = slowSync();
    render(<IdexxOrderFrame order={order} patientName="Max" fresh onSync={onSync} onClose={() => {}} />);

    await advance(30_000);

    expect(stats().calls).toBeGreaterThanOrEqual(1);
    expect(stats().maxInFlight).toBe(1);
  });

  it('LAB-01-5: the opening link refresh and the polls share one sync at a time', async () => {
    const { onSync, stats } = slowSync();
    render(<IdexxOrderFrame order={order} patientName="Max" onSync={onSync} onClose={() => {}} />);

    await advance(60_000);

    // Opening refresh (0–15 s), then each poll starts 10 s after the last sync finished.
    expect(stats().calls).toBeGreaterThanOrEqual(2);
    expect(stats().maxInFlight).toBe(1);
    expect(CHECK_EVERY_MS).toBe(10_000);
  });
});
