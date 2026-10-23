// Species filters for Room Loader rules. Stored as a string[] so a rule can
// apply to every species (`['any']`) or to several specific ones.

export const ROOM_LOADER_ALL_SPECIES = 'any';

export type RoomLoaderSpeciesSlug = string;
export type RoomLoaderSpeciesSelection = RoomLoaderSpeciesSlug[];

export type SpeciesCatalogRow = {
  id?: number;
  name: string;
  prettyName?: string;
};

function pickName(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'name' in raw) {
    const name = (raw as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/** Canonical slug: canine → dog, feline → cat, otherwise lowercased name. */
export function speciesSlug(raw: unknown): RoomLoaderSpeciesSlug {
  const s = pickName(raw).trim().toLowerCase();
  if (s === 'canine') return 'dog';
  if (s === 'feline') return 'cat';
  if (s === 'all' || s === 'every' || s === 'every species') return ROOM_LOADER_ALL_SPECIES;
  return s;
}

export function asSpeciesSelection(raw: unknown): RoomLoaderSpeciesSelection {
  const slugs = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .map(speciesSlug)
    .filter((slug) => slug !== '');
  if (slugs.length === 0 || slugs.includes(ROOM_LOADER_ALL_SPECIES)) {
    return [ROOM_LOADER_ALL_SPECIES];
  }
  return [...new Set(slugs)];
}

export function speciesSelectionIsAll(raw: unknown): boolean {
  return asSpeciesSelection(raw).includes(ROOM_LOADER_ALL_SPECIES);
}

export function speciesMatches(rule: unknown, patient: unknown): boolean {
  const ruleSel = asSpeciesSelection(rule);
  if (speciesSelectionIsAll(ruleSel)) return true;
  const patients = (Array.isArray(patient) ? patient : [patient])
    .map(speciesSlug)
    .filter((slug) => slug !== '');
  return patients.some((slug) => ruleSel.includes(slug));
}

export function speciesLabel(row: SpeciesCatalogRow): string {
  return (row.prettyName || row.name || '').trim() || row.name;
}

export function titleCaseSpecies(slug: string): string {
  if (slug === ROOM_LOADER_ALL_SPECIES) return 'All species';
  if (slug === 'dog') return 'Dogs';
  if (slug === 'cat') return 'Cats';
  if (!slug) return 'Unknown';
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Dogs and cats first; everyone else A–Z by display name. */
export function sortSpeciesCatalog<T extends SpeciesCatalogRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const rank = (row: SpeciesCatalogRow) => {
      const slug = speciesSlug(row.prettyName || row.name);
      if (slug === 'dog') return 0;
      if (slug === 'cat') return 1;
      return 2;
    };
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return speciesLabel(a).localeCompare(speciesLabel(b), undefined, { sensitivity: 'base' });
  });
}

export function describeSpeciesSelection(
  raw: unknown,
  catalog: readonly SpeciesCatalogRow[] = []
): string {
  const sel = asSpeciesSelection(raw);
  if (speciesSelectionIsAll(sel)) return 'All species';
  const labels = sel.map((slug) => {
    if (slug === 'dog') return 'Dogs';
    if (slug === 'cat') return 'Cats';
    const row = catalog.find((item) => speciesSlug(item.prettyName || item.name) === slug);
    return row ? speciesLabel(row) : titleCaseSpecies(slug);
  });
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/** Merge the practice catalog with slugs already on a rule so nothing disappears. */
export function speciesOptionsForEditor(
  catalog: readonly SpeciesCatalogRow[],
  current: unknown
): SpeciesCatalogRow[] {
  const seen = new Set<string>();
  const out: SpeciesCatalogRow[] = [];
  for (const row of sortSpeciesCatalog(catalog)) {
    const slug = speciesSlug(row.prettyName || row.name);
    if (!slug || slug === ROOM_LOADER_ALL_SPECIES || seen.has(slug)) continue;
    seen.add(slug);
    out.push(row);
  }
  for (const slug of asSpeciesSelection(current)) {
    if (slug === ROOM_LOADER_ALL_SPECIES || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: slug, prettyName: titleCaseSpecies(slug) });
  }
  if (out.length === 0) {
    out.push({ name: 'dog', prettyName: 'Dog' }, { name: 'cat', prettyName: 'Cat' });
  }
  return sortSpeciesCatalog(out);
}
