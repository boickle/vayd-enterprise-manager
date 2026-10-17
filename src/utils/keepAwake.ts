/**
 * Keep the screen on while something must not be interrupted (AI scribe recording).
 *
 * Browsers will stop getUserMedia and AudioContext the moment the device actually
 * sleeps. There is no reliable way to keep recording on a black screen. The Screen
 * Wake Lock API (plus a silent audio fallback for older Safari) is the honest
 * alternative: don't let the screen go to sleep in the first place.
 *
 * Locking the phone with the side button, or closing a laptop lid, still wins —
 * the OS, not the page, owns that.
 */

export type KeepAwakeHandle = {
  /** True when the browser accepted a screen wake lock (strongest guarantee). */
  screenHeld: boolean;
  release: () => void;
};

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

/**
 * 0.25s of silence as a WAV. Playing it on a loop is the older-iOS fallback
 * when Wake Lock is missing — it is enough to keep some phones from sleeping
 * while a recording is in progress.
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function startSilentKeepalive(): { stop: () => void } {
  if (typeof document === 'undefined') return { stop: () => {} };
  const audio = document.createElement('audio');
  audio.src = SILENT_WAV;
  audio.loop = true;
  audio.preload = 'auto';
  audio.setAttribute('playsinline', 'true');
  audio.setAttribute('aria-hidden', 'true');
  // Muted tracks are often ignored by iOS idle timers — keep volume tiny instead.
  audio.volume = 0.01;
  void audio.play().catch(() => {
    /* autoplay blocked — user already granted the mic, so this is rare */
  });
  return {
    stop: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}

export async function requestKeepAwake(): Promise<KeepAwakeHandle> {
  let released = false;
  let wakeLock: WakeLockSentinelLike | null = null;
  const silent = startSilentKeepalive();

  const acquireWakeLock = async (): Promise<boolean> => {
    if (released || typeof navigator === 'undefined') return false;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock?.request) return false;
    try {
      wakeLock = await nav.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        // A visibility change (app switcher, notification shade) drops the lock.
        // Re-take it as soon as we are visible again, while still recording.
      });
      return !wakeLock.released;
    } catch {
      // Battery saver, permission, or an unsupported browser — silent audio still runs.
      wakeLock = null;
      return false;
    }
  };

  let screenHeld = await acquireWakeLock();

  const onVisibility = () => {
    if (released || document.visibilityState !== 'visible') return;
    void acquireWakeLock().then((held) => {
      screenHeld = held;
    });
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get screenHeld() {
      return screenHeld && wakeLock != null && !wakeLock.released;
    },
    release: () => {
      if (released) return;
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      silent.stop();
      if (wakeLock && !wakeLock.released) {
        void wakeLock.release().catch(() => undefined);
      }
      wakeLock = null;
    },
  };
}
