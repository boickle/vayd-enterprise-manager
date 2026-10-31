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

type OptionVariant = { options?: string[] };

/**
 * The listing's named choices, when every variant has a value for each and no two variants
 * match. Otherwise empty, and pickers fall back to strength and pack.
 */
export function namedOptionsOf(listing: { optionNames?: string[]; variants?: OptionVariant[] }): string[] {
  const names = listing.optionNames ?? [];
  const variants = listing.variants ?? [];
  if (!names.length || variants.length < 2) return [];
  const rows = variants.map((v) => v.options ?? []);
  if (rows.some((r) => r.length !== names.length || r.some((c) => !String(c).trim()))) return [];
  const keys = new Set(rows.map((r) => r.map((c) => c.toLowerCase()).join('\u0000')));
  return keys.size === rows.length ? names : [];
}

/** Values offered for choice `index`, given the choices before it. */
export function optionValuesAt(variants: OptionVariant[], index: number, picked: (string | null)[]): string[] {
  const fits = variants.filter((v) => picked.slice(0, index).every((p, i) => p == null || v.options?.[i] === p));
  return [...new Set(fits.map((v) => v.options?.[index]).filter((x): x is string => !!x))];
}

/** Picks kept where they still fit; a later pick that no longer exists moves to the first that does. */
export function settleOptionPicks(variants: OptionVariant[], count: number, picked: (string | null)[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const values = optionValuesAt(variants, i, out);
    const want = picked[i];
    out.push(want != null && values.includes(want) ? want : values[0] ?? '');
  }
  return out;
}

export function variantForPicks<T extends OptionVariant>(variants: T[], picked: string[]): T | null {
  return variants.find((v) => picked.every((p, i) => v.options?.[i] === p)) ?? null;
}

/** The choice whose values are all weight ranges (e.g. "4.4–9.9 lbs"), for picking by pet weight. */
export function weightOptionIndex(variants: OptionVariant[], count: number): number {
  for (let i = 0; i < count; i += 1) {
    const values = [...new Set(variants.map((v) => v.options?.[i] ?? ''))];
    if (values.length > 1 && values.every((v) => weightRangeLbs(v))) return i;
  }
  return -1;
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
