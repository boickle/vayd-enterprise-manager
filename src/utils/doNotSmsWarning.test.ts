import { describe, expect, it } from 'vitest';
import { clientTextsOffReason } from './doNotSmsWarning';

describe('clientTextsOffReason (COM-03)', () => {
  it('says why when a STOP reply turned texts off', () => {
    expect(
      clientTextsOffReason({
        doNotSms: true,
        smsOptOut: true,
        smsOptOutSource: 'replied STOP',
        smsOptOutAt: '2026-11-09T15:00:00.000Z',
      }),
    ).toBe('Texts off: replied STOP (Nov 9, 2026)');
  });

  it('says Quo blocked when Quo refused a send', () => {
    expect(
      clientTextsOffReason({
        doNotSms: true,
        smsOptOutSource: 'Quo blocked',
        smsOptOutAt: '2026-11-09T15:00:00.000Z',
      }),
    ).toBe('Texts off: Quo blocked (Nov 9, 2026)');
  });

  it('is null when texts are on or staff turned them off', () => {
    expect(clientTextsOffReason({ doNotSms: false, smsOptOutSource: null })).toBeNull();
    expect(clientTextsOffReason({ doNotSms: true, smsOptOut: true, smsOptOutSource: null })).toBeNull();
    expect(clientTextsOffReason(null)).toBeNull();
  });
});
