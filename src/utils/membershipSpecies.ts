function entityLabel(x: unknown): string {
  if (x == null || typeof x !== 'object') return '';
  const o = x as Record<string, unknown>;
  const v = o.name ?? o.label ?? o.title;
  return v != null ? String(v).trim() : '';
}

function collectFromRow(row: unknown): string[] {
  if (row == null || typeof row !== 'object') return [];
  const r = row as Record<string, unknown>;
  const nested = r.patient as Record<string, unknown> | undefined;
  const pims =
    typeof r.pimsType === 'string'
      ? r.pimsType
      : typeof nested?.pimsType === 'string'
        ? nested.pimsType
        : '';
  const raw = [
    r.species,
    r.breed,
    entityLabel(r.speciesEntity),
    entityLabel(r.breedEntity),
    nested?.species,
    nested?.breed,
    entityLabel(nested?.speciesEntity),
    entityLabel(nested?.breedEntity),
    pims,
  ];
  return raw.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);
}

/**
 * Collect species/breed labels from room-loader and portal patient shapes.
 * Top-level row fields and nested `patient` may each carry species; `speciesEntity` / `breedEntity` are common when `species` is empty.
 */
export function collectMembershipSpeciesParts(p: unknown): string[] {
  return collectFromRow(p);
}

/** Optional extra objects (e.g. appointment `patient`) merged into detection only. */
export function membershipSpeciesDetectionString(p: unknown, extraSources?: unknown[]): string {
  const parts = [...collectFromRow(p)];
  if (extraSources?.length) {
    for (const ex of extraSources) {
      parts.push(...collectFromRow(ex));
    }
  }
  return parts.join(' ').toLowerCase();
}

/** First non-empty label for UI / Pet.species when a single field is required. */
export function membershipSpeciesPrimaryLabel(p: unknown, extraSources?: unknown[]): string | undefined {
  const first = collectFromRow(p)[0];
  if (first) return first;
  if (extraSources?.length) {
    for (const ex of extraSources) {
      const f = collectFromRow(ex)[0];
      if (f) return f;
    }
  }
  return undefined;
}

function scanPimsKind(obj: unknown): 'dog' | 'cat' | null {
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const keys = [o.pimsType, o.patientType, o.speciesType, o.speciesCategory, o.animalType] as unknown[];
  for (const c of keys) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const u = c.toUpperCase();
    if (/\b(CANINE|DOG)\b/.test(u) || u === 'K9') return 'dog';
    if (/\b(FELINE|CAT)\b/.test(u)) return 'cat';
  }
  return null;
}

function kindFromPimsFields(p: unknown, extras?: unknown[]): 'dog' | 'cat' | null {
  const k = scanPimsKind(p);
  if (k) return k;
  if (extras?.length) {
    for (const ex of extras) {
      const k2 = scanPimsKind(ex);
      if (k2) return k2;
    }
  }
  return null;
}

/** Longer phrases first to avoid partial matches (e.g. "american shorthair" before "shorthair"). */
const CAT_BREED_HINTS: string[] = [
  'domestic medium hair',
  'domestic longhair',
  'domestic shorthair',
  'british shorthair',
  'american shorthair',
  'exotic shorthair',
  'oriental shorthair',
  'norwegian forest',
  'maine coon',
  'scottish fold',
  'russian blue',
  'cornish rex',
  'devon rex',
  'english shorthair',
  'himalayan',
  'chartreux',
  'tonkinese',
  'ragdoll',
  'persian',
  'siamese',
  'sphynx',
  'bengal',
  'abyssinian',
  'burmese',
  'somali',
  'munchkin',
  'savannah',
  'birman',
  'korat',
  'manx',
  'balinese',
  'javanese',
  'laperm',
  'singapura',
  'toyger',
  'ocicat',
  'lynx point',
  'dsh',
  'dlh',
];

const DOG_BREED_HINTS: string[] = [
  'german shepherd',
  'golden retriever',
  'labrador retriever',
  'border collie',
  'australian shepherd',
  'jack russell',
  'staffordshire',
  'cane corso',
  'great pyrenees',
  'miniature schnauzer',
  'giant schnauzer',
  'standard schnauzer',
  'english springer',
  'irish setter',
  'gordon setter',
  'english bulldog',
  'american bulldog',
  'french bulldog',
  'boston terrier',
  'fox terrier',
  'rat terrier',
  'west highland',
  'cairn terrier',
  'yorkshire terrier',
  'miniature pinscher',
  'mountain dog',
  'great dane',
  'saint bernard',
  'st. bernard',
  'king charles',
  'cavalier',
  'chow chow',
  'newfoundland',
  'rhodesian ridgeback',
  'wirehaired',
  'smooth coat',
  'parson russell',
  'toy poodle',
  'mini poodle',
  'standard poodle',
  'goldendoodle',
  'labradoodle',
  'sheepadoodle',
  'bernedoodle',
  'maltipoo',
  'cockapoo',
  'schnoodle',
  'puggle',
  'chiweenie',
  'pit bull',
  'pitbull',
  'cattle dog',
  'retriever',
  'shepherd',
  'terrier',
  'poodle',
  'spaniel',
  'cocker',
  'hound',
  'beagle',
  'bulldog',
  'dachshund',
  'chihuahua',
  'husky',
  'malamute',
  'collie',
  'mastiff',
  'rottweiler',
  'doberman',
  'boxer',
  'pointer',
  'setter',
  'weimaraner',
  'vizsla',
  'akita',
  'shiba',
  'corgi',
  'papillon',
  'maltese',
  'yorkshire',
  'schnauzer',
  'whippet',
  'greyhound',
  'afghan',
  'basenji',
  'pomeranian',
  'bernese',
  'heeler',
  'kelpie',
  'aussie',
  'shih tzu',
  'bichon',
  'bloodhound',
  'borzoi',
  'samoyed',
  'pekingese',
  'dalmatian',
  'labrador',
  'pinscher',
  'pug',
  'staffy',
  'yorkie',
  'doodle',
];

function inferDogCatFromFreeText(s: string): 'dog' | 'cat' | null {
  if (!s.trim()) return null;
  // Word-boundary keywords (avoids false positives like "application" → "cat")
  if (/\b(dog|dogs|canine|canines|puppy|puppies)\b/i.test(s)) return 'dog';
  if (/\b(cat|cats|feline|felines|kitten|kittens|kitty|kitties)\b/i.test(s)) return 'cat';

  const lower = s.toLowerCase();
  for (const h of CAT_BREED_HINTS) {
    if (lower.includes(h)) return 'cat';
  }
  for (const h of DOG_BREED_HINTS) {
    if (lower.includes(h)) return 'dog';
  }
  return null;
}

/**
 * Resolve dog vs cat for membership catalog / pricing. Uses PIMS-style fields when present,
 * then keyword and breed heuristics over species, breed, and entity labels.
 */
export function resolveMembershipPetKind(p: unknown, extraSpeciesSources?: unknown[]): 'dog' | 'cat' | null {
  const fromPims = kindFromPimsFields(p, extraSpeciesSources);
  if (fromPims) return fromPims;
  const combined = membershipSpeciesDetectionString(p, extraSpeciesSources);
  return inferDogCatFromFreeText(combined);
}
