import { describe, expect, it } from 'vitest';
import { addedSummary } from './AddToWeeklyCountModal';

describe('addedSummary', () => {
  it('counts what was added, and what was already on the sheet', () => {
    expect(addedSummary({ added: 1, alreadyOnSheet: 0, notCountable: 0 })).toBe('Added 1 item to the weekly count');
    expect(addedSummary({ added: 2, alreadyOnSheet: 1, notCountable: 0 })).toBe(
      'Added 2 items to the weekly count · 1 already on it'
    );
  });

  it('says an item already on the sheet will be counted there, not "Added 0"', () => {
    expect(addedSummary({ added: 0, alreadyOnSheet: 1, notCountable: 0 })).toBe(
      "Already on this week's count, so it will be counted there"
    );
    expect(addedSummary({ added: 0, alreadyOnSheet: 3, notCountable: 0 })).toBe(
      "All 3 already on this week's count, so they will be counted there"
    );
  });

  it('still reports items that are not countable', () => {
    expect(addedSummary({ added: 0, alreadyOnSheet: 0, notCountable: 1 })).toBe(
      'Added 0 items to the weekly count · 1 not a countable stock item'
    );
  });
});
