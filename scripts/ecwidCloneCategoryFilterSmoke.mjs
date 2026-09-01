/**
 * Smoke: room-loader Ecwid additional-items search must exclude "Clone(s)" categories.
 *
 * Repro (bugs-scout 1787860853.409899): Pavarotti Bauer pre-visit showed
 * Revolution Plus with SKU …(3_MONTH-5-SEMIANNUALLY) — a subscription Clone
 * product, not a client autoship. Search was dominated by Clone SKUs; retail
 * master SKU SQ0293023 was buried.
 *
 * Mirrors src/api/ecwid.ts filter helpers.
 *
 * Run: node scripts/ecwidCloneCategoryFilterSmoke.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ecwidCategoryDisplayName(cat) {
  if (!cat || typeof cat !== 'object') return '';
  const translated = cat.nameTranslated;
  if (typeof translated === 'string' && translated.trim()) return translated.trim();
  if (translated && typeof translated === 'object') {
    const en = translated.en;
    if (typeof en === 'string' && en.trim()) return en.trim();
  }
  return typeof cat.name === 'string' ? cat.name.trim() : '';
}

function isEcwidCloneCategoryName(name) {
  const s = (name ?? '').trim();
  if (!s) return false;
  return /\bclones?\b/i.test(s);
}

function isEcwidCloneCategoryProduct(product) {
  if (!product) return false;
  const cats = product.categories;
  if (!Array.isArray(cats) || cats.length === 0) return false;
  return cats.some((c) => isEcwidCloneCategoryName(ecwidCategoryDisplayName(c)));
}

function filterOutEcwidCloneProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return [];
  return products.filter((p) => !isEcwidCloneCategoryProduct(p));
}

// --- Category name matching ---
{
  assert(isEcwidCloneCategoryName('Revolution Plus Topical for Cats – Clones'), 'en-dash Clones');
  assert(isEcwidCloneCategoryName('Something - Clone'), 'singular Clone');
  assert(isEcwidCloneCategoryName('CLONES'), 'case-insensitive');
  assert(!isEcwidCloneCategoryName('Flea & Tick Preventatives'), 'retail category kept');
  assert(!isEcwidCloneCategoryName('Heartworm Preventatives'), 'heartworm kept');
  assert(!isEcwidCloneCategoryName(''), 'empty');
  assert(!isEcwidCloneCategoryName('Cyclones'), 'must be word-boundary clone');
}

// --- Pavarotti-style Revolution search payload ---
{
  const cloneSku = 'SQ0293023-11.1_-_22_-5-3_(3_MONTH-5-SEMIANNUALLY';
  const products = [
    {
      id: 1,
      name: 'Revolution Plus Topical for Cats',
      price: 88.56,
      sku: cloneSku,
      categories: [
        {
          id: 197965524,
          enabled: false,
          name: 'Revolution Plus Topical for Cats – Clones',
          nameTranslated: 'Revolution Plus Topical for Cats – Clones',
        },
      ],
    },
    {
      id: 2,
      name: 'Revolution Plus Topical for Cats',
      price: 88.56,
      sku: 'SQ0293023-11.1_-_22_-5-3_(3_MONTH-5-MONTHLY',
      categories: [
        {
          id: 197965524,
          enabled: false,
          name: 'Revolution Plus Topical for Cats – Clones',
        },
      ],
    },
    {
      id: 3,
      name: 'Revolution Plus Topical for Cats',
      price: 32.02,
      sku: 'SQ0293023',
      categories: [
        { id: 131881871, enabled: true, name: 'Heartworm Preventatives' },
        { id: 131880632, enabled: true, name: 'Flea & Tick Preventatives' },
        { id: 131881683, enabled: true, nameTranslated: { en: 'Dewormers' } },
      ],
    },
    {
      id: 4,
      name: 'Credelio Quattro',
      price: 40,
      sku: 'CREDELIO',
      // no categories — keep (cannot classify as clone)
    },
  ];

  const filtered = filterOutEcwidCloneProducts(products);
  assert(filtered.length === 2, `expected 2 products after filter, got ${filtered.length}`);
  assert(
    filtered.every((p) => p.sku !== cloneSku && !String(p.sku).includes('SEMIANNUALLY')),
    'clone SKUs must be removed'
  );
  assert(
    filtered.some((p) => p.sku === 'SQ0293023'),
    'retail master SKU must remain'
  );
  assert(
    filtered.some((p) => p.sku === 'CREDELIO'),
    'uncategorized products must remain'
  );
}

console.log('ecwidCloneCategoryFilterSmoke: ok');
