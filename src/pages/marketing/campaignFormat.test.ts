import { describe, expect, it } from 'vitest';
import { sendWindowEnd, spreadLabel } from './campaignFormat';

describe('sendWindowEnd', () => {
  const start = new Date('2026-11-02T14:00:00Z');

  it('ends after the spread window', () => {
    expect(sendWindowEnd(start, 10, 4000).toISOString()).toBe('2026-11-02T14:10:00.000Z');
  });

  it('runs longer than the window when the audience is too big to send that fast', () => {
    expect(sendWindowEnd(start, 5, 9000).toISOString()).toBe('2026-11-02T14:15:00.000Z');
  });

  it('estimates the fastest send when not spread', () => {
    expect(sendWindowEnd(start, 0, 600).toISOString()).toBe('2026-11-02T14:01:00.000Z');
  });
});

describe('spreadLabel', () => {
  it('reads naturally', () => {
    expect(spreadLabel(0)).toBe('As fast as possible');
    expect(spreadLabel(15)).toBe('15 minutes');
    expect(spreadLabel(60)).toBe('1 hour');
    expect(spreadLabel(120)).toBe('2 hours');
  });
});
