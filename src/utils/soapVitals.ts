/**
 * The vitals recorded on a SOAP encounter, and the rules for when the weight counts.
 *
 * Lives here rather than on SoapEncounterPage because the scribe panel, the vitals fields,
 * and the wrap-up gate all need it — importing a page module from a component made an
 * import cycle and broke Fast Refresh on the SOAP page.
 */

export type WeightUnit = 'lb' | 'kg';

export type Vitals = {
  tempF: string;
  weight: string;
  /** Unit for `weight`. Ignored when `weightNotTaken`. Defaults to lb. */
  weightUnit: WeightUnit;
  /** Explicit: weight was not taken this visit (required alternative to a value). */
  weightNotTaken: boolean;
  /**
   * False only while a scribe-heard weight is waiting on the tech.
   *
   * The transcript is the one vital the AI guesses at, and a misheard "twelve" for "twenty"
   * re-doses the whole visit — so a weight the scribe supplied does not count as recorded
   * until someone standing at the scale says so. Anything typed by hand is confirmed by the
   * act of typing it, and charts written before this existed are treated as confirmed.
   */
  weightConfirmed: boolean;
  hr: string;
  rr: string;
  bcs: string;
  painScore: string;
};

/** True when the visit either recorded a confirmed weight + unit or chose "No weight taken". */
export function isWeightAddressed(v: Vitals): boolean {
  if (v.weightNotTaken) return true;
  return Boolean(v.weight.trim()) && v.weightConfirmed;
}

/** A weight the scribe heard that nobody has checked against the scale yet. */
export function isWeightAwaitingConfirmation(v: Vitals): boolean {
  return !v.weightNotTaken && Boolean(v.weight.trim()) && !v.weightConfirmed;
}

/** Display string for header / chart review, or null if nothing recorded. */
export function formatVitalWeight(v: Vitals): string | null {
  if (v.weightNotTaken) return 'No weight taken';
  const w = v.weight.trim();
  if (!w) return null;
  return `${w} ${v.weightUnit}`;
}

export function vitalsFromValue(v: unknown): Vitals {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (o[k] == null ? '' : String(o[k]));
  const unitRaw = String(o.weightUnit ?? '').toLowerCase();
  return {
    tempF: s('tempF'),
    weight: s('weight'),
    weightUnit: unitRaw === 'kg' ? 'kg' : 'lb',
    weightNotTaken: o.weightNotTaken === true || o.weightNotTaken === 'true',
    // Absent on charts written before confirmation existed — those weights were all
    // hand-entered, so reading them as unconfirmed would block signing retroactively.
    weightConfirmed:
      o.weightConfirmed == null
        ? true
        : o.weightConfirmed === true || o.weightConfirmed === 'true',
    hr: s('hr'),
    rr: s('rr'),
    bcs: s('bcs'),
    painScore: s('painScore'),
  };
}
