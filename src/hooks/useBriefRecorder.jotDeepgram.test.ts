import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const started: unknown[] = [];

vi.mock('../utils/keepAwake', () => ({
  requestKeepAwake: async () => ({ release: () => undefined }),
}));
vi.mock('../utils/scribeAudioCapture', () => ({
  startScribeAudioCapture: async () => ({ stop: () => undefined }),
}));
vi.mock('../api/soapScribe', () => ({
  createScribeSocket: (handlers: { onStatusChange?: (s: string) => void }) => ({
    start: async (target: unknown) => {
      started.push(target);
      handlers.onStatusChange?.('recording');
      return 'take-1';
    },
    sendAudio: () => undefined,
    stop: async () => 'Callback for Maria about Maple.',
    dispose: () => undefined,
  }),
}));

import { useBriefRecorder } from './useBriefRecorder';

/** B7 (owner, Nov 13, 2026): a Jot records through the scribe (Deepgram), never the browser's speech service. */
describe('Jot recording', () => {
  let speechBuilt = 0;
  beforeEach(() => {
    started.length = 0;
    speechBuilt = 0;
    class FakeSpeech {
      constructor() {
        speechBuilt += 1;
      }
      start() {}
      stop() {}
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeech;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeSpeech;
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it('records a Jot onto the Jot through the scribe socket', async () => {
    const { result } = renderHook(() => useBriefRecorder(null, { jotId: 'jot-1' }));
    await act(async () => {
      await result.current.start();
    });
    expect(started).toEqual([{ jotId: 'jot-1' }]);
    expect(speechBuilt).toBe(0);
    let text = '';
    await act(async () => {
      text = await result.current.stop();
    });
    expect(text).toBe('Callback for Maria about Maple.');
  });

  it('a Jot linked to a visit still records onto the Jot', async () => {
    const { result } = renderHook(() => useBriefRecorder('enc-1', { jotId: 'jot-1' }));
    await act(async () => {
      await result.current.start();
    });
    expect(started).toEqual([{ jotId: 'jot-1' }]);
  });

  it('a medical note records onto its visit', async () => {
    const { result } = renderHook(() => useBriefRecorder('enc-1'));
    await act(async () => {
      await result.current.start();
    });
    expect(started).toEqual(['enc-1']);
  });

  it('with nothing to record onto, it says so and never starts the browser speech service', async () => {
    const { result } = renderHook(() => useBriefRecorder(null));
    await act(async () => {
      await result.current.start();
    });
    expect(started).toEqual([]);
    expect(speechBuilt).toBe(0);
    expect(result.current.error).toMatch(/Save this note before recording/);
  });
});
