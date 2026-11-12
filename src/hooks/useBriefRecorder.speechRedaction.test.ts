import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBriefRecorder } from './useBriefRecorder';

vi.mock('../utils/keepAwake', () => ({
  requestKeepAwake: async () => ({ release: () => undefined }),
}));

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: unknown) => void) | null;
  onerror: unknown;
  onend: unknown;
  start: () => void;
  stop: () => void;
};

describe('SCR-A5 browser-speech fallback redaction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('redacts a spoken card number in the transcript and the saved draft', async () => {
    let rec!: Rec;
    class FakeSpeech {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: Rec['onresult'] = null;
      onerror = null;
      onend = null;
      constructor() {
        rec = this as unknown as Rec;
      }
      start() {}
      stop() {}
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeech;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [] }) },
    });

    const { result } = renderHook(() => useBriefRecorder(null, { draftKey: 'scr-a5-draft' }));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      rec.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'Card number is 4242 4242 4242 4242 thanks' } },
        ],
      });
    });
    expect(result.current.transcript).toContain('<CREDIT_CARD_NUMBER>');
    expect(result.current.transcript).not.toContain('4242');
    expect(localStorage.getItem('scr-a5-draft') ?? '').not.toContain('4242');
  });
});
