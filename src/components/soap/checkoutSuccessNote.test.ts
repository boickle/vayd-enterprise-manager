/**
 * Wave 8 (bug 7): after a declined card, a later successful payment (Type card manually, Scout
 * Terminal, gift card, account credit) must clear "Your card was declined." instead of leaving it
 * above the success note.
 */
import { describe, expect, it } from 'vitest';
import { showPaymentSuccess } from './checkoutSuccessNote';

describe('showPaymentSuccess', () => {
  it('clears a stale decline and shows the success note', () => {
    let error: string | null = 'Your card was declined.';
    let note: string | null = null;
    showPaymentSuccess(
      { setError: (v) => (error = v), setNote: (v) => (note = v) },
      'Card charged — invoice marked paid.',
    );
    expect(error).toBeNull();
    expect(note).toBe('Card charged — invoice marked paid.');
  });
});
