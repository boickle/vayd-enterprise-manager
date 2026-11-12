// @vitest-environment jsdom
// SCR-A15-1: device copies of transcripts are removed on sign and on sign-out.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllScribeDeviceCopies, clearScribeDeviceCopy } from './scribeDeviceCopy';
import { forceLogout } from '../api/http';

function seed() {
  localStorage.clear();
  ['enc-a', 'enc-b'].forEach((id) => {
    localStorage.setItem(`scout.scribe.liveTranscript:${id}`, 'Doctor: private talk.');
    localStorage.setItem(`scout.scribe.appliedSuggestion:${id}`, '5:123');
  });
  localStorage.setItem('unrelated', 'keep');
}

describe('scribe device copy (SCR-A15)', () => {
  beforeEach(seed);

  it('signing a chart removes only that chart’s transcript and marker', () => {
    clearScribeDeviceCopy('enc-a');
    expect(localStorage.getItem('scout.scribe.liveTranscript:enc-a')).toBeNull();
    expect(localStorage.getItem('scout.scribe.appliedSuggestion:enc-a')).toBeNull();
    expect(localStorage.getItem('scout.scribe.liveTranscript:enc-b')).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('clearAll removes every chart’s copies', () => {
    clearAllScribeDeviceCopies();
    expect(localStorage.getItem('scout.scribe.liveTranscript:enc-b')).toBeNull();
    expect(localStorage.getItem('scout.scribe.appliedSuggestion:enc-b')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('forced sign-out clears them', () => {
    forceLogout();
    expect(localStorage.getItem('scout.scribe.liveTranscript:enc-a')).toBeNull();
    expect(localStorage.getItem('scout.scribe.appliedSuggestion:enc-b')).toBeNull();
  });
});
