/**
 * AI-scribe Wave 4 batch F (plan: docs/test-plans/ai-scribe.md, section 6):
 * SCR-A2-1 reconnect into the same take after a Wi-Fi drop, SCR-A16-1 silence warning and
 * auto-stop, and the server's 2-hour stop notice. socket.io-client is replaced by a fake socket;
 * the real createScribeSocket runs. Fake clock throughout; nothing waits in real time.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScribePanel from './ScribePanel';
import { vitalsFromValue } from '../../utils/soapVitals';

type Handler = (...args: any[]) => void;

class FakeSocket {
  connected = false;
  handlers = new Map<string, Handler[]>();
  emitted: Array<{ event: string; payload: any }> = [];
  io = { reconnection: vi.fn() };
  /** What the fake server answers to scribe.stop. */
  stopTranscript: string | undefined = undefined;

  on(event: string, fn: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  once(event: string, fn: Handler) {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }
  off(event: string, fn: Handler) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== fn)
    );
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  disconnect() {
    this.connected = false;
    return this;
  }
  emit(event: string, payload: any, ack?: Handler) {
    this.emitted.push({ event, payload });
    if (event === 'scribe.start') ack?.({ ok: true, sessionId: 'sess-1' });
    if (event === 'scribe.stop') ack?.({ ok: true, sessionId: 'sess-1', transcript: this.stopTranscript });
    return this;
  }
  /** Server → browser. */
  fire(event: string, ...args: any[]) {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(...args);
  }
  serverConnect() {
    this.connected = true;
    this.fire('connect');
  }
  drop(reason = 'transport close') {
    this.connected = false;
    this.fire('disconnect', reason);
  }
  transcript(text: string, isFinal = true) {
    this.fire('scribe.transcript', { sessionId: 'sess-1', text, isFinal });
  }
  count(event: string) {
    return this.emitted.filter((e) => e.event === event).length;
  }
}

const mocks = vi.hoisted(() => ({
  sockets: [] as any[],
  tone: vi.fn(),
  onChunk: null as null | ((b64: string) => void),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const s = new FakeSocket();
    mocks.sockets.push(s);
    return s;
  }),
}));
vi.mock('../../api/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiBaseUrl: 'http://api.test',
  getToken: () => 'test-token',
}));
vi.mock('../../api/soapScribe', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/soapScribe')>();
  return {
    ...real,
    listScribeSessions: vi.fn().mockResolvedValue([]),
    structureTranscript: vi.fn(),
    clearScribeTranscript: vi.fn(),
  };
});
vi.mock('../../api/visitWorkflow', () => ({
  VISIT_WORKFLOW_PRACTICE_ID: 1,
  getHouseholdRoster: vi.fn().mockResolvedValue([]),
  getEncounter: vi.fn(),
  updateEncounter: vi.fn().mockResolvedValue({}),
  listProblems: vi.fn().mockResolvedValue([]),
  listOrders: vi.fn().mockResolvedValue([]),
  createProblem: vi.fn(),
}));
vi.mock('../../utils/appDialog', () => ({ appConfirm: vi.fn(), appConfirmChoice: vi.fn() }));
vi.mock('../../utils/keepAwake', () => ({
  requestKeepAwake: vi.fn().mockResolvedValue({ screenHeld: false, release: vi.fn() }),
}));
vi.mock('../../utils/scribeAudioCapture', () => ({
  startScribeAudioCapture: vi.fn(async (opts: { onChunk: (b64: string) => void }) => {
    mocks.onChunk = opts.onChunk;
    return { stop: vi.fn() };
  }),
}));
vi.mock('../../utils/scribeAlertTone', () => ({ playScribeAlertTone: mocks.tone }));

function renderPanel() {
  const props = {
    soapEncounterId: 'enc-a',
    patientId: 1,
    disabled: false,
    examEnabled: false,
    currentSubjective: '',
    currentVitals: vitalsFromValue({}),
    currentExam: {},
    currentObjectiveNotes: '',
    currentReasoning: '',
    currentPlanNotes: '',
    problems: [],
    orders: [],
    onApplySubjective: vi.fn(),
    onApplyVitals: vi.fn(),
    onApplyExam: vi.fn(),
    onApplyObjectiveNotes: vi.fn(),
    onApplyReasoning: vi.fn(),
    onApplyPlanNotes: vi.fn(),
    onApplyChart: vi.fn(),
    onProblemCreated: vi.fn(),
    onOrderCreated: vi.fn(),
  };
  render(<ScribePanel {...(props as any)} />);
}

const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Starts take 1 (an earlier take on this device skips the consent step) and returns its socket. */
async function startTake(): Promise<FakeSocket> {
  localStorage.setItem('scout.scribe.liveTranscript:enc-a', 'Earlier take.');
  renderPanel();
  await tick(10);
  fireEvent.click(screen.getByRole('button', { name: /Start take 1/ }));
  await tick(10);
  const sock = mocks.sockets[mocks.sockets.length - 1] as FakeSocket;
  await act(async () => {
    sock.serverConnect();
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByRole('button', { name: /Stop take 1/ })).toBeTruthy();
  return sock;
}

const pasteBox = () => screen.getByPlaceholderText(/Paste a visit transcript/) as HTMLTextAreaElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mocks.sockets.length = 0;
  mocks.onChunk = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SCR-A2-1 reconnect after a Wi-Fi drop', () => {
  it('plays a tone, shows the banner, resumes the same session and appends the text', async () => {
    const sock = await startTake();
    await act(async () => sock.transcript('Before the drop.'));

    await act(async () => sock.drop());
    expect(mocks.tone).toHaveBeenCalledWith('drop');
    expect(screen.getByRole('alert').textContent).toMatch(/Connection lost — reconnecting/);
    // Still the same take: Stop is still offered, nothing was saved as a new take.
    expect(screen.getByRole('button', { name: /Stop take 1/ })).toBeTruthy();

    // Words said while offline are kept and sent once back on the take.
    await act(async () => mocks.onChunk?.('AUDIO-WHILE-OFFLINE'));
    expect(sock.count('scribe.audio')).toBe(0);

    await act(async () => {
      sock.serverConnect();
      await vi.advanceTimersByTimeAsync(10);
    });
    const starts = sock.emitted.filter((e) => e.event === 'scribe.start');
    expect(starts).toHaveLength(2);
    expect(starts[0].payload.resumeSessionId).toBeUndefined();
    expect(starts[1].payload).toMatchObject({ soapEncounterId: 'enc-a', resumeSessionId: 'sess-1' });
    expect(sock.emitted.filter((e) => e.event === 'scribe.audio').map((e) => e.payload)).toEqual([
      { sessionId: 'sess-1', audioBase64: 'AUDIO-WHILE-OFFLINE' },
    ]);
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => sock.transcript('After the reconnect.'));
    fireEvent.click(screen.getByRole('button', { name: /Stop take 1/ }));
    await tick(10);

    expect(sock.count('scribe.stop')).toBe(1);
    expect(screen.getByText(/Take 1 saved/)).toBeTruthy();
    expect(pasteBox().value).toBe('Earlier take.\n\nBefore the drop.\nAfter the reconnect.');
  });

  it('ends the take, keeping its words, if the connection does not come back', async () => {
    const sock = await startTake();
    await act(async () => sock.transcript('Said before the drop.'));
    await act(async () => sock.drop());
    await tick(2 * 60 * 1000 + 10);

    expect(screen.queryByRole('button', { name: /Stop take 1/ })).toBeNull();
    expect(screen.getByText(/did not come back/)).toBeTruthy();
    expect(pasteBox().value).toBe('Earlier take.\n\nSaid before the drop.');
  });
});

describe('SCR-A16-1 silence warning and auto-stop', () => {
  it('warns with a tone and banner at 3 quiet minutes, then stops and saves the take at 5', async () => {
    const sock = await startTake();
    sock.stopTranscript = 'Peanut is bright and alert.';
    await act(async () => sock.transcript('Peanut is bright and alert.'));

    await tick(2 * 60 * 1000 + 50 * 1000);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.tone).not.toHaveBeenCalled();

    await tick(15 * 1000);
    expect(mocks.tone).toHaveBeenCalledWith('silence');
    expect(screen.getByRole('alert').textContent).toMatch(/No speech heard for 3 minutes/);
    expect(sock.count('scribe.stop')).toBe(0);

    await tick(2 * 60 * 1000);
    expect(sock.count('scribe.stop')).toBe(1);
    expect(screen.queryByRole('button', { name: /Stop take 1/ })).toBeNull();
    expect(screen.getByText(/Take 1 saved .*Stopped by itself after 5 minutes with no speech/)).toBeTruthy();
    expect(pasteBox().value).toBe('Earlier take.\n\nPeanut is bright and alert.');
  });

  it('speech clears the warning and restarts the quiet clock', async () => {
    const sock = await startTake();
    await tick(3 * 60 * 1000 + 2000);
    expect(screen.getByRole('alert')).toBeTruthy();

    await act(async () => sock.transcript('Still talking', false));
    expect(screen.queryByRole('alert')).toBeNull();
    await tick(4 * 60 * 1000);
    expect(sock.count('scribe.stop')).toBe(0);
    expect(screen.getByRole('button', { name: /Stop take 1/ })).toBeTruthy();
  });

  it('saves the take when the server stops it at the 2-hour cap', async () => {
    const sock = await startTake();
    await act(async () => sock.transcript('A very long visit.'));
    await act(async () => {
      sock.fire('scribe.stopped', {
        sessionId: 'sess-1',
        reason: 'max_length',
        transcript: 'A very long visit.',
      });
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(sock.count('scribe.stop')).toBe(0);
    expect(screen.getByText(/Take 1 saved .*2-hour limit/)).toBeTruthy();
    expect(pasteBox().value).toBe('Earlier take.\n\nA very long visit.');
  });
});
