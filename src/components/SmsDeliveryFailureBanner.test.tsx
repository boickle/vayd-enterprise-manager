import { describe, expect, it } from 'vitest';
import { sentByLine } from './SmsDeliveryFailureBanner';

/** B13-1 (owner, Nov 13, 2026): managers see other people's failed texts, labeled with the sender. */
describe('sentByLine', () => {
  it('your own failed text: no sender line', () => {
    expect(sentByLine({ sentByMe: true, senderName: 'Casey Morgan' })).toBeNull();
  });
  it("a manager's copy of someone else's: who sent it", () => {
    expect(sentByLine({ sentByMe: false, senderName: 'Jordan Pike' })).toBe('Sent by Jordan Pike.');
  });
  it('a text Scout sent on its own', () => {
    expect(sentByLine({ sentByMe: false, senderName: null })).toBe('Sent by Scout.');
  });
  it('an older API without the field: nothing extra', () => {
    expect(sentByLine({})).toBeNull();
  });
});
