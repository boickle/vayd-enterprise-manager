/** Pure helpers for choosing a store product's strength / pack. Shared by the store page and the Room Loader form. */

export function weightRangeLbs(pack: string): { low: number; high: number } | null {
  const match = pack.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kg)?/i);
  if (!match) return null;
  let low = Number(match[1]);
  let high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (/kg/i.test(match[3] || '')) {
    low *= 2.20462;
    high *= 2.20462;
  }
  return low <= high ? { low, high } : { low: high, high: low };
}

/** The size whose range contains this weight. A weight on a shared boundary uses the higher range. */
export function packForWeight(packs: string[], lbs: number): string | null {
  const hits = packs
    .map((pack) => ({ pack, range: weightRangeLbs(pack) }))
    .filter((row): row is { pack: string; range: { low: number; high: number } } => row.range != null)
    .filter((row) => lbs + 0.001 >= row.range.low && lbs - 0.001 <= row.range.high)
    .sort((a, b) => a.range.low - b.range.low || a.range.high - b.range.high);
  return hits.length ? hits[hits.length - 1].pack : null;
}

export function shortPetWeight(lbs: number | null | undefined): string | null {
  if (lbs == null || !Number.isFinite(Number(lbs)) || Number(lbs) <= 0) return null;
  const n = Number(lbs);
  return Math.abs(n - Math.round(n)) < 0.05 ? `${Math.round(n)} lb` : `${Math.round(n * 10) / 10} lb`;
}

type PickVariant = { strength: string | null; pack: string };

/** Distinct strengths (e.g. 1-month, 3-month), in listing order. */
export function strengthsOf(variants: PickVariant[]): string[] {
  return [...new Set(variants.map((v) => v.strength).filter(Boolean))] as string[];
}

/** Distinct packs (e.g. weight ranges) for one strength (all packs when no strength is chosen). */
export function packsForStrengthOf(variants: PickVariant[], strength: string | null): string[] {
  return [...new Set(variants.filter((v) => !strength || v.strength === strength).map((v) => v.pack))];
}

/** Heading above the strength chips. */
export function strengthChipsLabel(strengths: string[]): string {
  return strengths.every((s) => /month/i.test(s))
    ? 'Duration'
    : strengths.every((s) => /mg/i.test(s))
      ? 'Tablet size'
      : 'Option';
}

/**
 * Heading above the pack chips. Choices with no number in them (flavors like "Beef", "Vanilla
 * Mint") are options, not sizes.
 */
export function packChipsLabel(strengths: string[], packs: string[] = []): string {
  if (packs.length > 0 && packs.every((p) => !/\d/.test(p))) return 'Option';
  return strengths.every((s) => /month/i.test(s)) ? 'Weight' : strengths.length ? 'Amount' : 'Size';
}
