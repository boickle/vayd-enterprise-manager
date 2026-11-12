/** Owner (Nov 11, 2026): a client text back after the hold counts as a reply; one from before it doesn't. */
import { describe, expect, it } from 'vitest';
import { mailClientReplied } from './onlineStore';

describe('mailClientReplied', () => {
  it('a reply after the hold counts', () => {
    expect(mailClientReplied({ clientQuestionPendingAt: '2026-11-11T10:00:00Z', clientRepliedAt: '2026-11-11T10:05:00Z' })).toBe(true);
  });
  it('a reply from before the hold does not', () => {
    expect(mailClientReplied({ clientQuestionPendingAt: '2026-11-11T10:00:00Z', clientRepliedAt: '2026-11-11T09:00:00Z' })).toBe(false);
  });
  it('no hold or no reply: no', () => {
    expect(mailClientReplied({ clientQuestionPendingAt: null, clientRepliedAt: '2026-11-11T10:05:00Z' })).toBe(false);
    expect(mailClientReplied({ clientQuestionPendingAt: '2026-11-11T10:00:00Z', clientRepliedAt: null })).toBe(false);
  });
});
