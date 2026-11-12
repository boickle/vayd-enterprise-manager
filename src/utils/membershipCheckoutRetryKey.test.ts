import { describe, expect, it } from 'vitest';
import { keepCheckoutKeyAfterError, newCheckoutKey } from './membershipCheckoutRetryKey';

describe('PAY-A9: membership checkout keeps one key per attempt', () => {
  it('keeps the key when the reply never arrived', () => {
    expect(keepCheckoutKeyAfterError({ code: 'ERR_NETWORK', request: {} })).toBe(true);
    expect(keepCheckoutKeyAfterError({ code: 'ECONNABORTED', request: {} })).toBe(true);
  });

  it('keeps the key when the server could not hear back from the card processor', () => {
    expect(keepCheckoutKeyAfterError({ response: { status: 503 } })).toBe(true);
    expect(keepCheckoutKeyAfterError({ response: { status: 504 } })).toBe(true);
  });

  it('makes a new key after the server answered (decline, refusal, server error with a reason)', () => {
    expect(keepCheckoutKeyAfterError({ response: { status: 400 } })).toBe(false);
    expect(keepCheckoutKeyAfterError({ response: { status: 500 } })).toBe(false);
    expect(keepCheckoutKeyAfterError(new Error('Your bank did not approve the card.'))).toBe(false);
    expect(keepCheckoutKeyAfterError(null)).toBe(false);
  });

  it('makes distinct keys', () => {
    expect(newCheckoutKey()).not.toBe(newCheckoutKey());
  });
});
