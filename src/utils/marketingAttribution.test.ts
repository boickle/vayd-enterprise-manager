import { afterEach, describe, expect, it } from 'vitest';
import {
  captureMarketingAttribution,
  decodeGlSegment,
  parseAttributionFromGl,
  parseClickIdFromGclValue,
} from './marketingAttribution';

const GCLID = 'EAIaIQobChMIlNTl_7DqlwMVXWwPAh3hzTcCEAAYASAAEgL3HvD_BwE';

/** Linker param captured from a live Wix → portal "Request Appointment" click. */
const LIVE_GL =
  '1*13flazb*_gcl_aw*R0NMLjE3OTM2NjAzNDEuRUFJYUlRb2JDaE1JbE5UbF83RHFsd01WWFd3UEFoM2h6VGNDRUFBWUFTQUFFZ0wzSHZEX0J3RQ..*_ga*MjAwMDg5Mjg4My4xNzkzNjYwMzM1*_ga_WNRQDBWSN8*czE3OTM2NjAzMzQkbzEkZzEkdDE3OTM2NjAzNDAkajU0JGwwJGg3NjAwNjA2MDc.';

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
});

describe('parseClickIdFromGclValue', () => {
  it('reads a gclid out of the _gcl_aw cookie', () => {
    expect(parseClickIdFromGclValue(`GCL.1793660341.${GCLID}`)).toBe(GCLID);
  });

  it('rejects a cookie that is not a click id', () => {
    expect(parseClickIdFromGclValue('1.1.943675774.1793660363')).toBeUndefined();
  });
});

describe('parseAttributionFromGl', () => {
  it('recovers the click id and Analytics client id Wix forwards', () => {
    expect(parseAttributionFromGl(`?_gl=${LIVE_GL}`)).toEqual({
      gclid: GCLID,
      gaClientId: '2000892883.1793660335',
    });
  });

  it('decodes the live _gcl_aw segment to the cookie value', () => {
    const segment = LIVE_GL.split('*')[3];
    expect(decodeGlSegment(segment)).toBe(`GCL.1793660341.${GCLID}`);
  });
});

describe('captureMarketingAttribution', () => {
  it('stores the linker click id when the portal URL has no ?gclid=', () => {
    const captured = captureMarketingAttribution(`?_gl=${LIVE_GL}`);
    expect(captured.gclid).toBe(GCLID);
    expect(captured.gaClientId).toBe('2000892883.1793660335');
  });

  it('prefers an explicit gclid over the linker', () => {
    const captured = captureMarketingAttribution(`?gclid=from-url&_gl=${LIVE_GL}`);
    expect(captured.gclid).toBe('from-url');
  });

  it('reads the ads cookie and ignores the Wix property session cookie', () => {
    const previous = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        cookie: [
          `_gcl_aw=GCL.1793660341.${GCLID}`,
          '_ga_WNRQDBWSN8=GS2.1.s1793660334$o1$g1$t1793660340$j54$l0$h0',
          '_ga_PHDH2QGN6C=GS2.1.s1793660364$o1$g0$t1793660364$j60$l0$h0',
        ].join('; '),
      },
    });
    try {
      const captured = captureMarketingAttribution('');
      expect(captured.gclid).toBe(GCLID);
      expect(captured.gaSessionId === undefined || captured.gaSessionId === '1793660364').toBe(true);
      expect(captured.gaSessionId).not.toBe('1793660334');
    } finally {
      if (previous === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
      }
    }
  });
});
