import {
  looksLikeHtmlFragment,
  sanitizeStoreDescriptionHtml,
} from './sanitizeCommunicationHtml';

export type StoreNameRef = {
  listingId: string;
  name: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function storeListingIdFromHref(href: string): string | null {
  const raw = String(href || '').trim();
  if (!raw) return null;
  try {
    const path = /^(https?:)?\/\//i.test(raw) ? new URL(raw, 'https://store.local').pathname : raw;
    const match = path.match(/\/store\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    /* ignore invalid urls */
  }
  if (/^p-\d+$/i.test(raw) || /^\d+$/.test(raw)) return raw;
  return null;
}

function normalizeListingId(
  id: string,
  listings: StoreNameRef[],
): string | null {
  const exact = listings.find((row) => row.listingId === id);
  if (exact) return exact.listingId;
  const productId = id.startsWith('p-') ? Number(id.slice(2)) : Number(id);
  if (!Number.isFinite(productId)) return null;
  const byProduct = listings.find((row) => row.listingId === `p-${productId}`);
  return byProduct?.listingId ?? null;
}

function nameAliases(listings: StoreNameRef[]): Array<[string, string]> {
  const aliases = new Map<string, string>();
  const add = (name: string, listingId: string) => {
    const key = name.trim().toLowerCase();
    if (key.length >= 6) aliases.set(key, listingId);
  };
  for (const row of listings) add(row.name, row.listingId);
  const rosewood = listings.find((row) => /rosewood/i.test(row.name));
  if (rosewood) {
    add('Hand-carved Rosewood Urn', rosewood.listingId);
    add('Hand-crafted Rosewood Urn', rosewood.listingId);
    add('Hand carved Rosewood Urn', rosewood.listingId);
    add('the Rosewood Urn', rosewood.listingId);
  }
  return [...aliases.entries()].sort((a, b) => b[0].length - a[0].length);
}

function inferClickHereListingId(before: string, listings: StoreNameRef[]): string | null {
  const ctx = before.toLowerCase();
  const find = (pattern: RegExp) => listings.find((row) => pattern.test(row.name))?.listingId ?? null;
  if (/name plate|brass name/.test(ctx)) {
    return find(/name plate/i);
  }
  if (/three lines|up to three|up to 3/.test(ctx)) {
    return find(/extra etching on metal|up to 3 lines/i);
  }
  if (/multiple lines|multiple personalized|4 lines|customize multiple/.test(ctx)) {
    return find(/wood etching - 4 lines|extra etching on wood|4 lines/i);
  }
  if (/etched into the wood|etch them into the wood|name etched|wood etchings of your pet/.test(ctx)) {
    return find(/wood etching - name only|wood urn etching \(name only\)/i);
  }
  if (/engrave your pet/.test(ctx)) {
    return find(/etched metal urn fg|etched metal urn so - name only/i);
  }
  return null;
}

function replaceOutsideAnchors(html: string, rewrite: (text: string) => string): string {
  return html
    .split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi)
    .map((part) => (/^<a\b/i.test(part) ? part : rewrite(part)))
    .join('');
}

export function enhanceStoreDescriptionHtml(
  raw: string,
  listings: StoreNameRef[],
): string {
  const html = looksLikeHtmlFragment(raw)
    ? sanitizeStoreDescriptionHtml(raw)
    : escapeHtml(raw);
  const aliases = nameAliases(listings);

  const withFixedAnchors = html.replace(
    /([^>]{0,100})<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (full, before, attrs, inner) => {
      const href = String(attrs).match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const text = String(inner).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const fromHref = normalizeListingId(storeListingIdFromHref(href) || '', listings);
      const fromText = aliases.find(([name]) => name === text.toLowerCase())?.[1] ?? null;
      const fromClick =
        /click here/i.test(text) ? inferClickHereListingId(String(before), listings) : null;
      const listingId = fromHref || fromText || fromClick;
      if (!listingId) return full;
      return `${before}<a href="/store/${listingId}">${inner}</a>`;
    },
  );

  const withNames = replaceOutsideAnchors(withFixedAnchors, (text) => {
    let next = text;
    for (const [name, listingId] of aliases) {
      const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
      next = next.replace(pattern, (match) => `<a href="/store/${listingId}">${match}</a>`);
    }
    return next;
  });

  return replaceOutsideAnchors(withNames, (text) =>
    text.replace(/click here/gi, (match, offset, full) => {
      const listingId = inferClickHereListingId(full.slice(0, offset), listings);
      return listingId ? `<a href="/store/${listingId}">${match}</a>` : match;
    }),
  );
}
