/**
 * Short alert tones for the AI scribe, heard even when the doctor is not looking at the screen:
 * the connection dropped (SCR-A2), or no speech for a while (SCR-A16). Best effort: silent where
 * Web Audio is unavailable or blocked.
 */
export type ScribeAlertTone = 'drop' | 'silence';

const PATTERNS: Record<ScribeAlertTone, Array<{ freq: number; ms: number }>> = {
  // Falling two-note: something was lost.
  drop: [
    { freq: 880, ms: 160 },
    { freq: 440, ms: 260 },
  ],
  // Two soft equal beeps: a reminder.
  silence: [
    { freq: 660, ms: 140 },
    { freq: 660, ms: 140 },
  ],
};

export function playScribeAlertTone(kind: ScribeAlertTone): void {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    let t = ctx.currentTime;
    for (const note of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + note.ms / 1000);
      t += note.ms / 1000 + 0.06;
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), (t - ctx.currentTime) * 1000 + 200);
  } catch {
    /* no audio output; the banner still shows */
  }
}
